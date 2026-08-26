import { evaluateLandosSprintStop } from '../../scripts/omp/session-stop-guard.mjs';

function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text;
    }
    return '';
  }).join('\n');
}

export default function landosSessionStopGuard(pi: {
  on(event: 'session_stop', handler: (event: unknown, ctx: { cwd: string }) => unknown): void;
}) {
  pi.on('session_stop', async (event, ctx) => {
    const stopEvent = event as {
      messages?: unknown[];
      last_assistant_message?: unknown;
    };
    const transcriptRecords = Array.isArray(stopEvent.messages) ? stopEvent.messages : [];
    const input = {
      cwd: ctx.cwd,
      response: messageText(stopEvent.last_assistant_message),
    };
    const verdict = evaluateLandosSprintStop({ transcriptRecords, input });
    if (verdict.allow) return;
    return { decision: 'block', reason: verdict.reason };
  });
}