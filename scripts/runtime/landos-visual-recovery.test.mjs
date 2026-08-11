import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareVisualReady } from './landos-runtime.mjs';
import {
  isConnectionRefusedPage,
  recoverLandosVisualAcceptance,
} from './landos-visual-recovery.mjs';

const LAUNCH_URL = 'http://localhost:3141/connect?visualReady=1&returnTo=%2Fdept%2Facquisitions';

test('managed restart -> ERR_CONNECTION_REFUSED -> fresh in-app context -> successful visual recovery', async () => {
  let healthCalls = 0;
  let boardCalls = 0;
  let armed = false;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/api/health') {
      healthCalls += 1;
      if (healthCalls === 1) throw new Error('restart connection refused');
      return { status: 200, async json() { return { ok: true }; } };
    }
    if (url.pathname === '/api/landos/board') {
      boardCalls += 1;
      return {
        status: boardCalls === 1 ? 503 : 200,
        async json() { return boardCalls === 1 ? { error: 'starting' } : { columns: [] }; },
      };
    }
    if (url.pathname === '/api/dashboard/browser-pairings/visual-ready') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-landos-bootstrap-token'], 'runtime-credential');
      armed = true;
      return {
        status: 201,
        async json() {
          return { ready: true, launchUrl: LAUNCH_URL, returnTo: '/dept/acquisitions' };
        },
      };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const prepared = await prepareVisualReady('runtime-credential', {
    fetchImpl,
    pollMs: 0,
    sleepImpl: async () => {},
    timeoutMs: 1_000,
  });
  assert.equal(armed, true);
  assert.equal(prepared.healthStatus, 200);
  assert.equal(prepared.boardStatus, 200);
  assert.equal(prepared.launchUrl, LAUNCH_URL);

  const failedInfo = {
    id: 'failed-restart-tab',
    title: "This site can't be reached",
    url: 'data:text/html;charset=utf-8,ERR_CONNECTION_REFUSED',
  };
  let failedClosed = 0;
  let failedNavigated = 0;
  const failedTab = {
    async close() { failedClosed += 1; },
    async goto() { failedNavigated += 1; throw new Error('failed tab must never be navigated'); },
  };
  let freshCreated = 0;
  let freshGoto = '';
  const freshTab = {
    async goto(url) { freshGoto = url; },
    async close() { throw new Error('healthy fresh tab should stay open'); },
    playwright: {
      async waitForURL(url) {
        assert.equal(url, 'http://localhost:3141/dept/acquisitions');
      },
      async evaluate() {
        return { healthStatus: 200, boardStatus: 200 };
      },
    },
  };
  const browser = {
    tabs: {
      async list() { return [failedInfo]; },
      async get(id) {
        assert.equal(id, failedInfo.id);
        return failedTab;
      },
      async new() {
        freshCreated += 1;
        return freshTab;
      },
    },
    user: {
      async openTabs() { return []; },
      async claimTab() { throw new Error('no released tab should be claimed'); },
    },
  };

  const recovered = await recoverLandosVisualAcceptance(browser, prepared.launchUrl, {
    verifiedEndpoints: {
      healthStatus: prepared.healthStatus,
      boardStatus: prepared.boardStatus,
    },
  });
  assert.equal(isConnectionRefusedPage(failedInfo), true);
  assert.equal(failedClosed, 1);
  assert.equal(failedNavigated, 0);
  assert.equal(freshCreated, 1);
  assert.equal(freshGoto, LAUNCH_URL);
  assert.equal(recovered.tab, freshTab);
  assert.equal(recovered.healthStatus, 200);
  assert.equal(recovered.boardStatus, 200);
});
