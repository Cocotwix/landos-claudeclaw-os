// Research Mission model — the Activity tab's current-vs-historical truth.
//
// Every activity result is classified (accepted / rejected / superseded /
// failed / pending), repeated identical runs are grouped, and the CURRENT
// mission (the latest research pass) is separated from history so historical
// outputs never read as current conclusions. Pure + deterministic: the caller
// passes the raw activity events; nothing here queries or mutates state.

export interface ActivityEventIn {
  id: number;
  kind: string;
  summary: string;
  agentId: string;
  createdAt: number; // unix seconds
}

export type ActivityClassification = 'accepted' | 'rejected' | 'superseded' | 'failed' | 'pending';

export interface ClassifiedActivityEvent {
  id: number;
  kind: string;
  kindLabel: string;
  summary: string;
  agentId: string;
  createdAt: number;
  classification: ActivityClassification;
  /** >1 when identical repeated runs were grouped into this entry. */
  occurrences: number;
}

export interface ResearchMissionView {
  /** Newest research pass: events within the latest mission window. */
  current: {
    startedAt: number | null;
    endedAt: number | null;
    status: 'complete' | 'in_progress' | 'none';
    accepted: ClassifiedActivityEvent[];
    rejected: ClassifiedActivityEvent[];
    superseded: ClassifiedActivityEvent[];
    failed: ClassifiedActivityEvent[];
    pending: ClassifiedActivityEvent[];
  };
  /** Everything before the current mission, grouped + classified. */
  history: ClassifiedActivityEvent[];
  counts: Record<ActivityClassification, number>;
}

const KIND_LABEL: Record<string, string> = {
  visual_capture: 'Visual capture',
  property_inspection: 'Property inspection',
  landportal_inspection: 'LandPortal inspection',
  public_intelligence: 'Public-records research',
  comp_research: 'Comparable research',
  deal_card_reconcile: 'Deal Card reconciliation',
  report_run: 'Property Intelligence run',
  resolution: 'Parcel resolution',
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const SUPERSEDED_RE = /superseded|replaced by|no longer current/i;
const REJECTED_RE = /rejected|wrong[- ]market|excluded|refused|mismatch|could not be verified as belonging/i;
const FAILED_RE = /\bfailed\b|\berror\b|unavailable|timed? ?out|quota|denied/i;
const PENDING_RE = /pending|queued|awaiting|scheduled|in progress/i;

export function classifyActivityEvent(e: ActivityEventIn): ActivityClassification {
  // A reconciliation/report run that DESCRIBES rejected rows is itself an
  // accepted action — only its own failure makes it failed.
  if (e.kind === 'deal_card_reconcile' || e.kind === 'report_run') {
    return FAILED_RE.test(e.summary) ? 'failed' : 'accepted';
  }
  const text = `${e.kind} ${e.summary}`;
  if (SUPERSEDED_RE.test(text)) return 'superseded';
  if (REJECTED_RE.test(text)) return 'rejected';
  if (FAILED_RE.test(text)) return 'failed';
  if (PENDING_RE.test(text)) return 'pending';
  return 'accepted';
}

/** Group identical consecutive-or-not repeats (same kind + same summary). */
function groupRepeats(events: ClassifiedActivityEvent[]): ClassifiedActivityEvent[] {
  const byKey = new Map<string, ClassifiedActivityEvent>();
  const order: string[] = [];
  for (const e of events) {
    const key = `${e.kind}|${e.summary}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      // Keep the NEWEST timestamp so the grouped entry reads as latest run.
      if (e.createdAt > existing.createdAt) existing.createdAt = e.createdAt;
    } else {
      byKey.set(key, { ...e });
      order.push(key);
    }
  }
  return order.map((k) => byKey.get(k)!).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Build the mission view. The CURRENT mission window = every event within
 * `missionGapSeconds` of the newest event (a research pass produces a burst of
 * activity; a gap ends the pass). Anything older is history.
 */
export function buildResearchMissionView(eventsIn: ActivityEventIn[], opts?: { missionGapSeconds?: number; nowSeconds?: number }): ResearchMissionView {
  const gap = opts?.missionGapSeconds ?? 60 * 60; // one hour between passes
  const events = [...eventsIn].sort((a, b) => b.createdAt - a.createdAt);

  const classified: ClassifiedActivityEvent[] = events.map((e) => ({
    id: e.id,
    kind: e.kind,
    kindLabel: kindLabel(e.kind),
    summary: e.summary,
    agentId: e.agentId,
    createdAt: e.createdAt,
    classification: classifyActivityEvent(e),
    occurrences: 1,
  }));

  // Find the current-mission window from the newest event backwards.
  const currentEvents: ClassifiedActivityEvent[] = [];
  const historyEvents: ClassifiedActivityEvent[] = [];
  let cursor: number | null = null;
  for (const e of classified) {
    if (cursor == null) { cursor = e.createdAt; currentEvents.push(e); continue; }
    if (cursor - e.createdAt <= gap) { currentEvents.push(e); cursor = e.createdAt; }
    else historyEvents.push(e);
  }

  const groupedCurrent = groupRepeats(currentEvents);
  const groupedHistory = groupRepeats(historyEvents);

  const bucket = (c: ActivityClassification) => groupedCurrent.filter((e) => e.classification === c);
  const counts: Record<ActivityClassification, number> = { accepted: 0, rejected: 0, superseded: 0, failed: 0, pending: 0 };
  for (const e of [...groupedCurrent, ...groupedHistory]) counts[e.classification] += e.occurrences;

  const startedAt = currentEvents.length ? currentEvents[currentEvents.length - 1].createdAt : null;
  const endedAt = currentEvents.length ? currentEvents[0].createdAt : null;
  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const status: ResearchMissionView['current']['status'] = !currentEvents.length
    ? 'none'
    : now - (endedAt ?? 0) < 15 * 60 ? 'in_progress' : 'complete';

  return {
    current: {
      startedAt,
      endedAt,
      status,
      accepted: bucket('accepted'),
      rejected: bucket('rejected'),
      superseded: bucket('superseded'),
      failed: bucket('failed'),
      pending: bucket('pending'),
    },
    history: groupedHistory,
    counts,
  };
}
