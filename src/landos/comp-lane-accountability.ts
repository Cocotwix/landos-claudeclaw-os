export const ACCOUNTABLE_COMP_LANES = ['landportal', 'zillow', 'redfin', 'realtor'] as const;
export type AccountableCompLane = typeof ACCOUNTABLE_COMP_LANES[number];
export type CompLaneStatus = 'not_run' | 'ran_no_results' | 'ran_results_filtered' | 'retained' | 'failed' | 'blocked' | 'disabled_by_policy';

export interface CompLaneInput {
  lane: AccountableCompLane;
  attempted: boolean;
  attemptStatus?: string | null;
  failureReason?: string | null;
  blockedReason?: string | null;
  disabledReason?: string | null;
  candidates?: number | null;
  retained?: number | null;
  retainedAs?: string | null;
  filteredReasons?: string[];
}

export interface CompLaneOutcome {
  lane: AccountableCompLane;
  label: string;
  status: CompLaneStatus;
  candidates: number | null;
  retained: number | null;
  operatorLine: string;
  detail: string | null;
}

export interface CompLaneAccountability {
  lanes: CompLaneOutcome[];
  everyLaneAccountedFor: boolean;
  unrunLanes: AccountableCompLane[];
  summaryLine: string;
}

const LABELS: Record<AccountableCompLane, string> = {
  landportal: 'LandPortal', zillow: 'Zillow', redfin: 'Redfin', realtor: 'Realtor.com',
};

const count = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

function outcome(lane: AccountableCompLane, input: CompLaneInput | undefined): CompLaneOutcome {
  const label = LABELS[lane];
  if (!input) {
    return { lane, label, status: 'not_run', candidates: null, retained: null, operatorLine: `${label} comparable lane did not run for this subject.`, detail: null };
  }
  if (input.disabledReason) {
    return { lane, label, status: 'disabled_by_policy', candidates: null, retained: null, operatorLine: `${label} comparable lane was disabled by policy for this workflow.`, detail: input.disabledReason };
  }
  if (input.blockedReason || /blocked/i.test(input.attemptStatus ?? '')) {
    return { lane, label, status: 'blocked', candidates: null, retained: null, operatorLine: `${label} comparable lane ran but was blocked before results could be established.`, detail: input.blockedReason || input.attemptStatus || null };
  }
  if (input.failureReason || /fail|error/i.test(input.attemptStatus ?? '')) {
    return { lane, label, status: 'failed', candidates: null, retained: null, operatorLine: `${label} comparable lane ran but failed before results could be established.`, detail: input.failureReason || input.attemptStatus || null };
  }
  if (!input.attempted) {
    return { lane, label, status: 'not_run', candidates: null, retained: null, operatorLine: `${label} comparable lane did not run for this subject.`, detail: input.attemptStatus?.trim() || null };
  }
  const candidates = count(input.candidates);
  const retained = count(input.retained);
  if (retained != null && retained > 0) {
    return { lane, label, status: 'retained', candidates, retained, operatorLine: `${label} comparable lane retained ${retained} result${retained === 1 ? '' : 's'}${input.retainedAs ? ` as ${input.retainedAs}` : ''}.`, detail: null };
  }
  if (candidates != null && candidates > 0 && retained === 0) {
    const reasons = (input.filteredReasons ?? []).filter(Boolean);
    return { lane, label, status: 'ran_results_filtered', candidates, retained, operatorLine: `${label} search ran and found ${candidates} candidate${candidates === 1 ? '' : 's'}, but all were filtered.`, detail: reasons.length ? reasons.join(' ') : 'All returned candidates failed the comparable source policy filters.' };
  }
  if (candidates === 0) {
    return { lane, label, status: 'ran_no_results', candidates, retained: retained ?? 0, operatorLine: `${label} comparable search ran and returned no results.`, detail: input.attemptStatus?.trim() || null };
  }
  return { lane, label, status: 'failed', candidates: null, retained: null, operatorLine: `${label} comparable lane ran, but its result count was not established.`, detail: input.attemptStatus?.trim() || 'The attempt did not report a trustworthy candidate count.' };
}

export function buildCompLaneAccountability(inputs: CompLaneInput[]): CompLaneAccountability {
  const supplied = new Map<AccountableCompLane, CompLaneInput>();
  for (const input of inputs) if (!supplied.has(input.lane)) supplied.set(input.lane, input);
  const lanes = ACCOUNTABLE_COMP_LANES.map((lane) => outcome(lane, supplied.get(lane)));
  const unrunLanes = lanes.filter((entry) => entry.status === 'not_run').map((entry) => entry.lane);
  const everyLaneAccountedFor = unrunLanes.length === 0;
  const summaryLine = everyLaneAccountedFor
    ? `All four comparable-source lanes are accounted for with their actual run, filter, failure, block, retention, or policy status.`
    : `${unrunLanes.length} comparable-source lane${unrunLanes.length === 1 ? ' has' : 's have'} not run; no result count is claimed for an unasked source.`;
  return { lanes, everyLaneAccountedFor, unrunLanes, summaryLine };
}

export function compLanePlan(input: { landPortalUsableCount: number }): { mustRun: AccountableCompLane[]; reason: string } {
  return {
    mustRun: [...ACCOUNTABLE_COMP_LANES],
    reason: input.landPortalUsableCount > 0
      ? `LandPortal supplied ${input.landPortalUsableCount} usable comp(s), but every independent Zillow, Redfin, and Realtor.com supplement lane must still be accounted for.`
      : 'Every source lane must run or carry an explicit failure, block, or policy status so an absent row is never presented as a fabricated zero.',
  };
}
