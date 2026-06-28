// LandOS — Acquisitions Department (the seller-strategy brain).
//
// CRM-INDEPENDENT intelligence layer that works directly from the Deal Card. It
// holds the seller profile, manual communication log, discovery notes, and the
// acquisition stage; derives the next best action, readiness, and a strategy
// summary. It NEVER sends messages, never writes to GHL/Closebot, never
// auto-contacts sellers, and never calls a paid API. Seller-provided property
// facts are always labeled Seller-stated, never Verified. Pure logic + SQLite
// persistence (source of truth = the Deal Card); everything reloads.

import { getLandosDb, landosAudit } from './db.js';

export const ACQUISITION_STAGES = [
  'new_lead', 'needs_discovery', 'discovery_complete', 'needs_follow_up',
  'ready_for_offer_prep', 'offer_sent', 'stalled', 'paused', 'pass',
] as const;
export type AcquisitionStage = (typeof ACQUISITION_STAGES)[number];
export const ACQUISITION_STAGE_LABEL: Record<AcquisitionStage, string> = {
  new_lead: 'New lead', needs_discovery: 'Needs discovery', discovery_complete: 'Discovery complete',
  needs_follow_up: 'Needs follow-up', ready_for_offer_prep: 'Ready for offer prep', offer_sent: 'Offer sent',
  stalled: 'Stalled', paused: 'Paused', pass: 'Pass',
};
export function isAcquisitionStage(v: unknown): v is AcquisitionStage {
  return typeof v === 'string' && (ACQUISITION_STAGES as readonly string[]).includes(v);
}

export const COMM_CHANNELS = ['call', 'text', 'email', 'voicemail', 'in_person', 'other'] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

export interface SellerProfile {
  name?: string; phone?: string; email?: string;
  preferredChannel?: CommChannel;
  relationshipToProperty?: string;
  motivation?: string; timeline?: string;
  askingPrice?: string; priceFlexibility?: string;
  decisionMakers?: string; personalityNotes?: string; communicationStyle?: string;
  objections?: string[]; concerns?: string[]; commitments?: string[];
  /** Property facts the SELLER stated — never Verified DD facts. */
  sellerStatedFacts?: string[];
  unknowns?: string[]; verificationNeeded?: string[];
  lastContactDate?: string; nextFollowUpDate?: string;
}

export interface CommLogEntry {
  at: string; channel: CommChannel; direction: 'inbound' | 'outbound';
  summary: string; notes?: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'unknown';
  keyFacts?: string[]; objections?: string[]; commitments?: string[];
  followUpNeeded?: boolean; createdAt: string;
}

export interface DiscoveryExtraction {
  rawNotes: string;
  motivation: string | null; timeline: string | null; priceExpectation: string | null;
  decisionMakers: string | null; sellerClaimedFacts: string[]; objections: string[];
  emotionalTone: string | null; urgency: string | null; risks: string[];
  followUpItems: string[]; unansweredQuestions: string[];
  capturedAt: string;
}

export interface AcquisitionState {
  dealCardId: number;
  stage: AcquisitionStage;
  profile: SellerProfile;
  commLog: CommLogEntry[];
  discovery: DiscoveryExtraction[];
  updatedAt: number | null;
}

interface AcqRow { deal_card_id: number; stage: string; profile_json: string; comm_log_json: string; discovery_json: string; updated_at: number }

function parse<T>(s: string, fallback: T): T { try { const v = JSON.parse(s); return (v ?? fallback) as T; } catch { return fallback; } }

export function emptyAcquisition(dealCardId: number): AcquisitionState {
  return { dealCardId, stage: 'new_lead', profile: {}, commLog: [], discovery: [], updatedAt: null };
}

/** Read the acquisition state for a deal (honest empty when none). Reloads from SQLite. */
export function getAcquisition(dealCardId: number): AcquisitionState {
  const row = getLandosDb().prepare('SELECT * FROM landos_acquisition WHERE deal_card_id = ?').get(dealCardId) as AcqRow | undefined;
  if (!row) return emptyAcquisition(dealCardId);
  return {
    dealCardId,
    stage: isAcquisitionStage(row.stage) ? row.stage : 'new_lead',
    profile: parse<SellerProfile>(row.profile_json, {}),
    commLog: parse<CommLogEntry[]>(row.comm_log_json, []),
    discovery: parse<DiscoveryExtraction[]>(row.discovery_json, []),
    updatedAt: row.updated_at,
  };
}

function persist(state: AcquisitionState, actor = 'tyler'): void {
  const now = Math.floor(Date.now() / 1000);
  getLandosDb().prepare(
    `INSERT INTO landos_acquisition (deal_card_id, stage, profile_json, comm_log_json, discovery_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(deal_card_id) DO UPDATE SET stage=excluded.stage, profile_json=excluded.profile_json,
       comm_log_json=excluded.comm_log_json, discovery_json=excluded.discovery_json, updated_at=excluded.updated_at`,
  ).run(state.dealCardId, state.stage, JSON.stringify(state.profile), JSON.stringify(state.commLog), JSON.stringify(state.discovery), now);
  landosAudit(actor, 'acquisition_updated', `deal ${state.dealCardId} (stage ${state.stage})`, { refTable: 'landos_acquisition', refId: state.dealCardId });
}

/** Merge a seller-profile patch (never marks anything Verified). */
export function upsertSellerProfile(dealCardId: number, patch: Partial<SellerProfile>): AcquisitionState {
  const s = getAcquisition(dealCardId);
  s.profile = { ...s.profile, ...patch };
  persist(s);
  return getAcquisition(dealCardId);
}

export function addCommLogEntry(dealCardId: number, entry: Omit<CommLogEntry, 'createdAt'>): AcquisitionState {
  const s = getAcquisition(dealCardId);
  s.commLog = [{ ...entry, createdAt: new Date().toISOString() }, ...s.commLog];
  if (entry.at) s.profile.lastContactDate = entry.at.slice(0, 10);
  persist(s);
  return getAcquisition(dealCardId);
}

export function addDiscoveryNote(dealCardId: number, extraction: DiscoveryExtraction): AcquisitionState {
  const s = getAcquisition(dealCardId);
  s.discovery = [extraction, ...s.discovery];
  // Fold extracted seller-claimed facts into the profile as SELLER-STATED (never verified).
  const claimed = new Set([...(s.profile.sellerStatedFacts ?? []), ...extraction.sellerClaimedFacts]);
  s.profile.sellerStatedFacts = [...claimed];
  if (extraction.motivation && !s.profile.motivation) s.profile.motivation = extraction.motivation;
  if (extraction.timeline && !s.profile.timeline) s.profile.timeline = extraction.timeline;
  if (extraction.priceExpectation && !s.profile.askingPrice) s.profile.askingPrice = extraction.priceExpectation;
  if (extraction.objections.length) s.profile.objections = [...new Set([...(s.profile.objections ?? []), ...extraction.objections])];
  if (s.stage === 'new_lead' || s.stage === 'needs_discovery') s.stage = 'discovery_complete';
  persist(s);
  return getAcquisition(dealCardId);
}

export function setAcquisitionStage(dealCardId: number, stage: AcquisitionStage): AcquisitionState {
  const s = getAcquisition(dealCardId);
  s.stage = stage;
  persist(s);
  return getAcquisition(dealCardId);
}

// ── Deterministic discovery-note extraction (heuristic; pure; no AI/no network) ──
const RX = {
  motivation: /(motivat|why.*sell|reason.*sell|behind on|inherit|relocat|divorc|retir|tired of|moving|estate|burden|taxes|don'?t need|never use)/i,
  timeline: /(asap|right away|within \d+|by (next|end of)|month|week|in a hurry|no rush|whenever|spring|summer|fall|winter|\d+ days)/i,
  price: /\$\s?[\d,]+(?:\s?k)?|\b\d{2,3}(?:,\d{3})\b|asking|want.*for it|looking to get|price/i,
  decision: /(wife|husband|spouse|brother|sister|son|daughter|partner|attorney|family|sibling|heirs?|we (both|all)|my (wife|husband))/i,
  objection: /(not sure|too low|worth more|think about it|need to|already have|other offer|won'?t take|concerned|worried|hesitant|skeptical)/i,
};
function sentences(text: string): string[] { return text.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean); }
function firstMatch(sents: string[], rx: RegExp): string | null { const s = sents.find((x) => rx.test(x)); return s ? s.slice(0, 200) : null; }

export function extractDiscoveryNotes(text: string, now = new Date().toISOString()): DiscoveryExtraction {
  const sents = sentences(text);
  const grab = (rx: RegExp): string[] => sents.filter((s) => rx.test(s)).map((s) => s.slice(0, 200));
  const urgent = /(asap|right away|in a hurry|urgent|need to sell|behind on|foreclos)/i.test(text);
  const toneNeg = /(angry|frustrat|annoyed|upset|skeptical|hesitant)/i.test(text);
  const tonePos = /(friendly|happy|excited|open|cooperative|nice|warm)/i.test(text);
  return {
    rawNotes: text.trim(),
    motivation: firstMatch(sents, RX.motivation),
    timeline: firstMatch(sents, RX.timeline),
    priceExpectation: firstMatch(sents, RX.price),
    decisionMakers: firstMatch(sents, RX.decision),
    sellerClaimedFacts: grab(/(acre|road|access|well|septic|power|utilit|zon|flood|wetland|survey|fence|clear|wood|creek|build|structure|mobile|house|barn|lien|tax)/i),
    objections: grab(RX.objection),
    emotionalTone: toneNeg ? 'guarded / negative' : tonePos ? 'positive / open' : 'neutral',
    urgency: urgent ? 'high' : /no rush|whenever|not in a hurry/i.test(text) ? 'low' : 'unknown',
    risks: grab(/(lien|back tax|probate|estate|easement|landlock|no access|dispute|boundary|title|heirs?)/i),
    followUpItems: grab(/(send|call back|follow up|get back|will (check|ask|talk)|next (week|month)|let me know)/i),
    unansweredQuestions: grab(/\?$/),
    capturedAt: now,
  };
}

// ── Next best action (deterministic; explains WHY) ──────────────────────────
export type NextActionKind =
  | 'needs_discovery_call' | 'gather_missing_facts' | 'follow_up_now' | 'wait_until_date'
  | 'confirm_decision_makers' | 'needs_more_dd' | 'prepare_offer_call' | 'no_action_needed'
  | 'stalled_reengage' | 'pass_or_pause';

export interface AcquisitionNextAction { action: NextActionKind; label: string; reason: string }

/** Deterministic next best action from acquisition state + DD verification. */
export function acquisitionNextAction(s: AcquisitionState, ctx: { ddParcelVerified?: boolean } = {}): AcquisitionNextAction {
  const mk = (action: NextActionKind, label: string, reason: string) => ({ action, label, reason });
  const p = s.profile;
  const today = new Date().toISOString().slice(0, 10);
  if (s.stage === 'pass') return mk('pass_or_pause', 'Passed', 'Lead marked Pass — no action.');
  if (s.stage === 'paused') return mk('pass_or_pause', 'Paused', 'Lead paused — resume when ready.');
  if (s.stage === 'offer_sent') return mk('no_action_needed', 'Await seller response', 'Offer sent; awaiting the seller. Follow up if no response by the next follow-up date.');
  if (s.stage === 'stalled') return mk('stalled_reengage', 'Re-engage (soft touch)', 'Lead stalled — a low-pressure check-in keeps it warm without chasing.');
  if (p.nextFollowUpDate && p.nextFollowUpDate > today) return mk('wait_until_date', `Wait until ${p.nextFollowUpDate}`, `A follow-up is scheduled for ${p.nextFollowUpDate}; do not contact before then.`);
  // Discovery is captured via discovery notes (a comm-log entry is NOT required).
  if (s.stage === 'new_lead' || (s.discovery.length === 0 && !p.motivation)) return mk('needs_discovery_call', 'Run the discovery call', 'No discovery captured yet — learn motivation, timeline, price, and decision-makers before anything else.');
  if (!p.decisionMakers) return mk('confirm_decision_makers', 'Confirm decision-makers', 'Discovery done but the decision-makers are unconfirmed — confirm who must agree before an offer.');
  if ((p.verificationNeeded?.length ?? 0) > 0 || ctx.ddParcelVerified === false) return mk('needs_more_dd', 'Finish due diligence', 'Seller-stated facts or parcel identity still need verification before an offer.');
  if (!p.motivation || !p.timeline || !p.askingPrice) return mk('gather_missing_facts', 'Gather missing seller facts', 'Core seller facts (motivation / timeline / price) are incomplete — fill the gaps on the next touch.');
  if (s.stage === 'needs_follow_up') return mk('follow_up_now', 'Follow up now', 'A follow-up is due and nothing blocks it — reach out with the next-step frame.');
  if (s.stage === 'ready_for_offer_prep' || s.stage === 'discovery_complete') return mk('prepare_offer_call', 'Prepare the offer call', 'Discovery complete, decision-makers known, facts in hand — prepare the offer-call frame (underwriting computes the number).');
  return mk('no_action_needed', 'No action needed', 'Nothing outstanding right now.');
}

// ── Acquisition readiness (suggested stage) + strategy summary ──────────────
export interface SellerStrategySummary {
  situation: string; motivation: string; likelyLeverage: string; concerns: string;
  recommendedTone: string; currentStage: string; nextMove: string; risks: string;
  missingInfo: string; offerCallReady: boolean;
}

export function sellerStrategySummary(s: AcquisitionState, na: AcquisitionNextAction): SellerStrategySummary {
  const p = s.profile;
  const missing = [!p.motivation && 'motivation', !p.timeline && 'timeline', !p.askingPrice && 'price', !p.decisionMakers && 'decision-makers'].filter(Boolean) as string[];
  const urgent = /high/i.test(s.discovery[0]?.urgency ?? '') || /asap|hurry|behind/i.test(p.timeline ?? '');
  return {
    situation: p.relationshipToProperty || (p.motivation ? `Selling — ${p.motivation}` : 'Seller situation not yet established.'),
    motivation: p.motivation || 'Unknown — establish on the next call.',
    likelyLeverage: urgent ? 'Timeline/urgency is a lever — speed + certainty matter to them.' : (p.priceFlexibility ? `Price flexibility noted: ${p.priceFlexibility}` : 'No clear lever yet — listen for motivation/urgency.'),
    concerns: (p.concerns ?? []).join('; ') || (p.objections ?? []).join('; ') || 'None recorded.',
    recommendedTone: /negative|guarded/i.test(s.discovery[0]?.emotionalTone ?? '') ? 'Calm, unhurried, build trust — no pressure.' : 'Warm, plain-spoken, curious — let them talk.',
    currentStage: ACQUISITION_STAGE_LABEL[s.stage],
    nextMove: `${na.label} — ${na.reason}`,
    risks: (s.discovery[0]?.risks ?? []).join('; ') || 'None flagged yet (absence of data, verify the unknowns).',
    missingInfo: missing.length ? missing.join(', ') : 'Core seller facts captured.',
    offerCallReady: s.stage === 'ready_for_offer_prep' || (s.stage === 'discovery_complete' && missing.length === 0 && !!p.decisionMakers),
  };
}
