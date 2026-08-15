// LandOS — WHICH GOVERNMENT ACTUALLY CONTROLS THIS PARCEL.
//
// The first zoning question is not "what is the zoning". It is "whose zoning".
// Getting that wrong produces a confidently sourced answer about the wrong
// government, which is worse than no answer at all.
//
// The hard rule this module exists to enforce:
//
//     GEOGRAPHY IS NOT AUTHORITY.
//
// The Census TIGERweb resolver (`jurisdiction-resolution.ts`) establishes that a
// place lies inside a county. That is excellent geographic evidence and it is
// what selects a parcel source. It says NOTHING about who administers zoning or
// subdivision. Tennessee alone contains: cities that zone inside their limits,
// counties that zone everything unincorporated, municipal planning regions that
// reach beyond city limits, counties with subdivision authority but no zoning,
// and parcels inside a named place whose zoning is administered by the county.
// So a Census answer enters this module as `geographyEvidence` and can never,
// by construction, populate `zoningAuthority` or `subdivisionAuthority`.
//
// An authority is assigned ONLY from evidence that speaks to authority: an
// official government page, ordinance, or planning-department publication that
// says who administers it. Without that, the assignment is `unresolved` — and
// an unresolved authority is a real, usable answer that stops the zoning lane
// from asserting a district under the wrong government's name.
//
// Ambiguity is PRESERVED. When two governments both credibly claim the parcel,
// LandOS reports both and says it could not tell them apart, exactly as
// `official-source-discovery.ts` refuses to pick between two official sources.

import { defaultGovFetchText, htmlToText, type GovFetchText } from './gis-transport.js';
import { verifyOfficiality } from './official-source-discovery.js';
import { hostCorroboratesLocality } from './official-pdf-identity.js';
import { governmentSourceTier } from './land-use-source-authority.js';
import {
  browserEscalationLane,
  directSourceLane,
  indexedWebSearchLane,
  retainedEvidenceLane,
  type BrowserSourceReader,
  type EvidenceReader,
  type LaneJurisdiction,
  type RetrievalTransports,
} from './land-use-lanes.js';
import {
  raceLandUseSources,
  type LandUseEvidence,
  type LandUseLane,
  type LandUseLaneRecord,
  type LandUseRaceResult,
} from './land-use-source-race.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';
import type { JurisdictionResolution } from './jurisdiction-resolution.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const LAND_USE_AUTHORITY_LEVELS = [
  'municipal',
  'county',
  'state',
  'joint_municipal_county',
  'special_or_overlay_district',
  'unknown',
] as const;
export type LandUseAuthorityLevel = (typeof LAND_USE_AUTHORITY_LEVELS)[number];

/** The evidence weights the LandOS research standard uses, unchanged. */
export type AuthorityDetermination = 'confirmed' | 'well_supported' | 'likely' | 'ambiguous' | 'unresolved';

export type AuthoritySourceTier = 'official_government_source' | 'reputable_secondary' | 'search_result';

export interface AuthoritySourceRef {
  label: string;
  url: string | null;
  tier: AuthoritySourceTier;
  /** The wording that carried the answer, unedited. */
  quote: string;
  retrievedAt: string;
}

export interface AuthorityAssignment {
  /** The government that administers this function, or null when unresolved. */
  name: string | null;
  level: LandUseAuthorityLevel;
  determination: AuthorityDetermination;
  /** Why LandOS reached this, in the operator's language. */
  basis: string;
  sources: AuthoritySourceRef[];
  /** Named when two governments both credibly claim the function. */
  competingClaims: Array<{ name: string; level: LandUseAuthorityLevel; sourceUrl: string | null }>;
}

export type IncorporationStatus = 'incorporated' | 'unincorporated' | 'unverified';

export interface ControllingLandUseAuthority {
  dealCardId: number;
  municipality: string | null;
  county: string | null;
  state: string | null;
  incorporationStatus: IncorporationStatus;
  incorporationBasis: string;
  zoningAuthority: AuthorityAssignment;
  subdivisionAuthority: AuthorityAssignment;
  /** The department or body that runs the process, when one is named. */
  planningBody: string | null;
  /**
   * Census/TIGERweb geography. Retained as PROVENANCE only.
   * It never establishes either authority above; see the header.
   */
  geographyEvidence: {
    locality: string | null;
    localityKind: string | null;
    county: string | null;
    countyFips: string | null;
    state: string | null;
    stateFips: string | null;
    sourceLabel: string;
    /** Always true. Present so no reader can mistake geography for authority. */
    neverEstablishesLandUseAuthority: true;
  } | null;
  sources: AuthoritySourceRef[];
  conflicts: string[];
  limitations: string[];
  verifiedAt: string;
  /** Which methods raced, which won, and what was still running at release. */
  race?: LandUseRaceRecord;
}

/** The reportable shape of one source race. Timing proof, not narrative. */
export interface LandUseRaceRecord {
  question: string;
  released: boolean;
  releasedAtMs: number | null;
  elapsedMs: number;
  winningMethod: string | null;
  winningLaneId: string | null;
  pendingAtRelease: string[];
  lanes: LandUseLaneRecord[];
}

export function raceRecordOf<T>(race: LandUseRaceResult<T>): LandUseRaceRecord {
  return {
    question: race.question,
    released: race.released,
    releasedAtMs: race.releasedAtMs,
    elapsedMs: race.elapsedMs,
    winningMethod: race.winningMethod,
    winningLaneId: race.winningLaneId,
    pendingAtRelease: race.pendingAtRelease,
    lanes: race.lanes,
  };
}

// ── Reading authority out of an official page ───────────────────────────────

export type AuthorityStatementKind =
  | 'municipal_zoning'
  | 'county_zoning'
  | 'municipal_subdivision'
  | 'county_subdivision'
  | 'municipal_planning_region_extends'
  | 'no_county_zoning'
  | 'planning_body'
  | 'overlay_or_special_district';

/**
 * A government EXERCISING land-use jurisdiction over this parcel.
 *
 * The strongest authority evidence there is, and the live Fairview run is why
 * this exists. Municipal websites almost never contain the sentence "the City
 * of Fairview administers zoning" — but the city's own adopted ordinance says
 * "AN ORDINANCE TO AMEND THE ZONING ORDINANCE OF THE CITY OF FAIRVIEW … BY
 * REZONING … TAX MAP 042 PARCEL 123.00". A government that rezones a parcel is
 * the government that zones it. Reading the retained record answers the
 * authority question outright, from evidence LandOS already paid for, and it is
 * a stronger answer than any "about our planning department" page.
 */
const JURISDICTIONAL_ACTS: Array<{ build: (name: string) => RegExp; kind: AuthorityStatementKind }> = [
  // "…zoning ordinance of the City of X…", including inside an amending ordinance.
  { kind: 'municipal_zoning', build: (name) => new RegExp(`\\bzoning\\s+(?:ordinance|code|map)\\s+of\\s+(?:the\\s+)?(?:city|town|village)\\s+of\\s+${escape(name)}\\b`, 'i') },
  // "…City of X Zoning Ordinance…" / "…Town of X Zoning Resolution…"
  { kind: 'municipal_zoning', build: (name) => new RegExp(`\\b(?:city|town|village)\\s+of\\s+${escape(name)}\\b[^.\\n]{0,60}\\bzoning\\s+(?:ordinance|code|map|district)\\b`, 'i') },
  // A rezoning/annexation ordinance passed by the municipality.
  { kind: 'municipal_zoning', build: (name) => new RegExp(`\\bordinance\\b[^.\\n]{0,140}\\b(?:city|town|village)\\s+of\\s+${escape(name)}\\b[^.\\n]{0,140}\\b(?:rezon\\w+|zoning)\\b`, 'i') },
  // "Subdivision Regulations of Fairview, Tennessee" — the real Fairview
  // regulations name the town without the "City of" prefix, so the prefix is
  // optional. That is how these documents are actually titled.
  { kind: 'municipal_subdivision', build: (name) => new RegExp(`\\bsubdivision\\s+regulations?\\s+of\\s+(?:the\\s+)?(?:(?:city|town|village)\\s+of\\s+)?${escape(name)}\\b|\\b(?:city|town|village)\\s+of\\s+${escape(name)}\\s+subdivision\\s+regulations?\\b`, 'i') },
  { kind: 'municipal_subdivision', build: (name) => new RegExp(`\\b${escape(name)}\\s+(?:municipal\\s+)?planning\\s+commission\\b[^.\\n]{0,120}\\b(?:plat|subdivision)\\b`, 'i') },
];

const COUNTY_JURISDICTIONAL_ACTS: Array<{ build: (name: string) => RegExp; kind: AuthorityStatementKind }> = [
  { kind: 'county_zoning', build: (name) => new RegExp(`\\bzoning\\s+(?:resolution|ordinance|code|map)\\s+of\\s+${escape(name)}\\s+county\\b|\\b${escape(name)}\\s+county\\s+zoning\\s+(?:resolution|ordinance|code|map)\\b`, 'i') },
  { kind: 'county_subdivision', build: (name) => new RegExp(`\\bsubdivision\\s+regulations?\\s+(?:of|for)\\s+${escape(name)}\\s+county\\b|\\b${escape(name)}\\s+county\\s+subdivision\\s+regulations?\\b`, 'i') },
  { kind: 'county_subdivision', build: (name) => new RegExp(`\\b${escape(name)}\\s+county\\s+(?:regional\\s+)?planning\\s+commission\\b[^.\\n]{0,120}\\b(?:plat|subdivision)\\b`, 'i') },
];

/**
 * HOW the evidence speaks, strongest first.
 *
 * `administering_statement` — a source says outright who administers it.
 * `jurisdictional_act`      — the government's own code or ordinance, by name.
 * `publisher_act`           — that government heard a land-use matter on THIS
 *                             parcel in a document it published.
 *
 * All three are official evidence. The form decides which quote is presented as
 * the basis, so an operator reading "Fairview controls zoning" is shown the
 * strongest sentence behind it rather than whichever matched first.
 */
export type AuthorityEvidenceForm = 'administering_statement' | 'jurisdictional_act' | 'publisher_act';

export const AUTHORITY_FORM_RANK: Record<AuthorityEvidenceForm, number> = {
  administering_statement: 0,
  jurisdictional_act: 1,
  publisher_act: 2,
};

export interface AuthorityStatement {
  kind: AuthorityStatementKind;
  /** The government the statement names, as the page words it. */
  named: string | null;
  quote: string;
  form: AuthorityEvidenceForm;
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Sentences long enough to carry a claim and short enough to quote.
 *
 * Two live findings shaped this, and both were failures of the naive version:
 *
 *   • A PDF text layer breaks lines wherever the glyphs happened to wrap. The
 *     real Fairview regulations emit "These subdivision regulations are adopted
 *     by the\nFairview\nMunicipal Planning Commission" — split on newlines and
 *     the decisive sentence becomes three fragments that match nothing. So
 *     newlines are COLLAPSED first, and the split is on punctuation.
 *   • An ordinance title carries no sentence-ending punctuation at all, so a
 *     punctuation-only split produced one enormous run that the length filter
 *     then discarded whole. So an over-long run is WINDOWED rather than dropped,
 *     with the windows overlapping so a phrase never falls down a seam.
 */
function sentences(text: string): string[] {
  const flat = text.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ');
  const out: string[] = [];
  for (const chunk of flat.split(/(?<=[.!?;])\s+(?=[A-Z0-9"(])/)) {
    const sentence = clean(chunk);
    if (sentence.length < 15) continue;
    if (sentence.length <= 1_200) { out.push(sentence); continue; }
    for (let at = 0; at < sentence.length; at += 800) out.push(sentence.slice(at, at + 1_200));
  }
  return out;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

/**
 * Statements ON AN OFFICIAL PAGE that speak to who administers land use.
 *
 * Every rule requires an administering verb next to the function. "Zoning" on a
 * page is a topic; "the City of Fairview administers zoning" is a claim. Only
 * the second kind is read, because the first would let any planning page that
 * merely mentions the county assign authority to it.
 */
export function readAuthorityStatements(
  text: string,
  subject: { municipality?: string | null; county?: string | null },
): AuthorityStatement[] {
  const municipality = clean(subject.municipality ?? '');
  const county = clean(subject.county ?? '').replace(/\s+county$/i, '');
  const out: AuthorityStatement[] = [];
  const seen = new Set<string>();

  const municipalName = municipality
    ? new RegExp(`\\b(?:city|town|municipality)\\s+of\\s+${escape(municipality)}\\b|\\b${escape(municipality)}\\s+(?:city|town|municipal)\\b`, 'i')
    : null;
  const countyName = county ? new RegExp(`\\b${escape(county)}\\s+county\\b`, 'i') : null;
  // A LOOSE name match, used only for naming the planning body and spotting an
  // overlay district. Those two do not assign authority, so a bare "Fairview
  // Planning Commission" is enough to name the body — while the rules that DO
  // assign authority stay on the strict "City of Fairview" form, because a
  // bare town name in a sentence is not a jurisdictional claim.
  const municipalLoose = municipality ? new RegExp(`\\b${escape(municipality)}\\b`, 'i') : null;
  const countyLoose = county ? new RegExp(`\\b${escape(county)}\\b`, 'i') : null;

  const administers = /\b(?:administer(?:s|ed|ing)?|enforce(?:s|d|ment)?|adopt(?:s|ed)?|regulat(?:es|ed|ion)|has\s+jurisdiction|is\s+responsible\s+for|govern(?:s|ed)?|maintain(?:s)?)\b/i;
  const zoningWord = /\bzoning\b|\bzoning\s+ordinance\b|\bland\s+development\s+(?:code|ordinance)\b/i;
  const subdivisionWord = /\bsubdivision\s+(?:regulations?|ordinance|review|approval)\b|\bplat\s+approval\b/i;

  const push = (kind: AuthorityStatementKind, named: string | null, quote: string, form: AuthorityEvidenceForm = 'administering_statement'): void => {
    const key = `${kind}|${named ?? ''}|${quote.slice(0, 60)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, named, quote: quote.slice(0, 600), form });
  };

  for (const sentence of sentences(text)) {
    const namesMunicipality = municipalName?.test(sentence) ?? false;
    const namesCounty = countyName?.test(sentence) ?? false;

    // A county that states it has no zoning is decisive evidence ABOUT the
    // county, and it is the single most useful sentence a rural county page can
    // carry — it tells LandOS to stop looking there.
    if (/\b(?:county|unincorporated\s+(?:area|portion)s?)\b[^.]{0,80}\b(?:has\s+no|does\s+not\s+have|is\s+not)\s+(?:county[- ]wide\s+)?zon(?:ing|ed)\b/i.test(sentence)
      || /\bno\s+county[- ]wide\s+zoning\b/i.test(sentence)) {
      push('no_county_zoning', county ? `${county} County` : null, sentence);
      continue;
    }

    // A municipal planning region that reaches beyond the city limits is the
    // case a naive "is it inside the city?" test gets wrong every time.
    if (/\b(?:urban\s+growth\s+boundary|planning\s+region|extraterritorial\s+jurisdiction|\bETJ\b|planning\s+area\s+extend)/i.test(sentence)
      && (namesMunicipality || /\bmunicipal\b/i.test(sentence))) {
      push('municipal_planning_region_extends', namesMunicipality ? municipality : null, sentence);
    }

    const looselyMunicipal = municipalLoose?.test(sentence) ?? false;
    const looselyCounty = countyLoose?.test(sentence) ?? false;

    if (/\b(?:overlay\s+district|special\s+planning\s+district|historic\s+district|joint\s+planning)\b/i.test(sentence)) {
      push('overlay_or_special_district', looselyMunicipal ? municipality : looselyCounty ? `${county} County` : null, sentence);
    }

    if (/\bplanning\s+(?:commission|department|division|staff)\b|\bboard\s+of\s+zoning\s+appeals\b/i.test(sentence)
      && (looselyMunicipal || looselyCounty)) {
      push('planning_body', namedBodyIn(sentence) ?? (looselyMunicipal ? municipality : `${county} County`), sentence);
    }

    // A jurisdictional ACT needs no administering verb: the government owning
    // the code, or amending it over this parcel, IS the claim.
    if (municipality) {
      for (const act of JURISDICTIONAL_ACTS) {
        if (act.build(municipality).test(sentence)) push(act.kind, municipality, sentence, 'jurisdictional_act');
      }
    }
    if (county) {
      for (const act of COUNTY_JURISDICTIONAL_ACTS) {
        if (act.build(county).test(sentence)) push(act.kind, `${county} County`, sentence, 'jurisdictional_act');
      }
    }

    if (!administers.test(sentence)) continue;
    if (zoningWord.test(sentence)) {
      if (namesMunicipality) push('municipal_zoning', municipality, sentence);
      else if (namesCounty) push('county_zoning', `${county} County`, sentence);
    }
    if (subdivisionWord.test(sentence)) {
      if (namesMunicipality) push('municipal_subdivision', municipality, sentence);
      else if (namesCounty) push('county_subdivision', `${county} County`, sentence);
    }
  }
  return out;
}

/**
 * A government ACTING on this parcel, read from a document it published itself.
 *
 * Only valid for SUBJECT-ANCHORED text — the retained document passages, which
 * the miner keeps only when they name this parcel. That anchoring is what makes
 * the inference sound: a municipality whose own planning packet hears a
 * rezoning, a master development plan or a plat for THIS parcel is exercising
 * land-use jurisdiction over it. No page needs to describe the arrangement in
 * words, and in practice none does.
 *
 * The publisher is established from the source host (the city's own domain, per
 * `hostCorroboratesLocality`) or from the document naming itself. A passage on
 * somebody else's domain establishes nothing here.
 */
export function readPublisherJurisdictionActs(
  document: { text: string; sourceUrl: string | null; sourceTitle: string | null },
  subject: { municipality?: string | null; county?: string | null; state?: string | null },
): AuthorityStatement[] {
  const url = document.sourceUrl ?? '';
  const municipality = clean(subject.municipality ?? '');
  const county = clean(subject.county ?? '').replace(/\s+county$/i, '');
  const header = `${document.sourceTitle ?? ''} ${document.text.slice(0, 1_200)}`;

  const publishedByMunicipality = !!municipality
    && (hostCorroboratesLocality(url, municipality, subject.state)
      || new RegExp(`\\b(?:city|town|village)\\s+of\\s+${escape(municipality)}\\b`, 'i').test(header));
  const publishedByCounty = !!county
    && (hostCorroboratesLocality(url, `${county} County`, subject.state)
      || new RegExp(`\\b${escape(county)}\\s+county\\b`, 'i').test(header));
  if (!publishedByMunicipality && !publishedByCounty) return [];

  const name = publishedByMunicipality ? municipality : `${county} County`;
  const zoningKind: AuthorityStatementKind = publishedByMunicipality ? 'municipal_zoning' : 'county_zoning';
  const subdivisionKind: AuthorityStatementKind = publishedByMunicipality ? 'municipal_subdivision' : 'county_subdivision';

  const out: AuthorityStatement[] = [];
  const seen = new Set<string>();
  const push = (kind: AuthorityStatementKind, quote: string, named: string = name): void => {
    const key = `${kind}|${quote.slice(0, 60)}`;
    if (seen.has(key) || out.length >= 24) return;
    seen.add(key);
    out.push({ kind, named, quote: quote.slice(0, 600), form: 'publisher_act' });
  };

  const ZONING_ACT = /\b(?:rezon\w+|current\s+zoning|requested\s+zoning|zoning\s+(?:amendment|map\s+amendment|resolution|ordinance)|zoning\s+district)\b/i;
  const SUBDIVISION_ACT = /\b(?:preliminary\s+plat|final\s+plat|subdivision\s+plat|master\s+development\s+plan|site\s+plan|subdivision\s+(?:application|plan))\b/i;

  for (const sentence of sentences(document.text)) {
    if (ZONING_ACT.test(sentence)) push(zoningKind, sentence);
    if (SUBDIVISION_ACT.test(sentence)) push(subdivisionKind, sentence);
    if (/\bplanning\s+commission\b|\bboard\s+of\s+zoning\s+appeals\b/i.test(sentence)) {
      push('planning_body', sentence, namedBodyIn(sentence) ?? name);
    }
  }
  return out;
}

/**
 * The BODY a sentence names, as the document words it.
 *
 * "Fairview Municipal Planning Commission" is something an operator can ring;
 * "Fairview" is not. Null when the sentence names no body, so the caller can
 * fall back to the jurisdiction.
 */
function namedBodyIn(sentence: string): string | null {
  const match = /((?:[A-Z][A-Za-z'’-]+\s+){0,3}(?:Municipal\s+|Regional\s+)?Planning\s+Commission|Board\s+of\s+Zoning\s+Appeals)/.exec(sentence);
  return match ? clean(match[1]).slice(0, 80) : null;
}

// ── Assigning an authority from evidence ────────────────────────────────────

const UNRESOLVED_BASIS =
  'No official government source stated who administers this function for this parcel. '
  + 'Census geography places the property, but geography does not establish land-use authority, so nothing is assigned.';

export function unresolvedAssignment(basis = UNRESOLVED_BASIS): AuthorityAssignment {
  return { name: null, level: 'unknown', determination: 'unresolved', basis, sources: [], competingClaims: [] };
}

export interface AuthorityCandidate {
  name: string;
  level: LandUseAuthorityLevel;
  statement: AuthorityStatement;
  source: AuthoritySourceRef;
}

/**
 * Choose the administering government, or refuse to.
 *
 * Three refusals are deliberate:
 *   • No candidate at all → `unresolved`. Never "probably the county".
 *   • No candidate whose source is an OFFICIAL government page → `unresolved`,
 *     with the secondary evidence retained as provenance. A search snippet is a
 *     pointer, not a grant of jurisdiction.
 *   • Two official candidates naming DIFFERENT governments → `ambiguous`, both
 *     preserved. The brief is explicit: preserve the ambiguity rather than
 *     choosing.
 */
export function assignAuthority(candidates: readonly AuthorityCandidate[]): AuthorityAssignment {
  if (!candidates.length) return unresolvedAssignment();

  const official = candidates.filter((row) => row.source.tier === 'official_government_source');
  if (!official.length) {
    return {
      name: null,
      level: 'unknown',
      determination: 'unresolved',
      basis:
        `${candidates.length} source(s) discuss who administers this function, but none is an official government source. `
        + 'A secondary or search result may point at the answer; it may not establish which government holds land-use authority over a parcel.',
      sources: candidates.map((row) => row.source),
      competingClaims: [...new Set(candidates.map((row) => row.name))].map((name) => ({
        name,
        level: candidates.find((row) => row.name === name)!.level,
        sourceUrl: candidates.find((row) => row.name === name)!.source.url,
      })),
    };
  }

  const names = [...new Set(official.map((row) => row.name))];
  if (names.length > 1) {
    return {
      name: null,
      level: 'unknown',
      determination: 'ambiguous',
      basis:
        `Two or more official sources name DIFFERENT governments as administering this function: ${names.join(' and ')}. `
        + 'LandOS preserves the ambiguity rather than choosing, because choosing would attach this parcel to the wrong government.',
      sources: official.map((row) => row.source),
      competingClaims: names.map((name) => {
        const match = official.find((row) => row.name === name)!;
        return { name, level: match.level, sourceUrl: match.source.url };
      }),
    };
  }

  // Present the STRONGEST form of evidence as the basis. A publisher act is
  // real evidence, but if a source also states the arrangement outright, that
  // sentence is the one the operator should be reading.
  const ranked = [...official].sort((a, b) =>
    AUTHORITY_FORM_RANK[a.statement.form] - AUTHORITY_FORM_RANK[b.statement.form]);
  const chosen = ranked[0];
  const supporting = ranked.filter((row) => row.name === chosen.name);
  const basis = chosen.statement.form === 'administering_statement'
    ? `${chosen.name} is named by an official government source as administering this function: "${clean(chosen.statement.quote).slice(0, 240)}"`
    : chosen.statement.form === 'jurisdictional_act'
      ? `${chosen.name} owns the code that governs this function, per its own official document: "${clean(chosen.statement.quote).slice(0, 240)}"`
      : `${chosen.name} exercised this function over THIS parcel in a document it published itself — the strongest available evidence of jurisdiction, and there are ${supporting.length} such passage(s). Example: "${clean(chosen.statement.quote).slice(0, 240)}"`;

  return {
    name: chosen.name,
    level: chosen.level,
    // One official source that says it outright is Confirmed under the LandOS
    // evidence standard; more than one is still Confirmed, and the extra
    // sources travel with it rather than inflating the weight.
    determination: 'confirmed',
    basis,
    // Capped: twenty near-identical passages from one packet is noise, not
    // corroboration, and the operator has to be able to read the list.
    sources: supporting.slice(0, 5).map((row) => row.source),
    competingClaims: [],
  };
}

// ── The runner ──────────────────────────────────────────────────────────────

export interface AuthorityResolutionSubject {
  dealCardId: number;
  municipality: string | null;
  county: string | null;
  state: string | null;
  apn: string | null;
  address: string | null;
}

export interface AuthorityResolutionDeps {
  /**
   * Official documents LandOS ALREADY holds for this parcel, as text.
   *
   * Read first and for free. The retained planning packet and the adopted
   * ordinance are usually the most direct answer to "whose zoning is this",
   * because they are that government acting on THIS parcel rather than a page
   * describing itself.
   */
  retainedDocuments?: ReadonlyArray<{ text: string; sourceUrl: string | null; sourceTitle: string | null; tier?: AuthoritySourceTier }>;
  /** Governed keyless search. Discovery only; never an authority by itself. */
  search?: IdentitySearchProvider;
  fetchText?: GovFetchText;
  /** Census geography, already resolved by the identity path. Provenance only. */
  jurisdiction?: JurisdictionResolution | null;
  /** Pages the resolver already saw, so discovery does not start from zero. */
  knownSourceUrls?: readonly string[];
  maxQueries?: number;
  maxPages?: number;
  timeoutMs?: number;
  /** Bounds the WAIT for a sufficient answer. Lanes are never cancelled. */
  deadlineMs?: number;
  /** Escalation seam. Absent means the browser lane reports itself unwired. */
  browser?: BrowserSourceReader | null;
  /**
   * `false` returns as soon as the race releases, leaving the slower lanes to
   * finish unobserved. Default true: the record is written once, with whatever
   * corroboration or conflict the losing lanes produced.
   */
  awaitEnrichment?: boolean;
  onLaneSettled?: (record: LandUseLaneRecord) => void;
  now?: () => string;
}

/** Search phrasings an operator would actually type. */
export function buildAuthorityQueries(subject: AuthorityResolutionSubject, limit = 4): string[] {
  const place = [subject.municipality, subject.state].filter(Boolean).join(' ');
  const county = subject.county ? `${subject.county.replace(/\s+county$/i, '')} County ${subject.state ?? ''}`.trim() : '';
  const queries = [
    place ? `${place} zoning ordinance planning department official site` : '',
    county ? `${county} zoning resolution planning commission official site` : '',
    place ? `${place} subdivision regulations planning commission` : '',
    county ? `${county} subdivision regulations planning commission` : '',
    place && county ? `does ${place} or ${county} administer zoning` : '',
  ].filter(Boolean);
  return [...new Set(queries)].slice(0, Math.max(1, limit));
}

/**
 * Source tiering and jurisdiction ranking now live in
 * `land-use-source-authority.ts`, so the authority resolver, the zoning
 * determination, the standards research and the subdivision retrieval all
 * judge a source the same way. Re-exported here because callers already
 * import it from this module.
 */
export { rankSourceForAuthority, hostServesSubjectJurisdiction } from './land-use-source-authority.js';
export { governmentSourceTier };

function tierFor(url: string, county: string | null, state: string | null): AuthoritySourceTier {
  return governmentSourceTier({ url, county, state });
}

function levelFor(kind: AuthorityStatementKind): LandUseAuthorityLevel {
  switch (kind) {
    case 'municipal_zoning':
    case 'municipal_subdivision':
    case 'municipal_planning_region_extends':
      return 'municipal';
    case 'county_zoning':
    case 'county_subdivision':
    case 'no_county_zoning':
      return 'county';
    case 'overlay_or_special_district':
      return 'special_or_overlay_district';
    default:
      return 'unknown';
  }
}

/**
 * Establish who controls zoning and subdivision for this exact parcel.
 *
 * Search is DISCOVERY: it finds government pages. Those pages are then read,
 * and only what an official page SAYS about administration is allowed to assign
 * an authority. A run that finds nothing official returns two `unresolved`
 * assignments with the geography retained, which is an honest answer the zoning
 * lane can act on.
 */
export async function resolveControllingLandUseAuthority(
  subject: AuthorityResolutionSubject,
  deps: AuthorityResolutionDeps = {},
): Promise<ControllingLandUseAuthority> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const maxPages = Math.max(1, deps.maxPages ?? 5);
  const timeoutMs = Math.max(1_000, deps.timeoutMs ?? 20_000);
  const conflicts: string[] = [];
  const limitations: string[] = [];
  const sources: AuthoritySourceRef[] = [];

  const geographyEvidence: ControllingLandUseAuthority['geographyEvidence'] = deps.jurisdiction
    ? {
        locality: deps.jurisdiction.locality,
        localityKind: deps.jurisdiction.localityKind,
        county: deps.jurisdiction.county,
        countyFips: deps.jurisdiction.countyFips,
        state: deps.jurisdiction.state,
        stateFips: deps.jurisdiction.stateFips,
        sourceLabel: 'U.S. Census Bureau TIGERweb geographic services',
        neverEstablishesLandUseAuthority: true,
      }
    : null;

  const zoningCandidates: AuthorityCandidate[] = [];
  const subdivisionCandidates: AuthorityCandidate[] = [];
  let planningBody: string | null = null;
  let municipalRegionExtends = false;
  let countyStatesNoZoning = false;

  const absorb = (statements: readonly AuthorityStatement[], source: (statement: AuthorityStatement) => AuthoritySourceRef): void => {
    for (const statement of statements) {
      const ref = source(statement);
      if (!sources.some((row) => row.url === ref.url && row.quote === ref.quote)) sources.push(ref);
      const level = levelFor(statement.kind);
      const named = statement.named
        ?? (level === 'county' && subject.county ? `${subject.county.replace(/\s+county$/i, '')} County` : subject.municipality);
      switch (statement.kind) {
        case 'municipal_zoning':
        case 'county_zoning':
          if (named) zoningCandidates.push({ name: named, level, statement, source: ref });
          break;
        case 'municipal_subdivision':
        case 'county_subdivision':
          if (named) subdivisionCandidates.push({ name: named, level, statement, source: ref });
          break;
        case 'municipal_planning_region_extends':
          municipalRegionExtends = true;
          break;
        case 'no_county_zoning':
          countyStatesNoZoning = true;
          break;
        case 'planning_body':
          // A later statement that names the actual BODY upgrades an earlier
          // one that only named the jurisdiction. "Fairview Municipal Planning
          // Commission" is who the operator calls; "Fairview" is not.
          if (named && (!planningBody || (/\b(?:commission|appeals|board)\b/i.test(named) && !/\b(?:commission|appeals|board)\b/i.test(planningBody)))) {
            planningBody = named;
          }
          break;
        case 'overlay_or_special_district':
          conflicts.push(`An overlay or special planning district is referenced for this jurisdiction: "${clean(statement.quote).slice(0, 200)}"`);
          break;
      }
    }
  };

  // ── THE RACE ──────────────────────────────────────────────────────────────
  //
  // Retained evidence, indexed web discovery and the government's own known
  // pages all run CONCURRENTLY. The earlier version ran them in that order,
  // one after the other, which meant a jurisdiction whose planning page would
  // have answered in 300ms first paid four search round trips.
  //
  // The retained lane is `instant`, so on a card where LandOS already holds a
  // municipal act on this parcel the network lanes are never started at all —
  // that is not a fallback, it is the race being won before it began.
  const jurisdiction: LaneJurisdiction = {
    municipality: subject.municipality,
    county: subject.county,
    state: subject.state,
  };
  const transports: RetrievalTransports = { fetchText, timeoutMs, now: () => now };

  const readStatements: EvidenceReader<AuthorityStatement> = (document) => {
    const found = [
      ...readAuthorityStatements(document.text, { municipality: subject.municipality, county: subject.county }),
      ...readPublisherJurisdictionActs(
        { text: document.text, sourceUrl: document.url || null, sourceTitle: document.title },
        { municipality: subject.municipality, county: subject.county, state: subject.state },
      ),
    ];
    return found.map((statement) => ({
      method: 'official_document' as const,
      laneId: 'authority',
      value: statement,
      authorityName: statement.named,
      sourceLabel: clean(document.title ?? document.url).slice(0, 200),
      sourceUrl: document.url || null,
      sourceTier: document.tier,
      // An authority claim is about a GOVERNMENT's remit, not about a parcel
      // boundary; a publisher act is the one form that is parcel-anchored, and
      // the retained miner already anchored it.
      parcelMatchBasis: statement.form === 'publisher_act'
        ? 'the government published this act about THIS parcel'
        : 'the source states this government administers the function for this jurisdiction',
      currentness: 'current' as const,
      effectiveOrAsOf: null,
      quote: statement.quote,
      retrievedAt: document.retrievedAt,
    }));
  };

  const lanes: Array<LandUseLane<AuthorityStatement, LaneJurisdiction>> = [
    retainedEvidenceLane<AuthorityStatement>({
      id: 'retained_documents',
      label: 'Retained official-document intelligence',
      sources: (deps.retainedDocuments ?? []).map((document) => ({
        url: document.sourceUrl,
        title: document.sourceTitle,
        text: document.text,
        // A document the identity path already accepted as an official
        // government document is an official government source here too.
        tier: document.tier ?? 'official_government_source',
      })),
      jurisdiction,
      read: readStatements,
      now: () => now,
    }),
  ];
  if (deps.knownSourceUrls?.length) {
    lanes.push(directSourceLane<AuthorityStatement>({
      id: 'known_government_pages',
      label: "The government's own pages LandOS already knows",
      urls: deps.knownSourceUrls,
      jurisdiction,
      read: readStatements,
      transports,
      maxSources: maxPages,
    }));
  }
  if (deps.search) {
    lanes.push(indexedWebSearchLane<AuthorityStatement>({
      id: 'web_discovery',
      label: 'Indexed web discovery (governed keyless search)',
      queries: buildAuthorityQueries(subject, deps.maxQueries ?? 4),
      jurisdiction,
      search: deps.search,
      read: readStatements,
      transports,
      maxSources: maxPages,
      followLinks: /zoning|subdivision|planning|ordinance|regulation/i,
      onNote: (note) => limitations.push(note),
    }));
  } else {
    limitations.push('No search transport was wired, so page discovery relied only on sources LandOS already knew.');
  }
  lanes.push(browserEscalationLane<AuthorityStatement>({
    id: 'browser',
    label: 'Browser escalation (JS-rendered planning page)',
    urls: deps.knownSourceUrls ?? [],
    purpose: 'read who administers zoning and subdivision for this parcel',
    jurisdiction,
    read: readStatements,
    browser: deps.browser ?? null,
    onNote: (note) => limitations.push(note),
    now: () => now,
  }));

  const race = await raceLandUseSources<AuthorityStatement, LaneJurisdiction>({
    question: 'zoning_authority',
    aim: jurisdiction,
    lanes,
    instantFastPath: true,
    deadlineMs: deps.deadlineMs ?? 45_000,
    gate: (candidate) => {
      if (candidate.sourceTier !== 'official_government_source') {
        return { sufficient: false, reason: `the source is ${candidate.sourceTier.replace(/_/g, ' ')}; only an official government source may establish land-use authority` };
      }
      const assigns = candidate.value.kind === 'municipal_zoning' || candidate.value.kind === 'county_zoning'
        || candidate.value.kind === 'municipal_subdivision' || candidate.value.kind === 'county_subdivision';
      return assigns
        ? { sufficient: true, reason: 'an official source assigns this function to a named government' }
        : { sufficient: false, reason: `it is a ${candidate.value.kind.replace(/_/g, ' ')} statement, which is context rather than an assignment of authority` };
    },
    sameAnswer: (a, b) => a.kind === b.kind && a.named === b.named,
    onLaneSettled: (record) => deps.onLaneSettled?.(record),
  });

  const absorbEvidence = (rows: ReadonlyArray<LandUseEvidence<AuthorityStatement>>): void => {
    for (const row of rows) {
      absorb([row.value], () => ({
        label: row.sourceLabel || row.sourceUrl || 'Official source',
        url: row.sourceUrl,
        tier: row.sourceTier,
        quote: row.quote,
        retrievedAt: row.retrievedAt,
      }));
    }
  };
  absorbEvidence(race.evidence);
  conflicts.push(...race.conflicts);
  limitations.push(...race.notes);

  // The lanes that lost keep running. Whatever they find is corroboration or a
  // conflict, and it is folded in before the record is written — but the
  // RELEASE already happened, and `race.releasedAtMs` records when.
  if (deps.awaitEnrichment !== false) {
    const enrichment = await race.enrichment;
    absorbEvidence(enrichment.lateEvidence);
    conflicts.push(...enrichment.conflicts);
  }

  const read = race.lanes.filter((lane) => lane.status === 'evidence').length;

  if (countyStatesNoZoning && zoningCandidates.some((row) => row.level === 'county')) {
    conflicts.push('One official county source states the county administers zoning while another states the county has no zoning. Both are retained; the zoning authority is not decided from them.');
  }

  const zoningAuthority = countyStatesNoZoning && !zoningCandidates.some((row) => row.level === 'county')
    ? assignAuthority(zoningCandidates.filter((row) => row.level !== 'county'))
    : assignAuthority(zoningCandidates);
  const subdivisionAuthority = assignAuthority(subdivisionCandidates);

  if (municipalRegionExtends) {
    limitations.push(
      'An official source states a municipal planning region or urban growth boundary extends beyond the city limits, so a parcel outside the city may still be under municipal land-use jurisdiction. Do not infer authority from the city limit line.',
    );
  }
  if (zoningAuthority.determination === 'unresolved') {
    limitations.push('Controlling zoning authority is UNRESOLVED. No zoning district may be asserted under a named government until it is established.');
  }
  if (subdivisionAuthority.determination === 'unresolved') {
    limitations.push('Controlling subdivision authority is UNRESOLVED, so no subdivision rule set is attributed to a government.');
  }
  if (!read && !sources.length) {
    limitations.push('No candidate government source could be read, so nothing was established about administration.');
  }
  const skipped = race.lanes.filter((lane) => lane.status === 'skipped');
  if (skipped.length) {
    limitations.push(
      `Both controlling authorities were established from evidence LandOS already held, so ${skipped.length} network lane(s) were never started.`,
    );
  }

  // Incorporation is only established when an OFFICIAL source states it. The
  // Census place layer says a place exists; it does not say this parcel is
  // inside its corporate limits.
  const incorporated = zoningAuthority.level === 'municipal' || subdivisionAuthority.level === 'municipal';
  const incorporationStatus: IncorporationStatus = incorporated ? 'incorporated' : 'unverified';

  return {
    dealCardId: subject.dealCardId,
    municipality: subject.municipality,
    county: subject.county,
    state: subject.state,
    incorporationStatus,
    incorporationBasis: incorporated
      ? 'An official source names a municipal government as administering land use for this parcel.'
      : 'No official source established whether this parcel lies inside municipal corporate limits. Census place geography does not establish it.',
    zoningAuthority,
    subdivisionAuthority,
    planningBody,
    geographyEvidence,
    sources,
    conflicts: [...new Set(conflicts)],
    limitations: [...new Set(limitations)],
    verifiedAt: now,
    race: raceRecordOf(race),
  };
}
