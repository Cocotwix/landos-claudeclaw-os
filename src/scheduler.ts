import { CronExpressionParser } from 'cron-parser';

import { AGENT_ID, ALLOWED_CHAT_ID, agentMcpAllowlist } from './config.js';
import {
  getDueTasks,
  getSession,
  logConversationTurn,
  claimScheduledTask,
  updateTaskAfterRun,
  resetStuckTasks,
  claimNextMissionTask,
  completeMissionTask,
  resetStuckMissionTasks,
  getMissionTask,
} from './db.js';
import { classifyExecution, formatOutcome, type ExecutionOutcome } from './failure-classification.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import { runAgent } from './agent.js';
import { formatForTelegram, splitMessage } from './bot.js';
import { runDukePreflight } from './landos/duke-preflight.js';
import { persistDukeRunPostDelivery } from './landos/duke-persist-adapter.js';
import { isDukeReportTask, runDukeReportFromTask } from './landos/duke-report-runner.js';

type Sender = (text: string) => Promise<void>;

/** Max time (ms) a scheduled task can run before being killed. */
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let sender: Sender;

/**
 * In-memory set of task IDs currently being executed.
 * Acts as a fast-path guard alongside the DB-level lock in markTaskRunning.
 */
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
let schedulerAgentId = 'main';

export function initScheduler(send: Sender, agentId = 'main'): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  schedulerAgentId = agentId;

  // Recover tasks stuck in 'running' from a previous crash
  const recovered = resetStuckTasks(agentId);
  if (recovered > 0) {
    logger.warn({ recovered, agentId }, 'Reset stuck tasks from previous crash');
  }
  const recoveredMission = resetStuckMissionTasks(agentId);
  if (recoveredMission > 0) {
    logger.warn({ recovered: recoveredMission, agentId }, 'Reset stuck mission tasks from previous crash');
  }

  setInterval(() => void runDueTasks(), 60_000);
  logger.info({ agentId }, 'Scheduler started (checking every 60s)');
}

async function runDueTasks(): Promise<void> {
  const tasks = getDueTasks(schedulerAgentId);

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, 'Running due scheduled tasks');
  }

  for (const task of tasks) {
    // In-memory guard: skip if already running in this process
    if (runningTaskIds.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already running, skipping duplicate fire');
      continue;
    }

    // Compute next occurrence BEFORE executing so the claim can advance
    // next_run in the same statement, preventing re-fire on subsequent ticks.
    const nextRun = computeNextRun(task.schedule);

    // Atomic claim. getDueTasks() is a plain read, so a second scheduler (a
    // sibling agent process, or an old process overlapping a managed restart)
    // can see the same row. Only the caller whose UPDATE actually changed a row
    // is allowed to execute it — this is what prevents duplicate execution
    // across processes, where the in-memory runningTaskIds guard cannot help.
    if (!claimScheduledTask(task.id, nextRun)) {
      logger.warn({ taskId: task.id }, 'Task already claimed by another scheduler, skipping');
      continue;
    }
    runningTaskIds.add(task.id);

    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    // Route through the message queue so scheduled tasks wait for any
    // in-flight user message to finish before running. This prevents
    // two Claude processes from hitting the same session simultaneously.
    const chatId = ALLOWED_CHAT_ID || 'scheduler';
    messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        await sender(`Scheduled task running: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? '...' : ''}"`);

        // Run as a fresh agent call (no session — scheduled tasks are autonomous)
        const result = await runAgent(task.prompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist);
        clearTimeout(timeout);

        if (result.aborted) {
          const outcome = classifyExecution({ timedOut: true });
          updateTaskAfterRun(task.id, nextRun, 'Timed out after 10 minutes', 'timeout', outcome.category);
          await sender(`⏱ Task timed out after 10m: "${task.prompt.slice(0, 60)}..." — killed.`);
          logger.warn({ taskId: task.id, category: outcome.category }, 'Task timed out');
          return;
        }

        const text = result.text?.trim() || 'Task completed with no output.';
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject task output into the active chat session so user replies have context
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${task.prompt}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        // A clean run that produced nothing is recorded as invalid_output, not
        // as a success — the operator needs to be able to tell them apart.
        const outcome = classifyExecution({ output: result.text, requireOutput: true });
        updateTaskAfterRun(
          task.id, nextRun, text,
          outcome.ok ? 'success' : 'failed',
          outcome.ok ? null : outcome.category,
        );

        logger.info({ taskId: task.id, nextRun, category: outcome.category }, 'Task complete, next run scheduled');
      } catch (err) {
        clearTimeout(timeout);
        // Classify before reporting: an expired provider login must not be
        // written to the store as a crashed subprocess. detail is redacted.
        const outcome = classifyExecution({
          error: err,
          cancelledByUser: false,
          aborted: abortController.signal.aborted,
        });
        updateTaskAfterRun(task.id, nextRun, formatOutcome(outcome).slice(0, 500), 'failed', outcome.category);

        logger.error({ err, taskId: task.id, category: outcome.category }, 'Scheduled task failed');
        try {
          await sender(`❌ Task failed: "${task.prompt.slice(0, 60)}..." — ${formatOutcome(outcome).slice(0, 300)}`);
        } catch {
          // ignore send failure
        }
      } finally {
        runningTaskIds.delete(task.id);
      }
    });
  }

  // Also check for queued mission tasks (one-shot async tasks from Mission Control)
  await runDueMissionTasks();
}

async function runDueMissionTasks(): Promise<void> {
  const mission = claimNextMissionTask(schedulerAgentId);
  if (!mission) return;

  const missionKey = 'mission-' + mission.id;
  if (runningTaskIds.has(missionKey)) return;
  runningTaskIds.add(missionKey);

  logger.info({ missionId: mission.id, title: mission.title }, 'Running mission task');

  const chatId = ALLOWED_CHAT_ID || 'mission';
  messageQueue.enqueue(chatId, async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

    // Cross-process cancel signal: dashboard flips status to 'cancelled' in
    // SQLite, this poll picks it up within 5s and aborts the runAgent call.
    let cancelledByUser = false;
    const cancelPoll = setInterval(() => {
      const current = getMissionTask(mission.id);
      if (current?.status === 'cancelled') {
        cancelledByUser = true;
        abortController.abort();
        clearInterval(cancelPoll);
      }
    }, 5_000);

    try {
      // Dashboard "Run Duke Report" tasks run through Duke's REAL preflight +
      // standardized writeback flow (not the generic runAgent path). Guarded by
      // isDukeReportTask so all other mission tasks are unaffected.
      if (isDukeReportTask(mission)) {
        const res = await runDukeReportFromTask(mission, {
          runDukePreflight,
          // Use the allowlist the runner supplies (the preflight-filtered one for
          // a verified run — LandPortal MCP excluded), not the original allowlist.
          runAgent: (p, allowlist) => runAgent(p, undefined, () => {}, undefined, undefined, abortController, undefined, allowlist ?? agentMcpAllowlist),
          persistDukeRunPostDelivery,
          mcpAllowlist: agentMcpAllowlist,
          timeoutMs: TASK_TIMEOUT_MS,
        });
        clearTimeout(timeout);
        clearInterval(cancelPoll);
        if (cancelledByUser) {
          logger.info({ missionId: mission.id }, 'Duke Report mission task cancelled by user');
        } else {
          const dukeOutcome: ExecutionOutcome = res.status === 'completed'
            ? classifyExecution({ output: res.summary, requireOutput: true })
            : classifyExecution({ error: res.error ?? 'Duke Report run failed' });
          completeMissionTask(mission.id, res.summary, res.status, res.error, res.status === 'completed' && dukeOutcome.ok ? null : dukeOutcome.category);
          logger.info({ missionId: mission.id, verified: res.verified, reportStatus: res.reportStatus, category: dukeOutcome.category }, 'Duke Report mission task finished');
          try {
            await sender('Duke Report "' + mission.title + '": ' + res.summary);
          } catch (sendErr) {
            logger.warn({ err: sendErr, missionId: mission.id }, 'Failed to send Duke Report notification');
          }
        }
        return;
      }

      const result = await runAgent(mission.prompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist);
      clearTimeout(timeout);
      clearInterval(cancelPoll);

      if (result.aborted) {
        if (cancelledByUser) {
          // Status is already 'cancelled' from the dashboard write — leave it.
          logger.info({ missionId: mission.id }, 'Mission task cancelled by user');
        } else {
          const outcome = classifyExecution({ timedOut: true });
          completeMissionTask(mission.id, null, 'failed', 'Timed out after 10 minutes', outcome.category);
          logger.warn({ missionId: mission.id, category: outcome.category }, 'Mission task timed out');
          try {
            await sender('Mission task timed out: "' + mission.title + '"');
          } catch (sendErr) {
            // Sender can fail for Telegram API blips or chat-not-found. We
            // still want to see it so the user isn't silently unnotified.
            logger.warn({ err: sendErr, missionId: mission.id }, 'Failed to send mission timeout notification');
          }
        }
      } else {
        const text = result.text?.trim() || 'Task completed with no output.';
        // A clean run with no output is invalid_output, not a completion. The
        // text is still stored so nothing an agent produced is lost.
        const outcome = classifyExecution({ output: result.text, requireOutput: true });
        completeMissionTask(
          mission.id, text,
          outcome.ok ? 'completed' : 'failed',
          outcome.ok ? undefined : outcome.message,
          outcome.ok ? null : outcome.category,
        );
        logger.info({ missionId: mission.id, category: outcome.category }, 'Mission task finished');

        // Send result to Telegram
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject into conversation context so agent can reference it
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', '[Mission task: ' + mission.title + ']: ' + mission.prompt, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      clearInterval(cancelPoll);
      const outcome = classifyExecution({
        error: err,
        cancelledByUser,
        aborted: abortController.signal.aborted,
      });
      if (cancelledByUser) {
        logger.info({ missionId: mission.id }, 'Mission task cancelled by user (threw on abort)');
      } else {
        // formatOutcome is redacted, so the persisted error is safe to show on
        // the dashboard and in the CLI.
        completeMissionTask(mission.id, null, 'failed', formatOutcome(outcome).slice(0, 500), outcome.category);
        logger.error({ err, missionId: mission.id, category: outcome.category }, 'Mission task failed');
      }
    } finally {
      clearInterval(cancelPoll);
      runningTaskIds.delete(missionKey);
    }
  });
}

export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
