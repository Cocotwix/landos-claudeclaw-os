// LandOS — generic government GIS FALLBACK (PART 7).
//
// For a site that matched no family. The question this module answers is not
// "how do I drive this map" — it is the much cheaper and much more useful set:
//
//   1. Is this secretly a known platform behind a custom frontend?
//   2. Is a structured parcel service exposed anywhere on the page?
//   3. Is a zoning layer exposed?
//   4. Can the parcel be reached without touching the map at all?
//   5. Is there another official parcel/property search page to use instead?
//
// A great many county sites that look bespoke are an Esri deployment wearing
// county branding, and the fastest possible win is noticing that. So the
// fallback re-fingerprints with the page's real subresources and, when it finds
// services, hands straight back to the family adapter that already works.
//
// Nothing discovered here is promoted into a global platform profile. One
// unusual deployment is a deployment, not a family.

import {
  type PlatformProbeInput,
  extractStructuredServices,
  fingerprintPlatform,
} from './gis-platform-fingerprint.js';
import { type GovFetchText, defaultGovFetchText, extractLinks, htmlToText } from './gis-transport.js';
import { EscalationLadder } from './gis-escalation.js';
import type { DiscoveredService, PlatformFingerprint } from './gis-platform-types.js';

/** Link text/URL tokens that indicate another official property search route. */
const OFFICIAL_SEARCH_TOKENS = [
  /parcel\s*(search|viewer|lookup)/i,
  /property\s*(search|record|lookup|information)/i,
  /(real\s*)?property\s*(tax|assessment)/i,
  /assessor/i,
  /appraiser/i,
  /tax\s*(map|record|search)/i,
  /gis\s*(map|viewer|portal)/i,
  /land\s*record/i,
];

const PLANNING_TOKENS = [/zoning/i, /planning/i, /land\s*use/i, /ordinance/i, /development\s*(code|services)/i, /comprehensive\s*plan/i];

/** Downloadable GIS payloads. Recorded, never fetched by this sprint. */
const DOWNLOAD_TOKENS = /\.(zip|geojson|json|gdb|gpkg|kml|kmz|shp|csv)(\?|$)/i;

export interface GenericInspection {
  /** Re-run of the detector with everything the page actually loaded. */
  refinedFingerprint: PlatformFingerprint;
  /** True when the enriched probe revealed a family the URL alone did not. */
  revealedHiddenPlatform: boolean;
  services: DiscoveredService[];
  /** Other official parcel/property search pages linked from this one. */
  alternateSearchPages: Array<{ label: string; url: string }>;
  /** Official planning / zoning pages, carried to the next sprint. */
  planningLinks: Array<{ label: string; url: string }>;
  downloads: Array<{ label: string; url: string }>;
  /** Plain notes about what was and was not found. */
  notes: string[];
  /** True when the transport was refused rather than the page being empty. */
  blocked: boolean;
}

function sameOrRelatedHost(candidate: string, base: string): boolean {
  try {
    const a = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
    const b = new URL(base).hostname.toLowerCase().replace(/^www\./, '');
    if (a === b) return true;
    // A county routinely splits its GIS onto a sibling host under the same
    // registrable domain; that is still the same official source.
    const tail = (host: string) => host.split('.').slice(-2).join('.');
    return tail(a) === tail(b);
  } catch { return false; }
}

/** Script `src` and iframe `src` values, which is where a hidden platform shows. */
export function extractSubresources(html: string, baseUrl: string): { scripts: string[]; frames: string[] } {
  const scripts: string[] = [];
  const frames: string[] = [];
  const resolve = (raw: string): string | null => {
    try { return new URL(raw, baseUrl).toString(); } catch { return null; }
  };
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const url = resolve(match[1]);
    if (url) scripts.push(url);
  }
  for (const match of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
    const url = resolve(match[1]);
    if (url) frames.push(url);
  }
  return { scripts, frames };
}

/** Top-level keys of any inline JSON configuration object on the page. */
export function extractConfigKeys(html: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    /\b(?:var|const|let)\s+(?:appConfig|config|mapConfig|viewerConfig|_appConfig|jimuConfig)\s*=\s*(\{[\s\S]{0,20000}?\})\s*;/g,
    /window\.__(?:APP_)?CONFIG__\s*=\s*(\{[\s\S]{0,20000}?\})\s*;/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>;
        for (const key of Object.keys(parsed)) keys.add(key);
      } catch {
        // Not strict JSON (a JS object literal). Read the top-level key names
        // textually rather than giving up on the signal entirely.
        for (const keyMatch of match[1].matchAll(/["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:/g)) keys.add(keyMatch[1]);
      }
    }
  }
  return [...keys].slice(0, 80);
}

export interface GenericFallbackDeps {
  fetchText?: GovFetchText;
  ladder?: EscalationLadder;
  /** Extra config paths to probe on the app origin. Kept small on purpose. */
  configProbePaths?: string[];
}

/** Config files a custom county viewer almost always keeps its layer URLs in. */
const DEFAULT_CONFIG_PROBES = ['config.json', 'appconfig.json', 'assets/config.json', 'api/config'];

/**
 * Inspect an unknown official site without driving it. One page fetch plus at
 * most a couple of config probes; the escalation budget caps the rest.
 */
export async function inspectUnknownGovernmentSite(
  url: string,
  deps: GenericFallbackDeps = {},
): Promise<GenericInspection> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const ladder = deps.ladder;
  const notes: string[] = [];

  ladder?.noteRequest();
  const page = await fetchText(url);

  if (page.blocked) {
    const bareProbe: PlatformProbeInput = { url };
    return {
      refinedFingerprint: fingerprintPlatform(bareProbe),
      revealedHiddenPlatform: false,
      services: [],
      alternateSearchPages: [],
      planningLinks: [],
      downloads: [],
      notes: ['The site refused the transport, so nothing could be inspected. This is a transport refusal, not an empty source.'],
      blocked: true,
    };
  }

  const { scripts, frames } = extractSubresources(page.body, page.url);
  const links = extractLinks(page.body, page.url);
  const configKeys = extractConfigKeys(page.body);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.body);

  // Probe the handful of config paths a bespoke viewer keeps layer URLs in.
  // Bounded hard: this is an inspection, not a crawl.
  const configBodies: string[] = [];
  for (const probePath of (deps.configProbePaths ?? DEFAULT_CONFIG_PROBES).slice(0, 4)) {
    if (ladder?.stageExhausted()) { notes.push('Stage budget reached before every config path was probed.'); break; }
    let probeUrl: string;
    try { probeUrl = new URL(probePath, page.url).toString(); } catch { continue; }
    ladder?.noteRequest();
    try {
      const probe = await fetchText(probeUrl, { timeoutMs: 8000 });
      if (probe.status === 200 && /json/i.test(probe.contentType) && probe.body.trimStart().startsWith('{')) {
        configBodies.push(probe.body.slice(0, 60_000));
        notes.push(`Application configuration found at ${probePath}.`);
      }
    } catch {
      // A missing config path is the normal case, not an error worth surfacing.
    }
  }

  const probe: PlatformProbeInput = {
    url,
    finalUrl: page.url,
    html: `${page.body.slice(0, 400_000)}\n${configBodies.join('\n')}`,
    title: htmlToText(titleMatch?.[1] ?? ''),
    scriptUrls: scripts,
    networkUrls: [...frames, ...links.map((link) => link.url)],
    configKeys,
  };

  const bare = fingerprintPlatform({ url });
  const refined = fingerprintPlatform(probe);
  const services = extractStructuredServices(probe);

  const revealedHiddenPlatform =
    refined.family !== 'unknown'
    && refined.family !== 'custom_government_portal'
    && (bare.family === 'unknown' || bare.family === 'custom_government_portal');

  if (revealedHiddenPlatform) {
    notes.push(`The page is powered by ${refined.family.replace(/_/g, ' ')} behind a custom frontend; the family adapter applies.`);
  } else if (!services.length) {
    notes.push('No structured service was exposed by the page, its subresources or its configuration.');
  }

  const alternateSearchPages = links
    .filter((link) => sameOrRelatedHost(link.url, page.url))
    .filter((link) => OFFICIAL_SEARCH_TOKENS.some((token) => token.test(link.label) || token.test(link.url)))
    .slice(0, 8);

  const planningLinks = links
    .filter((link) => sameOrRelatedHost(link.url, page.url))
    .filter((link) => PLANNING_TOKENS.some((token) => token.test(link.label) || token.test(link.url)))
    .slice(0, 8);

  const downloads = links.filter((link) => DOWNLOAD_TOKENS.test(link.url)).slice(0, 8);

  return {
    refinedFingerprint: refined,
    revealedHiddenPlatform,
    services,
    alternateSearchPages,
    planningLinks,
    downloads,
    notes,
    blocked: false,
  };
}

/**
 * ArcGIS seeds worth handing to the ArcGIS adapter, in priority order. A layer
 * or service URL beats a bare services root, which would otherwise burn budget
 * enumerating everything a county publishes.
 */
export function arcgisSeedsFromInspection(inspection: GenericInspection): Array<{ url: string; label: string }> {
  const priority: Record<string, number> = {
    arcgis_feature_server: 0,
    arcgis_map_server: 1,
    arcgis_portal_item: 2,
    arcgis_server_root: 3,
  };
  return inspection.services
    .filter((service) => service.kind in priority)
    .sort((a, b) => priority[a.kind] - priority[b.kind])
    .slice(0, 6)
    .map((service) => ({ url: service.url, label: service.evidence }));
}
