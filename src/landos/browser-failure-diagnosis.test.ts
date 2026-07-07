import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { diagnoseFailure, attemptRecovery } from './browser-failure-diagnosis.js';
import { recordNavigationRequirement, getNavigationModel, buildNavigationModel, saveNavigationModel } from './browser-navigation-model.js';
import type { PageObservation, InteractiveState } from './website-intelligence.js';
import type { BrowserDriver } from './browser-intelligence.js';

function obs(over: Partial<PageObservation> = {}, interactive?: Partial<InteractiveState>): PageObservation {
  const base: PageObservation = {
    url: 'https://site.gov/', title: 'Search', headings: [], navItems: [], buttons: [],
    searchControls: [{ selector: '#q', placeholder: 'Search' }], links: [], hasMap: false, hasTable: false,
    fields: {}, loginLike: false, ...over,
  };
  if (interactive) base.interactive = {
    checkboxes: 0, radios: 0, selectableOptions: 0, submit: { present: false, disabled: false },
    validationMessages: [], hasModal: false, hasSelection: false, filterActive: false, ...interactive,
  };
  return base;
}

// ── diagnoseFailure — reads the intermediate state, not just "0 results" ───────
describe('diagnoseFailure — inspect intermediate state before concluding no results', () => {
  it('no interactive signals → genuinely nothing to do (no pending action)', () => {
    const d = diagnoseFailure(obs());
    expect(d.hasPendingAction).toBe(false);
    expect(d.nextAction).toBe('none');
  });

  it('a pending SELECTABLE OPTION with no selection → select-before-search', () => {
    const d = diagnoseFailure(obs({}, { selectableOptions: 1 }));
    expect(d.nextAction).toBe('select_option');
    expect(d.dependency).toBe('select_before_search');
    expect(d.signals).toEqual(expect.arrayContaining(['selectable_option', 'select_before_search']));
    expect(d.missingStep).toMatch(/select/i);
  });

  it('a CHECKBOX with no selection → select-before-search', () => {
    expect(diagnoseFailure(obs({}, { checkboxes: 1 })).nextAction).toBe('select_option');
  });

  it('a RADIO with no selection → select-before-search', () => {
    expect(diagnoseFailure(obs({}, { radios: 1 })).nextAction).toBe('select_option');
  });

  it('a selection MADE + a submit button → submit-after-select', () => {
    const d = diagnoseFailure(obs({}, { selectableOptions: 1, hasSelection: true, submit: { present: true, disabled: false } }));
    expect(d.nextAction).toBe('submit_after_select');
    expect(d.dependency).toBe('submit_after_select');
    expect(d.signals).toContain('submit_after_select');
    expect(d.missingStep).toMatch(/submit/i);
  });

  it('a DISABLED submit with a pending option → select the option to enable it', () => {
    const d = diagnoseFailure(obs({}, { selectableOptions: 1, submit: { present: true, disabled: true } }));
    expect(d.nextAction).toBe('select_option');
    expect(d.signals).toContain('submit_disabled');
  });

  it('a DISABLED submit with nothing selectable → cannot recover automatically', () => {
    const d = diagnoseFailure(obs({}, { submit: { present: true, disabled: true } }));
    expect(d.hasPendingAction).toBe(false);
    expect(d.signals).toContain('submit_disabled');
  });

  it('a MODAL blocks everything → dismiss it first', () => {
    const d = diagnoseFailure(obs({}, { hasModal: true, selectableOptions: 1 }));
    expect(d.nextAction).toBe('dismiss_modal');
    expect(d.signals).toContain('modal');
  });

  it('a VALIDATION message with a submit → resolve + resubmit', () => {
    const d = diagnoseFailure(obs({}, { validationMessages: ['Please select a parcel'], submit: { present: true, disabled: false } }));
    expect(d.nextAction).toBe('submit_after_select');
    expect(d.signals).toContain('validation_message');
  });

  it('a RESULTS TABLE with no detail reached → open the matching row', () => {
    const d = diagnoseFailure(obs({ hasTable: true }, { selectableOptions: 0 }));
    expect(d.nextAction).toBe('open_result');
    expect(d.signals).toContain('results_table');
  });
});

// ── Generic across site families (not LandPortal-specific) ─────────────────────
describe('diagnoseFailure — generic across interactive site families', () => {
  it('County GIS: identify/select a parcel feature before its record opens', () => {
    const gis = obs({ url: 'https://gis.county.gov/', title: 'County GIS Parcel Viewer', hasMap: true }, { selectableOptions: 2 });
    expect(diagnoseFailure(gis).nextAction).toBe('select_option');
  });
  it('Assessor: a results table needs the matching row opened', () => {
    const assessor = obs({ url: 'https://assessor.gov/', title: 'Property Record Search', hasTable: true });
    expect(diagnoseFailure(assessor).nextAction).toBe('open_result');
  });
  it('Recorder: a disclaimer modal must be dismissed first', () => {
    const recorder = obs({ url: 'https://deeds.gov/', title: 'Register of Deeds' }, { hasModal: true });
    expect(diagnoseFailure(recorder).nextAction).toBe('dismiss_modal');
  });
  it('Zillow/Redfin/Realtor: an address autocomplete option must be selected then submitted', () => {
    const zillow = obs({ url: 'https://www.zillow.com/', title: 'Zillow' }, { selectableOptions: 5 });
    const first = diagnoseFailure(zillow);
    expect(first.nextAction).toBe('select_option');
    const afterSelect = diagnoseFailure(obs({ url: 'https://www.zillow.com/' }, { selectableOptions: 5, hasSelection: true, submit: { present: true, disabled: false } }));
    expect(afterSelect.nextAction).toBe('submit_after_select');
  });
  it('a non-real-estate business site: same select-then-submit logic applies', () => {
    const biz = obs({ url: 'https://utility.example.com/', title: 'Account Lookup' }, { selectableOptions: 1, hasSelection: true, submit: { present: true, disabled: false } });
    expect(diagnoseFailure(biz).nextAction).toBe('submit_after_select');
  });
});

// ── attemptRecovery — drives the corrected action via generic driver methods ───
describe('attemptRecovery — executes the diagnosed next action', () => {
  const pick = (c: Array<{ index: number }>) => (c[0] ? { index: c[0].index } : null);

  it('submit-after-select → calls submitSearch', async () => {
    const calls = { submitted: 0 };
    const driver = {
      id: 'x', configured: () => true,
      async observe() { return obs(); },
      async submitSearch() { calls.submitted++; },
    } as unknown as BrowserDriver;
    await attemptRecovery({ driver, diagnosis: diagnoseFailure(obs({}, { hasSelection: true, submit: { present: true, disabled: false }, selectableOptions: 1 })), key: {}, pickCandidate: pick, opts: { timeoutMs: 100 } });
    expect(calls.submitted).toBe(1);
  });

  it('select-option → reads candidates, clicks the match, then submits', async () => {
    const calls = { clicked: -1, submitted: 0 };
    const driver = {
      id: 'x', configured: () => true,
      async observe() { return obs(); },
      async readCandidates() { return [{ index: 0, text: 'match', kind: 'row' }]; },
      async clickCandidate(i: number) { calls.clicked = i; },
      async submitSearch() { calls.submitted++; },
    } as unknown as BrowserDriver;
    await attemptRecovery({ driver, diagnosis: diagnoseFailure(obs({}, { selectableOptions: 1 })), key: {}, pickCandidate: pick, opts: { timeoutMs: 100 } });
    expect(calls.clicked).toBe(0);
    expect(calls.submitted).toBe(1);
  });

  it('dismiss-modal → clicks a dismiss control', async () => {
    const calls = { clickedText: '' };
    const driver = {
      id: 'x', configured: () => true,
      async observe() { return obs(); },
      async clickByText(txt: string) { calls.clickedText = txt; },
    } as unknown as BrowserDriver;
    await attemptRecovery({ driver, diagnosis: diagnoseFailure(obs({}, { hasModal: true })), key: {}, pickCandidate: pick, opts: { timeoutMs: 100 } });
    expect(calls.clickedText).toBeTruthy();
  });
});

// ── recordNavigationRequirement — the playbook records the missing step ────────
describe('recordNavigationRequirement — playbook learns the missing step', () => {
  beforeEach(() => _initTestLandosDb());

  it('appends the learned requirement, bumping the section + model version', () => {
    saveNavigationModel(buildNavigationModel('landportal.com', obs({ url: 'https://landportal.com/' })));
    const before = getNavigationModel('landportal.com')!;
    const after = recordNavigationRequirement('landportal.com', 'Submit the search AFTER selecting the option (submit-after-select).', obs());
    expect(after).not.toBeNull();
    expect(after!.navigationDependencies).toContain('Submit the search AFTER selecting the option (submit-after-select).');
    expect(after!.version).toBe(before.version + 1);
    expect(after!.sectionRevisions.navigationDependencies).toBe((before.sectionRevisions.navigationDependencies ?? 1) + 1);
  });

  it('is idempotent — recording the same requirement twice does not double it or churn', () => {
    saveNavigationModel(buildNavigationModel('site.gov', obs()));
    const first = recordNavigationRequirement('site.gov', 'Dismiss the modal/dialog before interacting with the search.', obs())!;
    const second = recordNavigationRequirement('site.gov', 'Dismiss the modal/dialog before interacting with the search.', obs())!;
    expect(second.navigationDependencies.filter((d) => /Dismiss the modal/.test(d)).length).toBe(1);
    expect(second.version).toBe(first.version);
  });

  it('creates the model from the observation when the site was never learned', () => {
    expect(getNavigationModel('new.gov')).toBeNull();
    const m = recordNavigationRequirement('new.gov', 'Select the matching option before searching (select-before-search).', obs({ url: 'https://new.gov/' }));
    expect(m).not.toBeNull();
    expect(getNavigationModel('new.gov')!.navigationDependencies).toContain('Select the matching option before searching (select-before-search).');
  });
});
