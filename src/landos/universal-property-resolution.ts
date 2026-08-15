// LandOS — UNIVERSAL PROPERTY RESOLUTION.
//
//   RAW NEW LEAD EVIDENCE
//     → race the fast identity sources
//     → FIRST SUFFICIENT EVIDENCE WINS
//     → ONE resolved property, promoted through the canonical path
//     → the existing LandOS parallel fanout is released immediately
//
// What this module replaces is one line, and that line was the defect:
//
//     const [capture, live] = await Promise.all([captureWait, publicWait]);
//
// Both identity paths were started concurrently and then AWAITED TOGETHER, so a
// county parcel layer that answered in twelve seconds still sat until the
// LandPortal browser capture's three-hundred-second window closed, and every
// downstream research lane sat behind it. Nothing about the evidence required
// that wait; only the join did.
//
// What this module is NOT:
//   • It is not a second canonical identity model. The shared resolved property
//     stays `landos_property_card` + `landos_property_identity_version`, written
//     through `upsertPropertyCard` and `reconcileSubjectIdentity` exactly as
//     before. No new table, no new identity record, no new read model.
//   • It is not a new research system. Every lane is an EXISTING LandOS
//     capability, injected: the public/official parcel run, the authenticated
//     LandPortal capture with its early subject handoff, and an indexed-web
//     lane built from the transport `official-source-discovery` already uses.
//   • It is not a browser stack. The indexed-web lane is a plain text
//     transport (`GovFetchText`); a browser-backed transport can be injected
//     later without changing a line here.
//
// Sufficiency is never decided by a lane about itself. A lane contributes
// evidence; the SHARED property is then re-read and judged by the existing
// `reconcileDiscoveryIdentity`. That is what makes "fastest wins" safe: the
// fastest lane still has to survive the same gate every lane survives, and a
// weak result can never outrank contradictory authoritative evidence.

import { logger } from '../logger.js';
import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { getPropertyCardRow, loadPropertyInspection, upsertPropertyCard } from './property-card.js';
import { reconcileDiscoveryIdentity, type DiscoveryIdentityDecision } from './discovery-identity.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import {
  bareCountyName,
  countyNamesAgree,
  decodeLandPortalCanonicalIdentity,
  stateNamesAgree,
  uspsFromStateName,
} from './landportal-canonical-identity.js';
import { apnIdentifiersCorroborate, detectApnConflict } from './property-resolution-engine.js';
import {
  anyParcelNotationMatches,
  extractParcelNotations,
  parcelNotationSearchPhrases,
  textMentionsParcelNotation,
  type ParcelNotation,
} from './parcel-notation.js';
import {
  DATALET_ROW,
  TH_TD_ROW,
  defaultGovFetchText,
  extractLabeledPairs,
  extractLinks,
  findLabeledValue,
  htmlToText,
  type GovFetchText,
  type LabeledValue,
} from './gis-transport.js';
import { officialDomainScore, searchEngineUrl, sourceContradictsRequestedState, unwrapSearchResults } from './netr-routing.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';
import {
  resolveJurisdiction,
  type JurisdictionFetchJson,
  type JurisdictionSourceRef,
} from './jurisdiction-resolution.js';
import {
  bestPdfParcelIdentity,
  loadOfficialPdf,
  looksLikePdf,
  pdfIdentityEligible,
  readPdfParcelIdentity,
  type OfficialPdfDocument,
  type PdfIdentityLimits,
} from './official-pdf-identity.js';
import {
  mineDocumentContext,
  retainDiscoveredContext,
  type DiscoveredContextResult,
  type SubjectAnchors,
} from './official-document-context.js';
import {
  buildLandPortalSearchPackage,
  type LandPortalSearchPackage,
} from './landportal-subject-upgrade.js';
import {
  composeOfficialDocumentSummary,
  type OfficialDocumentSubject,
  type OfficialDocumentSummary,
} from './official-document-summary.js';
import {
  documentKeyFor,
  persistDocumentIntelligence,
  type PersistDocumentIntelligenceResult,
} from './official-document-intelligence-store.js';
import type { LandosEntity } from './db.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const IDENTITY_LANE_IDS = [
  'retained_identity',
  /**
   * Establishes WHERE the parcel is, never WHICH parcel it is. It cannot win —
   * a county is not a parcel — but every official parcel source is selected by
   * county, so without it the strongest lane in the system cannot be aimed.
   */
  'jurisdiction',
  'official_parcel',
  'indexed_web',
  'landportal',
] as const;
export type IdentityLaneId = (typeof IDENTITY_LANE_IDS)[number];

/** Lanes that can be raced. `retained_identity` is evaluated, never raced. */
export type RaceableLaneId = Exclude<IdentityLaneId, 'retained_identity'>;

export type LaneStatus = 'evidence' | 'no_evidence' | 'unavailable' | 'error' | 'pending';

/** How strongly a source speaks about parcel identity. */
export type SourceOfficiality = 'official' | 'officially_linked' | 'unverified';

export interface ResolverSourceRef {
  label: string;
  url: string | null;
  officiality: SourceOfficiality;
}

/**
 * Facts a lane established but did NOT persist. Lanes that own their own
 * persistence (the public run, the LandPortal capture) return no patch: their
 * evidence is already on the shared property by the time they settle.
 */
export interface ResolverIdentityPatch {
  apn?: string | null;
  county?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
  owner?: string | null;
  acres?: number | null;
  fips?: string | null;
  lpPropertyId?: string | null;
  address?: string | null;
  /** Only an OFFICIAL parcel record may ask for this; `upsertPropertyCard`
   *  still refuses it without strong identity and a named source. */
  verified?: boolean;
  verificationSource?: string | null;
}

export interface IdentityLaneResult {
  lane: RaceableLaneId;
  status: LaneStatus;
  note: string;
  patch?: ResolverIdentityPatch | null;
  source?: ResolverSourceRef;
  /**
   * Government sources this lane SAW while resolving identity, whether or not
   * any of them produced a parcel record. They establish nothing and are never
   * promoted — they are provenance, and they are what the next sprint's
   * Property Backstory sweep starts from instead of searching again.
   */
  observedSources?: ResolverSourceRef[];
  /**
   * Official documents this lane already downloaded and parsed.
   *
   * Carried so the resolver can finish mining them AFTER the subject is
   * released. Nothing here participates in identity — the identity reading is
   * `patch`, and this is the rest of the document LandOS has already paid for.
   */
  fetchedDocuments?: OfficialPdfDocument[];
  /** Subject identifiers this lane learned, for anchoring the enrichment pass. */
  anchorHints?: { projectName?: string | null; address?: string | null };
}

export interface IdentityLaneRecord extends IdentityLaneResult {
  startedAtMs: number;
  settledAtMs: number | null;
  durationMs: number | null;
  /** Set when this lane's evidence was refused for contradicting the subject. */
  refusedFor: string[];
  applied: boolean;
  /** True when this lane is the one that released the downstream graph. */
  won: boolean;
}

/**
 * The subject as the resolver sees it: the shared property record plus the raw
 * intake evidence that never fitted in a column.
 */
export interface ResolverSubject {
  dealCardId: number;
  propertyCardId: number | null;
  entity: LandosEntity;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  acres: number | null;
  fips: string | null;
  lpPropertyId: string | null;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  verificationSource: string | null;
  /** Parcel notations read out of the preserved raw intake. Never normalized. */
  notations: ParcelNotation[];
  /** The operator's own words, exactly as stored. */
  rawIntake: string | null;
}

export interface ResolverEvaluation {
  decision: DiscoveryIdentityDecision;
  /** The shared property now names ONE parcel that research may proceed from. */
  sufficient: boolean;
  conflicts: string[];
}

/**
 * Everything the NEXT sprint's Property Backstory search needs, assembled here
 * so it never has to re-derive the subject. This sprint produces it and stops.
 */
export interface ResolvedSubjectHandle {
  dealCardId: number;
  propertyCardId: number | null;
  apn: string | null;
  parcelNotations: ParcelNotation[];
  owner: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  fips: string | null;
  lpPropertyId: string | null;
  acres: number | null;
  sourceEvidence: Array<{ lane: IdentityLaneId; label: string; url: string | null; officiality: SourceOfficiality }>;
}

export interface UniversalResolutionResult {
  dealCardId: number;
  propertyCardId: number | null;
  status: 'resolved' | 'conflicted' | 'unresolved' | 'skipped';
  identityState: DiscoveryIdentityDecision['state'];
  discoveryUsable: boolean;
  discoveryBasis: string;
  /** The lane whose evidence made the subject sufficient. */
  winner: IdentityLaneId | null;
  /** True when the downstream graph may fan out on this subject now. */
  released: boolean;
  /** True when the resolver returned while a useful lane was still running. */
  releasedEarly: boolean;
  elapsedMs: number;
  lanes: IdentityLaneRecord[];
  pendingLanes: RaceableLaneId[];
  conflicts: string[];
  notes: string[];
  subject: ResolvedSubjectHandle;
  /**
   * Mining of the documents already fetched, running AFTER this result was
   * produced. Production never awaits it; tests do, to assert what was kept.
   */
  enrichment?: Promise<DiscoveredContextResult[]>;
  /** The stronger LandPortal package, when one was available at release. */
  landPortalUpgrade?: LandPortalSearchPackage;
}

// ── Reading the shared property ─────────────────────────────────────────────

const text = (value: unknown): string | null => {
  const result = String(value ?? '').trim();
  return result && result !== '-' && result.toLowerCase() !== 'null' ? result : null;
};
const positive = (value: unknown): number | null => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const stateKey = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const usps = uspsFromStateName(raw);
  return (usps ?? raw).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
};

/** The shared canonical property, plus the notations preserved in raw intake. */
export function readResolverSubject(dealCardId: number): ResolverSubject | null {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const resolution = resolveSubjectPropertyCard(deal);
  const cardId = resolution.cardId;
  const card = cardId == null ? null : getPropertyCardRow(cardId);
  if (!card) return null;
  const rawIntake = text(card.summary) ?? text((deal as { seller_notes?: string }).seller_notes);
  const address = text(card.active_input_address);
  return {
    dealCardId,
    propertyCardId: cardId,
    entity: card.entity as LandosEntity,
    address,
    city: text(card.city),
    county: text(card.county),
    state: text(card.state),
    zip: text(card.zip),
    apn: text(card.apn),
    owner: text(card.owner),
    acres: positive(card.acres),
    fips: text(card.fips),
    lpPropertyId: text(card.lp_property_id),
    lat: card.lat == null ? null : Number(card.lat),
    lng: card.lng == null ? null : Number(card.lng),
    verified: String(card.verification_status ?? '') === 'verified_property',
    verificationSource: text(card.verification_source),
    // The notation may live in the operator's paste OR in the address line
    // itself, because a lead with no street address is stored by what the
    // operator actually typed.
    notations: extractParcelNotations([rawIntake, address].filter(Boolean).join('\n')),
    rawIntake,
  };
}

/**
 * Judge the SHARED property with the existing discovery gate.
 *
 * Nothing lane-specific reaches this: whatever a lane contributed is already on
 * the property record, so every lane is judged by the same rule the mission has
 * always used.
 */
export function evaluateResolverIdentity(subject: ResolverSubject): ResolverEvaluation {
  const inspection = subject.propertyCardId == null ? null : loadPropertyInspection(subject.propertyCardId);
  const decision = reconcileDiscoveryIdentity({
    subject: {
      address: subject.address,
      city: subject.city,
      county: subject.county,
      state: subject.state,
      zip: subject.zip,
      apn: subject.apn,
      owner: subject.owner,
      acres: subject.acres,
      fips: subject.fips,
    },
    landPortal: inspection ? {
      parcelUrl: inspection.parcelUrl,
      parcelFacts: inspection.parcelFacts,
      assetCount: inspection.assets.length,
      sourceLabel: 'LandPortal authenticated parcel panel',
      sourceNote: inspection.sources.find((item) => item.provider === 'LandPortal')?.note ?? null,
      verifiedSubject: inspection.parcelUrlRecord?.verifiedSubject === true,
    } : null,
    official: {
      status: subject.verified ? 'matched' : 'unavailable',
      source: subject.verificationSource ?? 'Official public parcel lookup',
      sourceUrl: null,
      note: subject.verified
        ? 'The persisted property card retains the accepted official parcel match.'
        : 'No official parcel source has confirmed this subject yet.',
      parcel: subject.verified ? {
        address: subject.address,
        city: subject.city,
        county: subject.county,
        state: subject.state,
        zip: subject.zip,
        apn: subject.apn,
        owner: subject.owner,
        acres: subject.acres,
      } : null,
    },
  });
  // A resolved SUBJECT names a parcel. The discovery gate's address/state
  // marketplace fallback is deliberately not enough here: it exists so Zillow
  // and Redfin can work an address-only lead, and treating it as a resolution
  // would declare exactly the sparse leads this resolver exists for "already
  // resolved" and stop every identity lane before it ran. Parcel identity is an
  // APN with a jurisdiction, or the provider's own canonical key plus FIPS
  // (permanent memory invariant 2).
  const namesParcel = !!subject.apn || (!!subject.lpPropertyId && !!subject.fips);
  const sufficient = decision.conflicts.length === 0
    && namesParcel
    && (decision.state === 'confirmed' || (decision.state === 'provisional' && decision.discoveryUsable));
  return { decision, sufficient, conflicts: decision.conflicts };
}

// ── Applying a lane's evidence to the shared property ───────────────────────

export interface ApplyLaneEvidenceResult {
  applied: boolean;
  refusedFor: string[];
  warnings: string[];
}

/**
 * Write a lane's facts onto the ONE shared property, or refuse them.
 *
 * Refusal is the interesting half. A lane may only fill or corroborate; it may
 * never replace an accepted parcel identifier or an established jurisdiction
 * with a different one. A contradiction is recorded as a conflict and NOTHING
 * is written, so a fast weak result can never quietly overwrite slower, better
 * evidence — and can never attach another property's facts to this card.
 */
export function applyLaneEvidence(
  subject: ResolverSubject,
  patch: ResolverIdentityPatch | null | undefined,
  actor: string,
): ApplyLaneEvidenceResult {
  const refusedFor: string[] = [];
  if (!patch || subject.propertyCardId == null) return { applied: false, refusedFor, warnings: [] };

  const apn = text(patch.apn);
  const county = text(patch.county);
  const state = text(patch.state);

  if (apn && subject.apn && !apnIdentifiersCorroborate(subject.apn, apn)) {
    const conflict = detectApnConflict(
      { apn: subject.apn },
      [{ apn, source: actor }],
    );
    refusedFor.push(
      conflict
        ? `Parcel identifier conflict: this Deal Card carries ${conflict.requestedApn} and ${actor} returned ${conflict.resolvedApn}. They are not formatting variants, so nothing was written and the subject parcel stays unresolved until one is accepted.`
        : `Parcel identifier conflict between the retained ${subject.apn} and ${apn} from ${actor}; nothing was written.`,
    );
  }
  if (county && subject.county && !countyNamesAgree(bareCountyName(county) ?? county, bareCountyName(subject.county) ?? subject.county)) {
    refusedFor.push(`County conflict: the retained record says ${subject.county} and ${actor} says ${county}; nothing was written.`);
  }
  if (state && subject.state && !stateNamesAgree(state, subject.state)) {
    refusedFor.push(`State conflict: the retained record says ${subject.state} and ${actor} says ${state}; nothing was written.`);
  }
  if (refusedFor.length) return { applied: false, refusedFor, warnings: [] };

  // A lane FILLS a field the shared property does not carry. It never rewrites
  // one that is already accepted, even when it agrees: a corroborating source
  // returning "042 123.00 000" for an accepted "042-123.00-000" is confirming
  // the parcel, not correcting its spelling, and replacing the accepted value
  // would quietly hand provenance to whichever lane happened to finish last.
  // Correcting an accepted value is `reconcileSubjectIdentity`'s decision,
  // where per-field precedence and supersession history live.
  const acres = typeof patch.acres === 'number' && patch.acres > 0 ? patch.acres : null;
  const fill = <T>(existing: unknown, incoming: T | null): T | null =>
    (existing == null || existing === '' ? incoming : null);
  const fields = {
    ...(fill(subject.apn, apn) ? { apn: apn! } : {}),
    ...(fill(subject.county, county) ? { county: bareCountyName(county) ?? county! } : {}),
    ...(fill(subject.state, state) ? { state: state! } : {}),
    ...(fill(subject.city, text(patch.city)) ? { city: text(patch.city)! } : {}),
    ...(fill(subject.zip, text(patch.zip)) ? { zip: text(patch.zip)! } : {}),
    ...(fill(subject.owner, text(patch.owner)) ? { owner: text(patch.owner)! } : {}),
    ...(fill(subject.fips, text(patch.fips)) ? { fips: text(patch.fips)! } : {}),
    ...(fill(subject.lpPropertyId, text(patch.lpPropertyId)) ? { lpPropertyId: text(patch.lpPropertyId)! } : {}),
    ...(fill(subject.acres, acres) == null ? {} : { acres: acres! }),
  };
  // An official record may still upgrade an unverified card that already
  // carries every fact, because the verification itself is new evidence.
  const upgradesVerification = patch.verified === true && !!text(patch.verificationSource) && !subject.verified;
  if (Object.keys(fields).length === 0 && !upgradesVerification) return { applied: false, refusedFor, warnings: [] };

  // Asking for verification requires the strong parcel identity to travel with
  // the request — `upsertPropertyCard` refuses `verified` without it. The values
  // restated here are the ones already on the card, so nothing is rewritten.
  const verification = patch.verified === true && text(patch.verificationSource)
    ? {
        verified: true,
        verificationSource: text(patch.verificationSource)!,
        apn: (fields as { apn?: string }).apn ?? subject.apn ?? undefined,
        county: (fields as { county?: string }).county ?? subject.county ?? undefined,
        state: (fields as { state?: string }).state ?? subject.state ?? undefined,
      }
    : {};

  const upsert = upsertPropertyCard({
    entity: subject.entity,
    cardId: subject.propertyCardId,
    // The operator's own input line is never rewritten by a research lane.
    activeInputAddress: subject.address ?? '',
    ...fields,
    ...verification,
    agentId: actor,
  } as Parameters<typeof upsertPropertyCard>[0]);
  return { applied: true, refusedFor, warnings: upsert.warnings };
}

// ── The indexed-web identity lane ───────────────────────────────────────────

export interface IndexedWebLaneOptions {
  /**
   * The SEARCH half of the lane. When supplied, the lane asks this provider for
   * result URLs instead of reading a search-results page as HTML.
   *
   * This is the seam the governed keyless capability plugs into
   * (`createHermesFreeSearch`). It is deliberately a plain function: the lane
   * has no opinion about which engine answers, only about what may be believed
   * afterwards. A provider that returns [] degrades the lane to "no evidence",
   * never to a failure.
   */
  search?: IdentitySearchProvider;
  /** Text transport used to OPEN the government pages the search returned. */
  fetchText?: GovFetchText;
  /** `false` disables the bounded official-PDF identity path entirely. */
  pdfIdentity?: false;
  pdfLimits?: PdfIdentityLimits;
  /** Official documents this lane may open. Separate from the page budget. */
  maxDocuments?: number;
  /** Bounded: how many distinct queries to run. */
  maxQueries?: number;
  /** Bounded: how many result pages to open per run. */
  maxPages?: number;
  timeoutMs?: number;
  /** Search endpoint builder. Injected so a different engine can be swapped in. */
  searchUrl?: (query: string) => string;
}

export interface WebIdentityCandidate {
  sourceUrl: string;
  sourceLabel: string;
  host: string;
  officiality: SourceOfficiality;
  officialScore: number;
  apn: string | null;
  county: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  owner: string | null;
  acres: number | null;
  matchedNotation: boolean;
  matchedApn: boolean;
}

const APN_LABELS = [
  /^\s*(?:parcel|property|tax)?\s*(?:id|identification)\s*(?:number|no\.?|#)?\s*$/i,
  /^\s*parcel\s*(?:number|no\.?|#)?\s*$/i,
  /^\s*apn\s*$/i,
  /^\s*pin\s*$/i,
  /^\s*(?:control\s*)?map\s*(?:&|and|\/)\s*(?:parcel|group)\s*$/i,
  /^\s*account\s*(?:number|no\.?|#)?\s*$/i,
  /^\s*gislink\s*$/i,
];
const OWNER_LABELS = [/^\s*owner(?:\s*name)?\s*(?:\d)?\s*$/i, /^\s*taxpayer(?:\s*name)?\s*$/i, /^\s*grantee\s*$/i];
const ACRE_LABELS = [/^\s*(?:deeded\s*|calculated\s*|calc\s*|total\s*|assessed\s*|land\s*)?acres?\s*$/i, /^\s*acreage\s*$/i];
const COUNTY_LABELS = [/^\s*county\s*$/i, /^\s*county\s*name\s*$/i];
const CITY_LABELS = [/^\s*(?:city|municipality|town|place)\s*$/i];
const ADDRESS_LABELS = [
  /^\s*(?:location|property|situs|site|physical|parcel)\s*address\s*$/i,
  /^\s*address\s*$/i,
  /^\s*street\s*$/i,
];

/** Label/value pairs from the common government-portal table shapes, plus the
 *  plain "Label: value" wording a municipal page prints in prose. */
function pageLabeledValues(html: string): LabeledValue[] {
  const pairs = [
    ...extractLabeledPairs(html, TH_TD_ROW),
    ...extractLabeledPairs(html, DATALET_ROW),
    ...extractLabeledPairs(html, /<td[^>]*>([\s\S]{0,120}?)<\/td>\s*<td[^>]*>([\s\S]{0,240}?)<\/td>/gi),
    ...extractLabeledPairs(html, /<dt[^>]*>([\s\S]{0,120}?)<\/dt>\s*<dd[^>]*>([\s\S]{0,240}?)<\/dd>/gi),
  ];
  const flat = htmlToText(html);
  for (const match of flat.matchAll(/([A-Za-z][A-Za-z ()/&.#-]{2,40}?)\s*:\s*([^:|]{1,80}?)(?=\s{2,}|\s*\||$)/g)) {
    pairs.push({ label: (match[1] ?? '').trim(), value: (match[2] ?? '').trim() });
  }
  return pairs.filter((pair) => pair.label && pair.value);
}

function countyFromPage(pairs: LabeledValue[], flat: string): string | null {
  const labeled = findLabeledValue(pairs, COUNTY_LABELS);
  if (labeled) return bareCountyName(labeled) ?? labeled;
  const named = flat.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)\s+County\b/);
  return named?.[1] ?? null;
}

function stateFromPage(pairs: LabeledValue[], flat: string, host: string): string | null {
  const labeled = findLabeledValue(pairs, [/^\s*state\s*$/i]);
  const fromLabel = labeled ? stateKey(labeled) : '';
  if (fromLabel.length === 2) return fromLabel;
  const spelled = flat.match(/\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/);
  if (spelled) return stateKey(spelled[1]);
  const hostCode = host.match(/\.([a-z]{2})\.us$/i)?.[1];
  return hostCode ? hostCode.toUpperCase() : null;
}

function classifyOfficiality(url: string, county: string | null, state: string | null): { officiality: SourceOfficiality; score: number } {
  const score = officialDomainScore(url, county ?? undefined, state ?? undefined);
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = ''; }
  const government = /\.gov$/i.test(host) || /\.gov\./i.test(host) || /\.us$/i.test(host) || /\.state\./i.test(host);
  if (government) return { officiality: 'official', score: Math.max(score, 0.6) };
  if (score >= 0.6) return { officiality: 'official', score };
  if (score > 0) return { officiality: 'officially_linked', score };
  return { officiality: 'unverified', score: 0 };
}

/**
 * Queries built from the RAW identity evidence, not from a street address.
 *
 * The lead that forced this lane supplied a jurisdiction's own parcel notation
 * and a town. That is a perfectly answerable question for an indexed government
 * record, and the only reason LandOS could not ask it was that the previous web
 * lane could only spell an exact street address.
 */
export function buildIdentityDiscoveryQueries(subject: ResolverSubject, limit = 3): string[] {
  const locality = [
    subject.city,
    subject.county ? `${bareCountyName(subject.county) ?? subject.county} County` : null,
    subject.state,
  ].filter(Boolean).join(' ');
  const queries: string[] = [];
  for (const notation of subject.notations.filter((row) => row.identityBearing)) {
    const phrases = parcelNotationSearchPhrases(notation);
    for (const phrase of phrases) {
      queries.push(`${phrase} ${locality}`.trim());
      queries.push(`${phrase} ${locality} parcel assessor property record`.trim());
    }
  }
  if (subject.apn) {
    queries.push(`"${subject.apn}" ${locality} parcel`.trim());
    queries.push(`"${subject.apn}" ${locality} assessor property record`.trim());
  }
  if (subject.address && /\d/.test(subject.address) && subject.notations.length === 0) {
    queries.push(`"${subject.address}" ${locality} parcel assessor`.trim());
  }
  if (subject.owner) queries.push(`"${subject.owner}" ${locality} parcel property record`.trim());
  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter((query) => query.length > 3))]
    .slice(0, Math.max(1, limit));
}

/** Read one indexed page as parcel-identity evidence for THIS subject. */
export function readWebIdentityCandidate(
  subject: ResolverSubject,
  input: { url: string; label: string; html: string },
): WebIdentityCandidate | null {
  let host = '';
  try { host = new URL(input.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  const pairs = pageLabeledValues(input.html);
  const flat = htmlToText(input.html);
  const apn = text(findLabeledValue(pairs, APN_LABELS));
  if (!apn) return null;

  // IDENTITY GATE. The page must be about the parcel this lead named, proved by
  // the operator's own notation or by the accepted APN — never by the town, the
  // owner name, or the fact that a search engine returned it.
  const matchedNotation = anyParcelNotationMatches(subject.notations, apn);
  const matchedApn = !!subject.apn && apnIdentifiersCorroborate(subject.apn, apn);
  if (!matchedNotation && !matchedApn) return null;

  const county = countyFromPage(pairs, flat);
  const state = stateFromPage(pairs, flat, host);
  // A parcel in another state is a different parcel, whatever its number.
  if (state && subject.state && !stateNamesAgree(state, subject.state)) return null;
  if (county && subject.county && !countyNamesAgree(bareCountyName(county) ?? county, bareCountyName(subject.county) ?? subject.county)) return null;

  const { officiality, score } = classifyOfficiality(input.url, county, state);
  const acresText = findLabeledValue(pairs, ACRE_LABELS);
  return {
    sourceUrl: input.url,
    sourceLabel: input.label || host,
    host,
    officiality,
    officialScore: score,
    apn,
    county: county ? bareCountyName(county) ?? county : null,
    state,
    city: text(findLabeledValue(pairs, CITY_LABELS)),
    address: text(findLabeledValue(pairs, ADDRESS_LABELS)),
    owner: text(findLabeledValue(pairs, OWNER_LABELS)),
    acres: positive(acresText),
    matchedNotation,
    matchedApn,
  };
}

/**
 * Does this search result's own text already point at the lead's parcel?
 *
 * Used ONLY to decide which government page is worth opening. A result that
 * mentions the parcel still has to produce a real parcel record on the page,
 * and that record still has to pass the identity gate.
 */
export function mentionsSubjectParcel(subject: ResolverSubject, text: string): boolean {
  if (subject.notations.some((notation) => textMentionsParcelNotation(notation, text))) return true;
  if (!subject.apn) return false;
  const digits = subject.apn.replace(/[^0-9A-Za-z]/g, '');
  return digits.length >= 5 && text.replace(/[^0-9A-Za-z]/g, '').includes(digits);
}

function candidateStrength(candidate: WebIdentityCandidate): number {
  return candidate.officialScore
    + (candidate.county ? 0.4 : 0)
    + (candidate.state ? 0.2 : 0)
    + (candidate.owner ? 0.1 : 0)
    + (candidate.acres ? 0.1 : 0);
}

/**
 * Build the indexed-web identity lane.
 *
 * Reuses the transport `official-source-discovery` already runs on: a static
 * search endpoint read through `GovFetchText`, links unwrapped and scored for
 * officiality, then the promising GOVERNMENT pages opened and read. No browser,
 * no CDP, no new tool stack — and the transport is injectable, so a
 * browser-backed reader can be supplied later without touching this logic.
 */
export function buildIndexedWebIdentityLane(
  options: IndexedWebLaneOptions = {},
): (subject: ResolverSubject) => Promise<IdentityLaneResult> {
  const fetchText = options.fetchText ?? defaultGovFetchText;
  const searchUrl = options.searchUrl ?? searchEngineUrl;
  const maxQueries = Math.max(1, options.maxQueries ?? 3);
  const maxPages = Math.max(1, options.maxPages ?? 3);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 20_000);
  const pdfLimits = options.pdfLimits ?? {};

  return async (subject) => {
    const queries = buildIdentityDiscoveryQueries(subject, maxQueries);
    if (!queries.length) {
      return { lane: 'indexed_web', status: 'no_evidence', note: 'No raw identity evidence to search: the lead names neither a parcel notation, an APN, an address, nor an owner.' };
    }
    const attempted: string[] = [];
    const blocked: string[] = [];
    const seenPages = new Set<string>();
    const candidates: WebIdentityCandidate[] = [];
    /** Government sources this lane actually saw, kept for provenance. */
    const observed: ResolverSourceRef[] = [];
    const snippets = new Map<string, string>();
    const documentEvidence: Array<{
      url: string;
      label: string;
      officiality: SourceOfficiality;
      corroborated: boolean;
      reading: NonNullable<ReturnType<typeof bestPdfParcelIdentity>>;
      document: OfficialPdfDocument;
    }> = [];
    const documentRejections: string[] = [];
    const imageOnlyDocuments: string[] = [];
    let offTargetOpened = 0;
    let documentsOpened = 0;
    const maxDocuments = Math.max(0, options.maxDocuments ?? 3);

    for (const query of queries) {
      attempted.push(query);
      let results: Array<{ text: string; href: string }> = [];
      try {
        if (options.search) {
          // The governed keyless provider answers with structured results, so
          // there is no search page to scrape and nothing to unwrap.
          const hits = await options.search(query, { maxResults: 8, timeoutMs });
          for (const hit of hits) if (hit.snippet) snippets.set(hit.url, hit.snippet);
          results = hits.map((hit) => ({ text: hit.title || hit.url, href: hit.url }));
          if (!results.length) blocked.push(query);
        } else {
          const response = await fetchText(searchUrl(query), { timeoutMs });
          if (response.blocked) { blocked.push(query); continue; }
          results = unwrapSearchResults(
            extractLinks(response.body, response.url).map((link) => ({ text: link.label, href: link.url })),
          );
        }
      } catch (error) {
        blocked.push(`${query} (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      const ranked = results
        .filter((link) => !sourceContradictsRequestedState(link, subject.county ?? undefined, subject.state ?? undefined))
        .map((link) => {
          const snippet = snippets.get(link.href) ?? '';
          return {
            link,
            // A result whose own title, snippet or URL already carries this
            // lead's parcel notation is far more likely to BE the record than
            // one that merely lives on a government host. Ranking signal only.
            mentionsSubject: mentionsSubjectParcel(subject, `${link.text} ${snippet} ${link.href}`),
            ...classifyOfficiality(link.href, subject.county, subject.state),
          };
        })
        // Only government and government-linked records may establish identity.
        // An aggregator that echoes a parcel number is not a parcel record.
        .filter((row) => row.officiality !== 'unverified')
        .sort((a, b) => Number(b.mentionsSubject) - Number(a.mentionsSubject) || b.score - a.score);

      for (const row of ranked) {
        observed.push({ label: row.link.text || row.link.href, url: row.link.href, officiality: row.officiality });
        if (seenPages.size >= maxPages) break;

        // ── OFFICIAL DOCUMENT PATH ────────────────────────────────────────
        // A government PDF that already looks like it concerns this parcel is
        // read for identity and nothing else. It is bounded, anchored on the
        // operator's own notation, and it may never establish a parcel the
        // document does not actually name.
        if (options.pdfIdentity !== false && looksLikePdf(row.link.href, row.link.text)) {
          // Documents have their OWN small budget. Spending the HTML page
          // budget on them is what let one query's unrelated government pages
          // crowd out the packet that actually named the parcel.
          if (documentsOpened >= maxDocuments) continue;
          const eligibility = pdfIdentityEligible({
            url: row.link.href,
            title: row.link.text,
            snippet: snippets.get(row.link.href) ?? '',
            officiality: row.officiality,
            notations: subject.notations,
            apn: subject.apn,
            locality: subject.city,
            state: subject.state,
          });
          if (!eligibility.eligible) continue;
          if (seenPages.has(row.link.href)) continue;
          seenPages.add(row.link.href);
          documentsOpened += 1;
          // Fetched and parsed ONCE. The enrichment pass after release reads
          // this same parsed document rather than downloading it again.
          const document = await loadOfficialPdf(row.link.href, { timeoutMs, limits: pdfLimits });
          if (!document || !document.textLayer) {
            if (document) imageOnlyDocuments.push(document.url);
            continue;
          }
          const readings = readPdfParcelIdentity({
            text: document.text,
            notations: subject.notations,
            apn: subject.apn,
            limits: pdfLimits,
          });
          for (const rejected of readings.filter((reading) => !reading.matchesSubject)) {
            documentRejections.push(`${row.link.href}: ${rejected.rejectedReason}`);
          }
          const best = bestPdfParcelIdentity(readings);
          if (best) {
            documentEvidence.push({ url: row.link.href, label: row.link.text, officiality: row.officiality, corroborated: eligibility.hostCorroboratesLocality, reading: best, document });
          }
          continue;
        }

        // A single query's government results must not consume the whole page
        // budget on pages that never mentioned this parcel — a later, better
        // aimed query would then never get to open anything.
        if (!row.mentionsSubject && offTargetOpened >= 2) continue;
        if (seenPages.has(row.link.href)) continue;
        seenPages.add(row.link.href);
        if (!row.mentionsSubject) offTargetOpened += 1;
        try {
          const page = await fetchText(row.link.href, { timeoutMs });
          if (page.blocked) continue;
          const candidate = readWebIdentityCandidate(subject, { url: page.url || row.link.href, label: row.link.text, html: page.body });
          if (candidate) candidates.push(candidate);
        } catch {
          // A single unreachable page never fails the lane.
        }
      }
      // Stop when something was actually established, not merely when the page
      // budget ran out — a later, better-aimed query is exactly what the budget
      // rule used to prevent from ever running.
      if (candidates.length || documentEvidence.length) break;
      if (seenPages.size >= maxPages && documentsOpened >= maxDocuments) break;
      offTargetOpened = 0;
    }

    // Government sources that NAMED this parcel but produced no parcel record
    // are kept as provenance. They are not identity and are never promoted;
    // they are what the Property Backstory sweep will start from.
    const namedSources = observed.filter((source, index, all) =>
      all.findIndex((row) => row.url === source.url) === index);

    // ── An official document identified the parcel ──────────────────────────
    //
    // This is NOT an assessor or GIS parcel record, and it never claims to be.
    // It may request verification only when three independent things agree: the
    // document is published by the government of the locality LandOS
    // established from federal geography, its own map/parcel statement names
    // this lead's parcel, and the jurisdiction is settled. That is the
    // "APN plus county" clause of the identity invariant, evidenced twice over.
    if (!candidates.length && documentEvidence.length) {
      const best = documentEvidence.sort((a, b) => Number(b.corroborated) - Number(a.corroborated))[0];
      // The jurisdiction half of this decision is NOT made here. This lane was
      // handed the subject as it stood when the lane was dispatched, and the
      // jurisdiction lane may well have settled since — judging it from a stale
      // snapshot made the outcome depend on which lane happened to finish
      // first. `applyLaneEvidence` reads the CURRENT subject, and
      // `upsertPropertyCard` refuses verification without strong parcel
      // identity (an APN plus a county/state/FIPS) whatever this lane asks for.
      const verifiable = best.corroborated && !!best.reading.parcelIdentifier;
      return {
        lane: 'indexed_web',
        status: 'evidence',
        note: `Official document ${best.label || best.url} states Map ${best.reading.map} Parcel ${best.reading.parcel}`
          + `${best.reading.owner ? `, owner ${best.reading.owner}` : ''}`
          + `${best.reading.acres ? `, ${best.reading.acres} acres` : ''}`
          + `${best.reading.projectName ? `, ${best.reading.projectName}` : ''}`
          + `, matched to this lead by its own parcel notation.`
          + `${documentRejections.length ? ` ${documentRejections.length} other parcel mention(s) in the same document were rejected.` : ''}`,
        source: { label: best.label || best.url, url: best.url, officiality: best.officiality },
        observedSources: namedSources,
        // The whole parsed document travels with the result. The enrichment
        // pass reads it after release; it is never re-fetched.
        fetchedDocuments: documentEvidence.map((row) => row.document),
        anchorHints: { projectName: best.reading.projectName, address: best.reading.location },
        patch: {
          apn: best.reading.parcelIdentifier,
          owner: best.reading.owner,
          acres: best.reading.acres,
          verified: verifiable,
          verificationSource: verifiable
            ? `Official ${subject.city ?? 'municipal'} government record — ${best.label || best.url}`
            : null,
        },
      };
    }

    if (!candidates.length) {
      return {
        lane: 'indexed_web',
        status: blocked.length && !seenPages.size ? 'unavailable' : 'no_evidence',
        note: blocked.length && !seenPages.size
          ? `Indexed identity search could not run: the search transport was refused for ${blocked.length} of ${attempted.length} query/queries.`
          : `Indexed identity search ran ${attempted.length} query/queries and opened ${seenPages.size} government page(s); none carried a parcel record matching this lead's own identifier.`,
        observedSources: namedSources,
      };
    }

    const best = candidates.sort((a, b) => candidateStrength(b) - candidateStrength(a))[0];
    // An OFFICIAL government record naming this parcel with its jurisdiction is
    // an official parcel record (permanent memory invariant 2). Anything weaker
    // contributes its facts without claiming verification.
    const verifiable = best.officiality === 'official' && !!best.apn && !!best.county && !!best.state;
    return {
      lane: 'indexed_web',
      status: 'evidence',
      note: `Indexed government record ${best.sourceLabel} (${best.host}) carries parcel ${best.apn}${best.county ? ` in ${best.county} County` : ''}${best.state ? `, ${best.state}` : ''}, matched to this lead by ${best.matchedNotation ? 'its own parcel notation' : 'the accepted parcel identifier'}.`,
      source: { label: best.sourceLabel || best.host, url: best.sourceUrl, officiality: best.officiality },
      observedSources: namedSources,
      patch: {
        apn: best.apn,
        county: best.county,
        state: best.state,
        city: best.city,
        owner: best.owner,
        acres: best.acres,
        address: best.address,
        verified: verifiable,
        verificationSource: verifiable ? `Indexed official parcel record — ${best.sourceLabel || best.host} (${best.host})` : null,
      },
    };
  };
}

// ── The jurisdiction lane ───────────────────────────────────────────────────

export interface JurisdictionLaneOptions {
  fetchJson?: JurisdictionFetchJson;
  timeoutMs?: number;
}

/**
 * Establish the county from the locality, so an official parcel source can be
 * selected at all.
 *
 * It contributes county / state / county FIPS and NOTHING about which parcel
 * this is, so it can never win the race. Its whole value is that the lane which
 * CAN win becomes aimable once it settles.
 */
export function buildJurisdictionLane(
  options: JurisdictionLaneOptions = {},
): (subject: ResolverSubject) => Promise<IdentityLaneResult> {
  return async (subject) => {
    if (!subject.city || !subject.state) {
      return {
        lane: 'jurisdiction',
        status: 'no_evidence',
        note: subject.state
          ? 'No city, town, or municipality is named, so the county cannot be established from geography.'
          : 'No state is named, so no jurisdiction can be established.',
      };
    }
    if (subject.county && subject.state) {
      return {
        lane: 'jurisdiction',
        status: 'no_evidence',
        note: `The jurisdiction is already established: ${subject.county} County, ${subject.state}.`,
      };
    }
    const resolution = await resolveJurisdiction(
      { locality: subject.city, county: subject.county, state: subject.state, zip: subject.zip },
      { fetchJson: options.fetchJson, timeoutMs: options.timeoutMs },
    );
    const primary = resolution.sources[resolution.sources.length - 1] ?? null;
    if (resolution.conflicts.length) {
      return { lane: 'jurisdiction', status: 'no_evidence', note: resolution.conflicts.join(' '), observedSources: resolution.sources.map(sourceRefOf) };
    }
    if (!resolution.county) {
      return { lane: 'jurisdiction', status: 'no_evidence', note: resolution.basis, observedSources: resolution.sources.map(sourceRefOf) };
    }
    return {
      lane: 'jurisdiction',
      status: 'evidence',
      note: resolution.basis,
      source: primary ? sourceRefOf(primary) : undefined,
      observedSources: resolution.sources.map(sourceRefOf),
      // Jurisdiction only. No APN, no owner, no acreage — a county never
      // identifies a parcel and this patch must never look as though it does.
      patch: { county: resolution.county, state: resolution.state },
    };
  };
}

function sourceRefOf(source: JurisdictionSourceRef): ResolverSourceRef {
  return { label: `${source.label} — ${source.established}`, url: source.url, officiality: 'official' };
}

// ── The race ────────────────────────────────────────────────────────────────

export interface ResolveSubjectPropertyOptions {
  actor?: string;
  /** Overall bound on WAITING. Lanes are never cancelled by it. */
  deadlineMs?: number;
  /** Raceable lanes, each an existing LandOS capability. */
  lanes?: Partial<Record<RaceableLaneId, (subject: ResolverSubject) => Promise<IdentityLaneResult>>>;
  /** Wire the default indexed-web lane. `false` (the default) leaves it off. */
  indexedWeb?: IndexedWebLaneOptions | false;
  /**
   * Wire the jurisdiction lane. Like the indexed-web lane it is OFF unless
   * supplied, so a unit test never reaches the network by accident; the route
   * layer and the identity collector wire it on.
   */
  jurisdiction?: JurisdictionLaneOptions;
  /**
   * How many lane re-aims are permitted in total after another lane established
   * a jurisdiction or parcel identifier the first attempt did not have. Each
   * eligible lane is re-aimed AT MOST ONCE, and the total is bounded here
   * (default 2). This is progressive enrichment, not a retry loop.
   */
  maxLaneReAims?: number;
  /** Return at once when the retained identity is already sufficient. */
  retainedFastPath?: boolean;
  /** Let slower lanes reconcile into the same property after release. */
  enrichAfterRelease?: boolean;
  readSubject?: (dealCardId: number) => ResolverSubject | null;
  evaluate?: (subject: ResolverSubject) => ResolverEvaluation;
  applyEvidence?: (subject: ResolverSubject, patch: ResolverIdentityPatch | null | undefined, actor: string) => ApplyLaneEvidenceResult;
  promote?: (dealCardId: number, actor: string) => Promise<unknown>;
  clockMs?: () => number;
  onLaneSettled?: (record: IdentityLaneRecord) => void;
  /** `false` skips mining the documents already fetched. Default: mine them. */
  documentEnrichment?: false;
  /** Receives each mined document's findings as enrichment completes. */
  onDiscoveredContext?: (result: DiscoveredContextResult) => void;
  /** Receives each document's detailed summary and its persistence outcome. */
  onDocumentSummary?: (input: { summary: OfficialDocumentSummary; persisted: PersistDocumentIntelligenceResult }) => void;
  /**
   * Offered ONE bounded LandPortal subject upgrade when the resolver produced a
   * materially stronger subject while the LandPortal workflow was still running.
   *
   * The resolver does not act on it: the caller owns the capture and is the only
   * layer that can guarantee a second agent is not started concurrently.
   */
  onLandPortalUpgrade?: (input: { dealCardId: number; subject: ResolverSubject; package: LandPortalSearchPackage }) => void;
}

function handleFor(subject: ResolverSubject, lanes: IdentityLaneRecord[], winner: IdentityLaneId | null): ResolvedSubjectHandle {
  const sourceEvidence = lanes
    .filter((lane) => lane.source)
    .map((lane) => ({ lane: lane.lane as IdentityLaneId, label: lane.source!.label, url: lane.source!.url, officiality: lane.source!.officiality }));
  // Government sources seen but not used for identity travel with the handle so
  // the Property Backstory sweep does not have to rediscover them.
  for (const lane of lanes) {
    for (const source of lane.observedSources ?? []) {
      if (sourceEvidence.some((row) => row.url === source.url)) continue;
      sourceEvidence.push({ lane: lane.lane as IdentityLaneId, label: source.label, url: source.url, officiality: source.officiality });
    }
  }
  if (winner === 'retained_identity') {
    sourceEvidence.unshift({
      lane: 'retained_identity',
      label: subject.verificationSource ?? 'Previously retained property record',
      url: null,
      officiality: subject.verified ? 'official' : 'unverified',
    });
  }
  return {
    dealCardId: subject.dealCardId,
    propertyCardId: subject.propertyCardId,
    apn: subject.apn,
    parcelNotations: subject.notations,
    owner: subject.owner,
    address: subject.address,
    city: subject.city,
    county: subject.county,
    state: subject.state,
    zip: subject.zip,
    fips: subject.fips,
    lpPropertyId: subject.lpPropertyId,
    acres: subject.acres,
    sourceEvidence,
  };
}

/**
 * Resolve the subject property, releasing the moment the evidence is sufficient.
 *
 * Ordering of the lanes is irrelevant and deliberately so: whichever settles
 * first with evidence that survives the shared gate wins. Every other lane keeps
 * running and reconciles into the SAME property afterwards.
 */
export async function resolveSubjectProperty(
  dealCardId: number,
  options: ResolveSubjectPropertyOptions = {},
): Promise<UniversalResolutionResult> {
  const actor = options.actor ?? 'universal-property-resolver';
  const clockMs = options.clockMs ?? (() => Date.now());
  const readSubject = options.readSubject ?? readResolverSubject;
  const evaluate = options.evaluate ?? evaluateResolverIdentity;
  const applyEvidence = options.applyEvidence ?? applyLaneEvidence;
  const promote = options.promote
    ?? ((id: number, who: string) => reconcileSubjectIdentity(id, { actor: who }));
  const enrichAfterRelease = options.enrichAfterRelease !== false;
  const startedMs = clockMs();
  const notes: string[] = [];
  const conflicts: string[] = [];

  const initial = readSubject(dealCardId);
  if (!initial) {
    return {
      dealCardId,
      propertyCardId: null,
      status: 'skipped',
      identityState: 'unresolved',
      discoveryUsable: false,
      discoveryBasis: 'This Deal Card has no subject property record to resolve.',
      winner: null,
      released: false,
      releasedEarly: false,
      elapsedMs: 0,
      lanes: [],
      pendingLanes: [],
      conflicts: [],
      notes: ['No subject property record exists for this Deal Card.'],
      subject: {
        dealCardId, propertyCardId: null, apn: null, parcelNotations: [], owner: null, address: null,
        city: null, county: null, state: null, zip: null, fips: null, lpPropertyId: null, acres: null,
        sourceEvidence: [],
      },
    };
  }

  const laneEntries: Array<[RaceableLaneId, (subject: ResolverSubject) => Promise<IdentityLaneResult>]> = [];
  const jurisdictionRunner = options.lanes?.jurisdiction
    ?? (options.jurisdiction ? buildJurisdictionLane(options.jurisdiction) : null);
  if (jurisdictionRunner) laneEntries.push(['jurisdiction', jurisdictionRunner]);
  for (const id of ['official_parcel', 'landportal'] as const) {
    const runner = options.lanes?.[id];
    if (runner) laneEntries.push([id, runner]);
  }
  const webRunner = options.lanes?.indexed_web
    ?? (options.indexedWeb ? buildIndexedWebIdentityLane(options.indexedWeb) : null);
  if (webRunner) laneEntries.push(['indexed_web', webRunner]);

  const records = new Map<RaceableLaneId, IdentityLaneRecord>();
  let winner: IdentityLaneId | null = null;

  // ── Lane 0: the retained/canonical identity. No I/O, no wait. ─────────────
  const retained = evaluate(initial);
  conflicts.push(...retained.conflicts);
  if (retained.sufficient && options.retainedFastPath !== false) {
    winner = 'retained_identity';
    notes.push('The retained canonical identity already names this parcel; no identity lane had to run before the downstream graph was released.');
    // Lanes still START — their evidence, visuals and comps anchors are wanted —
    // but nothing waits on them.
    const pending: RaceableLaneId[] = [];
    for (const [id, runner] of laneEntries) {
      pending.push(id);
      const startedAtMs = clockMs();
      records.set(id, { lane: id, status: 'pending', note: 'Started; the subject was already resolved, so this lane enriches rather than gates.', startedAtMs, settledAtMs: null, durationMs: null, refusedFor: [], applied: false, won: false });
      void safeLane(id, runner, initial).then((result) => {
        recordSettled(records, id, result, clockMs, options.onLaneSettled);
        if (enrichAfterRelease) void lateEnrich(dealCardId, result, actor, readSubject, applyEvidence, promote);
      });
    }
    return {
      dealCardId,
      propertyCardId: initial.propertyCardId,
      status: 'resolved',
      identityState: retained.decision.state,
      discoveryUsable: retained.decision.discoveryUsable,
      discoveryBasis: retained.decision.discoveryBasis,
      winner,
      released: true,
      releasedEarly: pending.length > 0,
      elapsedMs: clockMs() - startedMs,
      lanes: [...records.values()],
      pendingLanes: pending,
      conflicts: [...new Set(conflicts)],
      notes,
      subject: handleFor(initial, [...records.values()], winner),
    };
  }

  if (!laneEntries.length) {
    return finish(retained, initial);
  }

  // ── The race: first SUFFICIENT evidence wins ──────────────────────────────
  let settle: ((reason: 'won' | 'exhausted' | 'deadline') => void) | null = null;
  const finished = new Promise<'won' | 'exhausted' | 'deadline'>((resolve) => { settle = resolve; });
  let outstanding = laneEntries.length;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  if (options.deadlineMs && options.deadlineMs > 0) {
    deadlineTimer = setTimeout(() => settle?.('deadline'), options.deadlineMs);
  }

  // ── PROGRESSIVE ENRICHMENT ────────────────────────────────────────────────
  //
  // A lane that cannot win may still hand the lane that CAN win the thing it was
  // missing. The jurisdiction lane establishes the county every official parcel
  // source is selected by; the indexed-web lane can establish a parcel
  // identifier from an official document. Either makes a second, targeted
  // official attempt worth exactly one try.
  //
  // Bounded on purpose: `maxOfficialReAims` (default 1), and only when the
  // subject genuinely gained a key the last attempt did not have. This is
  // enrichment, not a retry loop.
  // Lanes that can be aimed better once the subject gains a jurisdiction or a
  // parcel identifier. The jurisdiction lane is not among them: it answers a
  // question that does not change, and re-running it would be the loop this
  // policy exists to prevent.
  const RE_AIMABLE: RaceableLaneId[] = ['official_parcel', 'indexed_web'];
  const maxReAims = Math.max(0, options.maxLaneReAims ?? 2);
  const reAimed = new Set<RaceableLaneId>();
  let reAimsUsed = 0;
  const aimedWith = (subject: ResolverSubject): string =>
    [subject.county ?? '', subject.state ?? '', subject.apn ?? ''].join('|').toLowerCase();
  const lastAim = new Map<RaceableLaneId, string>();
  const initialAim = aimedWith(initial);

  const dispatch = (id: RaceableLaneId, runner: (subject: ResolverSubject) => Promise<IdentityLaneResult>, subject: ResolverSubject, isReAim = false): void => {
    const startedAtMs = clockMs();
    // What this lane was aimed with, so a later settle can tell whether the
    // subject has since become stronger than the aim it already answered on.
    lastAim.set(id, aimedWith(subject));
    records.set(id, {
      lane: id,
      status: 'pending',
      note: isReAim ? 'Re-aimed with the newly established jurisdiction/identifier.' : 'Running.',
      startedAtMs, settledAtMs: null, durationMs: null, refusedFor: [], applied: false, won: false,
    });
    void safeLane(id, runner, subject).then((result) => {
      const record = recordSettled(records, id, result, clockMs, options.onLaneSettled);
      if (winner) {
        if (enrichAfterRelease) void lateEnrich(dealCardId, result, actor, readSubject, applyEvidence, promote);
        return;
      }
      const current = readSubject(dealCardId) ?? initial;
      const applied = applyEvidence(current, result.patch, `${actor}:${id}`);
      record.applied = applied.applied;
      record.refusedFor = applied.refusedFor;
      if (applied.refusedFor.length) conflicts.push(...applied.refusedFor);
      const after = readSubject(dealCardId) ?? current;
      const evaluation = evaluate(after);
      conflicts.push(...evaluation.conflicts);
      if (evaluation.sufficient) {
        winner = id;
        record.won = true;
        settle?.('won');
        return;
      }

      // ── Did the subject gain something a lane could have used? ──────────
      //
      // Checked on EVERY settle, not only when this lane enriched: the lane
      // that establishes the jurisdiction usually finishes FIRST, while the
      // lane that needs it is still running. Only re-aiming at enrichment time
      // meant the official lane — dispatched a second earlier without a county
      // — was never given the county at all. So the trigger is "a settled lane
      // answered nothing, and the subject is stronger now than when that lane
      // was aimed", whichever order the two happened in.
      const aim = aimedWith(after);
      for (const target of RE_AIMABLE) {
        if (reAimsUsed >= maxReAims) break;
        if (reAimed.has(target)) continue;
        const runner = options.lanes?.[target] ?? (target === 'indexed_web' ? webRunner : null);
        if (!runner) continue;
        const settledRecord = records.get(target);
        // Only a lane that has already answered — and answered without
        // establishing anything — is worth aiming again.
        if (!settledRecord || settledRecord.status === 'pending' || settledRecord.status === 'evidence') continue;
        if ((lastAim.get(target) ?? initialAim) === aim) continue;
        reAimed.add(target);
        reAimsUsed += 1;
        lastAim.set(target, aim);
        notes.push(
          `The subject gained ${[after.county && `${after.county} County`, after.apn && `parcel ${after.apn}`].filter(Boolean).join(' and ') || 'stronger identity'}; the ${target.replace(/_/g, ' ')} lane was re-aimed once with it.`,
        );
        outstanding += 1;
        dispatch(target, runner, after, true);
      }

      outstanding -= 1;
      if (outstanding <= 0) settle?.('exhausted');
    });
  };

  for (const [id, runner] of laneEntries) dispatch(id, runner, initial);

  const reason = await finished;
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (reason === 'deadline') notes.push(`The resolver's ${Math.round((options.deadlineMs ?? 0) / 1000)}-second wait elapsed before any lane established the subject; the lanes continue independently.`);

  // ── Promote through the EXISTING canonical path ───────────────────────────
  if (winner) {
    try {
      await promote(dealCardId, `${actor}:${winner}`);
    } catch (error) {
      notes.push(`Canonical identity promotion did not run (${error instanceof Error ? error.message : String(error)}); the resolved facts remain on the subject record.`);
    }
  }

  const finalSubject = readSubject(dealCardId) ?? initial;
  const finalEvaluation = evaluate(finalSubject);
  conflicts.push(...finalEvaluation.conflicts);

  // ── AFTER RELEASE ────────────────────────────────────────────────────────
  // Both of these run on the far side of the answer. Neither may delay it.
  const outcome = finish(finalEvaluation, finalSubject);

  // 1. Finish mining the documents already downloaded. Resolve fast, release
  //    fast, then read the rest of what LandOS already has.
  const documents = [...records.values()].flatMap((lane) => lane.fetchedDocuments ?? []);
  const hints = [...records.values()].map((lane) => lane.anchorHints).find(Boolean) ?? {};
  const documentTitles = new Map<string, string>();
  for (const lane of records.values()) {
    if (lane.source?.url && lane.source.label) documentTitles.set(lane.source.url, lane.source.label);
  }
  outcome.enrichment = documents.length && options.documentEnrichment !== false
    ? mineFetchedDocuments({
        dealCardId,
        documents,
        documentTitles,
        anchors: {
          notations: finalSubject.notations,
          apn: finalSubject.apn,
          owner: finalSubject.owner,
          projectName: hints.projectName ?? null,
          address: hints.address ?? finalSubject.address,
          city: finalSubject.city,
        },
        summarySubject: {
          apn: finalSubject.apn,
          owner: finalSubject.owner,
          projectName: hints.projectName ?? null,
          acreage: finalSubject.acres,
          city: finalSubject.city,
          county: finalSubject.county,
          state: finalSubject.state,
          parcelNotation: finalSubject.notations[0]?.raw ?? null,
        },
        onDiscoveredContext: options.onDiscoveredContext,
        onDocumentSummary: options.onDocumentSummary,
      })
    : Promise.resolve([]);

  // 2. Offer LandPortal one bounded subject upgrade — only while it is STILL
  //    RUNNING on the weaker keys it started with. The caller decides when to
  //    act on it, because only the caller knows whether an agent is in flight.
  const landPortalRecord = records.get('landportal');
  if (finalEvaluation.sufficient && landPortalRecord?.status === 'pending') {
    const upgrade = buildLandPortalSearchPackage(
      {
        landPortalPropertyId: finalSubject.lpPropertyId, fips: finalSubject.fips, state: finalSubject.state,
        county: finalSubject.county, city: finalSubject.city, apn: finalSubject.apn, owner: finalSubject.owner,
        address: finalSubject.address, zip: finalSubject.zip, acres: finalSubject.acres,
        lat: finalSubject.lat, lng: finalSubject.lng,
      },
      {
        landPortalPropertyId: initial.lpPropertyId, fips: initial.fips, state: initial.state,
        county: initial.county, city: initial.city, apn: initial.apn, owner: initial.owner,
        address: initial.address, zip: initial.zip,
      },
    );
    outcome.landPortalUpgrade = upgrade;
    if (upgrade.strongerThanIntake) {
      notes.push(`LandPortal is still working the raw lead; a stronger subject package is available (${upgrade.gainedOverIntake.join(', ')}).`);
      try {
        options.onLandPortalUpgrade?.({ dealCardId, subject: finalSubject, package: upgrade });
      } catch (error) {
        notes.push(`The LandPortal subject upgrade could not be handed over (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
  }
  return outcome;

  function finish(evaluation: ResolverEvaluation, subject: ResolverSubject): UniversalResolutionResult {
    const lanes = [...records.values()];
    const pendingLanes = lanes.filter((lane) => lane.status === 'pending').map((lane) => lane.lane);
    const status: UniversalResolutionResult['status'] = evaluation.sufficient
      ? 'resolved'
      : evaluation.decision.state === 'conflicted' || conflicts.length ? 'conflicted' : 'unresolved';
    return {
      dealCardId,
      propertyCardId: subject.propertyCardId,
      status,
      identityState: evaluation.decision.state,
      discoveryUsable: evaluation.decision.discoveryUsable,
      discoveryBasis: evaluation.decision.discoveryBasis,
      winner,
      released: evaluation.sufficient,
      releasedEarly: evaluation.sufficient && pendingLanes.length > 0,
      elapsedMs: clockMs() - startedMs,
      lanes,
      pendingLanes,
      conflicts: [...new Set(conflicts)],
      notes,
      subject: handleFor(subject, lanes, winner),
    };
  }
}

/**
 * Mine the documents this run already downloaded, after the subject is out.
 *
 * Never awaited by the resolution path and never able to fail it: an enrichment
 * error is logged and the identity stands. Nothing it produces is written to the
 * property record — discovered context is about an already-identified property,
 * never evidence for which property it is.
 */
async function mineFetchedDocuments(input: {
  dealCardId: number;
  documents: OfficialPdfDocument[];
  anchors: SubjectAnchors;
  summarySubject: OfficialDocumentSubject;
  documentTitles?: Map<string, string>;
  onDiscoveredContext?: (result: DiscoveredContextResult) => void;
  onDocumentSummary?: (input: { summary: OfficialDocumentSummary; persisted: PersistDocumentIntelligenceResult }) => void;
}): Promise<DiscoveredContextResult[]> {
  // Yield first, always. The subject is released on the caller's turn; mining
  // begins on the next one, so "resolve fast, release fast" is a property of
  // the schedule rather than a hope about how long parsing takes.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const results: DiscoveredContextResult[] = [];
  const seen = new Set<string>();
  for (const document of input.documents) {
    if (seen.has(document.url)) continue;
    seen.add(document.url);
    try {
      const mined = mineDocumentContext({ document, anchors: input.anchors, dealCardId: input.dealCardId });
      retainDiscoveredContext(input.dealCardId, mined);
      input.onDiscoveredContext?.(mined);
      results.push(mined);

      // ── DURABLE ────────────────────────────────────────────────────────
      // Compose the detailed subject-specific summary from the findings just
      // retained — never from the document again — and write both to the
      // evidence model LandOS already has, so nothing needs this PDF twice.
      const summary = composeOfficialDocumentSummary({
        context: mined,
        subject: input.summarySubject,
        documentKey: documentKeyFor(document.url),
        documentText: document.text,
        sourceTitle: input.documentTitles?.get(document.url) ?? null,
      });
      const persisted = persistDocumentIntelligence({
        dealCardId: input.dealCardId,
        context: mined,
        summary,
        documentText: document.text,
        sourceTitle: input.documentTitles?.get(document.url) ?? null,
      });
      logger.info({
        dealCardId: input.dealCardId,
        sourceUrl: mined.sourceUrl,
        findings: mined.findings.length,
        skippedForOtherParcel: mined.skippedForOtherParcel,
        textLayer: mined.textLayer,
        persisted: persisted.persisted,
        evidenceRows: persisted.evidenceIds.length,
        duplicateFindings: persisted.duplicateFindings,
        summarySnapshotId: persisted.summarySnapshotId,
        summaryReused: persisted.summaryReused,
        skippedReason: persisted.skippedReason,
      }, 'official_document_context_mined');
      input.onDocumentSummary?.({ summary, persisted });
    } catch (error) {
      logger.warn({ err: error, dealCardId: input.dealCardId, url: document.url }, 'official_document_context_failed');
    }
  }
  return results;
}

/** A lane never rejects: an error is an outcome the operator can read. */
async function safeLane(
  lane: RaceableLaneId,
  runner: (subject: ResolverSubject) => Promise<IdentityLaneResult>,
  subject: ResolverSubject,
): Promise<IdentityLaneResult> {
  try {
    const result = await runner(subject);
    return { ...result, lane };
  } catch (error) {
    return {
      lane,
      status: 'error',
      note: `Identity lane failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function recordSettled(
  records: Map<RaceableLaneId, IdentityLaneRecord>,
  id: RaceableLaneId,
  result: IdentityLaneResult,
  clockMs: () => number,
  onLaneSettled?: (record: IdentityLaneRecord) => void,
): IdentityLaneRecord {
  const previous = records.get(id)!;
  const settledAtMs = clockMs();
  const record: IdentityLaneRecord = {
    ...previous,
    ...result,
    lane: id,
    settledAtMs,
    durationMs: settledAtMs - previous.startedAtMs,
  };
  records.set(id, record);
  onLaneSettled?.(record);
  return record;
}

/**
 * A lane that finished after the subject was already released.
 *
 * It reconciles into the SAME property: corroborating evidence is written,
 * contradictory evidence is refused and recorded, and a stronger accepted
 * identity is never downgraded — `applyLaneEvidence` refuses first, and
 * `reconcileSubjectIdentity` never blanks a retained value.
 */
async function lateEnrich(
  dealCardId: number,
  result: IdentityLaneResult,
  actor: string,
  readSubject: (id: number) => ResolverSubject | null,
  applyEvidence: (subject: ResolverSubject, patch: ResolverIdentityPatch | null | undefined, actor: string) => ApplyLaneEvidenceResult,
  promote: (id: number, who: string) => Promise<unknown>,
): Promise<void> {
  try {
    const subject = readSubject(dealCardId);
    if (!subject) return;
    const applied = applyEvidence(subject, result.patch, `${actor}:late:${result.lane}`);
    if (applied.refusedFor.length) {
      logger.info({ dealCardId, lane: result.lane, refusedFor: applied.refusedFor }, 'universal_resolver_late_evidence_refused');
    }
    await promote(dealCardId, `${actor}:late:${result.lane}`);
    logger.info({ dealCardId, lane: result.lane, applied: applied.applied }, 'universal_resolver_late_evidence_reconciled');
  } catch (error) {
    logger.warn({ err: error, dealCardId, lane: result.lane }, 'universal_resolver_late_evidence_failed');
  }
}

/** The LandPortal canonical key, when the retained parcel URL carries one. */
export function retainedLandPortalIdentity(propertyCardId: number | null): { fips: string; apn: string; propertyId: string } | null {
  if (propertyCardId == null) return null;
  const inspection = loadPropertyInspection(propertyCardId);
  const decoded = decodeLandPortalCanonicalIdentity(inspection?.parcelUrl ?? null);
  return decoded ? { fips: decoded.fips, apn: decoded.apn, propertyId: decoded.propertyId } : null;
}
