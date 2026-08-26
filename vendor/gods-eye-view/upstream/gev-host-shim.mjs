// LandOS host shim for the vendored God's Eye View vite.config.js.
// Added by LandOS patch 01 (see ../patches/PATCHES.md). Not an upstream file.
//
// Purpose: let the LandOS server import the upstream config factory to harvest
// its Connect middlewares WITHOUT depending on Vite or vite-plugin-cesium and
// WITHOUT letting the factory snapshot the LandOS process environment.
//
// - defineConfig: identity (matches Vite's behavior for our usage).
// - loadEnv: returns a closed empty object. Upstream merges the result into
//   process.env only for keys that are undefined; with an empty object nothing
//   is ever written, and no .env file is read from anywhere.
// - cesium: no-op plugin. The LandOS build aliases `cesium` to the vendored
//   prebuilt ESM bundle and serves Build/Cesium assets at /gev-static/cesium/.

export function defineConfig(config) {
  return config;
}

export function loadEnv(_mode, _dir, _prefix) {
  return {};
}

export function cesium() {
  return { name: 'gev-host-noop-cesium' };
}
