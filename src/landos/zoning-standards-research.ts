// LandOS — ALLOWED USES and DIMENSIONAL STANDARDS for the established district.
//
// This subsystem did not exist. `current-zoning-determination.ts` could extract
// standards from ordinance text, but nothing ever supplied that text: the live
// wiring passed no `ordinanceText`, so every Fairview run returned minimum lot
// size null, frontage null, permitted uses empty, with an honest limitation
// saying so. Honest, and useless — those six numbers are what decide whether a
// land deal works.
//
// So this races for the ordinance the same way everything else now races:
// retained document intelligence, the government's own known code pages, a
// contracted code publisher, indexed web discovery, and browser escalation.
//
// The gate that matters here is different from zoning's. An ordinance is
// JURISDICTION-WIDE, so it has no parcel to match. What it must do instead is
// NAME THE ESTABLISHED DISTRICT — which is why this research cannot run at all
// until current zoning is established. Reading "minimum lot size 15,000 sq ft"
// out of an ordinance without knowing which district governs the parcel is how
// a buyer ends up underwriting the wrong number.

import {
  emptyZoningStandards,
  readZoningStandards,
  type CurrentZoningDetermination,
  type ZoningStandards,
} from './current-zoning-determination.js';
import { raceRecordOf, type AuthorityAssignment, type LandUseRaceRecord } from './controlling-land-use-authority.js';
import {
  browserEscalationLane,
  buildLandUseQueries,
  directSourceLane,
  indexedWebSearchLane,
  retainedEvidenceLane,
  type BrowserSourceReader,
  type EvidenceReader,
  type LaneJurisdiction,
  type RetrievalTransports,
  type SubjectQueryFacts,
} from './land-use-lanes.js';
import {
  raceLandUseSources,
  type LandUseEvidence,
  type LandUseLane,
  type LandUseLaneRecord,
} from './land-use-source-race.js';
import {
  completeRuleValue,
  districtCodeVariants,
  flattenOrdinanceText as flattenText,
  looksLikeTableOfContents,
  scopeToDistrictBlock,
} from './ordinance-text.js';
import type { GovFetchText } from './gis-transport.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type UseStatus = 'permitted' | 'conditional' | 'special_exception' | 'prohibited';

export interface AllowedUseFinding {
  use: string;
  status: UseStatus;
  /** The ordinance section, when the document prints one near the passage. */
  section: string | null;
  quote: string;
  sourceLabel: string;
  sourceUrl: string | null;
}

/** What one retrieved ordinance said about the district. */
export interface DistrictRegulationEvidence {
  districtCode: string;
  standards: ZoningStandards;
  allowedUses: AllowedUseFinding[];
  overlays: string[];
  sourceLabel: string;
  sourceUrl: string | null;
  /** True when the document calls itself proposed, draft or under review. */
  draftOrProposed: boolean;
  adoptedOrAsOf: string | null;
}

export interface ZoningStandardsResult {
  dealCardId: number;
  /** The district these standards describe. Null when none was available. */
  districtCode: string | null;
  /** True ONLY when the district was established as CURRENT for this parcel. */
  established: boolean;
  /**
   * True when the district came from the HISTORICAL record rather than a
   * current determination. The standards are then real regulations for a real
   * district — and there is no evidence this parcel is still in it, so they are
   * context for the seller call and never an input to a yield calculation.
   */
  contextOnly: boolean;
  authorityName: string | null;
  standards: ZoningStandards;
  allowedUses: AllowedUseFinding[];
  overlays: string[];
  documents: Array<{ label: string; url: string | null; draftOrProposed: boolean; adoptedOrAsOf: string | null }>;
  /**
   * A value a NEWER adopted source replaced. Retained, never deleted: an
   * operator reading "minimum lot size 1 acre" should be able to see that it
   * was 2 acres before the 2021 amendment, and which document changed it.
   */
  supersededHistory: Array<{ field: string; value: string; supersededBy: string; sourceLabel: string; sourceUrl: string | null; asOf: string | null }>;
  conflicts: string[];
  limitations: string[];
  retrievedAt: string;
  race: LandUseRaceRecord | null;
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
const SECTION_NEAR = /(?:§|\bSection\b|\bSec\.|\bArticle\b|\bArt\.|\bChapter\b|\bCh\.)\s*([0-9]+(?:\s*[.\-]\s*[0-9A-Za-z]+)*)/i;

/** Undo a PDF text layer's line wrapping before reading rules out of it. */
export const flattenOrdinanceText = flattenText;

function sectionBefore(text: string, index: number): string | null {
  const before = text.slice(Math.max(0, index - 1_200), index);
  const matches = [...before.matchAll(new RegExp(SECTION_NEAR.source, 'gi'))];
  const last = matches[matches.length - 1];
  return last ? clean(last[0]) : null;
}

/**
 * Is this a planning RECORD rather than the adopted code?
 *
 * A packet, an agenda or a minute book names the district beside the parcel and
 * regulates nothing. A live run released "street frontage" and "density will be
 * met" as this district's standards, read out of a commission agenda.
 */
export function looksLikePlanningRecord(document: { url: string; title: string | null; text: string }): boolean {
  const label = `${document.title ?? ''} ${document.url}`;
  if (/packet|minutes|agenda|staff[\s_-]*report|boc-packets/i.test(label)) return true;
  const head = flattenOrdinanceText(document.text).slice(0, 2_000);
  return /(?:PC|BOMA)?\s*Resolution\s+[A-Z0-9-]+|regular\s+meeting|call\s+to\s+order|approval\s+of\s+minutes/i.test(head);
}

/** Does this document call itself proposed or draft? It governs nothing if so. */
export function ordinanceLooksDraft(text: string): boolean {
  const head = flattenOrdinanceText(text).slice(0, 3_000);
  return /\bPROPOSED\s+(?:ZONING|SUBDIVISION|LAND\s+DEVELOPMENT)\s+(?:ORDINANCE|REGULATIONS?|CODE)\b/i.test(head)
    || /\bDRAFT\s+(?:ZONING|LAND\s+DEVELOPMENT)\s+(?:ORDINANCE|CODE)\b/i.test(head)
    || /\bFOR\s+(?:PUBLIC\s+)?(?:REVIEW|DISCUSSION)\s+ONLY\b/i.test(head);
}

function adoptedDate(text: string): string | null {
  const match = /\b(?:adopted|effective|amended)\s*(?:on|:)?\s*([A-Z][a-z]+\s+\d{1,2},\s*(?:19|20)\d{2}|\d{1,2}\/\d{1,2}\/(?:19|20)?\d{2})/i.exec(text.slice(0, 12_000));
  return match ? clean(match[1]) : null;
}

// ── The district's own block of the ordinance ───────────────────────────────

/**
 * District scoping lives in `ordinance-text.ts` so the standards research and
 * the zoning determination narrow to a district the same way — and, critically,
 * both flatten the PDF line wrapping first. Re-exported because callers and
 * tests already import them from here.
 */
export { districtCodeVariants, scopeToDistrictBlock } from './ordinance-text.js';

// ── Allowed uses ────────────────────────────────────────────────────────────

const USE_HEADINGS: Array<{ status: UseStatus; pattern: RegExp }> = [
  { status: 'permitted', pattern: /\b(?:permitted\s+uses?|uses?\s+permitted\s+by\s+right|principal\s+permitted\s+uses?|uses?\s+permitted)\b[^.\n]{0,400}/gi },
  { status: 'conditional', pattern: /\bconditional\s+uses?\b[^.\n]{0,400}/gi },
  { status: 'special_exception', pattern: /\bspecial\s+(?:exceptions?|uses?)\b[^.\n]{0,400}/gi },
  { status: 'prohibited', pattern: /\b(?:prohibited\s+uses?|uses?\s+prohibited)\b[^.\n]{0,400}/gi },
];

/**
 * The uses a district allows, as the ordinance words them.
 *
 * Deliberately conservative: it retains the ordinance's own list text rather
 * than trying to atomize it into a taxonomy. A land buyer needs to read what
 * the code says and cite it; a normalized enum that quietly drops "subject to
 * Section 5-4" is worse than the sentence.
 */
export function readAllowedUses(input: {
  text: string;
  districtCode: string;
  sourceLabel: string;
  sourceUrl: string | null;
}): AllowedUseFinding[] {
  const scoped = scopeToDistrictBlock(input.text, input.districtCode);
  if (!scoped) return [];
  const out: AllowedUseFinding[] = [];
  const seen = new Set<string>();
  for (const heading of USE_HEADINGS) {
    const scan = new RegExp(heading.pattern.source, heading.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = scan.exec(scoped.text)) !== null && out.length < 12) {
      // A use list is numbered — "1. Single-family dwellings. 2. Public parks."
      // — so stopping at the first period keeps one item and drops the list.
      const complete = completeRuleValue(scoped.text, match.index, match[0]);
      const use = clean(complete).slice(0, 600);
      if (use.length < 24) continue;
      // "Permitted Uses 4-101 Conditional Uses 4-102 …" is the contents page.
      if (looksLikeTableOfContents(use)) continue;
      const key = `${heading.status}|${use.slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        use,
        status: heading.status,
        section: sectionBefore(scoped.text, match.index) ?? scoped.section,
        quote: clean(scoped.text.slice(Math.max(0, match.index - 100), match.index + complete.length + 120)).slice(0, 700),
        sourceLabel: input.sourceLabel,
        sourceUrl: input.sourceUrl,
      });
      if (match.index === scan.lastIndex) scan.lastIndex += 1;
    }
  }
  return out;
}

/** Overlay districts the ordinance names for this district. */
export function readOverlays(text: string, districtCode: string): string[] {
  const scoped = scopeToDistrictBlock(text, districtCode);
  const body = scoped?.text ?? flattenOrdinanceText(text).slice(0, 14_000);
  return [...new Set(
    [...body.matchAll(/\b([A-Z][A-Za-z\- ]{2,40}?)\s+overlay\s+district\b/gi)].map((match) => clean(match[1])),
  )].slice(0, 6);
}

// ── The research ────────────────────────────────────────────────────────────

export interface ZoningStandardsSubject {
  dealCardId: number;
  municipality: string | null;
  county: string | null;
  state: string | null;
  queryFacts?: Partial<SubjectQueryFacts>;
  /** The government's own domains, for site-scoped discovery. */
  officialHosts?: readonly string[];
}

export interface ZoningStandardsDeps {
  search?: IdentitySearchProvider;
  fetchText?: GovFetchText;
  /** Bounded PDF reader. Injectable so a suite needs no network. */
  loadPdf?: RetrievalTransports['loadPdf'];
  /**
   * A HISTORICAL district to research when the current one is unresolved.
   *
   * Produces `contextOnly: true` and `established: false`. Offered because a
   * seller call is better served by "here is what R-20 POD actually requires,
   * and we could not confirm the parcel is still R-20 POD" than by silence.
   */
  contextDistrict?: string | null;
  /** Ordinance text LandOS already holds. Read first, and for free. */
  retainedSources?: ReadonlyArray<{ url: string | null; title: string | null; text: string }>;
  /** Known code URLs — the municipal code, a code publisher, an ordinance PDF. */
  knownSourceUrls?: readonly string[];
  browser?: BrowserSourceReader | null;
  awaitEnrichment?: boolean;
  deadlineMs?: number;
  maxSources?: number;
  timeoutMs?: number;
  onLaneSettled?: (record: LandUseLaneRecord) => void;
  now?: () => string;
}

/**
 * Research the standards and uses for the ESTABLISHED district.
 *
 * Returns immediately with `established: false` when current zoning is
 * unresolved. That refusal is the point: without a district there is nothing to
 * look up, and looking anyway would produce numbers from whichever district the
 * ordinance happened to print first.
 */
export async function researchZoningStandards(
  subject: ZoningStandardsSubject,
  zoning: CurrentZoningDetermination | null,
  authority: AuthorityAssignment | null,
  deps: ZoningStandardsDeps = {},
): Promise<ZoningStandardsResult> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  // The CURRENT district when one is established; otherwise the caller may
  // offer a historical district for CONTEXT ONLY, which the brief permits and
  // which `contextOnly` marks so nothing downstream can promote it.
  const currentDistrict = zoning?.established ? zoning.districtCode : null;
  const contextOnly = !currentDistrict && !!deps.contextDistrict;
  const districtCode = currentDistrict ?? (contextOnly ? deps.contextDistrict ?? null : null);
  const base: ZoningStandardsResult = {
    dealCardId: subject.dealCardId,
    districtCode,
    established: false,
    contextOnly,
    authorityName: authority?.name ?? null,
    standards: emptyZoningStandards(),
    allowedUses: [],
    overlays: [],
    documents: [],
    supersededHistory: [],
    conflicts: [],
    limitations: [],
    retrievedAt: now,
    race: null,
  };

  if (!districtCode) {
    return {
      ...base,
      limitations: [
        'Allowed uses and dimensional standards were NOT researched: the current zoning district is not established, and no historical district was offered for context. '
        + 'Reading standards out of an ordinance without knowing which district governs this parcel would produce the wrong numbers, so nothing is asserted.',
      ],
    };
  }

  const limitations: string[] = [];
  // The tightest spelling of the district a search engine can match: "R-20"
  // rather than the packet's "R - 20 POD".
  const queryDistrict = districtCodeVariants(districtCode).slice(-1)[0] ?? districtCode;
  if (contextOnly) {
    limitations.push(
      `CONTEXT ONLY. The current zoning district for this parcel is UNRESOLVED. The standards below are the real, adopted rules for district ${districtCode}, `
      + 'which the historical planning record named for this parcel — but nothing establishes that the parcel is still in that district today. '
      + 'They are for the seller conversation and for orientation. They are NOT an input to lot yield, valuation or any entitlement conclusion.',
    );
  }
  const jurisdiction: LaneJurisdiction = {
    municipality: subject.municipality,
    county: subject.county,
    state: subject.state,
    controllingAuthorityName: authority?.name ?? null,
  };
  const transports: RetrievalTransports = {
    fetchText: deps.fetchText,
    loadPdf: deps.loadPdf,
    timeoutMs: Math.max(1_000, deps.timeoutMs ?? 25_000),
    now: () => now,
  };
  const maxSources = Math.max(1, deps.maxSources ?? 4);

  const read: EvidenceReader<DistrictRegulationEvidence> = (document) => {
    // A planning PACKET quotes the district code beside the parcel and states
    // no regulation at all. It is not the code, however official it is.
    if (looksLikePlanningRecord(document)) return [];
    const scoped = scopeToDistrictBlock(document.text, districtCode);
    if (!scoped) return [];
    const standards = readZoningStandards({
      text: document.text,
      districtCode,
      sourceLabel: document.title ?? document.url,
      sourceUrl: document.url || null,
    });
    const allowedUses = readAllowedUses({
      text: document.text,
      districtCode,
      sourceLabel: document.title ?? document.url,
      sourceUrl: document.url || null,
    });
    const carriesSomething = /\d/.test(standards.minimumLotSize ?? '') || /\d/.test(standards.frontage ?? '')
      || /\d/.test(standards.density ?? '') || /\d/.test(standards.lotWidth ?? '')
      || /\d/.test(standards.setbacks ?? '') || allowedUses.length > 0;
    if (!carriesSomething) return [];
    const draftOrProposed = ordinanceLooksDraft(document.text);
    const value: DistrictRegulationEvidence = {
      districtCode,
      standards,
      allowedUses,
      overlays: readOverlays(document.text, districtCode),
      sourceLabel: document.title ?? document.url,
      sourceUrl: document.url || null,
      draftOrProposed,
      adoptedOrAsOf: adoptedDate(document.text),
    };
    return [{
      method: 'official_document',
      laneId: 'standards',
      value,
      authorityName: authority?.name ?? null,
      sourceLabel: value.sourceLabel,
      sourceUrl: value.sourceUrl,
      sourceTier: document.tier,
      // An ordinance is jurisdiction-wide; what it must match is the DISTRICT.
      parcelMatchBasis: `the ordinance prints a section for district ${districtCode}, which is the established district for this parcel`,
      currentness: draftOrProposed ? 'proposed' : 'adopted',
      effectiveOrAsOf: value.adoptedOrAsOf,
      quote: clean(scoped.text).slice(0, 600),
      retrievedAt: document.retrievedAt,
    }];
  };

  const lanes: Array<LandUseLane<DistrictRegulationEvidence, LaneJurisdiction>> = [];
  if (deps.retainedSources?.length) {
    lanes.push(retainedEvidenceLane<DistrictRegulationEvidence>({
      id: 'retained_ordinance',
      label: 'Retained ordinance and document intelligence',
      sources: deps.retainedSources.map((row) => ({ ...row })),
      jurisdiction,
      read,
      now: () => now,
    }));
  }
  if (deps.knownSourceUrls?.length) {
    lanes.push(directSourceLane<DistrictRegulationEvidence>({
      id: 'known_code',
      label: 'Known municipal code / ordinance URL',
      urls: deps.knownSourceUrls,
      jurisdiction,
      read,
      transports,
      maxSources,
    }));
  }
  if (deps.search) {
    const facts: SubjectQueryFacts = {
      apn: null, parcelNotation: null, owner: null, projectName: null, address: null,
      municipality: subject.municipality,
      county: subject.county,
      state: subject.state,
      officialHosts: subject.officialHosts,
      ...(subject.queryFacts ?? {}),
    };
    lanes.push(indexedWebSearchLane<DistrictRegulationEvidence>({
      id: 'standards_web',
      label: 'Indexed web discovery for the district regulations',
      // Query with the CANONICAL spelling of the district, not the packet's.
      // A PDF text layer prints "R - 20 POD"; searching that phrase verbatim
      // returns nothing a search engine can match, and a live run discovered
      // seventy results with not one of them on the city's own domain.
      queries: buildLandUseQueries({
        subject: facts,
        topic: `${queryDistrict} zoning district`,
        variants: [
          `${queryDistrict} permitted uses`,
          `${queryDistrict} minimum lot size`,
          `${queryDistrict} setbacks frontage`,
          'zoning ordinance PDF',
          'municipal code zoning districts',
        ],
      }),
      jurisdiction,
      search: deps.search,
      read,
      transports,
      maxSources,
      preferUrls: /zoning[\s_-]*ordinance|zoning[\s_-]*code|municipal[\s_-]*code|code[\s_-]*of[\s_-]*ordinances|\.pdf/i,
      followLinks: /zoning|ordinance|code|district/i,
      onNote: (note) => limitations.push(note),
    }));
  } else {
    limitations.push('No search transport was wired, so indexed web discovery did not run for the district regulations.');
  }
  lanes.push(browserEscalationLane<DistrictRegulationEvidence>({
    id: 'standards_browser',
    label: 'Browser escalation (JS-rendered municipal code)',
    urls: deps.knownSourceUrls ?? [],
    purpose: `read the ${districtCode} district regulations`,
    jurisdiction,
    read,
    browser: deps.browser ?? null,
    onNote: (note) => limitations.push(note),
    now: () => now,
  }));

  const race = await raceLandUseSources<DistrictRegulationEvidence, LaneJurisdiction>({
    question: 'allowed_uses',
    aim: jurisdiction,
    lanes,
    instantFastPath: true,
    deadlineMs: deps.deadlineMs ?? 45_000,
    gate: (candidate) => {
      if (candidate.sourceTier !== 'official_government_source') {
        return { sufficient: false, reason: `the source is ${candidate.sourceTier.replace(/_/g, ' ')}; a zoning standard must come from the adopted code` };
      }
      if (candidate.value.draftOrProposed) {
        return { sufficient: false, reason: 'the document calls itself proposed or draft, so it does not govern this district today' };
      }
      // A "standard" with no number in it is a heading, not a rule.
      const hasNumbers = /\d/.test(candidate.value.standards.minimumLotSize ?? '')
        || /\d/.test(candidate.value.standards.frontage ?? '');
      return hasNumbers || candidate.value.allowedUses.length > 0
        ? { sufficient: true, reason: `the adopted code prints the ${districtCode} district's standards` }
        : { sufficient: false, reason: 'the district block carries no standard or use this research can cite' };
    },
    // Every adopted district block is "the same answer" to the RACE, whose
    // question is only "did we get this district's regulations at all". Which
    // of two adopted versions governs is a SUPERSESSION decision, made by the
    // merge below on adoption dates; reporting it here would turn an ordinary
    // amendment into a contradiction.
    sameAnswer: () => true,
    onLaneSettled: (record) => deps.onLaneSettled?.(record),
  });

  const evidence: Array<LandUseEvidence<DistrictRegulationEvidence>> = [...race.evidence];
  if (deps.awaitEnrichment !== false) {
    const enrichment = await race.enrichment;
    evidence.push(...enrichment.lateEvidence);
    limitations.push(...enrichment.conflicts);
  }
  limitations.push(...race.notes);

  // The merge order IS the policy, in three tiers:
  //   1. ADOPTED beats PROPOSED — a draft governs nothing.
  //   2. An official source beats a secondary one.
  //   3. Among adopted sources, the NEWER adoption date wins, and what it
  //      replaced is retained as superseded history rather than dropped.
  const adoptionOrder = (row: LandUseEvidence<DistrictRegulationEvidence>): number => {
    const parsed = row.value.adoptedOrAsOf ? Date.parse(row.value.adoptedOrAsOf) : NaN;
    return Number.isFinite(parsed) ? -parsed : 0;
  };
  const ordered = [...evidence].sort((a, b) =>
    (a.value.draftOrProposed ? 1 : 0) - (b.value.draftOrProposed ? 1 : 0)
    || (a.sourceTier === 'official_government_source' ? 0 : 1) - (b.sourceTier === 'official_government_source' ? 0 : 1)
    || adoptionOrder(a) - adoptionOrder(b));

  const standards = emptyZoningStandards();
  const allowedUses: AllowedUseFinding[] = [];
  const overlays: string[] = [];
  const documents: ZoningStandardsResult['documents'] = [];
  const supersededHistory: ZoningStandardsResult['supersededHistory'] = [];
  const conflicts: string[] = [];
  const seenUse = new Set<string>();
  /** Which document supplied each field, so supersession can be explained. */
  const suppliedBy = new Map<string, { label: string; url: string | null; asOf: string | null }>();

  for (const row of ordered) {
    const value = row.value;
    if (!documents.some((document) => document.url === value.sourceUrl)) {
      documents.push({ label: value.sourceLabel, url: value.sourceUrl, draftOrProposed: value.draftOrProposed, adoptedOrAsOf: value.adoptedOrAsOf });
    }
    for (const key of ['minimumLotSize', 'density', 'setbacks', 'frontage', 'lotWidth', 'heightOrCoverage'] as const) {
      const incoming = value.standards[key];
      if (!incoming) continue;
      if (!standards[key]) {
        standards[key] = incoming;
        suppliedBy.set(key, { label: value.sourceLabel, url: value.sourceUrl, asOf: value.adoptedOrAsOf });
        continue;
      }
      if (standards[key] === incoming || value.draftOrProposed) continue;
      const held = suppliedBy.get(key);
      const heldAt = held?.asOf ? Date.parse(held.asOf) : NaN;
      const incomingAt = value.adoptedOrAsOf ? Date.parse(value.adoptedOrAsOf) : NaN;
      if (Number.isFinite(heldAt) && Number.isFinite(incomingAt) && incomingAt !== heldAt) {
        // Both dated, and they differ: the newer one governs and the older
        // becomes history. The sort already put the newer first, so the value
        // in hand is the newer one.
        supersededHistory.push({
          field: key,
          value: incoming,
          supersededBy: standards[key]!,
          sourceLabel: value.sourceLabel,
          sourceUrl: value.sourceUrl,
          asOf: value.adoptedOrAsOf,
        });
        continue;
      }
      // Undated, or same date: nothing establishes which one is current.
      conflicts.push(
        `Two adopted sources state a different ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} for ${districtCode} and neither is clearly newer: "${standards[key]}" (${held?.label ?? 'unknown source'}) and "${incoming}" (${value.sourceLabel}).`,
      );
    }
    if (standards.residentialEligible == null) standards.residentialEligible = value.standards.residentialEligible;
    if (standards.manufacturedHomeEligible == null) standards.manufacturedHomeEligible = value.standards.manufacturedHomeEligible;
    standards.principalUses.push(...value.standards.principalUses.filter((use) => !standards.principalUses.includes(use)));
    standards.specialConditions.push(...value.standards.specialConditions.filter((row2) => !standards.specialConditions.includes(row2)));
    standards.sources.push(...value.standards.sources.filter((source) => !standards.sources.some((existing) => existing.quote === source.quote)));
    for (const use of value.allowedUses) {
      const key = `${use.status}|${use.use.slice(0, 60)}`;
      if (seenUse.has(key)) continue;
      seenUse.add(key);
      // A proposed document may never supply a use the adopted code did not.
      if (value.draftOrProposed) continue;
      allowedUses.push(use);
    }
    for (const overlay of value.overlays) if (!overlays.includes(overlay)) overlays.push(overlay);
  }

  // `established` means the CURRENT district's standards. Context research can
  // find everything and still not establish anything about this parcel today.
  const found = allowedUses.length > 0 || /\d/.test(standards.minimumLotSize ?? '') || /\d/.test(standards.frontage ?? '');
  const established = found && !contextOnly;
  if (!found) {
    limitations.push(
      `No adopted source printed the ${districtCode} district's standards or use list, so allowed uses and dimensional standards remain UNKNOWN for this parcel.`,
    );
  }
  const drafts = documents.filter((document) => document.draftOrProposed).length;
  if (drafts) {
    limitations.push(`${drafts} retrieved document(s) call themselves proposed or draft; nothing was taken from them.`);
  }

  return {
    dealCardId: subject.dealCardId,
    districtCode,
    established,
    contextOnly,
    authorityName: authority?.name ?? null,
    standards,
    allowedUses,
    overlays,
    documents,
    supersededHistory,
    conflicts: [...new Set([...conflicts, ...race.conflicts])],
    limitations: [...new Set(limitations)],
    retrievedAt: now,
    race: raceRecordOf(race),
  };
}
