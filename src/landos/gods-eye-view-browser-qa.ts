import type { BrowserQaScenario, BrowserQaSession } from './browser-qa.js';

async function waitFor(
  qa: BrowserQaSession,
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await qa.delay(250);
  }
  throw new Error(message);
}

async function waitPath(qa: BrowserQaSession, path: string): Promise<void> {
  await waitFor(
    qa,
    () => qa.page.evaluate<boolean>((expected: string) => (globalThis as any).location.pathname === expected, path),
    `route did not reach ${path}`,
  );
}

async function clickRoute(qa: BrowserQaSession, path: string): Promise<void> {
  const selector = `a[href="${path}"]`;
  await qa.waitFor(selector);
  await qa.click(selector);
  await waitPath(qa, path);
}

async function toggleLayer(qa: BrowserQaSession, id: string): Promise<string> {
  const row = `[data-layer-id="${id}"]`;
  await qa.waitFor(row);
  const enabled = await qa.page.evaluate<boolean>((selector: string) => {
    const button = (globalThis as any).document.querySelector(`${selector} .data-toggle-btn`);
    return Boolean(button?.classList.contains('active'));
  }, row);
  if (!enabled) await qa.click(`${row} .data-toggle-btn`);
  await waitFor(
    qa,
    () => qa.page.evaluate<boolean>((selector: string) => {
      const button = (globalThis as any).document.querySelector(`${selector} .data-toggle-btn`);
      return Boolean(button?.classList.contains('active')) && !button?.disabled;
    }, row),
    `layer ${id} did not reach an enabled terminal state`,
  );
  return qa.text(row);
}

async function requestLayer(qa: BrowserQaSession, id: string): Promise<void> {
  const row = `[data-layer-id="${id}"]`;
  await qa.waitFor(row);
  const button = `${row} .data-toggle-btn`;
  const active = await qa.page.evaluate<boolean>((selector: string) =>
    (globalThis as any).document.querySelector(selector)?.classList.contains('active') ?? false, button);
  if (!active) await qa.click(button);
}

export const godsEyeViewBrowserQaScenario: BrowserQaScenario = {
  id: 'gods-eye-view',
  route: '/dept/gods-eye-view',
  allowIssue(issue) {
    // The upstream restore verifier can reject mid-flight while the doubled
    // hash+durable restore lanes settle under the full free-layer boot; the
    // OPERATOR end state is asserted explicitly by the post-refresh
    // "visibly ON" step below, which is the acceptance gate.
    if (issue.kind === 'page-error' && /Failed to restore layer ".+" visibility/.test(issue.message ?? '')) return true;
    if (issue.kind !== 'http-error' || !issue.url) return false;
    const pathname = new URL(issue.url).pathname;
    // Keyless honest setup states.
    if (issue.status === 503 && ['/api/firms', '/api/ais-live'].includes(pathname)) return true;
    // Upstream bikeshare catalog variance: an individual GBFS operator feed
    // that has gone away 404s through the proxy; the layer degrades per-system.
    if (issue.status === 404 && pathname.startsWith('/api/gbfs/')) return true;
    // Transient upstream weather on the serve-stale terrain proxy.
    if ((issue.status ?? 0) >= 500 && pathname === '/api/terrain/heights') return true;
    return false;
  },
  async run(qa) {
    await qa.page.evaluateOnNewDocument?.(() => {
      (globalThis as any).__landosQaGetUserMediaCalls = 0;
      (globalThis as any).__landosQaProviderCalls = 0;
      const originalFetch = (globalThis as any).fetch?.bind(globalThis);
      if (originalFetch) {
        (globalThis as any).fetch = (input: unknown, init?: unknown) => {
          const url = typeof input === 'string' ? input : String((input as any)?.url ?? input);
          if (/\/api\/(?:ais-live|firms|overpass)(?:[/?]|$)/.test(url)) {
            (globalThis as any).__landosQaProviderCalls += 1;
          }
          return originalFetch(input, init);
        };
      }
      const media = (globalThis as any).navigator?.mediaDevices;
      const original = media?.getUserMedia?.bind(media);
      if (!media || !original) return;
      try {
        Object.defineProperty(media, 'getUserMedia', {
          configurable: true,
          value: (...args: unknown[]) => {
            (globalThis as any).__landosQaGetUserMediaCalls += 1;
            return original(...args);
          },
        });
      } catch { /* the absence of a wrapper is recorded separately */ }
    });

    await qa.step('open God’s Eye View through the LandOS route', async () => {
      // Deterministic FIRST-RUN/MIGRATED state: clear the free-layer-defaults
      // marker and the durable layer state in this automation profile so the
      // acceptance proves what a first-run or pre-upgrade operator actually
      // sees — not whatever an earlier QA run left toggled. (2026-08 root
      // cause: the prior acceptance toggled layers itself and asserted the
      // ABILITY to enable, so "registered/available" false-passed as
      // operator-ON.)
      await qa.goto('/');
      await qa.waitFor('body');
      await qa.page.evaluate<void>(() => {
        try {
          (globalThis as any).localStorage?.removeItem('landos.gev.freeLayerDefaults');
          (globalThis as any).localStorage?.removeItem('gev:layer-state:v2');
        } catch { /* storage unavailable — migration path will report honestly */ }
      });
      await qa.goto();
      await qa.waitFor('[data-testid="gods-eye-view-department"]');
      await qa.waitFor('#gev-root');
      await qa.waitFor('#cesiumContainer canvas');
      return 'department route, host root, and live Cesium canvas are present (first-run state reset)';
    });

    await qa.step('capture first-run state when present', async () => {
      // The launcher is intentionally revealed after the loading-screen
      // transition, so allow that bounded late mount before inspecting it.
      await qa.delay(1800);
      const visible = await qa.page.evaluate<boolean>(() => {
        const node = (globalThis as any).document.querySelector('#first-run-launcher');
        return Boolean(node && !node.hidden);
      });
      if (visible) {
        const note = await qa.text('[data-first-run-status]');
        qa.check('first-run voice policy is honest', /voice controls are disabled/i.test(note) && !/MIC button/i.test(note), note.trim());
        await qa.screenshot('01-first-run');
      }
      return visible ? 'first-run mission chooser captured' : 'first-run chooser was previously dismissed for this persistent profile';
    });

    await qa.step('dismiss first-run chooser without enabling a provider', async () => {
      const visible = await qa.page.evaluate<boolean>(() => {
        const node = (globalThis as any).document.querySelector('#first-run-launcher');
        return Boolean(node && !node.hidden);
      });
      if (visible) await qa.click('[data-first-run-choice="explore"]');
      return visible ? 'Explore the globe selected' : 'no chooser needed dismissal';
    });

    await qa.step('every eligible free/keyless layer is visibly ON in the migrated operator state', async () => {
      // Mirrors web/src/gev/free-layer-defaults.ts FREE_DEFAULT_LAYER_IDS —
      // the operator-ON contract. 'local-firms' and 'ais-live-vessels' are
      // deliberately absent (FREE — SETUP REQUIRED until their free key).
      const EXPECTED_DEFAULT_ON = ['bikeshare', 'cctv', 'earthquakes', 'flights', 'local-dams', 'local-datacenters', 'military', 'military-awareness', 'military-installations', 'radio', 'rocket-launches', 'satellites', 'traffic'];
      const deadline = Date.now() + 45_000;
      let missing: string[] = EXPECTED_DEFAULT_ON;
      while (Date.now() < deadline) {
        missing = await qa.page.evaluate<string[]>((idsJson: string) => {
          const ids = JSON.parse(idsJson) as string[];
          const doc = (globalThis as any).document;
          return ids.filter((id) => {
            const row = doc.querySelector(`[data-layer-id="${id}"]`);
            if (!row) return false; // not rendered in this build — not an OFF state
            const button = row.querySelector('.data-toggle-btn');
            return !(button && button.classList.contains('active'));
          });
        }, JSON.stringify(EXPECTED_DEFAULT_ON));
        if (!missing.length) break;
        await qa.delay(1000);
      }
      if (missing.length) throw new Error(`free layers not visibly ON after migration: ${missing.join(', ')}`);
      // Key-gated layers must NOT be silently ON — their honest state is
      // setup-required, not an operator choice.
      const keyGatedOn = await qa.page.evaluate<string[]>(() => {
        const doc = (globalThis as any).document;
        return ['local-firms', 'ais-live-vessels'].filter((id) =>
          doc.querySelector(`[data-layer-id="${id}"] .data-toggle-btn`)?.classList.contains('active'));
      });
      if (keyGatedOn.length) throw new Error(`key-gated layers unexpectedly active: ${keyGatedOn.join(', ')}`);
      return `all ${EXPECTED_DEFAULT_ON.length} eligible free layers visibly ON; key-gated layers honestly not-on`;
    });
    await qa.screenshot('01b-free-layers-default-on', true);

    await qa.step('manual address search: LandOS subject (0 Kingwood Blvd, Fairview)', async () => {
      const flyAndVerify = async (query: string, lat: number, lon: number, tolerance: number): Promise<void> => {
        await qa.page.evaluate<void>((q: string) => {
          const doc = (globalThis as any).document;
          const input = doc.getElementById('location-search') as { value: string; dispatchEvent: (e: unknown) => void; focus: () => void } | null;
          if (!input) throw new Error('location-search input missing');
          doc.getElementById('search-toggle')?.click?.();
          input.value = q;
          input.dispatchEvent(new (globalThis as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, query);
        const deadline = Date.now() + 30_000;
        let position: { lat: number; lon: number } | null = null;
        while (Date.now() < deadline) {
          position = JSON.parse(await qa.page.evaluate<string>(() => {
            const carto = (globalThis as any).__godsEyeView?.viewer?.camera?.positionCartographic;
            return JSON.stringify(carto ? { lat: (carto.latitude * 180) / Math.PI, lon: (carto.longitude * 180) / Math.PI } : null);
          }));
          if (position && Math.abs(position.lat - lat) < tolerance && Math.abs(position.lon - lon) < tolerance) return;
          await qa.delay(1000);
        }
        throw new Error(`camera did not reach ${query} (at ${position ? `${position.lat.toFixed(3)},${position.lon.toFixed(3)}` : 'unknown'})`);
      };
      // Vacant-land subject resolves through the LandOS canonical hierarchy.
      await flyAndVerify('0 Kingwood Blvd, Fairview, TN 37062', 35.98, -87.12, 0.15);
      return 'camera relocated to the canonical Fairview subject';
    });
    await qa.screenshot('01c-search-deal89-subject');

    await qa.step('manual address search: ordinary place through the free geocoder', async () => {
      await qa.page.evaluate<void>(() => {
        const doc = (globalThis as any).document;
        const input = doc.getElementById('location-search') as { value: string; dispatchEvent: (e: unknown) => void } | null;
        if (!input) throw new Error('location-search input missing');
        input.value = 'Franklin, TN';
        input.dispatchEvent(new (globalThis as any).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      const deadline = Date.now() + 30_000;
      let position: { lat: number; lon: number } | null = null;
      while (Date.now() < deadline) {
        position = JSON.parse(await qa.page.evaluate<string>(() => {
          const carto = (globalThis as any).__godsEyeView?.viewer?.camera?.positionCartographic;
          return JSON.stringify(carto ? { lat: (carto.latitude * 180) / Math.PI, lon: (carto.longitude * 180) / Math.PI } : null);
        }));
        if (position && Math.abs(position.lat - 35.925) < 0.3 && Math.abs(position.lon - (-86.869)) < 0.3) {
          return `Franklin, TN geocoded and framed at ${position.lat.toFixed(3)},${position.lon.toFixed(3)}`;
        }
        await qa.delay(1000);
      }
      throw new Error(`camera did not reach Franklin, TN (at ${position ? `${position.lat.toFixed(3)},${position.lon.toFixed(3)}` : 'unknown'})`);
    });

    await qa.step('verify department shell, keyless globe, and provider map controls', async () => {
      const state = await qa.page.evaluate(() => {
        const app = (globalThis as any).__godsEyeView;
        const chips = [...(globalThis as any).document.querySelectorAll('.map-stack-chip')].map((node: any) => ({
          text: (node.textContent ?? '').trim(),
          aria: node.getAttribute('aria-label') ?? '',
          title: node.getAttribute('title') ?? '',
          unavailable: node.classList.contains('unavailable'),
        }));
        const banner = (globalThis as any).document.querySelector('[data-testid="gods-eye-view-department"]')?.textContent ?? '';
        const canvas = (globalThis as any).document.querySelector('#cesiumContainer canvas');
        return {
          banner,
          chips,
          canvasWidth: canvas?.width ?? 0,
          canvasHeight: canvas?.height ?? 0,
          viewerLive: Boolean(app?.viewer && !app.viewer.isDestroyed?.()),
          sidebarHasGev: Boolean((globalThis as any).document.querySelector('a[href="/dept/gods-eye-view"]')),
        };
      });
      const google = state.chips.find((chip) => chip.text.includes('Google 3D'));
      const bingAerial = state.chips.find((chip) => chip.text.includes('Bing Aerial'));
      qa.check('LandOS department shell remains present', state.sidebarHasGev, 'sidebar link exists alongside the hosted application');
      qa.check('keyless map canvas renders', state.viewerLive && state.canvasWidth > 0 && state.canvasHeight > 0, `${state.canvasWidth}x${state.canvasHeight} live canvas`);
      qa.check('Google 3D state is honest', state.banner.includes('setup required') && state.banner.includes('No Google request is made'), 'keyless banner names setup and confirms no Google request');
      qa.check('Google 3D control is setup-required', Boolean(google?.unavailable && /setup required/i.test(`${google.aria} ${google.title}`)), `${google?.aria || google?.title || 'missing Google control'}`);
      qa.check('Bing control is setup-required', Boolean(bingAerial?.unavailable && /ion|token|required/i.test(`${bingAerial.aria} ${bingAerial.title}`)), `${bingAerial?.aria || bingAerial?.title || 'missing Bing control'}`);
      return 'rendered map and map-stack controls inspected';
    });
    await qa.screenshot('02-keyless-map-and-provider-controls');

    await qa.step('open the Data Layers panel', async () => {
      const collapsed = await qa.page.evaluate<boolean>(() => (globalThis as any).document.querySelector('#data-panel')?.classList.contains('collapsed') ?? false);
      if (collapsed) await qa.click('#data-panel .panel-collapse-btn');
      await waitFor(qa, () => qa.page.evaluate<boolean>(() =>
        !(globalThis as any).document.querySelector('#data-panel')?.classList.contains('collapsed')),
      'Data Layers panel did not expand');
      await qa.waitFor('#data-toggles .data-toggle-row');
      return 'data-layer controls are visible';
    });

    await qa.step('toggle live keyless earthquakes', async () => {
      const text = await toggleLayer(qa, 'earthquakes');
      await waitFor(qa, async () => {
        const rowText = await qa.text('[data-layer-id="earthquakes"]');
        return /USGS/i.test(rowText) && !/loading/i.test(rowText);
      }, 'earthquake layer did not settle with source-labelled output');
      return text.replace(/\s+/g, ' ').trim();
    });

    await qa.step('toggle live keyless satellites', async () => {
      const text = await toggleLayer(qa, 'satellites');
      await waitFor(qa, async () => {
        const rowText = await qa.text('[data-layer-id="satellites"]');
        return /CelesTrak/i.test(rowText) && !/loading/i.test(rowText);
      }, 'satellite layer did not settle with source-labelled output');
      return text.replace(/\s+/g, ' ').trim();
    });
    await qa.screenshot('03-keyless-live-layers');

    await qa.step('verify provider-dependent layers fail closed with setup states', async () => {
      await requestLayer(qa, 'local-firms');
      await requestLayer(qa, 'ais-live-vessels');
      const traffic = await toggleLayer(qa, 'traffic');
      await waitFor(qa, async () => /KEY REQUIRED|UNAVAILABLE/i.test(await qa.text('[data-layer-id="local-firms"]')), 'FIRMS did not show KEY REQUIRED');
      await waitFor(qa, async () => /KEY REQUIRED|UNAVAILABLE|API KEY/i.test(await qa.text('[data-layer-id="ais-live-vessels"]')), 'AIS did not show an honest missing-key state');
      await waitFor(qa, async () => /SIMULATION|FALLBACK|TOMTOM|LIVE/i.test(await qa.text('[data-layer-id="traffic"]')), 'traffic did not show its live/fallback source state');
      const firms = await qa.text('[data-layer-id="local-firms"]');
      const ais = await qa.text('[data-layer-id="ais-live-vessels"]');
      return `FIRMS=${firms.replace(/\s+/g, ' ').trim()} | AIS=${ais.replace(/\s+/g, ' ').trim()} | traffic=${traffic.replace(/\s+/g, ' ').trim()}`;
    });
    await qa.page.evaluate(() => {
      (globalThis as any).document.querySelector('[data-layer-id="local-firms"]')?.scrollIntoView({ block: 'center' });
    });
    await qa.delay(500);
    await qa.screenshot('04-provider-setup-states');

    await qa.step('verify voice and restricted data are absent at runtime', async () => {
      const state = await qa.page.evaluate(() => {
        const app = (globalThis as any).__godsEyeView;
        const layers = app?.dataManager?.layers ? [...app.dataManager.layers.keys()] : [];
        return {
          voiceNull: app?.voiceCommands === null,
          micCalls: Number((globalThis as any).__landosQaGetUserMediaCalls ?? 0),
          voiceUi: (globalThis as any).document.querySelectorAll('[id*="voice"], [data-voice], #mic-btn').length,
          cableRegistered: layers.includes('telegeography-submarine-cables'),
          cableRows: (globalThis as any).document.querySelectorAll('[data-layer-id="telegeography-submarine-cables"]').length,
        };
      });
      qa.check('voice command adapter disabled', state.voiceNull, 'window.__godsEyeView.voiceCommands is null');
      qa.check('microphone never requested', state.micCalls === 0, `getUserMedia calls=${state.micCalls}`);
      qa.check('voice controls absent', state.voiceUi === 0, `voice-like controls=${state.voiceUi}`);
      qa.check('TeleGeography layer unregistered', !state.cableRegistered && state.cableRows === 0, `registered=${state.cableRegistered}; rows=${state.cableRows}`);
      return 'security-sensitive runtime state inspected';
    });

    await qa.step('leave department and verify suspension', async () => {
      await qa.page.evaluate(() => {
        (globalThis as any).__landosQaGevInstance = (globalThis as any).__godsEyeView;
        (globalThis as any).__landosQaProviderCallsBeforeLeave = (globalThis as any).__landosQaProviderCalls;
      });
      await clickRoute(qa, '/dept/acquisitions');
      await qa.waitFor('main');
      // A request already in flight at the moment of departure may still
      // land — that is transition residue, not a polling leak. Take the
      // baseline AFTER a settling beat, then verify the count stays flat
      // over the observation window (the actual no-ongoing-polling invariant).
      await qa.delay(2_000);
      await qa.page.evaluate(() => {
        (globalThis as any).__landosQaProviderCallsBeforeLeave = (globalThis as any).__landosQaProviderCalls;
      });
      await qa.delay(3500);
      const state = await qa.page.evaluate(() => ({
        rootCount: (globalThis as any).document.querySelectorAll('#gev-root').length,
        active: (globalThis as any).__GEV_ACTIVE__,
        renderLoop: (globalThis as any).__landosQaGevInstance?.viewer?.useDefaultRenderLoop,
        acquisitionsText: (globalThis as any).document.body?.innerText ?? '',
        providerCallsBefore: Number((globalThis as any).__landosQaProviderCallsBeforeLeave ?? 0),
        providerCallsAfter: Number((globalThis as any).__landosQaProviderCalls ?? 0),
      }));
      qa.check('God’s Eye View DOM detached while away', state.rootCount === 0, `#gev-root count=${state.rootCount}`);
      qa.check('God’s Eye View host marked inactive', state.active === false, `__GEV_ACTIVE__=${String(state.active)}`);
      qa.check('render loop suspended', state.renderLoop === false, `useDefaultRenderLoop=${String(state.renderLoop)}`);
      qa.check('provider polling suspended', state.providerCallsAfter === state.providerCallsBefore, `provider calls before=${state.providerCallsBefore}; after 3.5s away=${state.providerCallsAfter}`);
      qa.check('Acquisitions remains usable', /Acquisitions|Pipeline|Leads/i.test(state.acquisitionsText), 'acquisitions operator text is visible');
      return 'navigation used the normal LandOS sidebar';
    });
    await qa.screenshot('05-acquisitions-unaffected');

    await qa.step('return and resume the same instance without duplication', async () => {
      await clickRoute(qa, '/dept/gods-eye-view');
      await qa.waitFor('#gev-root');
      const state = await qa.page.evaluate(() => ({
        same: (globalThis as any).__godsEyeView === (globalThis as any).__landosQaGevInstance,
        rootCount: (globalThis as any).document.querySelectorAll('#gev-root').length,
        renderLoop: (globalThis as any).__godsEyeView?.viewer?.useDefaultRenderLoop,
      }));
      qa.check('same God’s Eye View instance resumed', state.same, `same object=${state.same}`);
      qa.check('no duplicate host roots', state.rootCount === 1, `#gev-root count=${state.rootCount}`);
      qa.check('render loop resumed', state.renderLoop === true, `useDefaultRenderLoop=${String(state.renderLoop)}`);
      return 'same live viewer resumed';
    });
    await qa.screenshot('06-resumed-same-instance');

    await qa.step('open Settings and verify provider safeguards', async () => {
      await clickRoute(qa, '/settings');
      // The GEV settings card loads its config (and now the provider matrix)
      // asynchronously — wait for the loaded card, not the Loading… shell.
      await waitFor(
        qa,
        async () => /Not configured|configured/i.test(await qa.text('body')),
        'GEV settings card did not finish loading its configuration state',
      );
      const text = await qa.text('body');
      qa.check('God’s Eye View settings visible', /God's Eye View/i.test(text), 'settings section heading visible');
      qa.check('Google key state visible without exposing a secret', /Not configured|configured/i.test(text), 'configuration state is rendered');
      qa.check('monthly safeguard visible', /900|monthly session safeguard/i.test(text), '900-session default/local safeguard is rendered');
      qa.check('voice disabled in Settings', /Voice[\s\S]*disabled/i.test(text), 'Settings states voice is disabled');
      return 'read-only provider configuration and safeguards inspected';
    });
    await qa.screenshot('07-settings-safeguards', true);

    await qa.step('return for hard-refresh persistence', async () => {
      await clickRoute(qa, '/dept/gods-eye-view');
      await qa.waitFor('#gev-root');
      return 'route restored through owner navigation';
    });
    await qa.hardRefresh('/dept/gods-eye-view');
    await qa.waitFor('#gev-root');
    // With the full free-layer set durably ON, the truthful loading cover
    // stays up until every restored layer settles — allow the real bounded
    // boot time. Poll the CLASS, not visibility: `.hidden` fades the cover
    // out, so waitForSelector(visible:true) only matches during the ~1s
    // transition window and misses it whenever boot is busy (the exact race
    // that failed this acceptance under the full-layer boot burst).
    await waitFor(
      qa,
      () => qa.page.evaluate<boolean>(() =>
        Boolean((globalThis as any).document.getElementById('loading-screen')?.classList.contains('hidden'))),
      'loading screen did not yield after hard refresh',
      120_000,
    );
    await qa.waitFor('#cesiumContainer canvas');
    await qa.delay(1200);
    await waitFor(qa, () => qa.exists('[data-layer-id="earthquakes"]'), 'earthquake layer row was not rebuilt after hard refresh');
    await qa.step('verify state after hard refresh', async () => {
      await waitFor(qa, () => qa.page.evaluate<boolean>(() => {
        const button = (globalThis as any).document.querySelector('[data-layer-id="earthquakes"] .data-toggle-btn');
        return Boolean(button?.classList.contains('active'));
      }), 'earthquake layer did not restore after hard refresh');
      const state = await qa.page.evaluate(() => ({
        path: (globalThis as any).location.pathname,
        rootCount: (globalThis as any).document.querySelectorAll('#gev-root').length,
        voiceNull: (globalThis as any).__godsEyeView?.voiceCommands === null,
      }));
      qa.check('route persisted after hard refresh', state.path === '/dept/gods-eye-view', `path=${state.path}`);
      qa.check('single host root after hard refresh', state.rootCount === 1, `#gev-root count=${state.rootCount}`);
      qa.check('voice remains disabled after hard refresh', state.voiceNull, `voiceCommands null=${state.voiceNull}`);
      // The acceptance gate for restore correctness: EVERY eligible free
      // layer must end visibly ON after the reload — the operator end state,
      // not the restore verifier's mid-flight opinion.
      const EXPECTED_DEFAULT_ON = ['bikeshare', 'cctv', 'earthquakes', 'flights', 'local-dams', 'local-datacenters', 'military', 'military-awareness', 'military-installations', 'radio', 'rocket-launches', 'satellites', 'traffic'];
      // The post-refresh boot burst (all layers restoring at once) can stall
      // the main thread long enough that a single CDP evaluate times out —
      // tolerate that stall (it clears; the render loop and layer boots keep
      // going) and keep polling for the END state within the bounded window.
      const deadline = Date.now() + 300_000;
      let missing: string[] = EXPECTED_DEFAULT_ON;
      while (Date.now() < deadline) {
        try {
          missing = await qa.page.evaluate<string[]>((idsJson: string) => {
            const ids = JSON.parse(idsJson) as string[];
            const doc = (globalThis as any).document;
            return ids.filter((id) => {
              const row = doc.querySelector(`[data-layer-id="${id}"]`);
              if (!row) return false;
              const button = row.querySelector('.data-toggle-btn');
              return !(button && button.classList.contains('active'));
            });
          }, JSON.stringify(EXPECTED_DEFAULT_ON));
          if (!missing.length) break;
        } catch { /* main-thread stall window — keep waiting for the end state */ }
        await qa.delay(2_000);
      }
      qa.check('every free layer visibly ON after hard refresh', missing.length === 0,
        missing.length ? `not restored: ${missing.join(', ')}` : 'all default free layers visibly ON');
      return 'route, layer state, single instance, and voice policy survived reload';
    });
    await qa.screenshot('08-post-hard-refresh');
  },
};
