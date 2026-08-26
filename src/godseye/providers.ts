import { getGevConfig } from './config.js';

/**
 * God's Eye View provider matrix — the single honest statement of which
 * upstream data/visual sources are active, which are free-but-need-a-free-key,
 * which are Google (the one approved metered exception), and which stay
 * disabled because they cost money.
 *
 * Classification is a static property of each provider (its cost model does
 * not change at runtime); ACTIVATION is dynamic (key present in the LandOS
 * environment or GEV config). Only key *presence* is consulted here — never a
 * value, and nothing from this module ever returns credential material.
 *
 * Doctrine (accepted 2026-08 provider-completion sprint):
 * - Every genuinely free keyless source is mounted and active.
 * - Free sources that need a free account/key are fully wired and mount the
 *   moment their named key exists; they are labeled FREE — CREDENTIAL
 *   REQUIRED, never "paid" or "broken".
 * - Google imagery/3D is the only approved metered provider, behind the local
 *   monthly session safeguard and a browser-restricted key in GEV Settings.
 * - Non-Google paid providers (TomTom live flow) stay disabled even if a key
 *   appears in the environment (see KEY_GUARDS in upstream-bridge.ts).
 */

export type GevProviderStatus =
  | 'active'                // works now, no credential needed (or credential present)
  | 'credential-required'   // fully wired; activates when the named free key exists
  | 'google-setup'          // approved Google capability awaiting the restricted browser key
  | 'paid-disabled'         // metered non-Google provider, deliberately off
  | 'removed';              // upstream capability removed/unreachable by design

export interface GevProviderState {
  id: string;
  label: string;
  capability: string;
  costModel: 'free' | 'free-key' | 'google-metered' | 'paid';
  credential: string | null; // env var / settings field name, never a value
  status: GevProviderStatus;
  note?: string;
}

function envPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

export function getGevProviderStates(): GevProviderState[] {
  const cfg = getGevConfig();
  const googleReady = cfg.googleMapsBrowserKey.length > 0;
  const ionReady = cfg.cesiumIonToken.length > 0;
  return [
    // ── Basemaps / terrain / 3D ──
    { id: 'osm', label: 'OpenStreetMap basemap', capability: 'Global 2D basemap (default globe)', costModel: 'free', credential: null, status: 'active' },
    { id: 'reearth-terrain', label: 'Re:Earth terrain', capability: '3D terrain mesh + height lookups', costModel: 'free', credential: null, status: 'active' },
    {
      id: 'google-photoreal', label: 'Google Photorealistic 3D Tiles', capability: '3D photorealistic imagery (primary visual stack)',
      costModel: 'google-metered', credential: 'Settings → God\'s Eye View browser key',
      status: googleReady ? 'active' : 'google-setup',
      note: googleReady
        ? `Local safeguard: ${cfg.monthlySessionLimit} sessions/month.`
        : 'Approved Google exception. Paste a Map-Tiles-restricted browser key in Settings; the local monthly session safeguard is already enforced.',
    },
    {
      id: 'bing-aerial', label: 'Bing Aerial (Cesium ion)', capability: 'Aerial imagery basemap (+ labels variant)',
      costModel: 'free-key', credential: 'Settings → God\'s Eye View Cesium ion token',
      status: ionReady ? 'active' : 'credential-required',
      note: ionReady ? undefined : 'Free Cesium ion account token unlocks Bing Aerial, Bing Aerial + Labels, and Cesium World Terrain.',
    },
    // ── Environmental / hazard ──
    { id: 'earthquakes', label: 'USGS Earthquakes (24h)', capability: 'Live seismic events', costModel: 'free', credential: null, status: 'active' },
    { id: 'weather', label: 'Open-Meteo weather', capability: 'Weather effects + regional conditions', costModel: 'free', credential: null, status: 'active' },
    {
      id: 'firms', label: 'NASA FIRMS active fires', capability: 'VIIRS fire/thermal detections',
      costModel: 'free-key', credential: 'FIRMS_MAP_KEY',
      status: envPresent('FIRMS_MAP_KEY') ? 'active' : 'credential-required',
      note: envPresent('FIRMS_MAP_KEY') ? undefined : 'Free NASA FIRMS map key activates the layer.',
    },
    // ── Space ──
    { id: 'satellites', label: 'CelesTrak satellites', capability: 'Live satellite catalog (TLE propagation)', costModel: 'free', credential: null, status: 'active' },
    { id: 'launches', label: 'Space missions (LL2)', capability: 'Launch schedule/tracking', costModel: 'free', credential: 'LL2_API_TOKEN (optional)', status: 'active', note: 'Anonymous tier: 15 calls/hour; a free token raises the limit.' },
    // ── Aviation ──
    { id: 'opensky', label: 'OpenSky live flights', capability: 'Live ADS-B aircraft states', costModel: 'free', credential: 'OPENSKY_CLIENT_ID/_SECRET (optional)', status: 'active', note: 'Anonymous tier active with adsb.lol fallback; free OpenSky credentials raise limits. Non-commercial license.' },
    { id: 'adsblol-mil', label: 'adsb.lol military flights', capability: 'Military aircraft + traces', costModel: 'free', credential: null, status: 'active' },
    // ── Maritime ──
    {
      id: 'ais', label: 'AISStream live vessels', capability: 'Live AIS vessel positions',
      costModel: 'free-key', credential: 'AISSTREAM_API_KEY',
      status: envPresent('AISSTREAM_API_KEY') ? 'active' : 'credential-required',
      note: envPresent('AISSTREAM_API_KEY') ? undefined : 'Free AISStream key activates the layer.',
    },
    // ── Transportation ──
    { id: 'traffic-sim', label: 'Street traffic (OSM/Overpass)', capability: 'Road geometry + simulated flow', costModel: 'free', credential: null, status: 'active' },
    { id: 'routing', label: 'OSRM routing', capability: 'Road routing', costModel: 'free', credential: null, status: 'active' },
    { id: 'bikeshare', label: 'GBFS bikeshare', capability: '26 public bikeshare systems', costModel: 'free', credential: null, status: 'active' },
    {
      id: 'tomtom', label: 'TomTom live traffic flow', capability: 'Real-time traffic flow tiles',
      costModel: 'paid', credential: 'TOMTOM_API_KEY',
      status: 'paid-disabled',
      note: 'Metered non-Google provider: deliberately not mounted even if a key exists. Simulated flow covers the layer.',
    },
    // ── Ground visual ──
    { id: 'cctv', label: 'Public CCTV (Austin/Caltrans/TfL)', capability: 'Public traffic cameras', costModel: 'free', credential: 'TFL_APP_KEY (optional)', status: 'active' },
    // ── Context ──
    { id: 'regional-brief', label: 'Regional brief', capability: 'Reverse geocode + headlines + weather', costModel: 'free', credential: null, status: 'active' },
    { id: 'radio', label: 'Radio Browser', capability: 'Live radio streams', costModel: 'free', credential: null, status: 'active' },
    { id: 'military-installations', label: 'Mapped installations (OSM)', capability: 'Military installation polygons', costModel: 'free', credential: null, status: 'active' },
    { id: 'local-datasets', label: 'Bundled datasets', capability: 'Datacenters, dams, Natural Earth regions', costModel: 'free', credential: null, status: 'active' },
    // ── Removed by security review ──
    { id: 'submarine-cables', label: 'TeleGeography submarine cables', capability: 'Cable map', costModel: 'free', credential: null, status: 'removed', note: 'CC BY-NC-SA dataset removed during vendoring (license).' },
    { id: 'voice', label: 'Voice / OpenAI realtime', capability: 'Voice control + HUD summaries', costModel: 'paid', credential: 'OPENAI_API_KEY', status: 'removed', note: 'Voice disabled; OpenAI routes never mounted.' },
    { id: 'google-places', label: 'Google Places / Text Search', capability: 'POI enrichment', costModel: 'paid', credential: 'GOOGLE_MAPS_API_KEY', status: 'removed', note: 'Server-key pattern excluded so GEV can never spend LandOS environment credentials.' },
  ];
}
