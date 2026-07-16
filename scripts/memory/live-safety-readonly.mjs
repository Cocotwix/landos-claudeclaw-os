#!/usr/bin/env node
// Read-only localhost acceptance probe. Uses configured auth without printing it.
import { createHash } from 'node:crypto';
import { DASHBOARD_TOKEN, DASHBOARD_URL } from '../../dist/config.js';

const base = new URL(DASHBOARD_URL || 'http://localhost:3141');
if (!DASHBOARD_TOKEN || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(base.hostname)) {
  throw new Error('Local authenticated dashboard is unavailable.');
}
async function get(pathname) {
  const url = new URL(pathname, base);
  url.searchParams.set('token', DASHBOARD_TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const list = await get('/api/landos/deal-cards');
const deals = Array.isArray(list.body?.dealCards) ? list.body.dealCards : [];
const firstId = deals[0]?.id;
const detail = firstId ? await get('/api/landos/deal-cards/' + firstId) : { status: 0, body: null };
const report = firstId ? await get('/api/landos/deal-cards/' + firstId + '/report') : { status: 0, body: null };
const session = await get('/api/landos/browser/session');
const readiness = await get('/api/landos/browser/readiness');
const agentStatus = await get('/api/landos/browser-agent/status');
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(updated|created|generated|timestamp|runtime|age|stale)/i.test(key))
    .map(([key, item]) => [key, stripVolatile(item)]));
}
const stableData = stripVolatile({ list: deals, detail: detail.body });
console.log(JSON.stringify({
  url: base.origin,
  dealCards: {
    listStatus: list.status,
    count: deals.length,
    detailStatus: detail.status,
    reportStatus: report.status,
    currentDealCardLoaded: detail.status === 200 && report.status === 200,
    stableDataDigest: digest(stableData),
  },
  landPortal: {
    sessionStatus: session.status,
    readinessStatus: readiness.status,
    authenticated: Boolean(session.body?.session?.landportalAuthenticated || readiness.body?.readiness?.landportalAuthenticated),
    phase: readiness.body?.readiness?.phase ?? session.body?.session?.status ?? 'unknown',
  },
  browserAutomation: {
    statusEndpoint: agentStatus.status,
    available: agentStatus.status === 200,
  },
}, null, 2));