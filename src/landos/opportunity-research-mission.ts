import crypto from 'node:crypto';

import { getLandosDb } from './db.js';
import type { OpportunityRecord } from './opportunity.js';
import type { PendingPropertyInspectionRecord, PropertyInspectionRecord } from './property-card.js';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';

export type ResearchMissionStatus = 'queued' | 'running' | 'partial' | 'complete' | 'failed' | 'quarantined';

export interface ResearchIdentityConstraints {
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  apn: string | null;
  source: 'manual_input' | 'opportunity_title' | 'property_fallback';
}

export interface ResearchMissionRecord {
  id: number;
  opportunityId: number;
  runKey: string;
  trigger: string;
  status: ResearchMissionStatus;
  attempt: number;
  constraints: ResearchIdentityConstraints;
  toolTrace: Array<Record<string, unknown>>;
  verification: ResearchVerification | null;
  summary: string;
  safeNextAction: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchVerification {
  accepted: boolean;
  identityState: 'confirmed' | 'candidate' | 'unresolved' | 'conflicted';
  verdict: 'matched' | 'insufficient_identity' | 'jurisdiction_mismatch' | 'apn_mismatch' | 'address_mismatch';
  reasons: string[];
  warnings: string[];
  expected: ResearchIdentityConstraints;
  observed: { address: string | null; city: string | null; county: string | null; state: string | null; apn: string | null };
}

export interface InvestigativePath {
  provider: string;
  stage: string;
  status: 'planned';
  note: string;
  candidates?: string[];
}

/** Safe APN formatting candidates. Every candidate retains the exact digit
 * sequence supplied by the operator; LandOS never inserts, drops, or reorders
 * digits while testing punctuation/spacing variants. */
export function apnSearchVariants(rawApn: string | null): string[] {
  if (!rawApn?.trim()) return [];
  const original = rawApn.trim();
  const digitSequence = (original.match(/\d/g) ?? []).join('');
  const tokens = original.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const candidates = [original, tokens.join(''), tokens.join('-'), tokens.join(' '), tokens.join('.')];
  return [...new Set(candidates.filter(Boolean))].filter((candidate) => (candidate.match(/\d/g) ?? []).join('') === digitSequence);
}

/** Persisted observe-first plan. LandPortal is a useful authenticated browser
 * workspace, never an authority or terminal gate; public and market paths stay
 * visible even when an earlier path returns no match. */
export function buildInvestigativePathPlan(constraints: ResearchIdentityConstraints): InvestigativePath[] {
  const jurisdiction = [constraints.city, constraints.county && `${constraints.county} County`, constraints.state].filter(Boolean).join(', ') || 'jurisdiction unresolved';
  const variants = apnSearchVariants(constraints.apn);
  return [
    { provider: 'operator_input', stage: 'preserve_source', status: 'planned', note: 'Preserve the original seller/operator words as immutable input.' },
    { provider: 'apn_variants', stage: 'identity_candidates', status: 'planned', note: `Test safe formatting variants without changing the supplied digit sequence in ${jurisdiction}.`, candidates: variants },
    { provider: 'landportal_browser', stage: 'parcel_workspace', status: 'planned', note: 'Use authenticated visible browser research when useful; no API/MCP, credit, paid report, or authority claim.' },
    { provider: 'county_gis', stage: 'public_parcel_map', status: 'planned', note: `Search the public GIS/parcel map for ${jurisdiction}.` },
    { provider: 'county_assessor', stage: 'public_assessment', status: 'planned', note: 'Check assessor/appraiser facts and owner candidates with provenance.' },
    { provider: 'county_recorder', stage: 'deed_and_recording', status: 'planned', note: 'Check recorder/register-of-deeds paths for deed artifacts and identity corroboration.' },
    { provider: 'web_search', stage: 'location_inference', status: 'planned', note: 'Use bounded online search to resolve missing locality clues; never promote an uncorroborated parcel.' },
    { provider: 'zillow', stage: 'market_context', status: 'planned', note: 'Continue to Zillow sold-land research after identity work; active/pending rows remain context only.' },
    { provider: 'redfin', stage: 'market_context', status: 'planned', note: 'Continue to Redfin sold-land research after identity work; no seller contact or paid action.' },
  ];
}

type MissionRow = {
  id: number; opportunity_id: number; run_key: string; trigger: string; status: ResearchMissionStatus; attempt: number;
  constraints_json: string; tool_trace_json: string; verification_json: string | null; summary: string;
  safe_next_action: string; error: string | null; started_at: number | null; finished_at: number | null;
  created_at: number; updated_at: number;
};

/** A visible dash is a common provider placeholder, not parcel identity.  Treat
 * it exactly like a missing field so a real matching APN cannot be quarantined
 * merely because the page did not expose a situs-address value. */
const clean = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && !/^(?:-|--|n\/?a|not\s+(?:available|found)|unknown)$/i.test(normalized)
    ? normalized
    : null;
};
const upper = (value: string | null): string | null => value ? value.toUpperCase() : null;
const stateValue = (value: string | null): string | null => {
  const match = upper(value)?.match(/(?:^|\b)([A-Z]{2})(?:\b|$)/);
  return match?.[1] ?? null;
};
const countyValue = (value: string | null): string | null => value ? value.toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z0-9]/g, '') || null : null;
const cityValue = (value: string | null): string | null => value ? value.toLowerCase().replace(/[^a-z0-9]/g, '') || null : null;
const apnValue = (value: string | null): string | null => value ? value.toLowerCase().replace(/[^a-z0-9]/g, '') || null : null;
const addressValue = (value: string | null): string | null => value
  ? value.split(',')[0].toLowerCase().replace(/\b(road|rd|street|st|avenue|ave|lane|ln|highway|hwy|drive|dr|court|ct|boulevard|blvd)\b/g, '').replace(/[^a-z0-9]/g, '') || null
  : null;

/** A provider may abbreviate a suffix or preserve a one-character spelling
 * correction (for example, McAlister -> McAllister). Accept that narrow case
 * only when the street number is identical. Anything larger remains a hard
 * identity mismatch and can never be promoted automatically. */
function addressesMatch(expected: string | null, observed: string | null): boolean {
  const left = addressValue(expected);
  const right = addressValue(observed);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftNumber = left.match(/^\d+/)?.[0];
  const rightNumber = right.match(/^\d+/)?.[0];
  if (!leftNumber || leftNumber !== rightNumber) return false;
  const a = left.slice(leftNumber.length);
  const b = right.slice(rightNumber.length);
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  let edits = 0;
  let ai = 0;
  let bi = 0;
  while (ai < a.length && bi < b.length) {
    if (a[ai] === b[bi]) { ai++; bi++; continue; }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) ai++;
    else if (b.length > a.length) bi++;
    else { ai++; bi++; }
  }
  return edits + (a.length - ai) + (b.length - bi) <= 1;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}

function titleLocation(title: string): Partial<ResearchIdentityConstraints> {
  const parts = title.split(',').map((part) => part.trim()).filter(Boolean);
  const last = parts.at(-1) ?? title;
  const state = stateValue(last);
  // Manual leads commonly use "street, City ST" (two comma-delimited
  // segments). Treating the first segment as the city silently changes the
  // search jurisdiction, which is exactly how a wrong-state parcel was
  // associated with the Kingstree lead.
  const city = parts.length === 2 && state
    ? clean(last.replace(new RegExp(`\\b${state}\\b`, 'i'), ''))
    : parts.length >= 3 ? clean(parts.at(-2)) : null;
  const address = parts.length === 2
    ? clean(parts[0])
    : parts.length >= 3 ? clean(parts.slice(0, -2).join(', ')) : clean(title);
  return { address, city, state };
}

/** Operator input always outranks legacy/property projections. A property-card
 * locality can fill a missing county only after its city/state agrees with the
 * immutable operator/title jurisdiction; it can never replace that jurisdiction. */
export function researchConstraintsFor(
  opportunity: OpportunityRecord,
  property?: {
    active_input_address?: unknown; city?: unknown; county?: unknown; state?: unknown; apn?: unknown;
    verification_source?: unknown;
  },
): ResearchIdentityConstraints {
  const stored = parseJsonObject(opportunity.rawInput);
  const conversational = stored ? null : parseConversationalLeadIntake(opportunity.rawInput);
  const manual: Record<string, unknown> | null = stored ?? (conversational ? {
    address: conversational.address,
    city: conversational.city,
    county: conversational.county,
    state: conversational.state,
    apn: conversational.apn,
  } : null);
  const title = titleLocation(opportunity.title);
  const manualHasIdentity = !!manual && ['address', 'city', 'county', 'state', 'apn'].some((key) => clean(manual[key]));
  const titleHasJurisdiction = !!title.state;
  const propertyCity = clean(property?.city);
  const propertyState = stateValue(clean(property?.state));
  // This is a deliberate, confirmed correction of a conflicting parcel—not a
  // routine property-card projection. It must become the immutable boundary
  // for the next research mission, otherwise stale raw intake can repeatedly
  // authorize the exact wrong APN the owner just rejected.
  const ownerReconciledParcel = /owner-confirmed official parcel record/i.test(clean(property?.verification_source) ?? '');
  const propertyMatchesTitleJurisdiction = !!propertyCity && !!propertyState
    && (!title.city || cityValue(propertyCity) === cityValue(title.city))
    && (!title.state || propertyState === stateValue(title.state));
  const pick = (key: keyof ResearchIdentityConstraints): string | null => {
    if (key === 'source') return null;
    if (ownerReconciledParcel) return clean(property?.[key === 'address' ? 'active_input_address' : key]);
    // Once operator input or the lead title establishes an identity boundary,
    // absence is meaningful. Never fill its missing county/APN/etc. from a
    // mutable legacy card: that is how the retained wrong-property inspection
    // contaminated a later retry even after state and city were protected.
    if (manualHasIdentity) return clean(manual?.[key]);
    if (titleHasJurisdiction) {
      const titleValue = clean(title[key]);
      if (titleValue) return titleValue;
      // County is a locality-only supplement: require the corrected card to
      // agree with the immutable title city/state before using it. This admits
      // "Kingstree, SC" -> "Williamsburg County" while refusing the prior
      // stale "Lincoln, NC" record and never imports an APN or street value.
      if (key === 'county' && propertyMatchesTitleJurisdiction) return clean(property?.county);
      return null;
    }
    return clean(property?.[key === 'address' ? 'active_input_address' : key]) ?? clean(title[key]);
  };
  return {
    address: pick('address'), city: pick('city'), county: pick('county'), state: stateValue(pick('state')),
    apn: pick('apn'), source: ownerReconciledParcel ? 'property_fallback' : manualHasIdentity ? 'manual_input' : titleHasJurisdiction ? 'opportunity_title' : 'property_fallback',
  };
}

function fact(facts: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const key = Object.keys(facts).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key && clean(facts[key])) return clean(facts[key]);
  }
  return null;
}

export function verifyInspectionIdentity(
  expected: ResearchIdentityConstraints,
  inspection: Pick<PendingPropertyInspectionRecord | PropertyInspectionRecord, 'parcelFacts' | 'parcelUrl'>,
): ResearchVerification {
  const facts = inspection.parcelFacts ?? {};
  const observed = {
    address: fact(facts, ['Parcel Address', 'Situs Address', 'Property Address']),
    city: fact(facts, ['Parcel Address City', 'City', 'Situs City']),
    county: fact(facts, ['Parcel Address County', 'County']),
    state: stateValue(fact(facts, ['Parcel Address State', 'State', 'Situs State'])),
    apn: fact(facts, ['Parcel ID', 'APN', 'Parcel Number']),
  };
  const reasons: string[] = [];
  const warnings: string[] = [];
  const stateMatches = !expected.state || !observed.state || upper(expected.state) === upper(observed.state);
  const countyMatches = !expected.county || !observed.county || countyValue(expected.county) === countyValue(observed.county);
  const addressMatches = !expected.address || !observed.address || addressesMatch(expected.address, observed.address);
  const expectedApn = apnValue(expected.apn);
  const observedApn = apnValue(observed.apn);
  const apnMatchesExactly = !!expectedApn && !!observedApn && expectedApn === observedApn;
  // Some official statewide parcel identifiers wrap the shorter county parcel
  // number shown by LandPortal. Accept that relationship only when a
  // meaningful shorter identifier is embedded intact and the street plus
  // county/state independently agree. This never makes a conflicting parcel
  // number acceptable on address evidence alone.
  const apnMatchesEmbeddedCountyId = !!expectedApn && !!observedApn
    && Math.min(expectedApn.length, observedApn.length) >= 7
    && (expectedApn.includes(observedApn) || observedApn.includes(expectedApn))
    && addressMatches && stateMatches && countyMatches;
  const apnMatches = apnMatchesExactly || apnMatchesEmbeddedCountyId;
  if (!stateMatches) reasons.push(`state mismatch: expected ${expected.state}, observed ${observed.state}`);
  if (!countyMatches) reasons.push(`county mismatch: expected ${expected.county}, observed ${observed.county}`);
  const cityMatches = !expected.city || !observed.city || cityValue(expected.city) === cityValue(observed.city);
  const exactParcelDespiteLocalityVariant = apnMatches && addressMatches && stateMatches && countyMatches;
  if (!cityMatches && !exactParcelDespiteLocalityVariant) reasons.push(`city mismatch: expected ${expected.city}, observed ${observed.city}`);
  if (expected.apn && observed.apn && !apnMatches) reasons.push(`APN mismatch: expected ${expected.apn}, observed ${observed.apn}`);
  if (expected.address && observed.address && !addressMatches) {
    const apnCountyStateMatch = apnMatches && stateMatches && countyMatches;
    if (apnCountyStateMatch) {
      warnings.push(`address mismatch: expected ${expected.address}, observed ${observed.address} — APN + county + state match exactly; treat as candidate and verify official situs.`);
    } else {
      reasons.push(`address mismatch: expected ${expected.address}, observed ${observed.address}`);
    }
  }
  const enoughObserved = !!(observed.apn || (observed.address && observed.state));
  const identityState: ResearchVerification['identityState'] = reasons.some((reason) => /^state|^county|^city/.test(reason))
    ? 'conflicted'
    : reasons.some((reason) => /^APN/.test(reason))
      ? 'conflicted'
      : warnings.length > 0 && enoughObserved
        ? 'candidate'
        : enoughObserved
          ? 'confirmed'
          : 'unresolved';
  const accepted = identityState === 'confirmed' || identityState === 'candidate';
  const verdict: ResearchVerification['verdict'] = identityState === 'confirmed'
    ? 'matched'
    : identityState === 'candidate'
      ? 'address_mismatch'
      : identityState === 'conflicted'
        ? reasons.some((r) => /^APN/.test(r)) ? 'apn_mismatch' : 'jurisdiction_mismatch'
        : reasons.some((reason) => /^address/.test(reason)) ? 'address_mismatch' : 'insufficient_identity';
  return {
    accepted,
    identityState,
    verdict,
    reasons: reasons.length ? reasons : (enoughObserved ? [] : ['The inspected page did not expose enough parcel identity to associate its evidence.']),
    warnings,
    expected,
    observed,
  };
}

function mapMission(row: MissionRow): ResearchMissionRecord {
  return {
    id: row.id, opportunityId: row.opportunity_id, runKey: row.run_key, trigger: row.trigger, status: row.status,
    attempt: row.attempt, constraints: JSON.parse(row.constraints_json), toolTrace: JSON.parse(row.tool_trace_json),
    verification: row.verification_json ? JSON.parse(row.verification_json) : null, summary: row.summary,
    safeNextAction: row.safe_next_action, error: row.error, startedAt: row.started_at, finishedAt: row.finished_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createResearchMission(opportunity: OpportunityRecord, constraints: ResearchIdentityConstraints, trigger: string): ResearchMissionRecord {
  const db = getLandosDb();
  const active = db.prepare(`SELECT * FROM landos_opportunity_research_mission
    WHERE opportunity_id = ? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`)
    .get(opportunity.id) as MissionRow | undefined;
  if (active) return mapMission(active);
  const runKey = crypto.randomUUID();
  const id = Number(db.prepare(`INSERT INTO landos_opportunity_research_mission
    (opportunity_id, run_key, trigger, constraints_json, tool_trace_json, safe_next_action)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(opportunity.id, runKey, trigger, JSON.stringify(constraints), JSON.stringify(buildInvestigativePathPlan(constraints)), 'Continue through the next unresolved research path; no single provider is a terminal gate.').lastInsertRowid);
  return getResearchMission(id)!;
}

export function getResearchMission(id: number): ResearchMissionRecord | null {
  const row = getLandosDb().prepare('SELECT * FROM landos_opportunity_research_mission WHERE id = ?').get(id) as MissionRow | undefined;
  return row ? mapMission(row) : null;
}

export function latestResearchMission(opportunityId: number): ResearchMissionRecord | null {
  const row = getLandosDb().prepare('SELECT * FROM landos_opportunity_research_mission WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1').get(opportunityId) as MissionRow | undefined;
  return row ? mapMission(row) : null;
}

export function claimResearchMission(id: number): ResearchMissionRecord | null {
  const db = getLandosDb();
  const result = db.prepare(`UPDATE landos_opportunity_research_mission
    SET status = 'running', attempt = attempt + 1, started_at = unixepoch(), finished_at = NULL,
        error = NULL, updated_at = unixepoch()
    WHERE id = ? AND status IN ('queued','running','failed') AND attempt < 3`).run(id);
  return result.changes ? getResearchMission(id) : null;
}

export function finishResearchMission(id: number, input: { status: Extract<ResearchMissionStatus, 'partial' | 'complete' | 'quarantined'>; summary: string; safeNextAction: string; verification: ResearchVerification; toolTrace?: Array<Record<string, unknown>> }): ResearchMissionRecord {
  getLandosDb().prepare(`UPDATE landos_opportunity_research_mission SET status = ?, summary = ?, safe_next_action = ?,
    verification_json = ?, tool_trace_json = ?, finished_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`)
    .run(input.status, input.summary, input.safeNextAction, JSON.stringify(input.verification), JSON.stringify(input.toolTrace ?? []), id);
  return getResearchMission(id)!;
}

export function failResearchMission(id: number, error: string): ResearchMissionRecord {
  getLandosDb().prepare(`UPDATE landos_opportunity_research_mission SET status = 'failed', error = ?, summary = ?,
    safe_next_action = 'Retry the bounded research mission; the Lead Card remains intact.', finished_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`)
    .run(error, 'Research mission failed without changing canonical property evidence.', id);
  return getResearchMission(id)!;
}

export function recoverableResearchMissionIds(): number[] {
  return (getLandosDb().prepare(`SELECT id FROM landos_opportunity_research_mission
    WHERE attempt < 3
      AND (status = 'queued' OR (status = 'running' AND updated_at < unixepoch() - 30))
    ORDER BY id`).all() as Array<{ id: number }>).map((row) => row.id);
}

export function quarantineLatestPropertyInspection(opportunityId: number, cardId: number, verification: ResearchVerification): number | null {
  const db = getLandosDb();
  const row = db.prepare(`SELECT id FROM landos_card_activity
    WHERE card_id = ? AND kind IN ('property_inspection','landportal_inspection')
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(cardId) as { id: number } | undefined;
  if (!row) return null;
  db.prepare(`INSERT OR IGNORE INTO landos_quarantined_card_evidence
    (activity_id, opportunity_id, reason, verification_json)
    VALUES (?, ?, ?, ?)`)
    .run(row.id, opportunityId, verification.reasons.join('; ') || verification.verdict, JSON.stringify(verification));
  return row.id;
}

/** Reconcile every retained inspection for a card against immutable operator
 * constraints. This is additive: mismatched rows/files remain available for
 * audit but canonical readers skip them. */
export function quarantineMismatchedPropertyInspections(
  opportunityId: number,
  cardId: number,
  constraints: ResearchIdentityConstraints,
): Array<{ activityId: number; verification: ResearchVerification }> {
  const db = getLandosDb();
  const rows = db.prepare(`SELECT a.id, a.ref FROM landos_card_activity a
    WHERE a.card_id = ? AND a.kind IN ('property_inspection','landportal_inspection')
      AND NOT EXISTS (SELECT 1 FROM landos_quarantined_card_evidence q WHERE q.activity_id = a.id)
    ORDER BY a.created_at DESC, a.id DESC`).all(cardId) as Array<{ id: number; ref: string }>;
  const quarantined: Array<{ activityId: number; verification: ResearchVerification }> = [];
  for (const row of rows) {
    try {
      const inspection = JSON.parse(row.ref) as PropertyInspectionRecord;
      const verification = verifyInspectionIdentity(constraints, inspection);
      if (verification.accepted) continue;
      db.prepare(`INSERT OR IGNORE INTO landos_quarantined_card_evidence
        (activity_id, opportunity_id, reason, verification_json) VALUES (?, ?, ?, ?)`)
        .run(row.id, opportunityId, verification.reasons.join('; ') || verification.verdict, JSON.stringify(verification));
      quarantined.push({ activityId: row.id, verification });
    } catch {
      const verification: ResearchVerification = {
        accepted: false, identityState: 'unresolved', verdict: 'insufficient_identity',
        reasons: ['Stored inspection could not be parsed safely.'],
        warnings: [],
        expected: constraints, observed: { address: null, city: null, county: null, state: null, apn: null },
      };
      db.prepare(`INSERT OR IGNORE INTO landos_quarantined_card_evidence
        (activity_id, opportunity_id, reason, verification_json) VALUES (?, ?, ?, ?)`)
        .run(row.id, opportunityId, verification.reasons[0], JSON.stringify(verification));
      quarantined.push({ activityId: row.id, verification });
    }
  }
  return quarantined;
}

/** Restore only evidence previously quarantined for this opportunity when the
 * owner-confirmed identity now corroborates it. The evidence is re-evaluated
 * from its durable activity record; no provider result is rewritten. */
export function restoreMatchingPropertyInspections(
  opportunityId: number,
  cardId: number,
  constraints: ResearchIdentityConstraints,
): number[] {
  const db = getLandosDb();
  const rows = db.prepare(`SELECT a.id, a.ref FROM landos_card_activity a
    INNER JOIN landos_quarantined_card_evidence q ON q.activity_id = a.id
    WHERE a.card_id = ? AND q.opportunity_id = ?
      AND a.kind IN ('property_inspection','landportal_inspection')
    ORDER BY a.created_at DESC, a.id DESC`).all(cardId, opportunityId) as Array<{ id: number; ref: string }>;
  const restored: number[] = [];
  for (const row of rows) {
    try {
      const inspection = JSON.parse(row.ref) as PropertyInspectionRecord;
      if (!verifyInspectionIdentity(constraints, inspection).accepted) continue;
      const result = db.prepare(`DELETE FROM landos_quarantined_card_evidence
        WHERE activity_id = ? AND opportunity_id = ?`).run(row.id, opportunityId);
      if (result.changes) restored.push(row.id);
    } catch {
      // Malformed retained evidence stays quarantined.
    }
  }
  return restored;
}

export function isCardActivityQuarantined(activityId: number): boolean {
  return !!getLandosDb().prepare('SELECT 1 FROM landos_quarantined_card_evidence WHERE activity_id = ?').get(activityId);
}

export function listQuarantinedResearchEvidence(opportunityId: number): Array<{
  activityId: number; reason: string; verification: ResearchVerification; quarantinedBy: string; quarantinedAt: number;
}> {
  const rows = getLandosDb().prepare(`SELECT activity_id, reason, verification_json, quarantined_by, quarantined_at
    FROM landos_quarantined_card_evidence WHERE opportunity_id = ? ORDER BY quarantined_at DESC, activity_id DESC`)
    .all(opportunityId) as Array<{ activity_id: number; reason: string; verification_json: string; quarantined_by: string; quarantined_at: number }>;
  return rows.map((row) => ({
    activityId: row.activity_id, reason: row.reason, verification: JSON.parse(row.verification_json) as ResearchVerification,
    quarantinedBy: row.quarantined_by, quarantinedAt: row.quarantined_at,
  }));
}
