// LandOS — Browser Intelligence: failure diagnosis (INSPECT before concluding).
//
// The behavior layer above evidence-driven search, inspect-and-learn, and site
// navigation models. When a workflow APPEARS to fail (no parcel/record reached),
// Browser Intelligence must not immediately declare "no results". First it
// inspects the intermediate page state and asks whether the site was actually
// waiting on a required next action:
//
//   • an autocomplete option / selectable row     • a validation message
//   • a checkbox / radio to tick                  • a modal to dismiss
//   • a pending selection not yet made            • a "select before search" gate
//   • a disabled or enabled submit button         • a "submit after select" gate
//   • a results table to open                     • a filter state
//
// If it finds one, it DIAGNOSES the missing step, retries the corrected action,
// and only THEN — if still nothing — concludes the result was not found. The
// missing step is recorded on the site's navigation playbook so the site is
// navigated correctly next time. Generic across EVERY interactive site (GIS,
// assessor, recorder, Zillow/Redfin/Realtor, and non-real-estate sites).
//
// The diagnosis itself is PURE (reads a PageObservation). Recovery drives generic
// driver methods only. This never fabricates a "reached" state — the caller still
// verifies ParcelIdentity before any downstream work runs.

import type { PageObservation, InteractiveState } from './website-intelligence.js';
import type { BrowserDriver, BrowserSearchKey } from './browser-intelligence.js';

// ── Diagnosis ────────────────────────────────────────────────────────────────

export type NextActionKind =
  | 'select_option'        // a selectable option/checkbox/radio is pending → select it
  | 'submit_after_select'  // a selection was made but not submitted → submit
  | 'dismiss_modal'        // a modal/dialog is intercepting interaction → dismiss it
  | 'open_result'          // a results table is showing → open the matching row
  | 'none';                // nothing actionable — genuinely no result

export type NavDependency = 'select_before_search' | 'submit_after_select' | null;

export interface FailureDiagnosis {
  /** Did the intermediate page reveal a required action that was skipped? */
  hasPendingAction: boolean;
  /** The single best next action to attempt. */
  nextAction: NextActionKind;
  /** Every intermediate-state signal detected (provenance + operator note). */
  signals: string[];
  /** Human-readable diagnosis. */
  diagnosis: string;
  /** The missing navigation step to record on the playbook (null when none). */
  missingStep: string | null;
  /** The learned navigation dependency this reveals, if any. */
  dependency: NavDependency;
}

const EMPTY_INTERACTIVE: InteractiveState = {
  checkboxes: 0, radios: 0, selectableOptions: 0, submit: { present: false, disabled: false },
  validationMessages: [], hasModal: false, hasSelection: false, filterActive: false,
};

const NONE: FailureDiagnosis = {
  hasPendingAction: false, nextAction: 'none', signals: [],
  diagnosis: 'No pending intermediate action found — the page shows no selectable option, checkbox, submit, validation, modal, or results table to act on.',
  missingStep: null, dependency: null,
};

/**
 * Inspect the intermediate page state of an apparently-failed workflow and decide
 * whether a required next action was skipped. Pure. Priority: a blocking modal is
 * cleared first; a validation message is read; a pending selection is made BEFORE
 * a search (select-before-search); a made selection is submitted (submit-after-
 * select); otherwise a results table is opened. Only when none apply is the result
 * genuinely "not found".
 */
export function diagnoseFailure(obs: PageObservation): FailureDiagnosis {
  const i: InteractiveState = { ...EMPTY_INTERACTIVE, ...(obs.interactive ?? {}) };
  const submit = i.submit ?? { present: false, disabled: false };
  const signals: string[] = [];
  if (i.selectableOptions > 0) signals.push('selectable_option');
  if (i.checkboxes > 0) signals.push('checkbox');
  if (i.radios > 0) signals.push('radio');
  if (submit.present) signals.push(submit.disabled ? 'submit_disabled' : 'submit_enabled');
  if (i.validationMessages.length) signals.push('validation_message');
  if (i.hasModal) signals.push('modal');
  if (i.hasSelection) signals.push('pending_selection_made');
  if (obs.hasTable) signals.push('results_table');
  if (i.filterActive) signals.push('filter_active');

  const hasSelectable = i.selectableOptions > 0 || i.checkboxes > 0 || i.radios > 0;

  // 1) A modal blocks everything — dismiss it first.
  if (i.hasModal) {
    return mk('dismiss_modal', signals, 'A modal/dialog is open and intercepting interaction — dismiss it, then retry the search.', 'Dismiss the modal/dialog before interacting with the search.', null);
  }

  // 2) A selection is pending and has not been made → select before searching.
  //    (Autocomplete option, checkbox, or radio present, nothing selected yet.)
  if (hasSelectable && !i.hasSelection) {
    signals.push('select_before_search');
    const what = i.selectableOptions > 0 ? 'the matching autocomplete option' : i.checkboxes > 0 ? 'the matching checkbox option' : 'the matching option';
    return mk('select_option', signals, `The site surfaced a selectable option but none is selected — ${what} must be selected before the search runs.`, `Select ${what} before searching (select-before-search).`, 'select_before_search');
  }

  // 3) A selection HAS been made but the search was not submitted → submit after select.
  if (i.hasSelection && submit.present) {
    signals.push('submit_after_select');
    return mk('submit_after_select', signals, 'An option is selected but the search was not submitted — the parcel opens only after Search is clicked (submit-after-select).', 'Submit the search AFTER selecting the option (submit-after-select).', 'submit_after_select');
  }

  // 4) Submit is DISABLED — a required action is still pending. Prefer selecting a
  //    pending option; otherwise there is nothing safe to do automatically.
  if (submit.present && submit.disabled) {
    if (hasSelectable) {
      signals.push('select_before_search');
      return mk('select_option', signals, 'The submit button is disabled — a required selection is pending; select the matching option to enable it.', 'Select the required option to enable the submit button.', 'select_before_search');
    }
    return { ...NONE, signals, diagnosis: 'The submit button is disabled and no selectable option is visible — a required field may be missing; cannot recover automatically.' };
  }

  // 5) A validation message is present with no clearer selectable action → surface it.
  if (i.validationMessages.length && submit.present) {
    signals.push('submit_after_select');
    return mk('submit_after_select', signals, `Validation/required message present ("${i.validationMessages[0]}") — resubmit after resolving it.`, `Resolve the required message ("${i.validationMessages[0]}") then submit.`, 'submit_after_select');
  }

  // 6) A results table is showing but no detail reached → open the matching row.
  if (obs.hasTable) {
    return mk('open_result', signals, 'A results table is showing but no detail page was reached — open the matching result row.', 'Open the matching result row to reach the detail page.', null);
  }

  return { ...NONE, signals };
}

function mk(nextAction: NextActionKind, signals: string[], diagnosis: string, missingStep: string | null, dependency: NavDependency): FailureDiagnosis {
  return { hasPendingAction: nextAction !== 'none', nextAction, signals: [...new Set(signals)], diagnosis, missingStep, dependency };
}

// ── Recovery ───────────────────────────────────────────────────────────────

export interface RecoveryDeps {
  driver: BrowserDriver;
  diagnosis: FailureDiagnosis;
  key: BrowserSearchKey;
  /** Pick the best candidate to select (defaults to first when the picker returns
   *  null but exactly one option exists). Injected to reuse the site's scorer. */
  pickCandidate: (candidates: Array<{ index: number; text: string; kind: string }>, key: BrowserSearchKey) => { index: number } | null;
  opts: { timeoutMs: number };
}

/** Dismiss-modal labels tried in order (generic). */
const DISMISS_LABELS = ['Close', 'Dismiss', 'Got it', 'Continue', 'Accept', 'OK', 'I agree', 'Agree'];

/**
 * Execute the diagnosed next action using generic driver methods, then RE-OBSERVE
 * and return the resulting page. Never verifies — the caller re-runs the identity
 * check. Read-only navigation; performs only the single corrective action.
 */
export async function attemptRecovery(deps: RecoveryDeps): Promise<PageObservation | null> {
  const { driver, diagnosis, key, opts } = deps;
  const observe = async (): Promise<PageObservation | null> => driver.observe ? (await driver.observe(opts)) as PageObservation : null;

  switch (diagnosis.nextAction) {
    case 'select_option':
    case 'open_result': {
      if (!driver.readCandidates || !driver.clickCandidate) return observe();
      const candidates = await driver.readCandidates(opts);
      if (!candidates.length) return observe();
      const best = deps.pickCandidate(candidates, key) ?? (candidates.length === 1 ? { index: candidates[0].index } : null);
      if (!best) return observe();
      await driver.clickCandidate(best.index, opts);
      // For select-before-search, the selection alone does not open the record —
      // submit if the driver supports it (submit-after-select is the paired step).
      if (diagnosis.nextAction === 'select_option' && driver.submitSearch) {
        const mid = await observe();
        // Only submit if we are not already on a record (selection may auto-open).
        if (mid && !/property=|parcel=|record=/.test(mid.url)) await driver.submitSearch(opts);
      }
      return observe();
    }
    case 'submit_after_select': {
      if (driver.submitSearch) await driver.submitSearch(opts);
      return observe();
    }
    case 'dismiss_modal': {
      if (driver.clickByText) { for (const label of DISMISS_LABELS) { try { await driver.clickByText(label, opts); break; } catch { /* try next */ } } }
      return observe();
    }
    default:
      return observe();
  }
}
