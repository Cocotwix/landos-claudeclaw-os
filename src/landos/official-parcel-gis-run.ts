// LandOS — official parcel / GIS ORCHESTRATOR.
//
// One entry point per property. It gathers candidate official sources, works
// out what platform each one is, runs the adapter that already handles that
// platform, reconciles the answer against the identity LandOS holds, and falls
// back cleanly to another official source when one cannot answer.
//
// Escalation order, enforced by the ladder rather than by hope:
//
//   structured service → embedded page data → rendered DOM
//     → background browser → interactive map (last, and tightly capped)
//
// The interactive map is an evidence source, not the objective. If authoritative
// parcel evidence is obtainable from the underlying service or from a different
// official page, LandOS takes that and never touches the map.

import { probeArcgisServicesRoot } from './arcgis-service-discovery.js';
import { runArcgisAdapter, type ArcgisSeed } from './arcgis-adapter.js';
import { runSchneiderAdapter, type SchneiderDeployment } from './schneider-adapter.js';
import { runTylerAdapter } from './tyler-adapter.js';
import { arcgisSeedsFromInspection, inspectUnknownGovernmentSite } from './gis-generic-fallback.js';
import { EscalationLadder, type EscalationBudget, type EscalationReport } from './gis-escalation.js';
import { fingerprintPlatform } from './gis-platform-fingerprint.js';
import { CountyCapabilityRegistry } from './county-capability-registry.js';
import { findCountyGis } from './county-gis-capabilities.js';
import { getCountySources } from './county-source-map.js';
import { statewideParcelServiceFor } from './statewide-parcel-services.js';
import {
  deploymentHost,
  getOfficialParcelGis,
  listDeploymentKnowledge,
  recordPlatformProof,
  rememberDeployment,
  saveOfficialParcelGis,
  type OfficialParcelGisRecord,
} from './gis-platform-knowledge.js';
import { defaultGovFetchText, readJsonBody, type GovFetchText } from './gis-transport.js';
import { createBackgroundBrowserFetchText, withBrowserFallback } from './gov-browser-transport.js';
import { AccessSignalCollector, withAccessSignals } from './public-record-access-transport.js';
import { PublicRecordAccessStore } from './public-record-access-store.js';
import {
  classifyDiscoveredSource,
  discoverOfficialSource,
  type OfficialSourceDiscoveryResult,
} from './official-source-discovery.js';
import { parseSchneiderDirectory, findSchneiderDeployment, SCHNEIDER_DIRECTORY_PATH, SCHNEIDER_PRIMARY_HOST } from './schneider-adapter.js';
import {
  type GisPlatformFamily,
  type NormalizedParcelSearchInput,
  type OfficialParcelGisResult,
  type PlatformFingerprint,
  type PublicRecordAccessHandoff,
  type ZoningResearchHandoff,
} from './gis-platform-types.js';
import { accessCapabilities } from './public-record-access.js';
import { SqliteGovernmentAccountRepository } from './government-account-manager.js';
import { logger } from '../logger.js';

/* ─────────────────────────────── subject ─────────────────────────────── */

export interface OfficialParcelGisSubject extends NormalizedParcelSearchInput {
  dealCardId: number;
}

export const SEED_ORIGINS = [
  'operator_supplied',
  'learned_deployment',
  'county_gis_registry',
  'county_capability',
  'county_source_map',
  'statewide_service',
  'context_probe',
  'discovered_official_source',
] as const;
export type SeedOrigin = (typeof SEED_ORIGINS)[number];

export interface SourceSeed {
  url: string;
  label: string;
  origin: SeedOrigin;
  /** Lower is tried first. */
  priority: number;
}

export interface OfficialParcelGisDeps {
  budget?: Partial<EscalationBudget>;
  now?: () => string;
  /** Browser-class transport, required for edge-protected vendor portals. */
  fetchText?: GovFetchText;
  /** Injected so tests never touch the network or the ArcGIS transport. */
  arcgisFetch?: Parameters<typeof runArcgisAdapter>[1] extends infer D ? (D extends { fetch?: infer F } ? F : never) : never;
  loadSchneiderDirectory?: () => Promise<SchneiderDeployment[]>;
  /** Extra official URLs supplied by the caller. */
  operatorSeeds?: Array<{ url: string; label: string }>;
  /** Overridden in tests. */
  countyRegistry?: CountyCapabilityRegistry;
  /** Disable automatic discovery (tests, or an offline run). */
  allowDiscovery?: boolean;
  /** Disable the public-search discovery lane specifically. */
  allowWebSearch?: boolean;
  /** Injected so a test can read what the run learned about portal access. */
  accessSignals?: AccessSignalCollector;
  /** Overridden in tests so access learning never touches the live database. */
  accessStore?: PublicRecordAccessStore;
}

/**
 * The transport every non-ArcGIS lane uses: a plain request first, escalating
 * to a background Chrome tab only when the edge refuses the client outright.
 * Built once per run so one blocked host does not re-open a session per call.
 */
function buildTransport(deps: OfficialParcelGisDeps): GovFetchText {
  if (deps.fetchText) return deps.fetchText;
  return withBrowserFallback(defaultGovFetchText, createBackgroundBrowserFetchText());
}

/**
 * The vendor directory lookup, read through the same transport. The directory
 * is PLATFORM knowledge — identical for every property — so a failure here is
 * a note, never a reason to stop.
 */
function schneiderDirectoryLookup(fetchText: GovFetchText) {
  return async (county: string | undefined, state: string | undefined): Promise<{ url: string; label: string } | null> => {
    const response = await fetchText(`https://${SCHNEIDER_PRIMARY_HOST}${SCHNEIDER_DIRECTORY_PATH}`, { timeoutMs: 45_000 });
    // The same endpoint arrives raw over a direct request and <pre>-wrapped
    // through a browser, so the body is read rather than pattern-matched.
    const payload = response.blocked ? null : readJsonBody(response.body);
    if (!payload) return null;
    const deployments = parseSchneiderDirectory(payload);
    const match = findSchneiderDeployment(deployments, county, state);
    if (!match?.searchUrl) return null;
    return { url: match.searchUrl, label: `${match.displayName} property search` };
  };
}

/* ───────────────────────── official source seeds ─────────────────────── */

function pushSeed(into: SourceSeed[], seed: SourceSeed): void {
  const url = seed.url?.trim();
  if (!url || !/^https?:/i.test(url)) return;
  if (into.some((existing) => existing.url === url)) return;
  into.push({ ...seed, url });
}

/**
 * Gather every official source LandOS already knows for this subject, best
 * first. Nothing here is county-specific code: each entry is a lookup in a
 * registry that any county can populate.
 */
export function collectOfficialSourceSeeds(
  subject: OfficialParcelGisSubject,
  deps: OfficialParcelGisDeps = {},
): SourceSeed[] {
  const seeds: SourceSeed[] = [];

  for (const supplied of deps.operatorSeeds ?? []) {
    pushSeed(seeds, { url: supplied.url, label: supplied.label, origin: 'operator_supplied', priority: 0 });
  }

  // Already-learned deployments that serve this county. This is the payoff of
  // platform-level memory: the second property in a county costs no discovery.
  const countyToken = (subject.county ?? '').replace(/\s*county\s*$/i, '').trim().toLowerCase();
  if (countyToken) {
    for (const deployment of listDeploymentKnowledge()) {
      if (!deployment.servesLabel || !deployment.servesLabel.toLowerCase().includes(countyToken)) continue;
      if (deployment.parcelLayerUrl) {
        pushSeed(seeds, { url: deployment.parcelLayerUrl, label: `Learned parcel layer on ${deployment.host}`, origin: 'learned_deployment', priority: 1 });
      }
      for (const service of deployment.services.slice(0, 4)) {
        pushSeed(seeds, { url: service, label: `Learned service on ${deployment.host}`, origin: 'learned_deployment', priority: 2 });
      }
    }
  }

  // The in-repo county GIS capability registry.
  const countyGis = findCountyGis(subject.county, subject.state);
  if (countyGis) {
    if (countyGis.layers.parcels) pushSeed(seeds, { url: countyGis.layers.parcels, label: `${countyGis.countyLabel} parcel layer`, origin: 'county_gis_registry', priority: 1 });
    if (countyGis.layers.zoning) pushSeed(seeds, { url: countyGis.layers.zoning, label: `${countyGis.countyLabel} zoning layer`, origin: 'county_gis_registry', priority: 3 });
    if (countyGis.mapViewerUrl) pushSeed(seeds, { url: countyGis.mapViewerUrl, label: `${countyGis.countyLabel} map viewer`, origin: 'county_gis_registry', priority: 5 });
    if (countyGis.assessorSearchUrl) pushSeed(seeds, { url: countyGis.assessorSearchUrl, label: `${countyGis.countyLabel} assessor search`, origin: 'county_gis_registry', priority: 5 });
  }

  // The learned county capability rows.
  if (subject.state && subject.county) {
    try {
      const registry = deps.countyRegistry ?? new CountyCapabilityRegistry();
      const capability = registry.get(subject.state, subject.county);
      if (capability) {
        if (capability.officialGisUrl) pushSeed(seeds, { url: capability.officialGisUrl, label: 'County official GIS', origin: 'county_capability', priority: 4 });
        if (capability.assessorUrl) pushSeed(seeds, { url: capability.assessorUrl, label: 'County assessor', origin: 'county_capability', priority: 6 });
        if (capability.planningZoningUrl) pushSeed(seeds, { url: capability.planningZoningUrl, label: 'County planning and zoning', origin: 'county_capability', priority: 7 });
      }
    } catch {
      // A missing registry must not stop the run; other seeds still apply.
    }

    try {
      const sourceMap = getCountySources(subject.state, subject.county);
      for (const link of sourceMap?.sources ?? []) {
        if (!['gis', 'assessor', 'appraiser', 'planning'].includes(String(link.type))) continue;
        pushSeed(seeds, { url: link.url, label: `County ${link.type} source`, origin: 'county_source_map', priority: 6 });
      }
    } catch {
      // Same: cached routing is a convenience, not a dependency.
    }
  }

  // The statewide official service. Last by priority but never omitted: it is
  // what keeps a county with no usable GIS from becoming a dead end.
  const statewide = statewideParcelServiceFor(subject.state);
  if (statewide) {
    pushSeed(seeds, { url: statewide.layerUrl, label: `${statewide.publisher} statewide parcels`, origin: 'statewide_service', priority: 8 });
  }

  return seeds.sort((a, b) => a.priority - b.priority);
}

/**
 * Hostnames a county's GIS server is conventionally published under, derived
 * from the county and state names.
 *
 * This is a FORMULA, not a list of counties: nothing here names a jurisdiction,
 * and adding a county requires no code. It will not find every county — a
 * server behind an abbreviation or an unrelated domain is undiscoverable this
 * way, and that is exactly what the operator-supplied source and the learned
 * deployment store are for. It costs a handful of requests and it turns a
 * meaningful share of unknown counties into fully structured retrievals.
 */
export function deriveCountyGisHostCandidates(county: string | undefined, state: string | undefined): string[] {
  const c = (county ?? '').trim().toLowerCase().replace(/\s*county\s*$/i, '').replace(/[^a-z]/g, '');
  const s = (state ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!c || !s) return [];
  return [
    `gis.${c}county${s}.gov`,
    `gis.${c}county.${s}.us`,
    `maps.${c}county${s}.gov`,
    `gis.${c}county.org`,
    `${c}countygis.${s}.gov`,
    `gis.co.${c}.${s}.us`,
  ];
}

/**
 * Turn official hosts that are not themselves service URLs into ArcGIS service
 * roots, by probing the contexts real deployments actually use. One probe here
 * converts "we know the county's GIS domain" into "we can query its parcels".
 */
export async function expandSeedsWithContextProbe(
  seeds: readonly SourceSeed[],
  deps: {
    arcgis?: Parameters<typeof probeArcgisServicesRoot>[1];
    ladder?: EscalationLadder;
    /** County/state used to derive candidate GIS hosts when none is known. */
    subject?: { county?: string; state?: string };
  } = {},
): Promise<SourceSeed[]> {
  const expanded: SourceSeed[] = [...seeds];
  const probedHosts = new Set<string>();

  // Only when no county-level source is already known. A county whose GIS is
  // already learned or registered must never pay for this.
  const hasCountySource = seeds.some((seed) => seed.origin !== 'statewide_service');
  if (!hasCountySource && deps.subject) {
    for (const host of deriveCountyGisHostCandidates(deps.subject.county, deps.subject.state)) {
      if (deps.ladder?.stageExhausted()) break;
      probedHosts.add(host);
      try {
        // Two contexts only. This is a cheap guess, not an exhaustive sweep.
        const probe = await probeArcgisServicesRoot(`https://${host}`, deps.arcgis, ['arcgis', 'server']);
        if (probe) {
          pushSeed(expanded, {
            url: probe.servicesRoot,
            label: `County ArcGIS server discovered at ${host}`,
            origin: 'context_probe',
            priority: 1,
          });
          break;
        }
      } catch {
        // A host that does not exist is the expected case here.
      }
    }
  }

  for (const seed of seeds) {
    if (deps.ladder?.stageExhausted()) break;
    if (/\/rest\/services/i.test(seed.url)) continue;
    const host = deploymentHost(seed.url);
    if (!host || probedHosts.has(host)) continue;
    probedHosts.add(host);
    try {
      const probe = await probeArcgisServicesRoot(seed.url, deps.arcgis);
      if (probe) {
        pushSeed(expanded, {
          url: probe.servicesRoot,
          label: `ArcGIS services root discovered on ${host}`,
          origin: 'context_probe',
          priority: seed.priority - 0.5,
        });
      }
    } catch {
      // Not an ArcGIS host. That is an answer, not an error.
    }
  }
  return expanded.sort((a, b) => a.priority - b.priority);
}

/* ────────────────────────────── the run ──────────────────────────────── */

export interface OfficialParcelGisRun {
  result: OfficialParcelGisResult;
  fingerprint: PlatformFingerprint;
  escalation: EscalationReport;
  handoff: ZoningResearchHandoff;
  seeds: SourceSeed[];
  /** Sources attempted in order, with the outcome of each. */
  attempts: Array<{ url: string; family: GisPlatformFamily; outcome: string }>;
}

function isUsable(result: OfficialParcelGisResult): boolean {
  return result.parcelMatchStatus === 'verified' || result.parcelMatchStatus === 'provisional';
}

/**
 * PART 19 — the normalized handoff. Everything the zoning and by-right
 * subdivision sprint needs, with no legal interpretation performed.
 */
export function buildZoningHandoff(
  subject: OfficialParcelGisSubject,
  result: OfficialParcelGisResult,
  fingerprint: PlatformFingerprint,
  now: () => string,
): ZoningResearchHandoff {
  const identityIssue =
    result.parcelMatchStatus === 'conflict'
      ? result.reconciliation?.reason ?? 'Official source identity conflicted with the identity LandOS holds.'
      : result.parcelMatchStatus === 'not_found'
        ? 'No official parcel record was matched to this subject.'
        : null;

  return {
    handoffVersion: 1,
    subject: {
      dealCardId: subject.dealCardId,
      parcelId: result.parcelId ?? subject.apn ?? null,
      address: result.parcelAddress ?? subject.address ?? null,
      county: subject.county ?? result.sourceJurisdiction ?? null,
      state: subject.state ?? null,
      acres: result.acres ?? subject.knownAcres ?? null,
    },
    officialParcelSourceUrl: result.sourceServiceUrl ?? result.sourceUrl ?? null,
    platformFamily: result.sourcePlatform,
    platformVariant: result.sourcePlatformVariant,
    geometry: result.geometry,
    jurisdictionClues: result.jurisdictionClues,
    zoningLayer: result.zoningLayer,
    zoningCode: result.zoning?.code ?? null,
    zoningDescription: result.zoning?.description ?? null,
    zoningAuthority: result.zoning?.authority ?? null,
    zoningSourceDisclaimer: result.zoning?.sourceDisclaimer ?? null,
    planningZoningUrls: result.officialPlanningLinks,
    sourceConfidence: result.retrievalConfidence,
    parcelMatchStatus: result.parcelMatchStatus,
    unresolvedIdentityIssue: identityIssue,
    failureStates: result.failureStates,
    preparedAt: now(),
  };
}

/** What the run learned about portal access, carried through to `finish`. */
export interface RunAccessContext {
  signals: AccessSignalCollector;
  /** Injected in tests so learning never touches the live database. */
  store?: PublicRecordAccessStore;
}

/**
 * The access slice of the handoff, read from shared platform knowledge.
 *
 * `accountAvailable` is deliberately narrow: it is true only when an ACTIVE
 * account exists that the scope gate already agreed applies to this exact
 * deployment. An account for a sibling county is not availability.
 */
function buildAccessHandoff(store: PublicRecordAccessStore, host: string): PublicRecordAccessHandoff | null {
  const knowledge = store.getByDomain(host);
  if (!knowledge) return null;
  const account = new SqliteGovernmentAccountRepository().findReusable({
    providerFamily: knowledge.providerFamily,
    deploymentDomain: knowledge.deploymentDomain,
    jurisdiction: '',
  });
  return {
    requirement: knowledge.requirement,
    registration: knowledge.registration,
    capabilities: accessCapabilities({
      requirement: knowledge.requirement,
      registration: knowledge.registration,
      account,
    }),
    accountAvailable: account?.accountStatus === 'active',
    paidRecordsObserved: knowledge.paidRecordsObserved,
    observedAt: knowledge.lastObservedAt,
  };
}

/**
 * Run the whole official-parcel lane for one property and persist the outcome.
 *
 * Every source is tried at most once, the ladder caps the total effort, and the
 * first usable answer wins. A run that finds nothing still returns a complete,
 * named result — silence is never an acceptable outcome for an operator.
 */
export async function runOfficialParcelGis(
  subject: OfficialParcelGisSubject,
  deps: OfficialParcelGisDeps = {},
): Promise<OfficialParcelGisRun> {
  const now = deps.now ?? (() => new Date().toISOString());
  const ladder = new EscalationLadder({ budget: deps.budget });
  const attempts: OfficialParcelGisRun['attempts'] = [];
  const arcgisDeps = { fetch: deps.arcgisFetch as never, onRequest: () => ladder.noteRequest(), ladder };

  // Access observation rides along on the transport. It reads what the portals
  // already answered and changes nothing about how they are retrieved.
  const access: RunAccessContext = { signals: deps.accessSignals ?? new AccessSignalCollector(), store: deps.accessStore };
  const transport = withAccessSignals(buildTransport(deps), access.signals);

  ladder.beginStage('platform_fingerprint');
  const baseSeeds = collectOfficialSourceSeeds(subject, deps);
  let seeds = await expandSeedsWithContextProbe(baseSeeds, {
    arcgis: arcgisDeps,
    ladder,
    subject: { county: subject.county, state: subject.state },
  });

  // Automatic discovery. Only when LandOS has no county-level source: a
  // jurisdiction it already knows, or has already learned, must never pay for
  // discovery again — that reuse is the whole point of the shared store.
  let discovery: OfficialSourceDiscoveryResult | null = null;
  const knowsCountySource = seeds.some((seed) => seed.origin !== 'statewide_service');
  if (!knowsCountySource && deps.allowDiscovery !== false && !ladder.exhausted()) {
    try {
      discovery = await discoverOfficialSource(
        { county: subject.county, state: subject.state, city: subject.city },
        {
          fetchText: transport,
          // The search lane needs a real browser even when nothing is blocked.
          searchFetchText: deps.fetchText ?? createBackgroundBrowserFetchText(),
          arcgis: arcgisDeps,
          ladder,
          hostnameCandidates: deriveCountyGisHostCandidates(subject.county, subject.state),
          providerDirectory: schneiderDirectoryLookup(transport),
          allowWebSearch: deps.allowWebSearch,
        },
      );
      if (discovery.selected) {
        // A discovered source outranks the statewide fallback but not an
        // operator-supplied one, and it is verified before it gets here.
        pushSeed(seeds, {
          url: discovery.selected.url,
          label: `${discovery.selected.label} (${discovery.selected.officiality.status.replace(/_/g, ' ')})`,
          origin: 'discovered_official_source',
          priority: 0.5,
        });
        seeds = [...seeds].sort((a, b) => a.priority - b.priority);
      }
    } catch (error) {
      logger.warn({ event: 'official_source_discovery_failed', msg: (error as Error).message }, 'official_source_discovery_failed');
    }
  }

  ladder.endStage('platform_fingerprint', seeds.length ? 'succeeded' : 'no_result',
    seeds.length ? `${seeds.length} official source(s) available.` : 'No official source is known for this county or state.');

  if (!seeds.length) {
    const empty: OfficialParcelGisResult = {
      sourcePlatform: 'unknown', sourcePlatformVariant: null, sourceJurisdiction: subject.county ?? null,
      sourceUrl: '', sourceServiceUrl: null, searchMethod: null, parcelMatchStatus: 'not_found',
      parcelId: null, parcelAddress: null, owner: null, acres: null, geometry: null,
      incorporatedStatus: null, localGovernment: null, jurisdictionClues: [], zoning: null, zoningLayer: null,
      availableLayers: [], officialPlanningLinks: [], retrievalMethod: 'structured_service',
      retrievalConfidence: 'none', failureStates: ['OFFICIAL_SOURCE_UNAVAILABLE'], fieldStates: {},
      unresolvedFields: ['parcelId', 'geometry', 'zoning'], rawEvidenceRef: null, reconciliation: null,
      retrievedAt: now(),
    };
    // Discovery ran and could not settle on a source: say WHICH way it failed
    // rather than reporting a generic unavailable source.
    if (discovery?.failure) empty.failureStates = [discovery.failure];
    const fingerprint = fingerprintPlatform({ url: '' });
    const escalation = ladder.report();
    const handoff = buildZoningHandoff(subject, empty, fingerprint, now);
    saveOfficialParcelGis(subject.dealCardId, { result: empty, fingerprint, escalation, handoff });
    return { result: empty, fingerprint, escalation, handoff, seeds, attempts };
  }

  // Group the ArcGIS-shaped seeds so the adapter sees them together: one
  // adapter run across several services beats several isolated runs.
  const fingerprints = seeds.map((seed) => ({ seed, fingerprint: fingerprintPlatform({ url: seed.url }) }));
  const arcgisSeeds: ArcgisSeed[] = fingerprints
    .filter((entry) => entry.fingerprint.recommendedAdapter === 'arcgis')
    .map((entry) => ({ url: entry.seed.url, label: entry.seed.label }));

  // Held in a box rather than a bare `let` so the closure below can update it
  // without confusing narrowing at the read sites further down.
  const best: { value: { result: OfficialParcelGisResult; fingerprint: PlatformFingerprint } | null } = { value: null };

  const consider = (result: OfficialParcelGisResult, fingerprint: PlatformFingerprint, url: string): boolean => {
    attempts.push({ url, family: result.sourcePlatform, outcome: result.parcelMatchStatus });
    // Keep the first answer, but always prefer a usable one over an unusable one.
    if (!best.value || (isUsable(result) && !isUsable(best.value.result))) best.value = { result, fingerprint };
    return isUsable(result);
  };

  // 1. ArcGIS first when any seed is Esri-shaped. It is the only family in this
  //    set that yields geometry AND zoning through a structured route.
  if (arcgisSeeds.length && !ladder.exhausted()) {
    const fingerprint = fingerprints.find((entry) => entry.fingerprint.recommendedAdapter === 'arcgis')!.fingerprint;
    const result = await runArcgisAdapter(
      { seeds: arcgisSeeds, search: subject, fingerprint, sourceJurisdiction: subject.county ?? null },
      { ...arcgisDeps, now },
    );
    if (consider(result, fingerprint, arcgisSeeds[0].url)) {
      return finish(subject, result, fingerprint, ladder, seeds, attempts, now, discovery, access);
    }
  }

  // 2. Vendor portals, in seed order, each once and only if budget remains.
  for (const { seed, fingerprint } of fingerprints) {
    if (ladder.exhausted()) break;
    if (fingerprint.recommendedAdapter === 'arcgis') continue;
    if (!ladder.allowAlternateSource()) break;

    if (fingerprint.recommendedAdapter === 'schneider_beacon_qpublic') {
      const result = await runSchneiderAdapter(
        { search: subject, fingerprint, applicationUrl: seed.url },
        { fetchText: transport, ladder, now, loadDirectory: deps.loadSchneiderDirectory },
      );
      if (consider(result, fingerprint, seed.url)) return finish(subject, result, fingerprint, ladder, seeds, attempts, now, discovery, access);
      continue;
    }

    if (fingerprint.recommendedAdapter === 'tyler') {
      const result = await runTylerAdapter(
        { search: subject, fingerprint, observedUrl: seed.url },
        { fetchText: transport, ladder, now },
      );
      if (consider(result, fingerprint, seed.url)) return finish(subject, result, fingerprint, ladder, seeds, attempts, now, discovery, access);
      continue;
    }

    // 3. Unknown platform: inspect, and if it is secretly Esri, hand back to
    //    the adapter that already works rather than learning a new UI.
    ladder.beginStage('generic_structured_inspection');
    const inspection = await inspectUnknownGovernmentSite(seed.url, { fetchText: transport, ladder });
    ladder.endStage('generic_structured_inspection', inspection.services.length ? 'succeeded' : 'no_result',
      inspection.notes.join(' ') || 'Nothing structured was exposed.');

    const hidden = arcgisSeedsFromInspection(inspection);
    if (hidden.length && !ladder.exhausted()) {
      const result = await runArcgisAdapter(
        { seeds: hidden, search: subject, fingerprint: inspection.refinedFingerprint, sourceJurisdiction: subject.county ?? null },
        { ...arcgisDeps, now },
      );
      if (consider(result, inspection.refinedFingerprint, seed.url)) {
        return finish(subject, result, inspection.refinedFingerprint, ladder, seeds, attempts, now, discovery, access);
      }
    } else {
      attempts.push({ url: seed.url, family: inspection.refinedFingerprint.family, outcome: inspection.blocked ? 'source_blocked' : 'no_structured_service' });
    }
  }

  const fallbackFingerprint = best.value?.fingerprint ?? fingerprints[0].fingerprint;
  const fallbackResult = best.value?.result ?? {
    sourcePlatform: fallbackFingerprint.family,
    sourcePlatformVariant: fallbackFingerprint.variant,
    sourceJurisdiction: subject.county ?? null,
    sourceUrl: seeds[0].url, sourceServiceUrl: null, searchMethod: null, parcelMatchStatus: 'not_found' as const,
    parcelId: null, parcelAddress: null, owner: null, acres: null, geometry: null,
    incorporatedStatus: null, localGovernment: null, jurisdictionClues: [], zoning: null, zoningLayer: null,
    availableLayers: [], officialPlanningLinks: [], retrievalMethod: 'structured_service' as const,
    retrievalConfidence: 'none' as const,
    failureStates: ['PARCEL_NOT_FOUND' as const, 'STRUCTURED_SERVICE_NOT_FOUND' as const],
    fieldStates: {}, unresolvedFields: ['parcelId', 'geometry', 'zoning'], rawEvidenceRef: null,
    reconciliation: null, retrievedAt: now(),
  };

  return finish(subject, fallbackResult, fallbackFingerprint, ladder, seeds, attempts, now, discovery, access);
}

/** Persist, learn, and return. Shared by every exit path so no route can skip it. */
function finish(
  subject: OfficialParcelGisSubject,
  result: OfficialParcelGisResult,
  fingerprint: PlatformFingerprint,
  ladder: EscalationLadder,
  seeds: SourceSeed[],
  attempts: OfficialParcelGisRun['attempts'],
  now: () => string,
  discovery: OfficialSourceDiscoveryResult | null = null,
  access: RunAccessContext = { signals: new AccessSignalCollector() },
): OfficialParcelGisRun {
  const escalation = ladder.report();
  // Discovery's own honest states travel with the result: "we could not work
  // out which source to use" is a different fact from "the source said no",
  // and an operator has to be able to tell them apart.
  const discoveryStates: OfficialParcelGisResult['failureStates'] = [];
  if (discovery?.failure) discoveryStates.push(discovery.failure);
  if (discovery?.selected) {
    const classified = classifyDiscoveredSource(discovery.selected);
    if (classified.failure) discoveryStates.push(classified.failure);
  }
  // The ladder's own failure states (a deferred interactive route) belong on
  // the result, so the operator sees why a source was abandoned.
  const merged: OfficialParcelGisResult = {
    ...result,
    failureStates: [...new Set([...result.failureStates, ...escalation.failureStates, ...discoveryStates])],
  };
  const handoff = buildZoningHandoff(subject, merged, fingerprint, now);

  try {
    const succeeded = isUsable(merged);
    recordPlatformProof(merged.sourcePlatform, {
      detection: fingerprint.confidence === 'high' || fingerprint.confidence === 'medium',
      parcelSearch: succeeded,
      apnSearch: succeeded && merged.searchMethod === 'apn',
      addressSearch: succeeded && merged.searchMethod === 'address',
      ownerSearch: succeeded && merged.searchMethod === 'owner',
      geometry: !!merged.geometry,
      zoningLayerDiscovery: !!merged.zoningLayer,
      directServiceRoute: succeeded && merged.retrievalMethod === 'structured_service',
      provenOnHost: succeeded ? deploymentHost(merged.sourceServiceUrl ?? merged.sourceUrl) : null,
      failureModes: merged.failureStates,
      succeeded,
    }, now);

    if (merged.sourceUrl) {
      rememberDeployment(merged.sourceServiceUrl ?? merged.sourceUrl, {
        family: merged.sourcePlatform,
        variant: merged.sourcePlatformVariant,
        // The jurisdiction the SOURCE serves. Not the property.
        servesLabel: merged.sourceJurisdiction ?? subject.county ?? null,
        services: merged.availableLayers.map((layer) => layer.url).slice(0, 20),
        parcelLayerUrl: merged.sourceServiceUrl,
        zoningLayerUrl: merged.zoningLayer?.serviceUrl ?? null,
        zoningCodeField: merged.zoningLayer?.codeField ?? null,
        searchMethods: merged.searchMethod ? [merged.searchMethod] : [],
        requiresBrowser: merged.retrievalMethod === 'background_browser' || merged.retrievalMethod === 'rendered_dom',
        confidence: merged.retrievalConfidence,
        failureModes: merged.failureStates,
        succeeded,
      }, now);
    }
  } catch (error) {
    // Learning is a bonus, never a gate on returning the operator's answer.
    logger.warn({ event: 'gis_platform_learning_failed', msg: (error as Error).message }, 'gis_platform_learning_failed');
  }

  try {
    // The family is known only now, so the buffered observations are filed with
    // the right one. A host LandOS never identified stays honestly "unknown".
    const winningHost = merged.sourceUrl ? deploymentHost(merged.sourceServiceUrl ?? merged.sourceUrl) : '';
    const accessStore = access.store ?? new PublicRecordAccessStore();
    access.signals.commit(
      accessStore,
      (host: string) => (host === winningHost ? merged.sourcePlatform : 'unknown'),
      now(),
    );
    // The ArcGIS lane fetches through its OWN transport, so the access observer
    // riding on `fetchText` never sees those responses. A structured service
    // that returned this parcel is nevertheless the strongest possible proof
    // that the source needs no account — exactly what the detector concludes
    // when it does see such a response. Record it rather than leaving the panel
    // blank on the most common platform in the country.
    if (winningHost && isUsable(merged) && !access.signals.get(winningHost)
      && (merged.retrievalMethod === 'structured_service' || merged.retrievalMethod === 'embedded_page_data')) {
      accessStore.observe(
        { providerFamily: merged.sourcePlatform, deploymentDomain: winningHost },
        {
          requirement: 'auth_not_required',
          registration: 'not_applicable',
          loginUrl: null,
          registrationUrl: null,
          paidRecordsObserved: false,
          signals: ['Structured service returned the parcel without authentication.'],
        },
        now(),
      );
    }
    // The zoning sprint reads this to decide whether it may continue alone.
    handoff.access = winningHost ? buildAccessHandoff(accessStore, winningHost) : null;
  } catch (error) {
    logger.warn({ event: 'public_record_access_learning_failed', msg: (error as Error).message }, 'public_record_access_learning_failed');
  }

  saveOfficialParcelGis(subject.dealCardId, { result: merged, fingerprint, escalation, handoff });
  logger.info({
    event: 'official_parcel_gis_run',
    dealCardId: subject.dealCardId,
    family: merged.sourcePlatform,
    status: merged.parcelMatchStatus,
    requests: escalation.totalRequests,
  }, 'official_parcel_gis_run');

  return { result: merged, fingerprint, escalation, handoff, seeds, attempts };
}

/** Latest persisted retrieval for a deal, or null when the lane never ran. */
export function latestOfficialParcelGis(dealCardId: number): OfficialParcelGisRecord | null {
  return getOfficialParcelGis(dealCardId);
}
