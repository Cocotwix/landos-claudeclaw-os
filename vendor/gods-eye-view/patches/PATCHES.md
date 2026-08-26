# Patches applied to the vendored God's Eye View copy

`upstream/` = pristine commit `880a672b5e16ad3e41d318801d3a5203f9201923`
minus the license exclusions listed in `../UPSTREAM.md`, plus exactly these
patches. Each `.patch` file is the unified diff against pristine upstream.
When updating upstream, re-derive these deliberately — never auto-apply.

## 01 — vite import shim (`01-04-05-06-server.patch`, `upstream/gev-host-shim.mjs` new file)
`vite.config.js` imports `defineConfig`/`loadEnv`/`cesium` from a local shim
instead of `vite`/`vite-plugin-cesium`. The shim's `loadEnv` returns a closed
empty env so the config factory can never snapshot the LandOS process
environment or read any `.env` file; `cesium()` is a no-op plugin. This lets
the LandOS server import the factory to harvest its Connect middlewares with
no Vite dependency.

## 02 — main.js host lifecycle (`02-main-host-lifecycle.patch`)
- `init()` no longer self-invokes under a host (`window.__GEV_HOSTED__`);
  exports `mountGodsEyeView(hostOptions)` / `destroyGodsEyeView()`.
- Google Maps key becomes a runtime host value; a missing key is an honest
  keyless fallback (OSM/Cesium globe) instead of a boot abort.
- Google 3D Tiles root-tileset creation (the billable session) is gated by
  `hostOptions.beforeGoogleSession()` and reported to
  `hostOptions.onGoogleSessionCreated()` — the LandOS monthly safeguard.
- The map-stack controller receives the host's configuration state so the
  keyless Google control says "Setup required" without making a Google request;
  configured-but-refused or failed sessions remain distinguishable.
- Voice wiring is skipped entirely unless `hostOptions.enableVoice === true`
  (LandOS never sets it): no voice UI, no listeners, no mic path.
- Hosted first-run copy states that voice is disabled instead of advertising
  the upstream MIC control that LandOS deliberately does not mount.
- Client-side Google GEOCODING is hard-off unless
  `hostOptions.enableGeocoding === true` (LandOS never sets it): the
  `window.__GOOGLE_MAPS_API_KEY__` global that feeds locations.js /
  annotationResolver.js / voice geocode calls stays undefined, so the
  Geocoding API is never contacted even if the configured key would allow it.
  Only the Map Tiles path (Cesium.GoogleMaps.defaultApiKey) receives the key.
- Logo-gaze starts inside `init()` so its window listeners are removable.
- `destroyGodsEyeView()` performs the whole-app teardown upstream never
  needed: voice stop, `dataManager.destroyAll()`, HUD/cloud/scope-mask/logo
  teardown, `viewer.destroy()` (render loop, workers, WebGL), removal of
  body-appended nodes and body/document mode classes, global handle cleanup.

## 03 — submarine cables removal (`03a`, `03b`)
Licensing (CC BY-NC-SA NonCommercial vs business use): layer not registered,
registry entry removed (share-link token `u` reserved), data folder excluded
from the vendored copy. `telegeographySubmarineCables.js` remains on disk but
is unreferenced and is never bundled.

## 04 — CCTV Street View fallback disabled (in `01-04-05-06-server.patch`)
The fallback was a Google-key spend path with client-influenced parameters
(upstream issue #20 / review finding F2) and would have picked up any
`GOOGLE_MAPS_API_KEY` in the host env. Unknown frames now fall back to the
synthetic placeholder.

## 05 — GBFS proxy hardening (same patch file)
Redirects refused (`redirect: 'manual'` + 502 on 3xx — upstream issue #30)
and the response cap compares bytes, not UTF-16 units (upstream issue #32).

## 06 — Google News RSS disabled (same patch file)
Noncommercial-restricted source; regional headlines come from the GDELT
fallback, which permits commercial use with citation.

## 07 — style.css page-rule scoping (`07-style-scope.patch`)
The stylesheet's `html, body` rules (background, overflow, fonts) apply only
under `html.gev-active`, which the host adapter toggles on mount/resume and
removes on suspend/destroy — so the stylesheet can stay loaded while other
LandOS pages render unchanged. The `*` reset is left as-is (a no-op under
Tailwind preflight).

## 08 — hosted HUD summary stays local (`08-disable-hosted-hud-ai.patch`)
LandOS deliberately does not mount the OpenAI HUD-summary endpoint. Hosted mode
therefore keeps the deterministic camera/layer summary, skips the 15-second AI
request cadence, and emits no recurring 404 warning or model-call attempt.

## 09 — keyless manual search via the host geocoder (in-tree edit, 2026-08-25)
`searchAndFlyTo` previously threw without a Google key, so manual address/place
search always failed in the keyless LandOS default. It now falls back to the
host's governed free endpoint `/api/gev/geocode` (LandOS canonical subject
match first, then Nominatim), flies to the best candidate, and returns an
honest null on no match — never the default demo location. Google-keyed
behavior is unchanged. Helper: `keylessSearchAndFlyTo` in `src/locations.js`.

## 10 — bounded startup cover (in-tree edit, 2026-08-25)
With the free-layer set durably ON, the state hash restores many network-backed
layers and the truthful startup cover waited on all of them — an unbounded
loader after refresh. The cover now yields after at most 12s (Promise.race in
`src/main.js`); layers keep booting behind the live globe with honest row
states. Share-restore fidelity is otherwise unchanged.
