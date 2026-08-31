// LandOS — SHARED LandPortal browser execution capability.
//
// ONE capability every LandOS workflow uses to reach LandPortal: Smart Intake,
// parcel resolution, comps, visuals, reports, Property Research, and (later) the
// Market Intelligence Agent. Missions differ; the execution surface does not.
// Nothing else may open its own LandPortal browser implementation.
//
// The capability enforces three contracts that deterministic DOM automation alone
// cannot honour:
//
//  1. MANDATORY VISUAL VERIFICATION. Deterministic automation performs routine
//     navigation, but every CONSEQUENTIAL action — submitting a search, selecting
//     a result, extracting facts, capturing a screenshot — is gated behind a
//     checkpoint that inspects what is actually on screen. A DOM-only workflow
//     accepted a Davidson-county parcel for a Roane-county subject and reported
//     "no confident match" while the correct result was visibly first. A page
//     that has not been looked at cannot be acted on.
//
//  2. SCREENSHOT QUALITY. A capture is `accepted`, `recapture_required`, or
//     `unavailable` — never "a file was written, therefore evidence exists". A
//     blank, obstructed, wrong-parcel, boundary-less, or unloaded capture is
//     rejected and recaptured within a bounded budget.
//
//  3. BROWSER LIFECYCLE. Every page, popup, tab, viewer, and context a job opens
//     is registered and closed — after success, partial completion, failure,
//     timeout, cancellation, or a visual-verification rejection. Logging in again
//     later is cheap; a leaked authenticated page is not. The janitor only ever
//     touches resources LandOS itself registered, never an operator's own tab.
//
// The verifiers are PURE: they take the frame the agent actually observed and
// return a verdict with reasons. That makes every gate testable without a
// browser, and makes an unverified action a type-level impossibility rather than
// a convention someone must remember.

import { createHash } from 'node:crypto';

import { getLandosDb, landosAudit } from './db.js';
import { ownerNameTokens, roadNameTokens, scoreResultCandidate } from './website-intelligence.js';
import type { ResultCandidate } from './website-intelligence.js';
import { apnIdentifiersCorroborate } from './apn-identity.js';
import { looksLikeStreetAddress } from './lead-identity.js';

export const LANDPORTAL_CAPABILITY_BASE = 'https://landportal.com';

/** The search modes the shared capability supports. */
export type LandPortalSearchMode = 'apn' | 'owner' | 'address';

/** The subject a LandPortal job is working on. Every checkpoint compares the
 *  screen against THIS, never against whatever the page happens to show. */
export interface LandPortalSubject {
  apn?: string;
  /** Jurisdiction-equivalent APN forms (state-format vs county-local). */
  apnAlternates?: string[];
  owner?: string;
  address?: string;
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
  acreage?: number | null;
  lat?: number | null;
  lng?: number | null;
}

/** A real operator/source street that may participate in parcel identity.
 * Storage labels such as `Parcel 023.003-02` name a lead but are not situs
 * addresses and must never contradict the actual road shown by a parcel panel. */
export function landPortalSubjectStreet(subject: LandPortalSubject): string | undefined {
  const address = subject.address?.trim();
  return address && looksLikeStreetAddress(address) ? address : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL FRAMES — what the agent actually looked at
// ─────────────────────────────────────────────────────────────────────────────

/** The visually observed state of the LandPortal search form, read from the
 *  rendered page (not from what the automation believes it typed). */
export interface SearchConfigurationFrame {
  url: string;
  /** The search mode VISIBLY selected on screen. */
  selectedMode: LandPortalSearchMode | null;
  /** The values VISIBLY present in the inputs. */
  enteredValues: Partial<Record<LandPortalSearchMode, string>>;
  /** The jurisdiction filters VISIBLY active. */
  activeState: string | null;
  activeCounty: string | null;
  /** Any other filter chips visibly active (acreage, price, prior subject…). */
  activeFilters: string[];
  /** The capture the agent inspected. Null means nothing was looked at. */
  screenshotPath: string | null;
}

/** The visually observed parcel-detail state after a result was selected. */
export interface ParcelDetailFrame {
  url: string;
  /** True when a parcel is visibly highlighted on the map; null when the detail
   *  view shows no map at all (nothing to highlight, nothing to fault). */
  parcelHighlighted: boolean | null;
  /** True when the parcel detail panel is visibly open. */
  detailPanelOpen: boolean;
  owner: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  apn: string | null;
  acreage: number | null;
  lat?: number | null;
  lng?: number | null;
  /** LandPortal's own identifiers, discovered — never required as input. */
  landPortalPropertyId?: string | null;
  fips?: string | null;
  screenshotPath: string | null;
}

/** The visually observed state immediately before/after a capture. */
export interface CaptureFrame {
  url: string;
  /** The parcel the capture is meant to prove. */
  parcelApn: string | null;
  /** The overlay / map state intended for this capture. */
  intendedOverlay: string | null;
  activeOverlay: string | null;
  boundaryVisible: boolean;
  tilesLoaded: boolean;
  /** Dialogs, dropdowns, spinners, unrelated panels covering the subject. */
  obstructions: string[];
  /** Bytes on disk after capture (post-capture inspection only). */
  bytes?: number | null;
  screenshotPath: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINTS
// ─────────────────────────────────────────────────────────────────────────────

export type VisualCheckpointKind =
  | 'search_configuration'
  | 'result_selection'
  | 'parcel_selected'
  | 'pre_capture'
  | 'post_capture';

export interface VisualCheckpoint {
  kind: VisualCheckpointKind;
  passed: boolean;
  /** What the agent confirmed it saw. */
  confirmed: string[];
  /** Why the checkpoint failed. Empty when passed. */
  blockers: string[];
  /** Signals the page does not display, so they could not be compared. Recorded
   *  rather than glossed: a field the site never shows is not a contradiction,
   *  but it is also not verification, and the operator gets told which is which. */
  unverified: string[];
  /** The capture that was inspected, when one was. */
  screenshotPath: string | null;
}

/** Raised when a consequential LandPortal action is attempted without a passing
 *  visual checkpoint. Callers catch this; the lifecycle still cleans up. */
export class LandPortalVisualVerificationError extends Error {
  readonly checkpoint: VisualCheckpoint;
  constructor(checkpoint: VisualCheckpoint) {
    super(`LandPortal ${checkpoint.kind} visual verification failed: ${checkpoint.blockers.join('; ')}`);
    this.name = 'LandPortalVisualVerificationError';
    this.checkpoint = checkpoint;
  }
}

/** The gate. A consequential action must pass its checkpoint through this. */
export function requireVisualCheckpoint(checkpoint: VisualCheckpoint): VisualCheckpoint {
  if (!checkpoint.passed) throw new LandPortalVisualVerificationError(checkpoint);
  return checkpoint;
}

function norm(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normCounty(s: string | null | undefined): string {
  return norm(s).replace(/\bcounty\b/g, '').trim();
}
function compactId(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const STATE_NAMES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio',
  ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota',
  tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia',
  wi: 'wisconsin', wy: 'wyoming',
};

/** Does a result row name the subject's state, by code or by full name? A state
 *  whose full name we do not know contributes NO match — never a blanket one,
 *  which an empty-string `includes` would silently produce. */
function stateNameMatches(hay: string, state: string | null | undefined): boolean {
  const code = norm(state);
  if (!code) return false;
  if (new RegExp(`\\b${code}\\b`).test(hay)) return true;
  const full = STATE_NAMES[code];
  return !!full && hay.includes(full);
}

/** Do two state spellings name the same state ("TN" ≡ "Tennessee")? */
export function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  const ea = na.length === 2 ? (STATE_NAMES[na] ?? na) : na;
  const eb = nb.length === 2 ? (STATE_NAMES[nb] ?? nb) : nb;
  return ea === eb;
}

/**
 * CHECKPOINT 1 — before submitting a search.
 *
 * Confirms visually that the intended search mode is selected, that every value
 * on screen is the value we meant to enter, that the intended state and county
 * filters are active, and that NO filter left over from another property is
 * still applied. A stale county filter is how a search silently answers about
 * the wrong jurisdiction.
 */
export function verifySearchConfiguration(
  frame: SearchConfigurationFrame,
  intent: {
    mode: LandPortalSearchMode;
    value: string;
    subject: LandPortalSubject;
    /** True when the site actually offers jurisdiction scoping. A site with no
     *  county control cannot be faulted for not having one applied. */
    jurisdictionScopingAvailable?: boolean;
  },
): VisualCheckpoint {
  const confirmed: string[] = [];
  const blockers: string[] = [];
  const unverified: string[] = [];

  if (!frame.screenshotPath) blockers.push('No visual capture of the configured search was inspected.');
  else confirmed.push(`Inspected the configured search visually (${frame.screenshotPath}).`);

  if (frame.selectedMode == null) unverified.push('The page does not display which search mode is selected.');
  else if (frame.selectedMode !== intent.mode) blockers.push(`Search mode on screen is "${frame.selectedMode}", intended "${intent.mode}".`);
  else confirmed.push(`Search mode "${intent.mode}" is selected.`);

  const shown = frame.enteredValues[intent.mode];
  if (shown == null) unverified.push(`The page does not echo the entered ${intent.mode} value.`);
  else if (norm(shown) !== norm(intent.value)) blockers.push(`Entered ${intent.mode} value on screen is "${shown}", intended "${intent.value}".`);
  else confirmed.push(`Entered ${intent.mode} value "${intent.value}" is correct.`);

  // A value belonging to a DIFFERENT mode, left in the form by a previous search,
  // silently skews the result set. This is the "stale filter from another
  // property" failure and it is always a blocker.
  for (const [mode, value] of Object.entries(frame.enteredValues)) {
    if (mode === intent.mode) continue;
    if (norm(value)) blockers.push(`Stale "${mode}" value "${value}" is still entered from a previous search.`);
  }

  if (intent.subject.state) {
    if (!intent.jurisdictionScopingAvailable) unverified.push('This search surface offers no state filter.');
    else if (!sameState(frame.activeState, intent.subject.state)) blockers.push(`State filter on screen is "${frame.activeState ?? 'none'}", intended "${intent.subject.state}".`);
    else confirmed.push(`State filter "${frame.activeState}" is active.`);
  }
  if (intent.subject.county) {
    if (!intent.jurisdictionScopingAvailable) unverified.push('This search surface offers no county filter.');
    else if (normCounty(frame.activeCounty) !== normCounty(intent.subject.county)) blockers.push(`County filter on screen is "${frame.activeCounty ?? 'none'}", intended "${intent.subject.county}".`);
    else confirmed.push(`County filter "${frame.activeCounty}" is active.`);
  }

  for (const stale of frame.activeFilters) {
    if (norm(stale)) blockers.push(`Stale filter still active from another property: "${stale}".`);
  }

  return { kind: 'search_configuration', passed: blockers.length === 0, confirmed, blockers, unverified, screenshotPath: frame.screenshotPath };
}

/** One visually compared result row. */
export interface RankedLandPortalResult {
  candidate: ResultCandidate;
  score: number;
  matched: string[];
  confidence: 'high' | 'medium' | 'low';
  /** The structural comparison an operator makes by eye, field by field. */
  comparison: {
    owner: boolean;
    road: boolean;
    city: boolean;
    county: boolean;
    state: boolean;
    zip: boolean;
    apn: boolean;
    acreage: boolean;
  };
}

/** Does this candidate row carry the subject's acreage (within rounding)? */
function acreageMatches(text: string, acreage?: number | null): boolean {
  if (acreage == null || !Number.isFinite(acreage)) return false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ac\b|acre)/gi)) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && Math.abs(v - acreage) <= Math.max(0.05, acreage * 0.02)) return true;
  }
  return false;
}

/**
 * CHECKPOINT 2 — before selecting a result.
 *
 * Ranks the visible results by the SAME comparison a human makes: owner, state,
 * county, road/situs, city and ZIP, APN variants, acreage, coordinates. A result
 * is selectable only when it is both visually and structurally the subject. An
 * exact owner on the exact road in the correct jurisdiction outranks an unrelated
 * candidate that merely shares an APN string from another county.
 */
export function rankLandPortalResults(candidates: ResultCandidate[], subject: LandPortalSubject): RankedLandPortalResult[] {
  const ownerToks = subject.owner ? ownerNameTokens(subject.owner) : [];
  const subjectStreet = landPortalSubjectStreet(subject);
  const roadToks = subjectStreet ? roadNameTokens(subjectStreet) : [];
  const apnForms = [subject.apn, ...(subject.apnAlternates ?? [])].filter((x): x is string => !!x && compactId(x).length >= 4);

  return candidates
    .map((candidate) => {
      const score = scoreResultCandidate(candidate, {
        apn: subject.apn, address: subjectStreet, owner: subject.owner,
        city: subject.city, county: subject.county, state: subject.state,
      });
      const hay = candidate.text.toLowerCase();
      const hayC = compactId(candidate.text);
      return {
        candidate,
        score: score.score,
        matched: score.matched,
        confidence: score.confidence,
        comparison: {
          owner: ownerToks.length > 0 && ownerToks.every((t) => hay.includes(t)),
          road: roadToks.length > 0 && roadToks.every((t) => hay.includes(t)),
          city: !!subject.city && norm(subject.city).split(/\s+/).some((t) => t.length > 3 && hay.includes(t)),
          county: !!subject.county && hay.includes(normCounty(subject.county)),
          state: stateNameMatches(hay, subject.state),
          zip: !!subject.zip && hay.includes(norm(subject.zip)),
          apn: apnForms.some((f) => hayC.includes(compactId(f))),
          acreage: acreageMatches(candidate.text, subject.acreage),
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Choose the one result to select, with the reasons. Returns null (never a
 * guess) when nothing is confidently the subject. A candidate whose road AND
 * city both contradict the subject is refused even when its APN string matches —
 * that is the cross-county APN collision, not the subject parcel.
 */
export function verifyResultSelection(
  candidates: ResultCandidate[],
  subject: LandPortalSubject,
): { checkpoint: VisualCheckpoint; selected: RankedLandPortalResult | null; ranked: RankedLandPortalResult[] } {
  const ranked = rankLandPortalResults(candidates, subject);
  const subjectStreet = landPortalSubjectStreet(subject);
  const confirmed: string[] = [];
  const blockers: string[] = [];

  const unverified: string[] = [];
  if (ranked.length === 0) {
    blockers.push('No result rows were visible to compare.');
    return { checkpoint: { kind: 'result_selection', passed: false, confirmed, blockers, unverified, screenshotPath: null }, selected: null, ranked };
  }

  const jurisdictionKnown = !!subject.county || !!subject.city;
  const eligible = ranked.filter((r) => {
    // Cross-county collision guard: an APN-only match that contradicts BOTH the
    // known road and the known jurisdiction is a different parcel.
    const contradictsPlace = jurisdictionKnown && !r.comparison.city && !r.comparison.county;
    const contradictsRoad = !!subjectStreet && !r.comparison.road;
    if (r.comparison.apn && contradictsPlace && contradictsRoad) return false;
    return true;
  });
  const rejected = ranked.length - eligible.length;
  if (rejected > 0) confirmed.push(`${rejected} result(s) rejected as a cross-jurisdiction identifier collision (APN matched, road and place did not).`);

  const best = eligible[0] ?? null;
  if (!best || best.confidence !== 'high') {
    blockers.push(best
      ? `Best visible result is ${best.confidence} confidence (${best.matched.join('+') || 'no identifying match'}); no result is confidently the subject.`
      : 'Every visible result contradicts the subject jurisdiction.');
    return { checkpoint: { kind: 'result_selection', passed: false, confirmed, blockers, unverified, screenshotPath: null }, selected: null, ranked };
  }
  const runnerUp = eligible[1];
  if (runnerUp && runnerUp.confidence === 'high' && runnerUp.score === best.score) {
    blockers.push('Two results tie at high confidence — ambiguous, nothing selected.');
    return { checkpoint: { kind: 'result_selection', passed: false, confirmed, blockers, unverified, screenshotPath: null }, selected: null, ranked };
  }

  const c = best.comparison;
  confirmed.push(`Compared owner=${c.owner} road=${c.road} city=${c.city} county=${c.county} state=${c.state} zip=${c.zip} apn=${c.apn} acreage=${c.acreage}.`);
  confirmed.push(`Selected result #${best.candidate.index}: ${best.candidate.text.slice(0, 120)}`);
  return { checkpoint: { kind: 'result_selection', passed: true, confirmed, blockers, unverified, screenshotPath: null }, selected: best, ranked };
}

/**
 * CHECKPOINT 3 — after selecting a result, before extracting anything.
 *
 * The highlighted parcel, the detail panel, the owner, the road, the county and
 * state, the APN, the acreage, and the map location must all refer to the SAME
 * subject property. Facts are extracted only after this passes.
 */
export function verifyParcelSelected(frame: ParcelDetailFrame, subject: LandPortalSubject): VisualCheckpoint {
  const confirmed: string[] = [];
  const blockers: string[] = [];
  const unverified: string[] = [];

  if (!frame.screenshotPath) blockers.push('No visual capture of the selected parcel was inspected.');
  else confirmed.push(`Inspected the selected parcel visually (${frame.screenshotPath}).`);

  if (frame.parcelHighlighted === null) unverified.push('The parcel detail view shows no map, so no boundary highlight could be compared.');
  else if (!frame.parcelHighlighted) blockers.push('No parcel is visibly highlighted on the map.');
  else confirmed.push('Subject parcel is highlighted on the map.');

  if (!frame.detailPanelOpen) blockers.push('The parcel detail panel is not open.');
  else confirmed.push('Parcel detail panel is open.');

  // Every comparison below follows one rule: a value the page DISPLAYS and that
  // contradicts the subject is a blocker; a value the page does not display is
  // recorded as unverified. A site that never shows a county has not disproved
  // the county, and pretending otherwise would reject correct parcels.
  if (subject.owner) {
    const toks = ownerNameTokens(subject.owner);
    if (!frame.owner) unverified.push('The parcel detail does not display an owner of record.');
    else if (toks.length && toks.every((t) => norm(frame.owner).includes(t))) confirmed.push(`Owner of record matches: ${frame.owner}.`);
    else blockers.push(`Owner on the parcel detail is "${frame.owner}", subject owner is "${subject.owner}".`);
  }
  let situsCorroborated = false;
  const subjectStreet = landPortalSubjectStreet(subject);
  if (subjectStreet) {
    const toks = roadNameTokens(subjectStreet);
    if (!frame.address) unverified.push('The parcel detail does not display a situs address.');
    else if (toks.length && toks.every((t) => norm(frame.address).includes(t))) { situsCorroborated = true; confirmed.push(`Road/situs matches: ${frame.address}.`); }
    else blockers.push(`Road on the parcel detail is "${frame.address}", subject road is "${subjectStreet}".`);
  }
  if (subject.county) {
    if (!frame.county) unverified.push('The parcel detail does not display a county.');
    else if (normCounty(frame.county) === normCounty(subject.county)) confirmed.push(`County matches: ${frame.county}.`);
    else blockers.push(`County on the parcel detail is "${frame.county}", subject county is "${subject.county}".`);
  }
  if (subject.state) {
    if (!frame.state) unverified.push('The parcel detail does not display a state.');
    else if (sameState(frame.state, subject.state)) confirmed.push(`State matches: ${frame.state}.`);
    else blockers.push(`State on the parcel detail is "${frame.state}", subject state is "${subject.state}".`);
  }
  // APN: jurisdiction-aware. A county-local form is the SAME parcel as the
  // state-prefixed form, so a format difference is never a mismatch. A genuinely
  // different identifier blocks ONLY when the situs did not already corroborate
  // the parcel: when the road and jurisdiction on screen are the subject's, the
  // parcel IS the subject and the operator's identifier is what needs review —
  // an operator-facing identifier conflict, not a wrong-parcel rejection.
  const apnForms = [subject.apn, ...(subject.apnAlternates ?? [])].filter((x): x is string => !!x && compactId(x).length >= 4);
  if (apnForms.length) {
    if (!frame.apn) unverified.push('The parcel detail does not display a parcel identifier.');
    else if (apnForms.some((f) => apnIdentifiersEquivalent(f, frame.apn as string))) confirmed.push(`APN reconciles with the subject identifier: ${frame.apn}.`);
    else if (situsCorroborated) unverified.push(`APN on the parcel detail is "${frame.apn}", which does not reconcile with the supplied "${apnForms[0]}"; the situs identifies this parcel, so the supplied identifier needs operator review.`);
    else blockers.push(`APN on the parcel detail is "${frame.apn}", which does not reconcile with "${apnForms[0]}".`);
  }
  if (subject.acreage != null) {
    if (frame.acreage == null) unverified.push('The parcel detail does not display acreage.');
    else if (Math.abs(frame.acreage - subject.acreage) <= Math.max(0.05, subject.acreage * 0.02)) confirmed.push(`Acreage matches: ${frame.acreage}.`);
    else blockers.push(`Acreage on the parcel detail is ${frame.acreage}, subject acreage is ${subject.acreage}.`);
  }
  if (subject.lat != null && subject.lng != null) {
    if (frame.lat == null || frame.lng == null) unverified.push('The parcel detail does not display map coordinates.');
    else if (Math.abs(frame.lat - subject.lat) <= 0.02 && Math.abs(frame.lng - subject.lng) <= 0.02) confirmed.push('Map location matches the subject coordinates.');
    else blockers.push(`Map location (${frame.lat}, ${frame.lng}) is not the subject location (${subject.lat}, ${subject.lng}).`);
  }

  return { kind: 'parcel_selected', passed: blockers.length === 0, confirmed, blockers, unverified, screenshotPath: frame.screenshotPath };
}

/**
 * PURE: do a state-format APN and a county-local APN name the SAME parcel?
 *
 * The browser lane and the resolution lane must never disagree about one
 * parcel, so both now ask `apn-identity.ts` — the single shared answer that
 * replaced the near-copies which had drifted apart.
 */
export function apnIdentifiersEquivalent(a: string, b: string): boolean {
  return apnIdentifiersCorroborate(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT QUALITY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenshotQualityResult = 'accepted' | 'recapture_required' | 'unavailable';

export interface ScreenshotQualityVerdict {
  result: ScreenshotQualityResult;
  reason: string;
  checkpoint: VisualCheckpoint;
}

/** What this capture is supposed to prove. A capture that cannot prove its fact
 *  is not evidence, however well it renders. */
export interface CaptureIntent {
  /** The fact the image must prove, in operator language. */
  provesFact: string;
  /** Whether the subject boundary must be visible for the fact to be proven. */
  boundaryRequired: boolean;
  /** The overlay/map state the fact requires, when any. */
  overlay?: string | null;
  subject: LandPortalSubject;
}

/**
 * CHECKPOINT 4 — before capturing. The correct parcel must be selected, the
 * intended overlay/map state active, the boundary visible when the fact needs it,
 * tiles loaded, nothing obstructing, and the frame must actually prove the fact.
 */
export function verifyPreCapture(frame: CaptureFrame, intent: CaptureIntent): VisualCheckpoint {
  const confirmed: string[] = [];
  const blockers: string[] = [];

  const apnForms = [intent.subject.apn, ...(intent.subject.apnAlternates ?? [])].filter((x): x is string => !!x);
  if (apnForms.length) {
    if (frame.parcelApn && apnForms.some((f) => apnIdentifiersEquivalent(f, frame.parcelApn as string))) confirmed.push(`Correct parcel is selected (${frame.parcelApn}).`);
    else blockers.push(`Selected parcel is "${frame.parcelApn ?? 'none'}", subject parcel is "${apnForms[0]}".`);
  }
  const intendedOverlay = intent.overlay ?? frame.intendedOverlay ?? null;
  if (intendedOverlay) {
    if (norm(frame.activeOverlay) === norm(intendedOverlay)) confirmed.push(`Intended overlay "${intendedOverlay}" is active.`);
    else blockers.push(`Active overlay is "${frame.activeOverlay ?? 'none'}", intended "${intendedOverlay}".`);
  }
  if (intent.boundaryRequired) {
    if (frame.boundaryVisible) confirmed.push('Subject parcel boundary is visible.');
    else blockers.push('Subject parcel boundary is not visible; the capture would not prove the fact.');
  }
  if (frame.tilesLoaded) confirmed.push('Map tiles are loaded.');
  else blockers.push('Map tiles are still loading.');
  if (frame.obstructions.length) blockers.push(`Obstructed by: ${frame.obstructions.join(', ')}.`);
  else confirmed.push('Nothing is obstructing the subject.');

  if (blockers.length === 0) confirmed.push(`This frame proves: ${intent.provesFact}.`);
  return { kind: 'pre_capture', passed: blockers.length === 0, confirmed, blockers, unverified: [], screenshotPath: null };
}

/** The smallest a real LandPortal map capture can plausibly be. Anything under
 *  this is a blank or torn frame, not evidence. */
export const MIN_USEFUL_CAPTURE_BYTES = 8 * 1024;

/**
 * CHECKPOINT 5 — after capturing, the saved image is inspected. A capture is
 * accepted only when the file exists, is not blank, still shows the correct
 * parcel with its boundary and overlay, and is unobstructed. Anything else is
 * `recapture_required`; a capture the browser could not produce at all is
 * `unavailable` (an honest bounded failure, never a silent pass).
 */
export function assessScreenshotQuality(frame: CaptureFrame, intent: CaptureIntent): ScreenshotQualityVerdict {
  const confirmed: string[] = [];
  const blockers: string[] = [];

  if (!frame.screenshotPath) {
    const checkpoint: VisualCheckpoint = {
      kind: 'post_capture', passed: false, confirmed,
      blockers: ['No image was produced by the browser.'], unverified: [], screenshotPath: null,
    };
    return { result: 'unavailable', reason: 'LandPortal produced no image for this capture.', checkpoint };
  }
  confirmed.push(`Inspected the saved capture (${frame.screenshotPath}).`);

  if (frame.bytes != null && frame.bytes < MIN_USEFUL_CAPTURE_BYTES) blockers.push(`Saved image is ${frame.bytes} bytes — blank or torn.`);
  const pre = verifyPreCapture(frame, intent);
  blockers.push(...pre.blockers);
  confirmed.push(...pre.confirmed);

  const checkpoint: VisualCheckpoint = {
    kind: 'post_capture', passed: blockers.length === 0, confirmed, blockers,
    unverified: pre.unverified, screenshotPath: frame.screenshotPath,
  };
  if (checkpoint.passed) return { result: 'accepted', reason: `Capture proves: ${intent.provesFact}.`, checkpoint };
  return { result: 'recapture_required', reason: blockers.join(' '), checkpoint };
}

/** Default recapture budget: enough to survive a slow tile load or a transient
 *  dialog, bounded so a broken page reaches an honest failure instead of looping. */
export const DEFAULT_CAPTURE_ATTEMPTS = 2;

export interface CaptureAttemptRecord {
  attempt: number;
  result: ScreenshotQualityResult;
  reason: string;
  screenshotPath: string | null;
  capturedAtIso: string;
}

export interface VerifiedCapture {
  result: ScreenshotQualityResult;
  reason: string;
  screenshotPath: string | null;
  capturedAtIso: string | null;
  artifactHash: string | null;
  attempts: CaptureAttemptRecord[];
}

/**
 * Capture with mandatory verification on BOTH sides: the pre-capture state is
 * verified, the image is captured, the saved image is inspected, and anything
 * ineffective is rejected and recaptured until accepted or the bounded budget is
 * spent. An ineffective capture is never returned as evidence.
 */
export async function captureVerified(input: {
  intent: CaptureIntent;
  /** Observe the live page. Called before every attempt. */
  observe: () => Promise<CaptureFrame>;
  /** Perform the capture; returns the saved frame (path + bytes). */
  capture: () => Promise<CaptureFrame>;
  /** Hash the saved artifact for evidence provenance. */
  hashArtifact?: (path: string) => Promise<string | null>;
  /** Optional remediation between attempts (dismiss dialog, wait for tiles). */
  remediate?: (blockers: string[]) => Promise<void>;
  maxAttempts?: number;
  nowIso?: () => string;
}): Promise<VerifiedCapture> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_CAPTURE_ATTEMPTS);
  const nowIso = input.nowIso ?? (() => new Date().toISOString());
  const attempts: CaptureAttemptRecord[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const before = await input.observe();
    const pre = verifyPreCapture(before, input.intent);
    if (!pre.passed) {
      attempts.push({ attempt, result: 'recapture_required', reason: pre.blockers.join(' '), screenshotPath: null, capturedAtIso: nowIso() });
      if (attempt < maxAttempts) await input.remediate?.(pre.blockers);
      continue;
    }
    const saved = await input.capture();
    const verdict = assessScreenshotQuality(saved, input.intent);
    const capturedAtIso = nowIso();
    attempts.push({ attempt, result: verdict.result, reason: verdict.reason, screenshotPath: saved.screenshotPath, capturedAtIso });
    if (verdict.result === 'accepted') {
      const artifactHash = saved.screenshotPath ? await (input.hashArtifact?.(saved.screenshotPath) ?? Promise.resolve(null)) : null;
      return { result: 'accepted', reason: verdict.reason, screenshotPath: saved.screenshotPath, capturedAtIso, artifactHash, attempts };
    }
    if (verdict.result === 'unavailable' && attempt === maxAttempts) {
      return { result: 'unavailable', reason: verdict.reason, screenshotPath: null, capturedAtIso: null, artifactHash: null, attempts };
    }
    if (attempt < maxAttempts) await input.remediate?.(verdict.checkpoint.blockers);
  }

  const last = attempts[attempts.length - 1];
  return {
    result: last?.result === 'unavailable' ? 'unavailable' : 'recapture_required',
    reason: `No effective capture after ${maxAttempts} attempt(s). ${last?.reason ?? ''}`.trim(),
    screenshotPath: null, capturedAtIso: null, artifactHash: null, attempts,
  };
}

/** Persist a capture verdict as evidence. Only an ACCEPTED capture is ever
 *  presented as proof; rejected attempts are retained as honest history. */
export function persistCaptureVerdict(input: {
  dealCardId: number | null;
  parcelApn: string | null;
  sourceUrl: string;
  purpose: string;
  capture: VerifiedCapture;
  actor?: string;
}): number {
  const db = getLandosDb();
  const info = db.prepare(`
    INSERT INTO landos_landportal_capture (
      deal_card_id, parcel_apn, purpose, source_url, quality_result, quality_reason,
      screenshot_path, artifact_hash, captured_at_iso, attempt_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.dealCardId, input.parcelApn, input.purpose, input.sourceUrl,
    input.capture.result, input.capture.reason.slice(0, 1000),
    input.capture.result === 'accepted' ? input.capture.screenshotPath : null,
    input.capture.artifactHash, input.capture.capturedAtIso, input.capture.attempts.length,
  );
  landosAudit(input.actor ?? 'landportal-capability', 'landportal_capture_verdict',
    `${input.purpose} → ${input.capture.result}`,
    { refTable: 'landos_landportal_capture', refId: Number(info.lastInsertRowid) });
  return Number(info.lastInsertRowid);
}

/** Only accepted captures are evidence. Rejected attempts remain queryable as
 *  history but are never presented as proof of anything. */
export function readAcceptedCaptures(dealCardId: number): Array<{
  id: number; purpose: string; sourceUrl: string; screenshotPath: string; artifactHash: string | null; capturedAtIso: string | null;
}> {
  return getLandosDb().prepare(`
    SELECT id, purpose, source_url AS sourceUrl, screenshot_path AS screenshotPath,
           artifact_hash AS artifactHash, captured_at_iso AS capturedAtIso
    FROM landos_landportal_capture
    WHERE deal_card_id = ? AND quality_result = 'accepted' AND screenshot_path IS NOT NULL
    ORDER BY id DESC
  `).all(dealCardId) as Array<{ id: number; purpose: string; sourceUrl: string; screenshotPath: string; artifactHash: string | null; capturedAtIso: string | null }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackedLandPortalResource {
  key: string;
  type: 'context' | 'page' | 'popup' | 'viewer' | 'download' | 'temporary_session';
  parentKey?: string | null;
  safeUrl?: string | null;
  close(): Promise<void>;
}

export type LandPortalJobOutcome = 'succeeded' | 'partial' | 'failed' | 'timed_out' | 'cancelled' | 'visual_rejected';

export interface LandPortalJobResult<T> {
  outcome: LandPortalJobOutcome;
  value: T | null;
  error: string | null;
  cleanup: {
    status: 'succeeded' | 'failed';
    ownedResourceCount: number;
    openResourceCountAfter: number;
    error: string | null;
    memoryBeforeBytes: number;
    memoryAfterBytes: number;
  };
  jobId: number;
}

function nowSec(): number { return Math.floor(Date.now() / 1000); }

function beginLandPortalJob(mission: string, requestKey: string): number {
  const info = getLandosDb().prepare(`
    INSERT INTO landos_landportal_job (mission, request_key, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(mission, requestKey, nowSec());
  return Number(info.lastInsertRowid);
}

function registerResource(jobId: number, resource: TrackedLandPortalResource): void {
  getLandosDb().prepare(`
    INSERT OR IGNORE INTO landos_landportal_job_resource (
      job_id, resource_key, resource_type, parent_resource_key, safe_url, status, opened_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(jobId, resource.key, resource.type, resource.parentKey ?? null, resource.safeUrl ?? null, nowSec());
}

async function closeJobResources(jobId: number, resources: TrackedLandPortalResource[]): Promise<{
  status: 'succeeded' | 'failed'; error: string | null; openAfter: number;
}> {
  const db = getLandosDb();
  const errors: string[] = [];
  // Close children before parents: a popup opened from a page must not outlive it.
  for (const resource of [...resources].reverse()) {
    try {
      await resource.close();
      db.prepare(`UPDATE landos_landportal_job_resource SET status='closed', closed_at=?, cleanup_error=NULL WHERE job_id=? AND resource_key=?`)
        .run(nowSec(), jobId, resource.key);
    } catch (error) {
      const safe = String((error as Error)?.message ?? error).slice(0, 300);
      errors.push(`${resource.type}:${resource.key} ${safe}`);
      db.prepare(`UPDATE landos_landportal_job_resource SET status='cleanup_failed', cleanup_error=? WHERE job_id=? AND resource_key=?`)
        .run(safe, jobId, resource.key);
    }
  }
  const openAfter = (db.prepare(
    `SELECT COUNT(*) AS count FROM landos_landportal_job_resource WHERE job_id=? AND status IN ('open','cleanup_failed')`,
  ).get(jobId) as { count: number }).count;
  return { status: errors.length || openAfter ? 'failed' : 'succeeded', error: errors.length ? errors.join(' | ').slice(0, 1000) : null, openAfter };
}

/**
 * Run one LandPortal job with guaranteed cleanup.
 *
 * Every page, popup, tab, viewer, and context the job opens is registered through
 * `track` and closed afterwards — on success, partial completion, failure,
 * timeout, cancellation, and visual-verification rejection alike. Authentication
 * is never a reason to keep a page open; logging in again later is cheap.
 */
export async function runLandPortalJob<T>(input: {
  mission: string;
  requestKey: string;
  timeoutMs: number;
  isCancelled?: () => boolean;
  run(ctx: { track(resource: TrackedLandPortalResource): void; signal: AbortSignal }): Promise<T>;
}): Promise<LandPortalJobResult<T>> {
  const jobId = beginLandPortalJob(input.mission, input.requestKey);
  const resources: TrackedLandPortalResource[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const abort = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  let outcome: LandPortalJobOutcome = 'succeeded';
  let value: T | null = null;
  let error: string | null = null;

  try {
    value = await Promise.race([
      input.run({
        track(resource) {
          if (resources.some((r) => r.key === resource.key)) return;
          resources.push(resource);
          registerResource(jobId, resource);
        },
        signal: abort.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { abort.abort(); reject(new Error(`LandPortal job timed out after ${input.timeoutMs} ms.`)); }, Math.max(50, input.timeoutMs));
      }),
    ]);
    if (input.isCancelled?.()) outcome = 'cancelled';
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 1000);
    outcome = err instanceof LandPortalVisualVerificationError ? 'visual_rejected'
      : /timed out/i.test(error) ? 'timed_out'
        : input.isCancelled?.() ? 'cancelled' : 'failed';
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  // Cleanup ALWAYS runs, whatever the outcome.
  const cleanup = await closeJobResources(jobId, resources);
  getLandosDb().prepare(`
    UPDATE landos_landportal_job
    SET status=?, error=?, finished_at=?, owned_resource_count=?, open_resource_count_after=?
    WHERE id=?
  `).run(outcome, error, nowSec(), resources.length, cleanup.openAfter, jobId);

  return {
    outcome, value, error, jobId,
    cleanup: {
      status: cleanup.status, error: cleanup.error,
      ownedResourceCount: resources.length, openResourceCountAfter: cleanup.openAfter,
      memoryBeforeBytes: memoryBefore, memoryAfterBytes: process.memoryUsage().rss,
    },
  };
}

/**
 * Targeted janitor for abandoned LandOS-owned LandPortal resources. It can only
 * select rows LandOS itself registered, so an operator's own manually opened tab
 * is never touched — an unregistered handle is simply not in the ledger.
 */
export async function runLandPortalJanitor(input: {
  activeResources: Map<string, TrackedLandPortalResource>;
  abandonedBefore: number;
}): Promise<{ inspected: number; closed: number; failed: number; unavailable: number }> {
  const db = getLandosDb();
  const rows = db.prepare(`
    SELECT id, resource_key FROM landos_landportal_job_resource
    WHERE status IN ('open','cleanup_failed') AND opened_at <= ?
    ORDER BY id
  `).all(input.abandonedBefore) as Array<{ id: number; resource_key: string }>;
  let closed = 0, failed = 0, unavailable = 0;
  for (const row of rows) {
    const handle = input.activeResources.get(row.resource_key);
    if (!handle) {
      unavailable += 1;
      db.prepare(`UPDATE landos_landportal_job_resource SET status='abandoned', closed_at=?, cleanup_error='Runtime handle unavailable; owning context no longer exists.' WHERE id=?`).run(nowSec(), row.id);
      continue;
    }
    try {
      await handle.close();
      closed += 1;
      db.prepare(`UPDATE landos_landportal_job_resource SET status='closed', closed_at=?, cleanup_error=NULL WHERE id=?`).run(nowSec(), row.id);
    } catch (err) {
      failed += 1;
      db.prepare(`UPDATE landos_landportal_job_resource SET status='cleanup_failed', cleanup_error=? WHERE id=?`).run(String((err as Error)?.message ?? err).slice(0, 300), row.id);
    }
  }
  return { inspected: rows.length, closed, failed, unavailable };
}

/** How many LandPortal browser resources LandOS still holds open. Repeated jobs
 *  must not steadily increase this. */
export function openLandPortalResourceCount(): number {
  return (getLandosDb().prepare(
    `SELECT COUNT(*) AS count FROM landos_landportal_job_resource WHERE status IN ('open','cleanup_failed')`,
  ).get() as { count: number }).count;
}

export function hashBuffer(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}
