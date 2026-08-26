import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { flyToAustin } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import satellitesLayer from './data/satellites.js';
import rocketLaunchesLayer from './data/rocketLaunches.js';
import trafficLayer from './data/traffic.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import bikeshareLayer from './data/bikeshare.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import localDataLayers from './data/localLayers.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initGevVoiceCommands } from './voice/gevRealtime.js';
import { MapStackController } from './mapStackController.js';
import { initAnnotations } from './annotations/index.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { initFirstRunExperience } from './firstRunExperience.js';
import { destroyScopeMask } from './scopeMask.js';

// LandOS patch 02 (see ../patches/PATCHES.md): logo gaze starts inside init()
// so the host can remove its window listeners on destroy. Standalone upstream
// behavior is preserved by the auto-boot guard at the bottom of this file.

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

/**
 * GOD'S EYE VIEW — Main Entry Point
 * Initializes CesiumJS with Google Photorealistic 3D Tiles,
 * style system, intelligence HUD, location presets, and share links.
 */
async function init(hostOptions = {}) {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');

  try {
    loaderStatus.textContent = 'Configuring viewer...';

    const removeLogoGaze = initLogoGaze();

    // Set Cesium Ion token for World Terrain
    // LandOS patch 02: token may arrive from the host at runtime instead of a
    // build-time define. Neither is configured in LandOS today.
    const cesiumToken = hostOptions.cesiumIonToken || import.meta.env.CESIUM_ION_TOKEN;
    if (cesiumToken) {
      Cesium.Ion.defaultAccessToken = cesiumToken;
    }

    // Set Google Maps API key for 3D Tiles
    // LandOS patch 02: the key is a runtime value from the host (operator
    // Settings), never baked into the bundle. A missing key no longer aborts
    // the app — the keyless OSM/Cesium-globe path below is the honest
    // fallback, matching the tileset-failure behavior upstream already has.
    const googleApiKey = hostOptions.googleMapsKey || import.meta.env.GOOGLE_MAPS_API_KEY || '';
    if (googleApiKey) {
      Cesium.GoogleMaps.defaultApiKey = googleApiKey;
    }
    // LandOS patch 02: the window global feeds the client-side Google
    // GEOCODING calls (locations.js, annotationResolver.js, voice actions).
    // Under the host, the approved key is Map-Tiles-only, so geocoding stays
    // hard-off unless the host explicitly opts in later — this guarantees the
    // Geocoding API is never contacted regardless of how the key is
    // restricted, not merely expected to fail. Geocoded search degrades to
    // its honest unavailable state.
    window.__GOOGLE_MAPS_API_KEY__ = (googleApiKey && hostOptions.enableGeocoding === true)
      ? googleApiKey
      : undefined;

    // Create the Cesium viewer with minimal chrome
    const viewer = new Cesium.Viewer('cesiumContainer', {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      // Visible attribution container — Google Maps / 3D Tiles credits are
      // required by Google's Terms of Service, so they must be shown (styled
      // subtly via #cesium-credits). The credit line stays visible in
      // clean-view AND recording modes too (ToS requires attribution while the
      // content is displayed — those are the exact modes used to record
      // demos), including the "Data attribution" link that opens the per-layer
      // license popover.
      creditContainer: (() => {
        const el = document.createElement('div');
        el.id = 'cesium-credits';
        document.body.appendChild(el);
        return el;
      })(),
      msaaSamples: 4,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    // Cap the default render loop at 60 fps. Cesium's loop otherwise runs at
    // the display's refresh rate — 120 Hz on ProMotion panels — doubling GPU
    // and CPU burn for zero visual benefit in a map app whose animation
    // cadences (poll interpolation, trail fades, style crossfades) are all
    // designed against wall-clock time, not frame count. Measured on the
    // 2026-08-05 perf investigation as a strict halving of idle burn on
    // 120 Hz hardware; a no-op on 60 Hz displays. (perf item 2)
    viewer.targetFrameRate = 60;

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe attribution line.
    registerDataCredits(viewer);

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    viewer.scene.globe.show = false;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    let tileset = null;
    let googleSessionBlocked = false;
    if (!googleApiKey) {
      // LandOS patch 02: honest keyless state — no Google request is made.
      loaderStatus.textContent = 'Google 3D Tiles not configured. Continuing with the keyless map...';
      viewer.scene.globe.show = true;
    } else {
      // LandOS patch 02: session safeguard gate. Creating the root tileset is
      // the billable Google session; the host may refuse it (monthly local
      // limit reached) and the app continues on the keyless map instead.
      let allowSession = true;
      if (typeof hostOptions.beforeGoogleSession === 'function') {
        try {
          allowSession = (await hostOptions.beforeGoogleSession()) !== false;
        } catch {
          allowSession = true;
        }
      }
      if (!allowSession) {
        googleSessionBlocked = true;
        loaderStatus.textContent = 'Google 3D Tiles paused by the monthly session safeguard. Continuing with the keyless map...';
        viewer.scene.globe.show = true;
      } else {
        loaderStatus.textContent = 'Loading Google 3D Tiles...';
        try {
          // Load Google Photorealistic 3D Tiles
          tileset = await Cesium.createGooglePhotorealistic3DTileset({
            onlyUsingWithGoogleGeocoder: true,
          });
          viewer.scene.primitives.add(tileset);
          // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
          // Google Photorealistic 3D Tiles provide their own terrain/elevation.
          viewer.scene.globe.show = false;
          // LandOS patch 02: report the (single, boot-time) session creation
          // to the host's local usage counter.
          try { hostOptions.onGoogleSessionCreated?.(); } catch { /* counter is best-effort */ }
        } catch (tileError) {
          console.warn('[Init] Google 3D Tiles unavailable, falling back to Cesium globe:', tileError);
          const tileErrorDetail = describeError(tileError);
          loaderStatus.textContent = `Google 3D Tiles unavailable (${tileErrorDetail}). Continuing in fallback mode...`;
          // Keep Cesium globe visible as fallback instead of aborting the app.
          viewer.scene.globe.show = true;
        }
      }
    }

    loaderStatus.textContent = 'Initializing systems...';

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      initialStack: tileset ? 'photoreal' : 'osm',
      // Preserve the distinction between an unconfigured provider and a
      // configured provider whose session was refused or failed. The map chip
      // can then say "Setup required" in keyless mode without pretending a
      // Google request was attempted.
      providerHooks: { googleConfigured: Boolean(googleApiKey) },
      // Task 5 (height-datum fix): rebroadcast stack changes as a window
      // CustomEvent so data layers (CCTV per-regime ground resolution) can
      // react without coupling MapStackController to layer modules. Fires on
      // 'switching'/'ready'/'error'; listeners derive the surface regime from
      // live scene state, so intermediate emissions are harmless.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    const styleManager = new StyleManager(viewer, { mapStackController });
    // The previous multi-canvas weather compositor remains disabled. Cockpit
    // clouds use a separate, capped low-resolution GPU pass that never attaches
    // Cesium fog or post-process stages and is fully stopped in map mode.
    const weatherEffects = null;
    const cockpitCloudEffects = initCockpitCloudEffects(viewer);

    // If no share link state, do default fly-to Austin
    if (!styleManager.hasShareState) {
      loaderStatus.textContent = 'Flying to Austin, TX...';
      flyToAustin(viewer);
    } else {
      loaderStatus.textContent = 'Restoring shared view...';
    }

    // Initialize data layer manager
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
    });
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(satellitesLayer);
    dataManager.register(rocketLaunchesLayer);
    rocketLaunchesLayer.attachDataManager(dataManager);
    dataManager.register(trafficLayer);
    dataManager.register(cctvLayer);
    dataManager.register(radioLayer);
    dataManager.register(bikeshareLayer);
    dataManager.register(aisLiveVesselsLayer);
    dataManager.register(militaryInstallationsLayer);
    dataManager.register(militaryAwarenessLayer);
    militaryAwarenessLayer.attachDataManager(dataManager);
    for (const layer of localDataLayers) {
      dataManager.register(layer);
    }
    // Restoration starts only after the complete production registry is sealed.
    dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY);
    if (import.meta.env.DEV) {
      window.__gevQaRegisterLayer = (targetManager, layerModule) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.registerForQa(layerModule);
      };
      window.__gevQaUnregisterLayer = (targetManager, layerId) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.unregisterForQa(layerId);
      };
    }
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    // LandOS patch 10: the cover is BOUNDED. With the full free-layer set
    // durably ON (provider-completion default), the state hash restores a
    // dozen network-backed layers, and gating the cover on every one of them
    // terminating left the operator staring at the loader for minutes after a
    // refresh. The cover now yields after at most 12s; remaining layers keep
    // booting visibly behind the live globe with their own row states.
    void Promise.race([
      Promise.all([
        styleManager.initialRestorePromise,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]),
      new Promise((resolve) => setTimeout(resolve, 12000)),
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        initFirstRunExperience({ styleManager, dataManager });
      };
      loadingScreen.addEventListener('transitionend', revealFirstRun, { once: true });
      setTimeout(revealFirstRun, 900);
    });

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

    // The follow camera recomputes the tracked target's dead-reckon position
    // every frame — tracking anything is a per-frame animation. (perf wave 2)
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
    // stop the default render loop outright — a hidden canvas repaints for
    // nobody, and browser rAF throttling still lets throttled frames burn
    // GPU. Holder/data state is untouched, so return is seamless: restore
    // the loop, refresh the one DOM surface we gated, render a frame.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden;
      cockpitCloudEffects?.setSuspended?.(hidden);
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    // Apply the CURRENT state too — bootstrap can complete while the tab is
    // already hidden, and waiting for the next transition would leave the
    // loop burning behind a hidden tab. (perf wave 2 fix)
    syncVisibilitySuspension();

    window.__godsEyeView = {
      viewer,
      styleManager,
      tileset,
      dataManager,
      sceneDirector,
      mapStackController,
      annotations,
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    // LandOS patch 02: voice is disabled by default under the host. When it is
    // off, the voice UI is never injected, no document listeners are bound, no
    // microphone permission can be requested, and no /api/realtime endpoint is
    // ever called (those endpoints are not mounted by the host anyway).
    window.__godsEyeView.voiceCommands = hostOptions.enableVoice === true
      ? initGevVoiceCommands({ viewer, styleManager, dataManager, sceneDirector, annotations })
      : null;

    // LandOS patch 02: handles the host needs for suspend/destroy plus honest
    // provider state for the host UI.
    window.__godsEyeView.host = {
      removeLogoGaze,
      syncVisibilitySuspension,
      googleKeyConfigured: Boolean(googleApiKey),
      googleSessionBlocked,
    };

  } catch (error) {
    console.error("God's Eye View initialization failed:", error);
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  }
}

/**
 * LandOS patch 02 — host lifecycle API.
 * mountGodsEyeView() runs the normal boot against DOM the host has already
 * injected; destroyGodsEyeView() is the whole-app teardown upstream never
 * needed (it owns the page, the host does not).
 */
export async function mountGodsEyeView(hostOptions = {}) {
  await init(hostOptions);
  return window.__godsEyeView || null;
}

export async function destroyGodsEyeView() {
  const app = window.__godsEyeView;
  if (!app) return;
  try { app.voiceCommands?.stop?.({ removeUi: true }); } catch { /* teardown is best-effort */ }
  try { await app.dataManager?.destroyAll?.(); } catch { /* teardown is best-effort */ }
  try { app.styleManager?.hud?.destroy?.(); } catch { /* teardown is best-effort */ }
  try { app.cockpitCloudEffects?.destroy?.(); } catch { /* teardown is best-effort */ }
  try { destroyScopeMask(); } catch { /* teardown is best-effort */ }
  try { app.host?.removeLogoGaze?.(); } catch { /* teardown is best-effort */ }
  if (app.host?.syncVisibilitySuspension) {
    try { document.removeEventListener('visibilitychange', app.host.syncVisibilitySuspension); } catch { /* best-effort */ }
  }
  try { app.viewer?.destroy?.(); } catch { /* teardown is best-effort */ }
  for (const selector of ['#cesium-credits', '#gev-screen-whiteboard-styles', '.gev-screen-whiteboard']) {
    try { document.querySelectorAll(selector).forEach((el) => el.remove()); } catch { /* best-effort */ }
  }
  document.body.classList.remove('cockpit-mode', 'ui-clean-view', 'recording-mode', 'scene-playback-mode');
  try { delete document.documentElement.dataset.gevStyle; } catch { /* best-effort */ }
  window.__godsEyeView = undefined;
  window.__gevAnnotations = undefined;
  window.__GOOGLE_MAPS_API_KEY__ = undefined;
}

// Standalone upstream behavior: boot immediately. Under the LandOS host the
// page sets window.__GEV_HOSTED__ = true before importing this module and
// calls mountGodsEyeView() itself.
if (!window.__GEV_HOSTED__) init();
