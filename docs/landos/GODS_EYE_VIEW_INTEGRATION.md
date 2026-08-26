# God's Eye View — LandOS integration report

Date: 2026-08-25 · Upstream: bilawalsidhu/gods-eye-view @ `880a672b5e16ad3e41d318801d3a5203f9201923` (MIT, upstream HEAD)
Security gate: PASSED — `docs/landos/GODS_EYE_VIEW_SECURITY_AUDIT.md`. Vendor boundary: `vendor/gods-eye-view/` (`UPSTREAM.md`, `VENDORED-ARTIFACTS.md`, `patches/PATCHES.md`).

## What was integrated

- **"God's Eye View" is a top-level sidebar department** (`/dept/gods-eye-view`), registered in the department model (`web/src/lib/departments.ts`) so the sidebar, command palette, and Mission Control all pick it up. It is a first-class SPA route — **no iframe** — with the sidebar alive alongside it (upstream's fixed-position panels are contained to the page by a transform containing block).
- **The complete upstream application** is vendored at the pinned commit and mounted by a host adapter (`web/src/gev/host.ts`): full boot (Cesium viewer, style manager, HUD, map stacks, layer manager with all registered layers, scene director, annotations, first-run experience), the upstream DOM template injected from upstream's own `index.html`, upstream `style.css` served as-is (scoped by patch 07).
- **Server side**: the audited upstream data-proxy middlewares run inside the LandOS Hono server via an env-isolated bridge (`src/godseye/upstream-bridge.ts`) — a synchronous `/api/*` dispatcher that longest-prefix-matches the harvested Connect handlers at the exact paths the client calls, behind the existing dashboard auth and the 127.0.0.1 bind. Mounted: OpenSky (anon), opensky-track, adsb.lol mil/trace, adsbdb, CelesTrak, launches, terrain heights, Overpass, OSRM route, military installations, regional brief (GDELT), weather effects, CCTV, radio, GBFS, TomTom status, FIRMS status, AIS status. **Never mounted**: OpenAI realtime/token/debug-log/hud-summary, Google places/text-search (spend + env-credential protection). Metered routes additionally refuse to mount if a matching key unexpectedly exists in the host env.
- **Dependencies without npm install** (deny-listed here): exact registry tarballs verified byte-for-byte against upstream's lockfile sha512 and staged under `vendor/gods-eye-view/libs/` — cesium 1.138.0 (prebuilt `Build/Cesium` ESM + Assets/Workers served at `/gev-static/cesium/`), satellite.js 6.0.2, mgrs 2.1.0, pbf 5.1.2, @mapbox/vector-tile 3.0.0, @mapbox/point-geometry 1.1.0, egm96-universal 1.1.1, rfc4648 1.5.4 — wired by Vite aliases in `vite.config.ts`.
- **Google Photorealistic 3D Tiles** support is fully integrated and awaiting Tyler's restricted browser key: runtime key sourcing (never a build-time define, never `.env`), one root-tileset session per boot, session-count gate before creation, honest keyless fallback (OSM/Cesium globe) when unconfigured.
- **Google free-allowance safeguards**: local monthly counter persisted server-side (`store/godseye/usage.json`), configurable limit default **900** (below the 1,000 free sessions), warnings at 75%/90%, hard stop at the limit (no new Google session; keyless map + banner), atomic gate endpoint, Settings display with month + progress bar, explicit "local safeguard, not Google's billing record" labeling. Suspend-instead-of-destroy on route leave exists specifically so route bounces never mint extra sessions; full destroy after 5 minutes away.
- **Shared spatial platform foundation**: `web/src/gev/property-evidence.ts` (the Property Evidence Package contract — identifiers, parcel geometry optional, imagery, constraints, terrain, soils, access, improvements, utilities, zoning, sold comps with inclusion/rejection reasons, active listings, source authority/dates/confidence/confirmed-vs-AI, operator findings) and `web/src/gev/spatial-platform.ts` (`openPropertyInGodsEyeView(pkg)` → navigate + fly-to subject + subject/comp/listing markers; applied by the host after mount). Valuation doctrine untouched: sold comps' median $/acre stays the FMV baseline; active listings are competition context; nothing derives numbers from visuals.

## Disabled or patched for security/licensing (patches in `vendor/gods-eye-view/patches/`)

1. Vite import shim — config factory needs no Vite and can never snapshot the LandOS env (patch 01).
2. Host lifecycle in `main.js` — export mount/destroy, keyless graceful boot, session gate, voice never wired (patch 02).
3. Submarine-cables layer removed — CC BY-NC-SA data vs business use; data folder excluded (patch 03).
4. CCTV Street View fallback disabled — Google-spend path with client-influenced params (patch 04).
5. GBFS proxy hardening — redirects refused, byte-accurate cap (patch 05, fixes upstream #30/#32).
6. Google News RSS disabled in regional brief — noncommercial-restricted; GDELT carries headlines (patch 06).
7. `style.css` page rules scoped behind `html.gev-active` (patch 07).
8. Hosted HUD AI-summary cadence disabled; deterministic local summary remains and the deliberately unmounted endpoint is never called (patch 08).
9. Excluded from vendoring: `docs/media/` (68 MB, repo-only license), TeleGeography dataset.
10. Host-added: document referrer meta `strict-origin-when-cross-origin` while mounted — OSM's tile server rejects no-referer apps; only the bare origin is ever sent, so the token-in-URL protection is preserved.

## Feature-gated (honest unavailable states, no crash)

Ships/AIS (`AISSTREAM_API_KEY`), active fires (`FIRMS_MAP_KEY`), live TomTom traffic (`TOMTOM_API_KEY` — simulation fallback works), Bing map stacks + world terrain (`CESIUM_ION_TOKEN`), Google 3D Tiles + geocoded search (browser Maps key), voice + HUD AI summary + Places enrichment (never callable in this installation). Keyless and working: OSM + Re:Earth terrain map, aircraft (anon OpenSky + adsb.lol), military aircraft, satellites, earthquakes, space missions, CCTV (Austin/Caltrans/TfL), radio, bikeshare, military installations, Overpass roads, routing, weather, regional brief (GDELT), datacenters/dams local layers, annotations, measurements, routes, scenes, share links, cockpit.

## Files changed / added

- Added: `vendor/gods-eye-view/**` (upstream at pin + patches + libs + docs); `src/godseye/{config,routes,upstream-bridge}.ts`; `web/src/gev/{host.ts,gev.d.ts,property-evidence.ts,spatial-platform.ts}`; `web/src/pages/GodsEyeView.tsx`; `docs/landos/GODS_EYE_VIEW_SECURITY_AUDIT.md`; this report.
- Modified: `src/dashboard.ts` (2-line route registration), `web/src/lib/departments.ts` (new department entry + Globe icon), `web/src/App.tsx` (explicit route), `web/src/pages/Settings.tsx` (God's Eye View section + acknowledgement), `vite.config.ts` (aliases, fs.allow, dev proxies), `.landos/OPERATOR_QA.md` (QA entry).
- No `package.json`/lockfile changes. No `.env` read or written. No commits (per invariant 7).

## Tests and audits run

- `npm audit --package-lock-only --omit=dev` (isolated upstream copy): 0 vulnerabilities; full audit: 9 high, all dev-only tooling, not installed here.
- sha512 verification of all vendored tarballs vs upstream lockfile: all OK.
- `npx tsc --noEmit`: clean. `npm run build` (vite + tsc): clean.
- `vitest`: dashboard contract 147/147; vision-architecture 21/21; routing-map 11/11. Full suite 7695 pass / 24 pre-existing failures confined to in-flight market-intelligence work and checkpoint-state drift (memory-bootstrap, routes Phase-1 hash, Pickens routing, comps-valuation-integration, sprint checkpoint-integration, etc.) — none touch God's Eye View; no unrelated expectations were changed to force a pass.
- Live browser acceptance on `http://localhost:3141` with screenshots: `store/operator-qa-canonical/gods-eye-view/` and the OPERATOR_QA entry dated 2026-08-25.

## Confirmed limitations

- Hidden/backgrounded tabs stop the render loop (upstream power-saving; resumes on visibility). Not a defect.
- The HUD uses deterministic local summary text in LandOS; the upstream AI-summary cadence is disabled with its endpoint deliberately unmounted.
- Geocoded search/fly-to needs the Google key; with a Map-Tiles-only restriction the Geocoding API calls will fail closed (documented upstream inconsistency F11 — enable the Geocoding API on the same restricted browser key if search is wanted).
- A handful of upstream module-scope listeners cannot be removed on destroy (inert without a viewer; safe on remount via module cache).
- The data-layer toggle panel can visually lag behind programmatic layer changes while the tab is backgrounded (UI refresh rides the suspended render cadence).

## Upstream updates

Follow `vendor/gods-eye-view/UPSTREAM.md`: fetch into an isolated dir, diff against `880a672`, repeat a proportionate security review, re-verify the `define` block and outbound inventory, re-apply patches deliberately, re-verify lib hashes if pins moved, rebuild + retest + browser acceptance. Never auto-merge upstream.

## Manual Google Cloud steps for Tyler (later, optional — nothing was created or changed by this work)

1. Create a **new browser key** (never reuse a server credential) in Google Cloud Console.
2. Restrict it: API restriction → **Map Tiles API** (add Geocoding API only if you want in-app search); Application restriction → HTTP referrers `http://localhost:3141/*` (and `http://localhost:5173/*` for dev).
3. Recommended billing backstop: set a **per-API quota** on Map Tiles root tileset requests (e.g. 900/month) and a budget alert — the LandOS counter is a local safeguard, not the billing record. Authoritative usage: Google Cloud console → Map Tiles API metrics.
4. Google requires billing to be enabled on the project for the free allowance; do that only if/when you accept it.
5. Paste the key into **Settings → God's Eye View** in LandOS. Nothing else is needed; the department upgrades from the keyless map to Photorealistic 3D Tiles on the next open.
