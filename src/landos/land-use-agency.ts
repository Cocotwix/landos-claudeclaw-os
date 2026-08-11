// LandOS — ACCESS and SEPTIC/HEALTH authority research.
//
// Two lanes that are small individually and decisive together: whether a new
// lot can legally get a driveway, and whether it can legally get a septic
// system. Either one alone can make a division that satisfies every zoning
// standard impossible in practice.
//
// The engine is careful about one thing above all here: visible road frontage
// is NOT legal access, and an existing driveway is NOT an approval for another
// one. Those two conflations are how a subdivision scenario gets priced that
// cannot actually be built.

import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { searchEngineUrl, unwrapSearchResults } from './netr-routing.js';
import { boundExcerpt, buildCitation, findProvisions, hostOf, isGovernmentHost } from './land-use-evidence.js';
import { deriveStateAgencyHostCandidates, stateName } from './state-legal-sources.js';
import {
  evidencedValue,
  provisionalValue,
  unresolvedValue,
  type AccessFramework,
  type AccessStatus,
  type LegalSourceCitation,
  type ResolvedAuthority,
  type RoadType,
  type SepticWellFramework,
} from './land-use-types.js';

/* ────────────────────────── road classification ──────────────────────── */

/**
 * Classify the road a property fronts from its NAME.
 *
 * A name is strong evidence of the maintaining authority and weak evidence of
 * nothing else, so the result drives WHICH authority to research and never
 * decides whether access is permitted. "GA Highway 102" tells LandOS to go ask
 * the state DOT; it does not tell LandOS what the DOT will say.
 */
export function classifyRoadFromName(roadName: string | null | undefined, state: string | null | undefined): { type: RoadType; reason: string } {
  const name = (roadName ?? '').trim();
  if (!name) return { type: 'unverified', reason: 'No road name is available for the subject.' };
  const code = (state ?? '').trim().toUpperCase();

  if (/\b(?:us|u\.s\.)\s*(?:highway|hwy|route|rte)?\s*\d+\b/i.test(name)) {
    return { type: 'us_highway', reason: 'The road name identifies a U.S. numbered highway, which is state-maintained in almost every state.' };
  }
  const statePattern = code
    ? new RegExp(`\\b(?:${code}|state)\\s*(?:highway|hwy|route|rte|road|rd)\\.?\\s*\\d+\\b`, 'i')
    : /\bstate\s*(?:highway|hwy|route|rte)\.?\s*\d+\b/i;
  if (statePattern.test(name)) {
    return { type: 'state_highway', reason: 'The road name identifies a state-numbered route, so the state highway authority controls access to it.' };
  }
  if (/\bcounty\s*(?:road|rd|route|highway|hwy)\.?\s*\d+/i.test(name) || /\bC\.?R\.?\s*\d+\b/.test(name)) {
    return { type: 'county_road', reason: 'The road name identifies a county route.' };
  }
  if (/\bprivate\b/i.test(name)) {
    return { type: 'private_road', reason: 'The road name states it is private.' };
  }
  return { type: 'unverified', reason: 'The road name does not identify a numbered state, U.S. or county route, so the maintaining authority is not established from the name alone.' };
}

/** The road name from a street address, with the number removed. */
export function roadNameFromAddress(address: string | null | undefined): string | null {
  const value = (address ?? '').trim();
  if (!value) return null;
  const stripped = value.replace(/^\s*\d+[A-Za-z]?\s+/, '').trim();
  return stripped || null;
}

/* ───────────────────────────── the access lane ───────────────────────── */

export interface AccessLaneInput {
  address: string | null;
  state: string | null;
  county: string | null;
  /** True when the subject already has improvements, implying existing access. */
  hasImprovements: boolean;
  now: string;
}

export interface AgencyLaneDeps {
  fetchText?: GovFetchText;
  allowWebSearch?: boolean;
  maxRequests?: number;
}

const DRIVEWAY_PERMIT_PATTERN =
  /(?:driveway|access|encroachment|entrance)\s+permit[^.;]{0,240}|permit\s+(?:is\s+)?required[^.;]{0,80}(?:driveway|access|entrance)[^.;]{0,160}/gi;
const SPACING_PATTERN = /(?:access|driveway|connection)\s+spacing[^.;]{0,200}|spacing\s+(?:standard|requirement|criteria)[^.;]{0,200}/gi;
const SHARED_ACCESS_PATTERN = /(?:shared|joint|combined)\s+(?:access|driveway|entrance)[^.;]{0,200}/gi;

/**
 * Find and read the authority that controls access on the subject's road.
 *
 * Bounded on purpose: this lane answers "who decides, and does a new access
 * point need their permission", not "will they say yes". The second question
 * has no answer short of an application, and pretending otherwise is exactly
 * what PART 11 forbids.
 */
export async function researchAccess(input: AccessLaneInput, deps: AgencyLaneDeps = {}): Promise<AccessFramework> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const roadName = roadNameFromAddress(input.address);
  const classified = classifyRoadFromName(roadName, input.state);
  const constraintNotes: string[] = [];

  const roadTypeValue = classified.type === 'unverified'
    ? unresolvedValue<RoadType>(classified.reason)
    : provisionalValue<RoadType>(classified.type, [buildCitation({
        url: 'urn:landos:subject-address',
        label: 'Subject address on file',
        excerpt: `Subject address "${input.address ?? ''}" identifies the road as ${classified.type.replace(/_/g, ' ')}. ${classified.reason}`,
        format: 'plain_text',
        tierHint: 'official_form_or_guidance',
        retrievedAt: input.now,
      })], 'Road classification is read from the road name; it has not been confirmed against the maintaining authority\'s own route inventory.');

  // Only a state-maintained route sends this lane to the state DOT. A local
  // road's access authority is the county or municipality, which the local
  // lane already researched.
  const isStateMaintained = classified.type === 'state_highway' || classified.type === 'us_highway';

  let accessAuthority: ResolvedAuthority | null = null;
  let drivewayPermitRequired = unresolvedValue<boolean>('No access authority document was read, so a permit requirement is not established.');
  let newAccessApprovalRequired = unresolvedValue<boolean>('Not established.');
  let spacingStandards = unresolvedValue<string>('No spacing standard was located.');
  let sharedAccessMayBeRequired = unresolvedValue<boolean>('Not established.');
  let subdivisionTriggersReview = unresolvedValue<boolean>('Not established.');

  if (isStateMaintained && input.state) {
    const documents = await findAgencyDocuments(
      input.state,
      'dot',
      `${stateName(input.state) ?? input.state} department of transportation driveway access permit requirements`,
      deps,
    );

    if (documents.length) {
      const citations: LegalSourceCitation[] = [];
      let permitHit: string | null = null;
      let spacingHit: string | null = null;
      let sharedHit: string | null = null;

      for (const document of documents) {
        const permit = findProvisions(document.text, DRIVEWAY_PERMIT_PATTERN, { maxMatches: 1 });
        if (permit.length && !permitHit) {
          permitHit = permit[0].excerpt;
          citations.push(buildCitation({
            url: document.url, label: document.label, citation: permit[0].section, excerpt: permit[0].excerpt,
            format: 'html', tierHint: 'state_dot', retrievedAt: input.now,
          }));
        }
        const spacing = findProvisions(document.text, SPACING_PATTERN, { maxMatches: 1 });
        if (spacing.length && !spacingHit) {
          spacingHit = spacing[0].excerpt;
          citations.push(buildCitation({
            url: document.url, label: document.label, citation: spacing[0].section, excerpt: spacing[0].excerpt,
            format: 'html', tierHint: 'state_dot', retrievedAt: input.now,
          }));
        }
        const shared = findProvisions(document.text, SHARED_ACCESS_PATTERN, { maxMatches: 1 });
        if (shared.length && !sharedHit) {
          sharedHit = shared[0].excerpt;
          citations.push(buildCitation({
            url: document.url, label: document.label, citation: shared[0].section, excerpt: shared[0].excerpt,
            format: 'html', tierHint: 'state_dot', retrievedAt: input.now,
          }));
        }
      }

      accessAuthority = {
        role: 'road_access',
        name: evidencedValue(`${stateName(input.state) ?? input.state} state highway authority`, citations.length ? citations : [buildCitation({
          url: documents[0].url, label: documents[0].label, excerpt: boundExcerpt(documents[0].text) ?? '',
          format: 'html', tierHint: 'state_dot', retrievedAt: input.now,
        })]),
        unitType: 'state',
        relationship: 'Controls new access points onto the state-maintained route the subject fronts.',
        officialUrl: documents[0].url,
      };

      if (permitHit) {
        drivewayPermitRequired = evidencedValue(true, citations.filter((citation) => citation.excerpt === boundExcerpt(permitHit!)));
        newAccessApprovalRequired = evidencedValue(true, citations.filter((citation) => citation.excerpt === boundExcerpt(permitHit!)));
      }
      if (spacingHit) spacingStandards = evidencedValue(boundExcerpt(spacingHit)!, citations);
      if (sharedHit) sharedAccessMayBeRequired = evidencedValue(true, citations);
    }
  }

  /* The status. Deliberately conservative in both directions. */
  let status: AccessStatus;
  if (isStateMaintained && drivewayPermitRequired.value === true) {
    status = 'new_access_permit_dependent';
    constraintNotes.push('Any ADDITIONAL access point onto this state route depends on a permit from the highway authority. LandOS holds no such approval, so no additional curb cut may be assumed.');
  } else if (isStateMaintained) {
    status = 'new_access_unverified';
    constraintNotes.push('The subject fronts a state-maintained route. LandOS did not read the highway authority\'s access rule, so whether a new access point can be permitted is unverified.');
  } else if (classified.type === 'unverified') {
    status = 'new_access_unverified';
    constraintNotes.push('The maintaining authority for the subject\'s road is not established, so access for any new lot is unverified.');
  } else {
    status = 'new_access_unverified';
  }

  if (input.hasImprovements) {
    constraintNotes.push('The subject has existing improvements, so an existing access point is likely. An existing driveway is not an approval for an additional one.');
  }
  constraintNotes.push('Visible road frontage is not the same as guaranteed legal access. Frontage alone does not establish that a driveway can be permitted at a given point.');

  return {
    roadType: roadTypeValue,
    roadName,
    accessAuthority,
    status,
    drivewayPermitRequired,
    newAccessApprovalRequired,
    spacingStandards,
    sharedAccessMayBeRequired,
    subdivisionTriggersReview,
    constraintNotes,
  };
}

/* ──────────────────────────── the septic lane ────────────────────────── */

const SEPTIC_SCOPE_NOTE =
  'Screening only. This sprint performs no engineered septic feasibility, no soil interpretation and no percolation analysis. Soil evidence from listing platforms is screening evidence and is not an approval.';

const PER_LOT_PATTERN =
  /each\s+(?:lot|parcel|dwelling)[^.;]{0,200}(?:permit|approval|system)[^.;]{0,160}|(?:permit|approval)\s+(?:is\s+)?required[^.;]{0,80}(?:each|every)\s+(?:lot|parcel)[^.;]{0,140}|on-?site\s+sewage\s+management\s+system[^.;]{0,200}/gi;
const HEALTH_REVIEW_PATTERN =
  /(?:health\s+(?:department|district|authority|officer)|environmental\s+health)[^.;]{0,220}(?:approv|review|certif|permit)[^.;]{0,160}/gi;
const RESERVE_FIELD_PATTERN = /(?:reserve|replacement|repair|secondary)\s+(?:drain\s?field|absorption\s+(?:field|area)|area)[^.;]{0,200}/gi;
const MIN_ACREAGE_PATTERN = /(?:lot|parcel)\s+(?:size|area)[^.;]{0,80}(?:on-?site|septic|individual\s+sewage)[^.;]{0,180}|(?:minimum|not\s+less\s+than)[^.;]{0,60}(?:acre|square\s+feet)[^.;]{0,60}(?:septic|on-?site|sewage)[^.;]{0,140}/gi;

export interface SepticLaneInput {
  county: string | null;
  state: string | null;
  hasExistingSeptic: boolean;
  hasExistingWell: boolean;
  now: string;
}

/**
 * Find the onsite wastewater authority and what it requires of a division.
 *
 * The authority is nearly always county-level environmental health operating
 * under a state rule, so the lane looks for both and reports whichever it can
 * establish. It never infers feasibility from acreage or from soil maps.
 */
export async function researchSepticAuthority(input: SepticLaneInput, deps: AgencyLaneDeps = {}): Promise<SepticWellFramework> {
  const unresolved: string[] = [];

  let authority: ResolvedAuthority | null = null;
  let perLotApprovalRequired = unresolvedValue<boolean>('No onsite wastewater rule was read.');
  let divisionRequiresHealthReview = unresolvedValue<boolean>('No onsite wastewater rule was read.');
  let minimumAcreage = unresolvedValue<string>('No official minimum lot size for an onsite system was located.');
  let reserveFieldRequirement = unresolvedValue<string>('No reserve or replacement field requirement was located.');

  if (input.state) {
    const query = input.county
      ? `${input.county} ${stateName(input.state) ?? input.state} environmental health on-site sewage management septic permit lot requirements`
      : `${stateName(input.state) ?? input.state} on-site sewage management rules lot size septic permit`;
    const documents = await findAgencyDocuments(input.state, 'onsite_wastewater', query, deps);

    if (documents.length) {
      const citations: LegalSourceCitation[] = [];
      const collect = (pattern: RegExp, tier: LegalSourceCitation['tier']) => {
        for (const document of documents) {
          const hits = findProvisions(document.text, pattern, { maxMatches: 1 });
          if (!hits.length) continue;
          const citation = buildCitation({
            url: document.url, label: document.label, citation: hits[0].section, excerpt: hits[0].excerpt,
            format: 'html', tierHint: tier, retrievedAt: input.now,
          });
          citations.push(citation);
          return { excerpt: hits[0].excerpt, citation };
        }
        return null;
      };

      const perLot = collect(PER_LOT_PATTERN, 'health_or_septic_authority');
      const review = collect(HEALTH_REVIEW_PATTERN, 'health_or_septic_authority');
      const reserve = collect(RESERVE_FIELD_PATTERN, 'health_or_septic_authority');
      const acreage = collect(MIN_ACREAGE_PATTERN, 'health_or_septic_authority');

      if (perLot) perLotApprovalRequired = evidencedValue(true, [perLot.citation]);
      if (review) divisionRequiresHealthReview = evidencedValue(true, [review.citation]);
      if (reserve) reserveFieldRequirement = evidencedValue(boundExcerpt(reserve.excerpt)!, [reserve.citation]);
      if (acreage) minimumAcreage = evidencedValue(boundExcerpt(acreage.excerpt)!, [acreage.citation]);

      if (citations.length) {
        authority = {
          role: 'septic_health',
          name: evidencedValue(
            input.county ? `${input.county} environmental health / onsite sewage authority` : `${stateName(input.state) ?? input.state} onsite wastewater authority`,
            citations.slice(0, 2),
          ),
          unitType: 'special_district',
          relationship: 'Approves onsite sewage systems, which every lot without public sewer requires.',
          officialUrl: documents[0].url,
        };
      }
    }
  }

  if (!authority) unresolved.push('SEPTIC AUTHORITY UNRESOLVED — the body that approves onsite sewage systems for this parcel was not established.');
  if (perLotApprovalRequired.value == null) unresolved.push('Whether each new lot needs its own septic approval is not established.');
  if (minimumAcreage.value == null) unresolved.push('Whether an official minimum lot size applies to lots on onsite systems is not established.');
  if (reserveFieldRequirement.value == null) unresolved.push('Whether a reserve or replacement field must be shown is not established.');

  return {
    authority,
    perLotApprovalRequired,
    divisionRequiresHealthReview,
    minimumAcreageForOnsiteSystem: minimumAcreage,
    reserveFieldRequirement,
    existingSepticInfluence: input.hasExistingSeptic
      ? 'An existing septic system is reported on the property. Its location and its replacement area constrain where a retained lot boundary can go, and neither is surveyed.'
      : null,
    existingWellInfluence: input.hasExistingWell
      ? 'An existing well is reported on the property. Well separation distances constrain practical lot configuration, and the well location is not surveyed.'
      : null,
    unresolved,
    scopeNote: SEPTIC_SCOPE_NOTE,
  };
}

/* ─────────────────────── shared agency document lane ─────────────────── */

interface AgencyDocument { url: string; label: string; text: string }

/**
 * Locate readable documents from a state or county agency.
 *
 * Candidate hosts come from the formula first (cheap, no search engine) and a
 * bounded search second. Either way, only government hosts are read, and a
 * commercial explainer of the rule never enters the evidence set.
 */
async function findAgencyDocuments(
  state: string,
  agency: 'dot' | 'manufactured_housing' | 'onsite_wastewater',
  query: string,
  deps: AgencyLaneDeps,
): Promise<AgencyDocument[]> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const documents: AgencyDocument[] = [];
  const seen = new Set<string>();
  const budget = deps.maxRequests ?? 5;

  const read = async (url: string, label: string) => {
    if (documents.length >= budget || seen.has(url)) return;
    seen.add(url);
    if (!isGovernmentHost(url)) return;
    try {
      const response = await fetchText(url, { timeoutMs: 30_000 });
      if (response.blocked || response.status >= 400) return;
      const text = htmlToText(response.body);
      if (text.trim().length < 300) return;
      documents.push({ url, label, text });
    } catch {
      // Unreachable agency pages are simply absent from the evidence set.
    }
  };

  for (const host of deriveStateAgencyHostCandidates(state, agency).slice(0, 4)) {
    if (documents.length) break;
    await read(`https://${host}`, `${stateName(state) ?? state} ${agency.replace(/_/g, ' ')} authority`);
  }

  if (deps.allowWebSearch !== false && documents.length < budget) {
    try {
      const response = await fetchText(searchEngineUrl(query), { timeoutMs: 25_000 });
      if (!response.blocked && response.status < 400) {
        const links = unwrapSearchResults(
          extractLinks(response.body, response.url).map((link) => ({ text: link.label, href: link.url })),
        ).filter((link) => isGovernmentHost(link.href));
        const byHost = new Map<string, { text: string; href: string }>();
        for (const link of links) {
          const host = hostOf(link.href);
          if (!byHost.has(host)) byHost.set(host, link);
        }
        for (const link of [...byHost.values()].slice(0, budget)) {
          await read(link.href, link.text || `${stateName(state) ?? state} official source`);
        }
      }
    } catch {
      // A search outage reduces coverage; it never invents a source.
    }
  }

  return documents;
}
