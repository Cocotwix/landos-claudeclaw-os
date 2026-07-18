// Browser Training Department — replay engine.
//
// Safely re-executes the non-paid steps of an approved/draft playbook against a
// test or alternate property to verify the workflow still works. Paid steps are
// never executed — they are skipped and flagged. The page driver is injectable
// so replay is fully unit-testable without a real browser, and so production
// replay runs against the existing CDP session (browser-session.ts).

import { screenPaidAction, screenPaidUrl } from './training-security.js';
import type { PageLike } from './browser-session.js';
import type { SynthesizedPlaybook } from './browser-training.js';
import { landosAudit } from './db.js';

export type ReplayStepStatus = 'passed' | 'failed' | 'skipped_paid' | 'skipped_unsupported';

export interface ReplayStepResult {
  index: number;
  action: string;
  status: ReplayStepStatus;
  detail: string;
}

export interface ReplayResult {
  ok: boolean;
  ranAt: number;
  passed: number;
  failed: number;
  skipped: number;
  paidBlocked: number;
  steps: ReplayStepResult[];
  summary: string;
}

export interface ReplayOptions {
  /** Optional variable overrides, e.g. { searchQuery: '123 Test Rd' }. */
  vars?: Record<string, string>;
  /** Directory for verification screenshots. */
  screenshotDir?: string;
}

/** Substitute {{var}} tokens in a step string from the vars map. */
function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

/**
 * Replay a playbook's steps against a page. `getPage` yields a PageLike (real
 * CDP page in prod, a fake in tests). Never buys anything: any step whose action
 * text or url looks paid is skipped and flagged.
 */
export async function replayPlaybook(
  playbook: SynthesizedPlaybook,
  getPage: () => Promise<PageLike>,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  const vars = opts.vars ?? {};
  const results: ReplayStepResult[] = [];
  const ranAt = Date.now();

  let page: PageLike | null = null;
  try {
    page = await getPage();
  } catch (err) {
    return {
      ok: false,
      ranAt,
      passed: 0,
      failed: 0,
      skipped: 0,
      paidBlocked: 0,
      steps: [],
      summary: `Could not open a browser page for replay: ${errMsg(err)}`,
    };
  }

  for (let i = 0; i < playbook.steps.length; i++) {
    const step = playbook.steps[i];
    const action = applyVars(step.action || '', vars);
    const url = step.url ? applyVars(step.url, vars) : '';
    const selector = step.selector || '';

    // Guard: never execute a paid step.
    if (screenPaidUrl(url).approvalRequired || screenPaidAction(action).approvalRequired) {
      results.push({ index: i, action, status: 'skipped_paid', detail: 'Paid action prohibited — skipped permanently.' });
      continue;
    }

    try {
      if (url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const landed = page.url();
        results.push({ index: i, action, status: 'passed', detail: `Navigated to ${landed}` });
      } else if (/^click/i.test(action) && selector) {
        const found = await page.evaluate<boolean>(
          `!!document.querySelector(${JSON.stringify(selector)})`,
        );
        if (found) {
          await page.evaluate(`(document.querySelector(${JSON.stringify(selector)}))?.click()`);
          results.push({ index: i, action, status: 'passed', detail: `Clicked ${selector}` });
        } else {
          results.push({ index: i, action, status: 'failed', detail: `Selector not found: ${selector}` });
        }
      } else if (/^enter|^input|^type/i.test(action) && selector) {
        const found = await page.evaluate<boolean>(
          `!!document.querySelector(${JSON.stringify(selector)})`,
        );
        results.push({
          index: i,
          action,
          status: found ? 'passed' : 'failed',
          detail: found ? `Input target present: ${selector}` : `Input target missing: ${selector}`,
        });
      } else if (/screenshot|capture/i.test(action)) {
        if (opts.screenshotDir) {
          const path = `${opts.screenshotDir}/replay_${i}.png`;
          await page.screenshot({ path });
          results.push({ index: i, action, status: 'passed', detail: `Screenshot ${path}` });
        } else {
          results.push({ index: i, action, status: 'passed', detail: 'Screenshot step (no dir configured)' });
        }
      } else {
        results.push({ index: i, action, status: 'skipped_unsupported', detail: 'No selector/url to replay deterministically.' });
      }
    } catch (err) {
      results.push({ index: i, action, status: 'failed', detail: errMsg(err) });
    }
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const paidBlocked = results.filter((r) => r.status === 'skipped_paid').length;
  const skipped = results.filter((r) => r.status === 'skipped_unsupported').length;
  const ok = failed === 0;

  const summary = `Replay: ${passed} passed, ${failed} failed, ${skipped} unsupported, ${paidBlocked} paid-blocked (${results.length} steps).`;
  landosAudit('browser-training', 'training_replay', summary, { blocked: paidBlocked > 0 });

  return { ok, ranAt, passed, failed, skipped, paidBlocked, steps: results, summary };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
