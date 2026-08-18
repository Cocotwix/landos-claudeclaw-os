// LandOS — wiring the post-resolution intelligence lanes to live transports.
//
// The mission definition declares WHAT the Property Backstory and Subdivision
// lanes must deliver. This is the only place that decides HOW: which search
// transport, which HTTP reader, which GIS discovery. Keeping that here means
// the lanes stay unit-testable with injected fakes, and the route layer stays
// a handful of lines instead of a second research system.
//
// Transport policy, and it is deliberately narrow:
//   • Governed keyless search (`createHermesFreeSearch`), the same capability
//     the Universal Resolver's indexed-web lane uses. No key, no credit, no
//     browser, and the query travels on stdin rather than argv.
//   • Ordinary bounded HTTPS for government pages (`defaultGovFetchText`) and
//     the existing bounded PDF reader for documents.
//   • Direct ArcGIS REST for the zoning layer. A browser is escalation, and
//     nothing here needs it.
//
// No paid API. No LandPortal action. No credential is read, and none can reach
// the search child process — `hermes-free-search.ts` hands it a minimal env.

import { readResolverSubject, retainedLandPortalIdentity } from './universal-property-resolution.js';
import { createHermesFreeSearch } from './hermes-free-search.js';
import { defaultGovFetchText } from './gis-transport.js';
import { loadPropertyInspection } from './property-card.js';
import { buildParcelFactSheet } from './landportal-facts.js';
import { resolveJurisdiction, type JurisdictionResolution } from './jurisdiction-resolution.js';
import { readDocumentIntelligence } from './official-document-intelligence-store.js';
import { documentUrlIdentity } from './document-url-identity.js';
import { runPropertyBackstory } from './property-backstory-run.js';
import { discoverZoningLayers } from './zoning-layer-discovery.js';
import {
  resolveControllingLandUseAuthority,
  type ControllingLandUseAuthority,
} from './controlling-land-use-authority.js';
import { attachHistoricalZoning, determineCurrentZoning, type CurrentZoningDetermination } from './current-zoning-determination.js';
import { researchZoningStandards } from './zoning-standards-research.js';
import { retrieveSubdivisionRegulations, type SubdivisionRegulations } from './subdivision-regulations.js';
import { buildPropertySubdivisionRead, type PropertySubdivisionRead } from './subdivision-property-read.js';
import {
  persistControllingAuthority,
  persistCurrentZoning,
  persistPropertySubdivisionRead,
  persistSubdivisionRegulations,
  persistZoningStandards,
  readSubdivisionRegulations,
  readSubdivisionRegulationsHistory,
} from './land-use-intelligence-store.js';
import {
  readRegulationDocuments,
  saveRegulationDocuments,
  type RegulationJurisdiction,
} from './regulation-document-store.js';
import { logger } from '../logger.js';
import type { DealIntelligenceCapabilities, EnvironmentalHandback, UtilitiesAccessHandback } from './deal-intelligence-mission.js';
import type { PropertyBackstory } from './property-backstory.js';
import type { SubjectQueryFacts } from './land-use-lanes.js';

/** Bounds. Every lane runs beside the rest of the mission, so it stays small. */
const BACKSTORY_BUDGET = { maxQueries: 5, maxDocuments: 3, timeoutMs: 25_000 } as const;
const AUTHORITY_BUDGET = { maxQueries: 4, maxPages: 5, timeoutMs: 20_000 } as const;
const ZONING_BUDGET = { maxPages: 4, timeoutMs: 20_000 } as const;
const SUBDIVISION_BUDGET = { maxQueries: 6, maxDocuments: 4, timeoutMs: 25_000 } as const;
const STANDARDS_BUDGET = { maxSources: 4, timeoutMs: 25_000 } as const;

/** Government sources LandOS already has for this card. Discovery starts here. */
function knownSourceUrls(dealCardId: number): string[] {
  try {
    return [...new Set(readDocumentIntelligence(dealCardId).documents.map((document) => document.sourceUrl).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * The retained official documents, reassembled as text per document.
 *
 * The store keeps each finding's own passage rather than the whole PDF, which
 * is exactly what is wanted here: those passages are already anchored to this
 * parcel, and they are where a government states its jurisdiction over it.
 */
function retainedDocuments(dealCardId: number): Array<{ text: string; sourceUrl: string | null; sourceTitle: string | null }> {
  try {
    const stored = readDocumentIntelligence(dealCardId);
    const byDocument = new Map<string, { text: string[]; sourceUrl: string | null; sourceTitle: string | null }>();
    for (const finding of stored.findings) {
      const key = finding.documentKey || finding.sourceUrl || 'unknown';
      const entry = byDocument.get(key) ?? { text: [], sourceUrl: finding.sourceUrl, sourceTitle: finding.sourceTitle };
      entry.text.push(finding.context);
      byDocument.set(key, entry);
    }
    for (const summary of stored.summaries) {
      const entry = byDocument.get(summary.documentKey);
      if (entry) entry.text.push(summary.detailedSummary);
    }
    return [...byDocument.values()].map((entry) => ({
      text: entry.text.join('\n'),
      sourceUrl: entry.sourceUrl,
      sourceTitle: entry.sourceTitle,
    }));
  } catch {
    return [];
  }
}

/** Read the confirmed subject once. It is a SELECT; nothing is rediscovered. */
function subjectFor(dealCardId: number): ReturnType<typeof readResolverSubject> {
  try {
    return readResolverSubject(dealCardId);
  } catch {
    return null;
  }
}

/**
 * The Property Backstory capability.
 *
 * Reads retained document intelligence first and expands only past it. The
 * `alwaysExpand` default is deliberately OFF: a card whose resolver already
 * mined the planning packet gets its backstory from a SELECT.
 */
export function livePropertyBackstoryCapability(): NonNullable<DealIntelligenceCapabilities['propertyBackstory']> {
  return async ({ dealCardId, identity }): Promise<PropertyBackstory> => runPropertyBackstoryForDeal(dealCardId, {
    apn: identity.apn,
    owner: identity.owner,
    address: identity.address,
    city: identity.identity.city,
    county: identity.county,
    state: identity.state,
    acres: identity.acres,
  });
}

/** Subject facts a caller may already hold. Every one is optional. */
export interface BackstoryIdentityOverrides {
  apn?: string | null;
  owner?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  acres?: number | null;
}

/**
 * The bounded Property Backstory lane for one Deal Card, wired to its live
 * transports.
 *
 * This is the ONE place the lane is launched. New Lead reaches it through
 * `livePropertyBackstoryCapability()`; Tools and the Deal Card reach it through
 * the Property Development History Capability. All three run this function, so
 * no surface can hold a second history implementation.
 *
 * The confirmed subject is the resolver's own, and any override a caller
 * already holds is only ever preferred over it — never invented.
 */
export async function runPropertyBackstoryForDeal(
  dealCardId: number,
  overrides: BackstoryIdentityOverrides = {},
): Promise<PropertyBackstory> {
  const resolved = subjectFor(dealCardId);
  let projectName: string | null = null;
  try {
    projectName = readDocumentIntelligence(dealCardId).findings
      .find((finding) => finding.category === 'project_name' && finding.value)?.value ?? null;
  } catch { /* retained intelligence is optional here */ }
  return runPropertyBackstory(
    {
      dealCardId,
      apn: overrides.apn ?? resolved?.apn ?? null,
      parcelNotation: resolved?.notations[0]?.raw ?? null,
      parcelNotations: resolved?.notations ?? [],
      owner: overrides.owner ?? resolved?.owner ?? null,
      address: overrides.address ?? resolved?.address ?? null,
      city: overrides.city ?? resolved?.city ?? null,
      county: overrides.county ?? resolved?.county ?? null,
      state: overrides.state ?? resolved?.state ?? null,
      acres: overrides.acres ?? resolved?.acres ?? null,
      projectName,
      knownSourceUrls: knownSourceUrls(dealCardId),
    },
    {
      search: createHermesFreeSearch(),
      ...BACKSTORY_BUDGET,
    },
  );
}

/**
 * The subject's own existing road frontage, when LandOS already retains it.
 *
 * A screening figure only, from the retained LandPortal parcel record — never
 * a survey. This is the only source `buildPropertySubdivisionRead` is offered:
 * without it, the frontage ceiling stays UNKNOWN and "measure the frontage"
 * lands on the diligence list, silently dropping the constraint that most
 * often decides lot yield.
 */
function subjectFrontageFeet(propertyCardId: number | null): { feet: number | null; basis: string | null } {
  if (propertyCardId == null) return { feet: null, basis: null };
  try {
    const inspection = loadPropertyInspection(propertyCardId);
    if (!inspection) return { feet: null, basis: null };
    const feet = buildParcelFactSheet(inspection.parcelFacts).access.roadFrontageFt;
    return feet != null
      ? { feet, basis: 'LandPortal parcel record (screening; legal frontage not established)' }
      : { feet: null, basis: null };
  } catch {
    return { feet: null, basis: null };
  }
}

/** Hosts LandOS has established as this parcel's government. */
function officialHostsFor(dealCardId: number): string[] {
  return [...new Set(knownSourceUrls(dealCardId)
    .map((url) => { try { return new URL(url).hostname; } catch { return ''; } })
    .filter(Boolean))];
}

/**
 * Everything the CONFIRMED subject can put into a search query.
 *
 * The canonical LandPortal spelling of the APN is included alongside the local
 * one because a county indexes its records under one and the provider under the
 * other, and a query with only one of them misses half the record.
 */
function subjectQueryFacts(
  dealCardId: number,
  input: { apn: string | null; address: string | null; city: string | null; county: string | null; state: string | null; owner: string | null; hosts: readonly string[] },
): Partial<SubjectQueryFacts> {
  const resolved = subjectFor(dealCardId);
  const notation = resolved?.notations[0] ?? null;
  const canonical = retainedLandPortalIdentity(resolved?.propertyCardId ?? null);
  let projectName: string | null = null;
  let road: string | null = null;
  try {
    const stored = readDocumentIntelligence(dealCardId);
    projectName = stored.findings.find((finding) => finding.category === 'project_name' && finding.value)?.value ?? null;
  } catch { /* storage is optional here */ }
  // A road name is only useful when the lead actually carries one; a parcel
  // notation in the address field is not a road.
  if (input.address && !/map|parcel/i.test(input.address) && /[A-Za-z]{3}/.test(input.address)) {
    road = input.address;
  }
  return {
    apn: input.apn,
    canonicalApn: canonical?.apn ?? null,
    parcelNotation: notation?.raw ?? null,
    notationParts: {
      map: notation?.parts.find((part) => part.label === 'map')?.value ?? null,
      parcel: notation?.parts.find((part) => part.label === 'parcel')?.value ?? null,
    },
    owner: input.owner,
    projectName,
    address: input.address,
    road,
    municipality: input.city,
    county: input.county,
    state: input.state,
    officialHosts: input.hosts,
  };
}

/** Census geography for the authority record. Provenance only, never authority. */
async function geographyFor(input: { city: string | null; county: string | null; state: string | null }): Promise<JurisdictionResolution | null> {
  if (!input.state) return null;
  try {
    return await resolveJurisdiction({ locality: input.city, county: input.county, state: input.state }, { timeoutMs: 15_000 });
  } catch {
    return null;
  }
}

/** Subject facts a caller may already hold for the authority + zoning lane. Every one is optional. */
export interface LandUseAuthorityZoningOverrides {
  apn?: string | null;
  owner?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
}

/**
 * The authority + current-zoning lane for one Deal Card, wired to its live
 * transports.
 *
 * This is the ONE place the lane is launched from a plain `dealCardId`. New
 * Lead reaches it through `liveLandUseAuthorityAndZoningCapability()`; the
 * Deal Card's own re-research reaches it directly, exactly the pattern
 * `runPropertyBackstoryForDeal` already uses for the backstory lane. Neither
 * caller holds a second copy of the authority race, the zoning-layer
 * discovery, or the current-zoning source race with its browser-escalation
 * lane — all of that lives here, once.
 *
 * The zoning-layer discovery runs CONCURRENTLY with the authority resolution:
 * finding the county's ArcGIS zoning layer does not depend on knowing who
 * administers zoning, and serializing them would add a full discovery sweep to
 * a required lane's wall clock for nothing.
 */
export async function runLandUseAuthorityAndZoningForDeal(
  dealCardId: number,
  overrides: LandUseAuthorityZoningOverrides = {},
): Promise<{
  authority: ControllingLandUseAuthority;
  zoning: CurrentZoningDetermination;
  zoningStandards: Awaited<ReturnType<typeof researchZoningStandards>> | null;
}> {
    const resolved = subjectFor(dealCardId);
    const city = overrides.city ?? resolved?.city ?? null;
    const county = overrides.county ?? resolved?.county ?? null;
    const state = overrides.state ?? resolved?.state ?? null;
    const apn = overrides.apn ?? resolved?.apn ?? null;
    const address = overrides.address ?? resolved?.address ?? null;
    const owner = overrides.owner ?? resolved?.owner ?? null;
    const search = createHermesFreeSearch();
    const known = knownSourceUrls(dealCardId);
    const hosts = officialHostsFor(dealCardId);
    const retained = retainedDocuments(dealCardId);
    const facts = subjectQueryFacts(dealCardId, { apn, address, city, county, state, owner, hosts });

    // Geography and the zoning-layer discovery run beside the authority race.
    // None of the three needs another's answer, and serializing them would add
    // two full sweeps to a required lane's wall clock for nothing.
    const [geography, authority, layers] = await Promise.all([
      geographyFor({ city, county, state }),
      resolveControllingLandUseAuthority(
        { dealCardId, municipality: city, county, state, apn, address },
        {
          retainedDocuments: retained,
          search,
          fetchText: defaultGovFetchText,
          knownSourceUrls: known,
          ...AUTHORITY_BUDGET,
        },
      ),
      discoverZoningLayers({ county, state, city }, {}).catch(() => ({ queries: [], notes: ['Zoning layer discovery failed.'] })),
    ]);

    // Geography is attached AFTER the assignment, so it can never have
    // participated in it. That ordering is the invariant, stated in code.
    const withGeography: ControllingLandUseAuthority = {
      ...authority,
      geographyEvidence: geography
        ? {
            locality: geography.locality,
            localityKind: geography.localityKind,
            county: geography.county,
            countyFips: geography.countyFips,
            state: geography.state,
            stateFips: geography.stateFips,
            sourceLabel: 'U.S. Census Bureau TIGERweb geographic services',
            neverEstablishesLandUseAuthority: true,
          }
        : authority.geographyEvidence,
    };

    const zoning = attachHistoricalZoning(
      await determineCurrentZoning(
        { dealCardId, apn, address, municipality: city, county, state, point: null, queryFacts: facts },
        withGeography.zoningAuthority,
        {
          gisQueries: layers.queries.map((query) => ({ ...query, apn })),
          search,
          fetchText: defaultGovFetchText,
          knownSourceUrls: known,
          retainedSources: retained.map((row) => ({ url: row.sourceUrl, title: row.sourceTitle, text: row.text })),
          ...ZONING_BUDGET,
        },
      ),
      [],
    );

    // Allowed uses and dimensional standards, but ONLY once the district is
    // established. Without it there is nothing to look up, and looking anyway
    // returns whichever district the ordinance printed first.
    // When the district is unresolved, offer the HISTORICAL district for
    // context: the seller call is better served by "here is what R-20 POD
    // actually requires, and we could not confirm the parcel is still in it"
    // than by silence. `contextOnly` keeps it out of every conclusion.
    const contextDistrict = zoning.established
      ? null
      : zoning.historicalReferences.find((row) => row.value)?.value ?? null;
    const zoningStandards = await researchZoningStandards(
      { dealCardId, municipality: city, county, state, officialHosts: hosts, queryFacts: facts },
      zoning,
      withGeography.zoningAuthority,
      {
        search,
        fetchText: defaultGovFetchText,
        retainedSources: retained.map((row) => ({ url: row.sourceUrl, title: row.sourceTitle, text: row.text })),
        knownSourceUrls: known,
        contextDistrict,
        ...STANDARDS_BUDGET,
      },
    ).catch(() => null);

    persistControllingAuthority({ authority: withGeography });
    persistCurrentZoning({ zoning });
    if (zoningStandards) persistZoningStandards({ standards: zoningStandards });
    logger.info({
      dealCardId,
      zoningAuthority: withGeography.zoningAuthority.determination,
      subdivisionAuthority: withGeography.subdivisionAuthority.determination,
      zoningEstablished: zoning.established,
      zoningLayers: layers.queries.length,
      authorityWonBy: withGeography.race?.winningMethod ?? null,
      authorityReleasedAtMs: withGeography.race?.releasedAtMs ?? null,
      zoningWonBy: zoning.race?.winningMethod ?? null,
      zoningReleasedAtMs: zoning.race?.releasedAtMs ?? null,
      standardsEstablished: zoningStandards?.established ?? false,
    }, 'land_use_authority_and_zoning_completed');
    return { authority: withGeography, zoning, zoningStandards };
}

/**
 * New Lead's own wiring for the authority + current-zoning capability: adapts
 * the mission's `SubjectResearchHandback` into the plain overrides
 * `runLandUseAuthorityAndZoningForDeal` takes, and runs nothing else.
 */
export function liveLandUseAuthorityAndZoningCapability(): NonNullable<DealIntelligenceCapabilities['landUseAuthorityAndZoning']> {
  return ({ dealCardId, identity }) => runLandUseAuthorityAndZoningForDeal(dealCardId, {
    apn: identity.apn, owner: identity.owner, address: identity.address,
    city: identity.identity.city, county: identity.county, state: identity.state,
  });
}

// ── The retained regulation set ─────────────────────────────────────────────
//
// A jurisdiction's adopted subdivision regulations do not change between two
// runs on the same parcel, but a keyless web search's idea of them does. These
// four helpers are the whole retention seam: identify the government, read what
// it is known to publish, offer that to the retrieval, and record what was
// actually read.

type RetainedRegulationDocuments = SubdivisionRegulations['documents'];

/** The government whose regulation set this is, or null when unresolved. */
function subdivisionRegulationJurisdiction(
  authority: ControllingLandUseAuthority['subdivisionAuthority'] | null,
  state: string | null,
): RegulationJurisdiction | null {
  if (!authority?.name || !state) return null;
  // An unresolved or ambiguous authority names no government, and a set filed
  // against the wrong government would be served to the wrong parcels.
  if (authority.determination === 'unresolved' || authority.determination === 'ambiguous') return null;
  return { authorityName: authority.name, level: authority.level, state };
}

function retainedRegulationSet(jurisdiction: RegulationJurisdiction | null): RetainedRegulationDocuments {
  if (!jurisdiction) return [];
  try {
    return readRegulationDocuments(jurisdiction).map((row) => ({
      label: row.label,
      url: row.url,
      tier: 'official_government_source' as const,
      adoptedOrAsOf: row.adoptedOrAsOf,
      draftOrProposed: row.draftOrProposed,
      retrievedAt: new Date(row.lastVerifiedAt * 1_000).toISOString(),
    }));
  } catch {
    return [];
  }
}

/**
 * The jurisdiction's set first, then anything this card alone knows about.
 *
 * Compared by document identity, not by URL text: a card that learned a
 * document under one of a site's two addresses must not add a second copy of a
 * document the jurisdiction's set already holds under the other.
 */
function mergeRetainedDocuments(
  set: RetainedRegulationDocuments,
  prior: RetainedRegulationDocuments,
): RetainedRegulationDocuments {
  const out: RetainedRegulationDocuments = [];
  const held = new Set<string>();
  for (const document of [...set, ...prior]) {
    const identity = documentUrlIdentity(document.url);
    if (!identity || held.has(identity)) continue;
    held.add(identity);
    out.push(document);
  }
  return out;
}

/**
 * The last rule set this card actually held, current or not.
 *
 * A run that reached nothing writes a current snapshot with no document in it.
 * Starting the next run from that snapshot would make one bad retrieval
 * permanent, so the most recent set that carried documents is what is offered
 * back to the retrieval.
 */
function readSubdivisionRegulationsSafely(dealCardId: number): SubdivisionRegulations | null {
  try {
    const current = readSubdivisionRegulations(dealCardId);
    if (current?.documents.length) return current;
    const prior = readSubdivisionRegulationsHistory(dealCardId)
      .filter((row) => row.documents.length)
      .pop();
    return prior ?? current;
  } catch {
    return null;
  }
}

/**
 * Record what this run actually opened and read as this government's own.
 *
 * Official documents only: a secondary source is a pointer, and re-serving one
 * as the jurisdiction's adopted regulations is exactly the mistake retention
 * would otherwise make permanent.
 */
function rememberRegulationSet(
  jurisdiction: RegulationJurisdiction | null,
  regulations: SubdivisionRegulations,
): number {
  if (!jurisdiction) return 0;
  const ruleCounts = new Map<string, number>();
  for (const rule of regulations.rules) {
    if (!rule.sourceUrl) continue;
    ruleCounts.set(rule.sourceUrl, (ruleCounts.get(rule.sourceUrl) ?? 0) + 1);
  }
  try {
    return saveRegulationDocuments(
      jurisdiction,
      regulations.documents
        .filter((document) => document.url && document.tier === 'official_government_source')
        .map((document) => ({
          url: document.url as string,
          label: document.label,
          adoptedOrAsOf: document.adoptedOrAsOf,
          draftOrProposed: document.draftOrProposed,
          ruleCount: ruleCounts.get(document.url as string) ?? 0,
        })),
    );
  } catch {
    return 0;
  }
}

/** Subject facts a caller may already hold for the subdivision lane. Every one is optional. */
export interface SubdivisionIntelligenceOverrides {
  apn?: string | null;
  owner?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  acres?: number | null;
}

/** What the zoning lane and the other mission lanes already established, when they ran. */
export interface SubdivisionIntelligenceContext {
  authority: ControllingLandUseAuthority | null;
  zoning: CurrentZoningDetermination | null;
  backstory: PropertyBackstory | null;
  environmental?: EnvironmentalHandback | null;
  access?: UtilitiesAccessHandback | null;
}

/**
 * The subdivision lane for one Deal Card, wired to its live transports.
 *
 * Consumes the authority the zoning lane established rather than resolving it
 * again, which is the whole reason the two are separate lanes with an `awaits`
 * edge instead of one long serial chain. This is the ONE place the lane is
 * launched from a plain `dealCardId`, mirroring `runLandUseAuthorityAndZoningForDeal`.
 */
export async function runSubdivisionIntelligenceForDeal(
  dealCardId: number,
  overrides: SubdivisionIntelligenceOverrides = {},
  context: SubdivisionIntelligenceContext,
): Promise<{ regulations: SubdivisionRegulations; propertyRead: PropertySubdivisionRead }> {
    const { authority, zoning, backstory, environmental, access } = context;
    const resolved = subjectFor(dealCardId);
    const city = overrides.city ?? resolved?.city ?? null;
    const county = overrides.county ?? resolved?.county ?? null;
    const state = overrides.state ?? resolved?.state ?? null;
    const apn = overrides.apn ?? resolved?.apn ?? null;
    const address = overrides.address ?? resolved?.address ?? null;
    const owner = overrides.owner ?? resolved?.owner ?? null;
    const acres = overrides.acres ?? resolved?.acres ?? null;

    // The regulation SET belongs to the government, so it is remembered against
    // the government. Once the controlling subdivision authority is
    // established, the documents it publishes are fetched directly instead of
    // being rediscovered by a search that returns a different slice each run.
    const regulationJurisdiction = subdivisionRegulationJurisdiction(authority?.subdivisionAuthority ?? null, state);
    const retainedSet = retainedRegulationSet(regulationJurisdiction);
    const priorRegulations = readSubdivisionRegulationsSafely(dealCardId);

    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId, municipality: city, county, state },
      authority?.subdivisionAuthority ?? null,
      {
        // The jurisdiction's own set first, then whatever this card already
        // knows about. A prior run's documents count as known even when the
        // authority was not established at the time.
        retainedDocuments: mergeRetainedDocuments(retainedSet, priorRegulations?.documents ?? []),
        retainedRules: priorRegulations?.rules ?? [],
        // The government's own domain, established by the documents the
        // resolver already retrieved from it.
        preferredHosts: officialHostsFor(dealCardId),
        queryFacts: subjectQueryFacts(dealCardId, {
          apn, address, city, county, state, owner,
          hosts: officialHostsFor(dealCardId),
        }),
        knownDocumentUrls: knownSourceUrls(dealCardId),
        search: createHermesFreeSearch(),
        fetchText: defaultGovFetchText,
        ...SUBDIVISION_BUDGET,
      },
    );

    // The subject's own existing road frontage — the screening figure that
    // decides whether existing frontage already supports the by-right ceiling
    // or whether it is the limiting factor. Read once, here, so a private-road
    // concept is never raised ahead of this existing-frontage screen.
    const frontage = subjectFrontageFeet(resolved?.propertyCardId ?? null);

    const propertyRead = buildPropertySubdivisionRead({
      dealCardId,
      acres,
      roadFrontageFeet: frontage.feet,
      roadFrontageBasis: frontage.basis,
      accessStatus: access?.accessStatus ?? null,
      environmentalConstraints: environmental?.constraints ?? [],
      utilitiesKnown: access?.utilitiesKnown ?? null,
      utilitiesSummary: access?.utilitiesSummary ?? null,
      zoning: zoning ?? null,
      regulations,
      backstory: backstory ?? null,
    });

    persistSubdivisionRegulations({ regulations });
    persistPropertySubdivisionRead({ read: propertyRead });
    // Learned, so the next run on this jurisdiction opens the same set.
    const learned = rememberRegulationSet(regulationJurisdiction, regulations);
    logger.info({
      dealCardId,
      ruleCount: regulations.rules.length,
      documents: regulations.documents.length,
      retainedDocumentsOffered: retainedSet.length,
      regulationDocumentsLearned: learned,
      roadFrontageFeet: frontage.feet,
      likelyPath: propertyRead.likelyPath.kind,
      theoreticalLots: propertyRead.theoreticalLotCount.value,
    }, 'subdivision_intelligence_completed');
    return { regulations, propertyRead };
}

/**
 * New Lead's own wiring for the subdivision capability: adapts the mission's
 * `SubjectResearchHandback` and its sibling lane handbacks into the plain
 * overrides and context `runSubdivisionIntelligenceForDeal` takes.
 */
export function liveSubdivisionIntelligenceCapability(): NonNullable<DealIntelligenceCapabilities['subdivisionIntelligence']> {
  return ({ dealCardId, identity, authority, zoning, backstory, environmental, access }) =>
    runSubdivisionIntelligenceForDeal(
      dealCardId,
      {
        apn: identity.apn, owner: identity.owner, address: identity.address,
        city: identity.identity.city, county: identity.county, state: identity.state,
        acres: identity.acres,
      },
      { authority, zoning, backstory, environmental, access },
    );
}

/**
 * The three capabilities, ready to spread into `DealIntelligenceCapabilities`.
 *
 * `Required` rather than `Pick`: all three are always wired here, and saying so
 * in the type is what lets a caller compose them without a null check that
 * could only ever be dead code.
 */
export function livePostResolutionCapabilities(): Required<Pick<
  DealIntelligenceCapabilities,
  'propertyBackstory' | 'landUseAuthorityAndZoning' | 'subdivisionIntelligence'
>> {
  return {
    propertyBackstory: livePropertyBackstoryCapability(),
    landUseAuthorityAndZoning: liveLandUseAuthorityAndZoningCapability(),
    subdivisionIntelligence: liveSubdivisionIntelligenceCapability(),
  };
}
