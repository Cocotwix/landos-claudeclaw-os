# God's Eye View — pre-integration security audit

- Date: 2026-08-25
- Upstream: https://github.com/bilawalsidhu/gods-eye-view
- Reviewed commit: `880a672b5e16ad3e41d318801d3a5203f9201923` ("Release God's Eye View as open source") — verified to be upstream `main` HEAD at review time; only 4 commits exist, repo open-sourced 2026-08-24; upstream Security tab / published advisories: empty.
- Review method: cloned `--no-checkout` into an isolated scratchpad directory outside the LandOS runtime; files extracted with `git archive` (nothing executed, nothing installed). Five parallel read-only reviews: (A) full read of the 7,383-line `vite.config.js` server middleware plus all `scripts/` and `tools/`; (B) boot/lifecycle/integration surface (`index.html`, `main.js`, voice, Google tiles); (C) secrets/supply-chain/licensing across the whole tree; (D) breadth sweep of all ~205 client modules + `style.css`; (E) upstream issues/PRs/advisory databases. Plus lockfile-only dependency audits run directly.
- Deployment shape audited against: localhost-only LandOS (Hono binds 127.0.0.1), voice disabled, no OpenAI/Grok/AISStream/TomTom/FIRMS/Cesium-ion keys, Google Maps browser key absent until Tyler later configures a tiles-restricted one.

## Gate verdict: PASSED

- No critical findings.
- No unmitigated high-severity runtime findings for this deployment (the only high-classified items are dev-only tooling advisories and an upstream launcher script LandOS never runs).
- No unexplained outbound destination (complete inventory below).
- No path by which a LandOS secret reaches the browser: the integration never bakes env values into the client bundle; the upstream `define` mechanism is not used; the OpenAI/Google server endpoints are never mounted.
- No unexplained repository behavior: no eval/new Function in runtime code, no dynamic remote script loading, no service workers, no telemetry, no install/lifecycle hooks in the package itself, no obfuscated payloads, no committed secrets.

## Commands run and results

- `npm audit --package-lock-only --omit=dev` (isolated copy): **0 vulnerabilities** (production tree clean).
- `npm audit --package-lock-only` (full tree): **9 high — all in devDependencies** (puppeteer→extract-zip, ip-address, js-yaml, nanoid, postcss, sharp/libvips). Evaluated in context (below), not dismissed.
- sha512 verification of all 10 runtime dependency tarballs against upstream lockfile integrity values: **all OK** (see `vendor/gods-eye-view/VENDORED-ARTIFACTS.md`).
- Lockfile: lockfileVersion 3, 271 packages, every `resolved` URL on `https://registry.npmjs.org`, no git/http deps, no typosquats found. `hasInstallScript` only on esbuild, fsevents, puppeteer, sharp — all dev-only, none installed into LandOS.

## Dev-dependency advisories, evaluated for the local build/preview context

Upstream's own dev server IS its Vite config, so dev-chain advisories would matter if LandOS ran GEV's toolchain. LandOS does not: the client is built by LandOS's own Vite 5.4.21 (root `vite.config.ts`), the middleware runs inside the LandOS Hono server, and GEV's devDependencies (puppeteer 24.37.5, sharp 0.34.5, vite 6.4.3, ws 8.21.0, vite-plugin-cesium) are **never installed**. Therefore:

| Advisory group | Classification here |
|---|---|
| puppeteer → extract-zip symlink traversal (no patched release) | not applicable — never installed |
| sharp < 0.35 libvips CVEs | not applicable — never installed |
| postcss ≤ 8.5.22 sourcemap traversal | not applicable — GEV build chain unused; LandOS's own postcss is managed separately |
| js-yaml 4.x quadratic CPU, nanoid loops, ip-address SSRF-check bypass | not applicable — dev-only transitives of the unused toolchain |
| vite 6.4.3 (upstream's own) | clean/patched at pin; unused here anyway |
| ws 8.21.0 | exactly the patched version for CVE-2026-48779; unused here (AISStream WS not mounted) |
| Runtime deps: cesium 1.138.0, satellite.js 6.0.2, mgrs 2.1.0, pbf 5.1.2, @mapbox/vector-tile 3.0.0, egm96-universal 1.1.1 | **no known advisories** (cesium XSS CVE-2023-48094 affects ≤1.111.0 only) |

## Secrets and credential handling

- Full-tree secret scan: clean. `.env.example` contains placeholders only. The only "private key"-looking string is a secret-scanner regex inside upstream's own QA harness.
- Upstream design keeps all secret-bearing keys server-side; the Vite `define` block injects exactly two values (Google Maps browser key, Cesium ion token) — verified against code, and the docs' claim of two extra CCTV flags is stale in the safe direction. `VITE_AIS_LIVE_*` non-secret tuning values are the only other client-reachable env values.
- LandOS integration goes further: no `define` at all. The Google browser key is a runtime value Tyler may later set through the LandOS Settings surface (stored in `store/godseye/config.json`, explicitly labeled browser-visible, never in `.env`); absent key = honest setup-required state. **No LandOS `.env` file or stored credential was read, copied, modified, or exposed during audit or implementation.**
- Env-capture risk found and neutralized: upstream middleware reads ~48 `process.env.*` values at request time and its config factory snapshots the whole env via `loadEnv(mode, dir, '')`. Mounted in-process in LandOS, endpoints reading `OPENAI_API_KEY` / `GOOGLE_MAPS_API_KEY` could have picked up LandOS's own credentials. Mitigations: (1) the env shim patch replaces `loadEnv` with a closed, GEV-only env source; (2) the OpenAI and Google server endpoints are **excluded from the mount allowlist entirely**; (3) the CCTV Street View fallback (the one other Google-key spend path) is patched off.

## Server middleware (the entire upstream backend lives in `vite.config.js`)

Complete route inventory reviewed (OpenSky, opensky-track, adsb.lol mil/trace, adsbdb, CelesTrak, launches, TomTom, FIRMS, terrain heights, Overpass, OSRM route, military-installations, regional-brief, weather-effects, CCTV sources/frame/media/health, GBFS, radio stations/click, AIS live, OpenAI realtime token/debug-log/hud-summary, Google nearby-places/text-search). Key verified properties:

- Binds `localhost` by default; `allowedHosts` restricted (DNS-rebinding blocked). LAN exposure is explicit opt-in that LandOS does not use — the module rides the LandOS Hono server on 127.0.0.1.
- No client-supplied upstream URL anywhere except the GBFS proxy, which is https-only + host-allowlisted + path-restricted. SECURITY.md's radio-proxy claims verified in code: allowlisted radio-browser origins, redirect refusal, per-address DNS screening (loopback/private/link-local/CGNAT/metadata rejected), TLS pinned to the validated address, 4MB/12s caps, catalog-gated click endpoint. CCTV catalogs are origin-pinned (Austin/Caltrans/TfL).
- No eval/new Function/child_process in middleware; filesystem writes confined to fixed cache/log paths with validated or hashed names; no path traversal; QL sanitizer for Overpass is unusually thorough.
- No Node-24-only APIs in the middleware (engines pin is repo tooling); portable to the Node 22 LandOS server.

Findings carried into the integration (all low/accepted for this deployment; F-numbers from the full middleware review):

| Finding | Disposition in LandOS |
|---|---|
| F1 `scripts/dev-cctv.sh` defaults HOST=0.0.0.0 | not applicable — script never used; noted do-not-use |
| F2 CCTV Street View fallback spends Google key with client-supplied params | **patched off** (404 instead of Street View; also removes the key-collision path) |
| F3 `/api/realtime/debug-log` unauthenticated disk append | **not mounted** (voice disabled) |
| F4 GBFS proxy follows redirects; cap after buffering | **patched**: redirects refused (`redirect: 'manual'` + 502 on 3xx) |
| F5 missing timeouts/caps on some fixed-host fetches (OpenSky states, adsb.lol mil, CelesTrak, FIRMS) | accepted — fixed reputable upstreams, cache-fronted, localhost client only |
| F6 minor error-sanitization exceptions (launches raw body, err.message echoes) | accepted — no credential material in those paths |
| F7 no CSRF/Origin checks on GEV endpoints | mitigated — LandOS mounts them behind the existing `/api/*` dashboard auth (session cookie / token), which GEV fetches satisfy same-origin; cost endpoints not mounted |
| F8 opt-in rate limits default unlimited | not applicable — cost endpoints not mounted |
| F11 tiles-restricted key breaks Geocoding/Places | documented — geocoded search degrades honestly under a Map-Tiles-only key (recommended restriction) |
| #30/#32 (upstream issues, GBFS) | fixed by the same GBFS patch |
| #21 (allowedHosts:true when LAN-bound) | not applicable — never LAN-bound |

## Client code

- Breadth sweep of all client modules: **no** eval, new Function, string-timer args, document.write, importScripts, WebAssembly, dynamic third-party `<script>`/`<link>` creation, window.open, client WebSockets/EventSource, service workers, or third-party telemetry. All feed-data `innerHTML` sites use local escapers; annotation/callout text uses `textContent`. No prototype-pollution-prone merges. Debug hooks are console-only.
- Device/media access: `getUserMedia` exists only in the voice path behind an explicit user gesture — and voice wiring is not initialized in LandOS at all. No geolocation, camera, or Notification API use. Radio audio plays only on explicit user action (validated HTTPS public hosts only); the browser then connects directly to the chosen broadcaster (listener IP visible to it) — inherent to the feature, user-initiated, documented.
- Browser storage: first-party localStorage/sessionStorage only (layer state, panel layout, saved scenes, first-run flag, weather toggle); no IndexedDB; no secrets stored.
- Boot: single ESM entry, static DOM template, no inline scripts. Google 3D tileset is created once per boot; style/stack switches only toggle visibility — no per-camera-move or per-style session churn.

## Outbound network inventory (approved)

Browser-direct: `tile.googleapis.com` (Google 3D Tiles, only when a key is configured) · `maps.googleapis.com/maps/api/geocode` (same key, only when configured) · `earthquake.usgs.gov` · `terrain.reearth.land` · `tile.openstreetmap.org` · `fonts.googleapis.com`/`fonts.gstatic.com` · user-clicked radio stream hosts (validated public HTTPS from the Radio Browser directory) and attribution links (click-only). `api.cesium.com` only when a Cesium ion token (free tier) is configured in Settings → God's Eye View (2026-08 provider completion; unlocks Bing Aerial/Labels + World Terrain). Not present in LandOS: `api.openai.com` (voice never initialized).

Server-side (via mounted proxies, fixed/allowlisted upstreams): `opensky-network.org` + `auth.opensky-network.org`, `api.adsb.lol`/`adsb.lol`, `api.adsbdb.com`, `celestrak.org`, Overpass mirror pool (overpass-api.de, overpass.kumi.systems, lz4.overpass-api.de, overpass.private.coffee), `routing.openstreetmap.de`, `nominatim.openstreetmap.org`, `api.gdeltproject.org`, `api.open-meteo.com`, `ll.thespacedevs.com`, `terrain.reearth.land`, `data.austintexas.gov`, `cwwp2.dot.ca.gov`, `api.tfl.gov.uk` + TfL S3 jamcams bucket, CCTV frame hosts from the pinned catalogs (e.g. `cctv.austinmobility.io`), `*.api.radio-browser.info`, GBFS allowlist hosts. Key-gated endpoints that 503 cleanly without keys and contact nothing: FIRMS, TomTom, AISStream. Guard doctrine (2026-08 provider completion): only the metered TomTom route is unmounted when its env key exists; the genuinely free-key providers (FIRMS, AISStream, OpenSky credentials) mount and activate the moment their named free credential is configured. `news.google.com` IS contacted server-side by `/api/regional-brief` — patch 06 was revised (2026-08-25) to retain Google News RSS as the primary headline source (GDELT fallback), justified as personal-exploration-only use. Never mounted: OpenAI, Google Places/Text Search/Street View.

Rejected/absent: no analytics, no telemetry, no CDN scripts, no unexplained destinations.

## Licensing

- Code MIT (© Bilawal Sidhu) — notice preserved at `vendor/gods-eye-view/upstream/LICENSE`; Cesium Apache-2.0 notice at `vendor/gods-eye-view/libs/cesium/LICENSE.md`; per-lib licenses staged alongside every vendored artifact.
- Excluded from vendoring: `docs/media/` (© author, repo-only redistribution grant); TeleGeography submarine cables dataset (CC BY-NC-SA NonCommercial — business context). Cables layer removed by patch with the reason documented.
- Disabled: Google News RSS in regional brief (noncommercial restriction; GDELT retained). Kept with attribution: Natural Earth (PD), DataSF (PDDL), OSM-derived datasets (ODbL, attribution kept), Sketchfab models (CC BY 4.0 — `public/models/README.md` credits preserved), in-app data-credits surface (`dataCredits.js`) untouched.
- OpenSky's noncommercial API terms noted: the aircraft layer runs anonymous/keyless with the adsb.lol (ODbL) fallback intact; flagged for Tyler's judgment if usage stops being personal exploration.
- TomTom `.pbf` test fixture retained as a test fixture only.

## Intentionally disabled functionality (inventory)

Voice control + push-to-talk (never initialized; no mic permission possible), OpenAI HUD summary (local text fallback), Google Places/Text Search enrichment, CCTV Street View fallback frames, voice debug-log endpoint, submarine-cables layer, TomTom live traffic (paid — deliberately guarded off even if a key exists; built-in simulation fallback). FREE — CREDENTIAL REQUIRED (fully wired, honest setup states, activate on their named free key): AIS live vessels (`AISSTREAM_API_KEY`), FIRMS fires (`FIRMS_MAP_KEY`), authenticated OpenSky, Bing map stacks + World Terrain (Cesium ion token in Settings; OSM + Re:Earth terrain remain keyless). The live provider matrix is `/api/gev/providers`, rendered in Settings → God's Eye View.

## Evidence preservation

Isolated review copy and verified tarballs: session scratchpad `gev-review/` (clone, `git archive` extraction, tarballs, extracted libs). Durable evidence in-repo: this document, `vendor/gods-eye-view/UPSTREAM.md`, `VENDORED-ARTIFACTS.md` (registry URLs + verified sha512), `patches/PATCHES.md` + unified diffs of every deviation from pristine upstream.
