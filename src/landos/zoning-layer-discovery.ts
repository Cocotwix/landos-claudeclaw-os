// LandOS — finding the authority's own ZONING LAYER, so the district can be
// read directly instead of guessed from a PDF map image.
//
// This is the "direct retrieval first" half of the sprint's source policy. A
// county or city that publishes an ArcGIS zoning layer will answer a single
// HTTPS query with the district polygon covering a parcel — no browser, no
// screenshot, no interpretation. Where that exists it is the strongest evidence
// LandOS can get, and it is cheap enough to try first every time.
//
// Discovery reuses the machinery that already works:
//   `discoverOfficialSource`     — the verified government source of record
//   `probeArcgisServicesRoot`    — is there an ArcGIS server there
//   `enumerateArcgisServices`    — what does it publish
//   `describeArcgisService`      — what layers, with which fields
//   `pickLayerForRole(…, 'zoning')` — which of them is the zoning layer
//
// Nothing here is new GIS infrastructure. It is the existing adapter stack
// aimed at one question the zoning lane needs answered.

import {
  describeArcgisService,
  enumerateArcgisServices,
  parseArcgisUrl,
  probeArcgisServicesRoot,
  pickLayerForRole,
  resolveField,
  type ArcgisDiscoveryDeps,
  type ArcgisLayerSummary,
} from './arcgis-service-discovery.js';
import { discoverOfficialSource, type SourceDiscoveryDeps } from './official-source-discovery.js';
import type { ZoningGisQuery } from './current-zoning-determination.js';

export interface ZoningLayerDiscoveryInput {
  county: string | null;
  state: string | null;
  city: string | null;
  /** ArcGIS roots or service URLs the caller already knows. Tried first. */
  knownServiceUrls?: readonly string[];
}

export interface ZoningLayerDiscoveryDeps {
  arcgis?: ArcgisDiscoveryDeps;
  sourceDiscovery?: SourceDiscoveryDeps;
  /** `false` skips the official-source discovery sweep (tests, offline runs). */
  discoverSource?: boolean;
  maxServices?: number;
  maxLayers?: number;
}

export interface ZoningLayerDiscoveryResult {
  queries: ZoningGisQuery[];
  /** Every root that was probed, and what came of it. */
  notes: string[];
}

/** The parcel-identifier field on a zoning layer, when it carries one. */
function apnFieldOf(layer: ArcgisLayerSummary): string | null {
  return resolveField(layer.fields, 'parcelId');
}

async function servicesRootFor(url: string, deps: ArcgisDiscoveryDeps): Promise<string | null> {
  const parsed = parseArcgisUrl(url);
  if (parsed?.servicesRoot) return parsed.servicesRoot;
  const probe = await probeArcgisServicesRoot(url, deps, ['arcgis', 'server', 'gis']);
  return probe?.servicesRoot ?? null;
}

/**
 * Find every queryable zoning layer this jurisdiction publishes.
 *
 * Returns QUERIES rather than layers, so the zoning lane can hand each one
 * straight to `readZoningFromGisLayer` without knowing anything about ArcGIS.
 * A layer that exposes a parcel-identifier field gets an APN query (exact); one
 * that does not is left to a point query, which the caller only supplies when
 * it has a parcel-derived point.
 *
 * Never throws: a jurisdiction with no ArcGIS presence returns no queries and a
 * note saying so, which is a usable answer.
 */
export async function discoverZoningLayers(
  input: ZoningLayerDiscoveryInput,
  deps: ZoningLayerDiscoveryDeps = {},
): Promise<ZoningLayerDiscoveryResult> {
  const arcgis = deps.arcgis ?? {};
  const maxServices = Math.max(1, deps.maxServices ?? 12);
  const maxLayers = Math.max(1, deps.maxLayers ?? 3);
  const notes: string[] = [];
  const queries: ZoningGisQuery[] = [];

  const roots: string[] = [];
  for (const url of input.knownServiceUrls ?? []) {
    try {
      const root = await servicesRootFor(url, arcgis);
      if (root && !roots.includes(root)) roots.push(root);
    } catch {
      notes.push(`No ArcGIS services root answered at ${url}.`);
    }
  }

  if (deps.discoverSource !== false && !roots.length) {
    try {
      const discovery = await discoverOfficialSource(
        { county: input.county ?? undefined, state: input.state ?? undefined, city: input.city ?? undefined },
        deps.sourceDiscovery ?? {},
      );
      notes.push(...discovery.notes);
      for (const candidate of [discovery.selected, ...discovery.candidates].filter(Boolean)) {
        const url = candidate!.url;
        try {
          const root = await servicesRootFor(url, arcgis);
          if (root && !roots.includes(root)) roots.push(root);
        } catch {
          // A candidate that is not an ArcGIS server is not an error.
        }
        if (roots.length >= 2) break;
      }
    } catch (error) {
      notes.push(`Official source discovery was unavailable: ${(error as Error).message}`);
    }
  }

  if (!roots.length) {
    notes.push('No ArcGIS services root was found for this jurisdiction, so no parcel-specific zoning layer could be queried directly.');
    return { queries, notes };
  }

  for (const root of roots) {
    if (queries.length >= maxLayers) break;
    let services: Array<{ name: string; type: string; url: string }> = [];
    try {
      services = await enumerateArcgisServices(root, arcgis);
    } catch {
      notes.push(`The ArcGIS services root ${root} could not be enumerated.`);
      continue;
    }
    // Services whose NAME mentions zoning or planning are tried first: a
    // county with sixty services should not cost sixty describe calls to find
    // the one obvious candidate.
    const ranked = services
      .map((service) => ({ service, hint: /zon|planning|landuse|land_use/i.test(service.name) ? 0 : 1 }))
      .sort((a, b) => a.hint - b.hint)
      .slice(0, maxServices);

    for (const entry of ranked) {
      if (queries.length >= maxLayers) break;
      let layers: readonly ArcgisLayerSummary[] = [];
      try {
        layers = (await describeArcgisService(entry.service.url, arcgis)).layers;
      } catch {
        continue;
      }
      const pick = pickLayerForRole(layers, 'zoning');
      if (!pick) continue;
      const apnField = apnFieldOf(pick.layer);
      queries.push({
        layerUrl: pick.layer.layerUrl,
        layerLabel: `${entry.service.name} — ${pick.layer.name}`,
        apnField,
      });
      notes.push(
        `Zoning layer found: "${pick.layer.name}" in ${entry.service.name} (${pick.verdict.reason})`
        + `${apnField ? `; it exposes parcel identifier field ${apnField}, so the parcel can be matched exactly.` : '; it exposes no parcel identifier field, so only a point query can match this parcel.'}`,
      );
    }
  }

  if (!queries.length) notes.push('The jurisdiction publishes ArcGIS services, but none of them exposes a queryable zoning layer.');
  return { queries, notes };
}
