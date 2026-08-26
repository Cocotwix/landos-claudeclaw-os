# God's Eye View — vendored module

Upstream: https://github.com/bilawalsidhu/gods-eye-view
Pinned commit: `880a672b5e16ad3e41d318801d3a5203f9201923` ("Release God's Eye View as open source", 2026-08-24 — upstream HEAD at review time)
License: MIT (code), © Bilawal Sidhu — see `upstream/LICENSE`. Data/asset carve-outs listed below.
Security review: `docs/landos/GODS_EYE_VIEW_SECURITY_AUDIT.md` (2026-08-25, gate PASSED).

## Layout

- `upstream/` — the upstream tree at the pinned commit, minus license-excluded
  assets (below), plus the small documented patches in `patches/`.
- `libs/` — hash-verified prebuilt runtime dependencies (see
  `VENDORED-ARTIFACTS.md`). No npm install is performed for this module; these
  are exact registry artifacts verified against upstream's `package-lock.json`
  sha512 integrity values.
- `patches/` — every deviation from pristine upstream, as unified diffs plus
  `PATCHES.md` explaining each. `upstream/` = pristine + these patches, nothing
  else.

## Excluded from the vendored copy (licensing)

- `docs/media/` (~68 MB demo GIFs/PNGs) — © Bilawal Sidhu, licensed only for
  redistribution with the upstream repository; not covered for reuse here.
- `src/data/local_data/telegeography_submarine_cables/` — CC BY-NC-SA 3.0
  (NonCommercial). This installation supports a land-investing business, so the
  submarine-cables layer is removed (patch `03-remove-cables-layer`).

## Disabled by patch or by never mounting (security/policy)

- Voice (OpenAI Realtime), HUD AI summary, Google Places/Text Search server
  endpoints, CCTV Street View fallback, voice debug-log endpoint — never
  mounted or patched off. See PATCHES.md and the security audit.
- Google News RSS in the regional brief (upstream docs restrict it to
  noncommercial use); GDELT path remains.

## How LandOS consumes this module

- Client: `web/src/pages/GodsEyeView.tsx` + `web/src/gev/host.ts` mount the
  upstream app (aliased `@gev-upstream` in `vite.config.ts`); runtime deps
  resolve to `libs/` via aliases; Cesium static assets are served at
  `/gev-static/cesium/` by the Hono server directly from `libs/cesium/Build/Cesium`.
- Server: `src/godseye/upstream-bridge.ts` harvests the Connect middlewares
  from `upstream/vite.config.js` (via the patched local env shim, NOT Vite) and
  mounts an allowlisted subset on the LandOS Hono app at the same `/api/*`
  paths, behind the existing dashboard auth and loopback binding.

## Updating from upstream — required process

1. Never merge upstream automatically. Fetch the new commit into an isolated
   directory outside the runtime (not into this tree).
2. Repeat a proportionate security review: diff against the previously
   reviewed commit, re-run `npm audit --package-lock-only` (prod and full),
   re-check open security issues, re-verify the Vite `define` block still
   exposes only the two documented browser keys, and re-inventory any new
   outbound destinations, env reads, or lifecycle scripts.
3. Record the new commit SHA and findings in a new section of the security
   audit doc. Only then replace `upstream/`, re-apply/refresh `patches/`,
   re-run the exclusions above, and re-verify `libs/` hashes if dependency
   pins changed (verify new tarballs against the new lockfile integrity).
4. Re-run the LandOS build, tests, and browser visual acceptance for the
   God's Eye View department before reporting the update complete.
