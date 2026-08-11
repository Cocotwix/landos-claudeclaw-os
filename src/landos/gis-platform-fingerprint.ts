// LandOS — Government GIS platform FINGERPRINTING (PART 2).
//
// Given an unfamiliar official parcel/GIS URL and whatever was observed about
// the page, decide which platform family powers it, how confident that is, and
// which adapter should run. The whole point is that LandOS stops relearning a
// custom UI: recognise the family, reuse the adapter.
//
// Rule enforced in code, not just in prose: a classification may not reach high
// confidence on appearance alone. Vendor branding, HTML class names and page
// titles are corroborating signals; a hostname, URL path, script source,
// embedded application config or an actual service endpoint is required before
// LandOS will say it knows what a site is.
//
// Pure and synchronous. No network, no DB, no browser — so it is cheap to run
// on every candidate URL and trivially testable.

import {
  type DiscoveredService,
  type GisAdapterId,
  type GisDetectionConfidence,
  type GisDetectionEvidence,
  type GisDetectionSignal,
  type GisPlatformFamily,
  type PlatformFingerprint,
} from './gis-platform-types.js';
import {
  PLATFORM_FAMILY_PROFILES,
  SCORED_PLATFORM_FAMILIES,
  type PlatformFamilyProfile,
  type PlatformSignalPatterns,
} from './gis-platform-registry.js';

/** Everything a probe can observe. Every field beyond `url` is optional so the
 *  detector still returns a usable answer from a bare URL. */
export interface PlatformProbeInput {
  url: string;
  /** URL after redirects, when it differs. */
  finalUrl?: string;
  /** Page HTML. Truncated by the caller; the detector never needs all of it. */
  html?: string;
  title?: string;
  /** `src` of every script tag. */
  scriptUrls?: string[];
  /** URLs the page actually requested (XHR/fetch/subresource). */
  networkUrls?: string[];
  /** Response headers, lower-cased keys. */
  headers?: Record<string, string>;
  /** Top-level keys seen in an embedded JS/JSON application configuration. */
  configKeys?: string[];
}

/** Relative strength per signal kind. Technical observations outweigh looks. */
const SIGNAL_WEIGHT: Record<GisDetectionSignal, number> = {
  service_endpoint: 5,
  embedded_config: 4,
  script_src: 4,
  network_resource: 4,
  url_path: 3,
  hostname: 3,
  html_marker: 2,
  page_metadata: 2,
  vendor_branding: 1,
};

/**
 * Signals that count as real technical evidence. At least one is required
 * before a verdict can exceed low confidence — this is the code-level
 * enforcement of "do not classify only from appearance".
 */
const TECHNICAL_SIGNALS: ReadonlySet<GisDetectionSignal> = new Set<GisDetectionSignal>([
  'service_endpoint',
  'embedded_config',
  'script_src',
  'network_resource',
  'url_path',
  'hostname',
]);

const MAX_OBSERVED = 160;

function truncate(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_OBSERVED ? `${flat.slice(0, MAX_OBSERVED)}…` : flat;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function pathOf(url: string): string {
  try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; }
}

interface Match { pattern: RegExp; hit: string }

function firstMatch(patterns: readonly RegExp[] | undefined, haystacks: readonly string[]): Match | null {
  if (!patterns?.length) return null;
  for (const pattern of patterns) {
    for (const haystack of haystacks) {
      if (!haystack) continue;
      const m = pattern.exec(haystack);
      if (m) return { pattern, hit: m[0] || haystack };
    }
  }
  return null;
}

function pushEvidence(
  into: GisDetectionEvidence[],
  family: GisPlatformFamily,
  signal: GisDetectionSignal,
  match: Match | null,
  detail: string,
  variant?: string,
): void {
  if (!match) return;
  into.push({
    signal,
    family,
    ...(variant ? { variant } : {}),
    detail,
    observed: truncate(match.hit),
    weight: SIGNAL_WEIGHT[signal],
  });
}

/** Score one family against the probe and collect the evidence behind it. */
function scoreFamily(profile: PlatformFamilyProfile, probe: PlatformProbeInput): {
  score: number;
  evidence: GisDetectionEvidence[];
  variant: string | null;
} {
  const urls = [probe.url, probe.finalUrl].filter((u): u is string => !!u);
  const hosts = urls.map(hostOf).filter(Boolean);
  const paths = urls.map(pathOf);
  const scripts = probe.scriptUrls ?? [];
  const network = probe.networkUrls ?? [];
  const html = probe.html ? [probe.html] : [];
  const meta = [probe.title ?? '', probe.headers?.server ?? '', probe.headers?.['x-powered-by'] ?? ''].filter(Boolean);
  const configKeys = probe.configKeys ?? [];

  const evidence: GisDetectionEvidence[] = [];
  const p = profile.patterns;
  const family = profile.family;

  pushEvidence(evidence, family, 'hostname', firstMatch(p.hostnames, hosts), `Hostname matches the ${profile.vendor} pattern.`);
  pushEvidence(evidence, family, 'url_path', firstMatch(p.paths, paths), `URL path matches a known ${profile.vendor} application path.`);
  pushEvidence(evidence, family, 'script_src', firstMatch(p.scripts, scripts.concat(html)), `Page loads a ${profile.vendor} script bundle.`);
  pushEvidence(evidence, family, 'network_resource', firstMatch(p.serviceUrls, network), `Page requests a ${profile.vendor} data service.`);
  // A service URL that is the page itself, or is quoted inside the HTML, is a
  // service endpoint rather than a passive network observation.
  pushEvidence(evidence, family, 'service_endpoint', firstMatch(p.serviceUrls, paths.concat(urls)), `The URL itself is a ${profile.vendor} service endpoint.`);
  pushEvidence(evidence, family, 'html_marker', firstMatch(p.htmlMarkers, html), `Page markup carries ${profile.vendor} structural markers.`);
  pushEvidence(evidence, family, 'page_metadata', firstMatch(p.metadata, meta.concat(html)), `Page metadata names ${profile.vendor}.`);
  pushEvidence(evidence, family, 'vendor_branding', firstMatch(p.branding, meta.concat(html)), `Page shows ${profile.vendor} branding.`);

  if (p.configKeys.length && configKeys.length) {
    const hit = p.configKeys.find((key) => configKeys.includes(key));
    if (hit) {
      evidence.push({
        signal: 'embedded_config',
        family,
        detail: `Embedded application config exposes the ${profile.vendor} key "${hit}".`,
        observed: hit,
        weight: SIGNAL_WEIGHT.embedded_config,
      });
    }
  }

  // Variant refinement. A variant only sharpens an already-matched family; it
  // can never create one, so a bespoke frontend is never promoted on a guess.
  let variant: string | null = null;
  if (evidence.length) {
    for (const candidate of profile.variants) {
      const vp = candidate.patterns as Partial<PlatformSignalPatterns>;
      const hit =
        firstMatch(vp.paths, paths) ??
        firstMatch(vp.hostnames, hosts) ??
        firstMatch(vp.scripts, scripts.concat(html)) ??
        firstMatch(vp.serviceUrls, network.concat(paths)) ??
        firstMatch(vp.htmlMarkers, html);
      const configHit = vp.configKeys?.find((key) => configKeys.includes(key));
      if (hit || configHit) {
        variant = candidate.variant;
        evidence.push({
          signal: hit ? 'url_path' : 'embedded_config',
          family,
          variant: candidate.variant,
          detail: candidate.description,
          observed: truncate(hit?.hit ?? configHit ?? candidate.variant),
          weight: 1,
        });
        break;
      }
    }
  }

  const score = evidence.reduce((sum, e) => sum + e.weight, 0);
  return { score, evidence, variant };
}

function confidenceFor(score: number, evidence: readonly GisDetectionEvidence[]): GisDetectionConfidence {
  if (!evidence.length) return 'none';
  const hasTechnical = evidence.some((e) => TECHNICAL_SIGNALS.has(e.signal));
  // Appearance alone never exceeds low, no matter how much of it there is.
  if (!hasTechnical) return 'low';
  const technicalScore = evidence.filter((e) => TECHNICAL_SIGNALS.has(e.signal)).reduce((s, e) => s + e.weight, 0);
  if (score >= 8 && technicalScore >= 5) return 'high';
  if (score >= 4 && technicalScore >= 3) return 'medium';
  return 'low';
}

/* ─────────────────── structured-service extraction ───────────────────── */

const SERVICE_MATCHERS: Array<{ kind: DiscoveredService['kind']; pattern: RegExp; evidence: string }> = [
  { kind: 'arcgis_feature_server', pattern: /https?:\/\/[^\s"'<>]+\/rest\/services\/[^\s"'<>]*?\/FeatureServer(\/\d+)?/i, evidence: 'ArcGIS FeatureServer path' },
  { kind: 'arcgis_map_server', pattern: /https?:\/\/[^\s"'<>]+\/rest\/services\/[^\s"'<>]*?\/MapServer(\/\d+)?/i, evidence: 'ArcGIS MapServer path' },
  { kind: 'arcgis_image_server', pattern: /https?:\/\/[^\s"'<>]+\/rest\/services\/[^\s"'<>]*?\/ImageServer/i, evidence: 'ArcGIS ImageServer path' },
  { kind: 'arcgis_geocode_server', pattern: /https?:\/\/[^\s"'<>]+\/rest\/services\/[^\s"'<>]*?\/GeocodeServer/i, evidence: 'ArcGIS GeocodeServer path' },
  { kind: 'arcgis_geometry_server', pattern: /https?:\/\/[^\s"'<>]+\/rest\/services\/[^\s"'<>]*?\/GeometryServer/i, evidence: 'ArcGIS GeometryServer path' },
  { kind: 'arcgis_portal_item', pattern: /https?:\/\/[^\s"'<>]+\/sharing\/rest\/content\/items\/[0-9a-f]{32}/i, evidence: 'ArcGIS portal item endpoint' },
  // A county-branded site whose whole body is an iframe to an Esri app is one
  // of the most common shapes in the wild. Several vendors ship exactly this,
  // so resolving the embedded app id is what makes those counties work with no
  // vendor-specific code at all.
  { kind: 'arcgis_portal_item', pattern: /https?:\/\/[^\s"'<>]*experience\.arcgis\.com\/experience\/[0-9a-f]{32}/i, evidence: 'Embedded ArcGIS Experience Builder application' },
  { kind: 'arcgis_portal_item', pattern: /https?:\/\/[^\s"'<>]+\/apps\/[^\s"'<>]*[?&]a?ppid=[0-9a-f]{32}/i, evidence: 'Embedded ArcGIS configurable or Instant application' },
  { kind: 'arcgis_portal_item', pattern: /https?:\/\/[^\s"'<>]+\/apps\/webappviewer\/index\.html\?id=[0-9a-f]{32}/i, evidence: 'Embedded ArcGIS Web AppBuilder application' },
  { kind: 'arcgis_server_root', pattern: /https?:\/\/[^\s"'<>]+\/rest\/services(?![^\s"'<>]*\/(Map|Feature|Image|Geocode|Geometry|GP|VectorTile)Server)/i, evidence: 'ArcGIS REST services root' },
  { kind: 'wfs', pattern: /https?:\/\/[^\s"'<>]*[?&]service=WFS[^\s"'<>]*/i, evidence: 'OGC WFS request' },
  { kind: 'wms', pattern: /https?:\/\/[^\s"'<>]*[?&]service=WMS[^\s"'<>]*/i, evidence: 'OGC WMS request' },
  { kind: 'geojson', pattern: /https?:\/\/[^\s"'<>]+\.geojson(\?[^\s"'<>]*)?/i, evidence: 'GeoJSON resource' },
  { kind: 'vector_tile', pattern: /https?:\/\/[^\s"'<>]+(tilejson|VectorTileServer|\{z\}\/\{x\}\/\{y\})[^\s"'<>]*/i, evidence: 'Vector tile source' },
];

/** ArcGIS item ids are exactly 32 lowercase hex characters. */
export const ARCGIS_ITEM_ID = /\b[0-9a-f]{32}\b/;

/**
 * Pull every structured service visible in the probe. This runs before any
 * adapter, so the escalation ladder can tell immediately whether a structured
 * route exists at all or whether the interactive map is the only thing there.
 */
export function extractStructuredServices(probe: PlatformProbeInput): DiscoveredService[] {
  const haystacks = [
    probe.url,
    probe.finalUrl ?? '',
    ...(probe.scriptUrls ?? []),
    ...(probe.networkUrls ?? []),
    probe.html ?? '',
  ].filter(Boolean);

  const found = new Map<string, DiscoveredService>();
  for (const haystack of haystacks) {
    for (const matcher of SERVICE_MATCHERS) {
      const global = new RegExp(matcher.pattern.source, `${matcher.pattern.flags.replace('g', '')}g`);
      for (const m of haystack.matchAll(global)) {
        const url = m[0].replace(/[),.;'"]+$/, '');
        // Keep the most specific classification per URL: a FeatureServer URL
        // also matches the services-root pattern, and the root must not win.
        if (found.has(url)) continue;
        found.set(url, { kind: matcher.kind, url, evidence: matcher.evidence });
      }
    }
  }
  return [...found.values()];
}

/* ────────────────────────────── detector ─────────────────────────────── */

/**
 * PART 2 — classify the platform behind a government parcel/GIS URL.
 *
 * Ties break toward the MORE SPECIFIC family (registry order), which is why a
 * Geocortex or Experience Builder site is reported as such rather than as bare
 * ArcGIS, while still routing to the ArcGIS adapter that actually works.
 */
export function fingerprintPlatform(probe: PlatformProbeInput): PlatformFingerprint {
  const scored = SCORED_PLATFORM_FAMILIES.map((family, index) => {
    const result = scoreFamily(PLATFORM_FAMILY_PROFILES[family], probe);
    return { family, index, ...result };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const structuredServices = extractStructuredServices(probe);
  const best = scored[0];

  if (!best) {
    // Nothing matched a family. Say so plainly, and only then ask whether the
    // site at least looks like an official government host.
    const looksOfficial = /\.(gov|us)$/i.test(hostOf(probe.finalUrl ?? probe.url));
    const family: GisPlatformFamily = looksOfficial ? 'custom_government_portal' : 'unknown';
    return {
      family,
      variant: null,
      confidence: looksOfficial ? 'low' : 'none',
      evidence: looksOfficial
        ? [{
            signal: 'hostname',
            family,
            detail: 'Host is a government domain but matches no known platform family.',
            observed: truncate(hostOf(probe.finalUrl ?? probe.url)),
            weight: SIGNAL_WEIGHT.hostname,
          }]
        : [],
      structuredServices,
      recommendedAdapter: 'generic_fallback',
      sourceUrl: probe.finalUrl ?? probe.url,
      alternates: [],
    };
  }

  const confidence = confidenceFor(best.score, best.evidence);
  const profile = PLATFORM_FAMILY_PROFILES[best.family];

  // A recognised family with no usable adapter still routes to the generic
  // fallback rather than pretending an adapter exists.
  const recommendedAdapter: GisAdapterId = profile.adapter;

  return {
    family: best.family,
    variant: best.variant,
    confidence,
    evidence: best.evidence,
    structuredServices,
    recommendedAdapter,
    sourceUrl: probe.finalUrl ?? probe.url,
    alternates: scored.slice(1, 4).map((entry) => ({ family: entry.family, score: entry.score })),
  };
}

/**
 * One-line operator summary of a fingerprint. Kept here so the UI never has to
 * reassemble vendor vocabulary.
 */
export function describeFingerprint(fingerprint: PlatformFingerprint): string {
  const profile = PLATFORM_FAMILY_PROFILES[fingerprint.family];
  const variant = fingerprint.variant ? ` (${fingerprint.variant.replace(/_/g, ' ')})` : '';
  return `${profile.vendor}${variant} — ${fingerprint.confidence} confidence from ${fingerprint.evidence.length} signal(s).`;
}
