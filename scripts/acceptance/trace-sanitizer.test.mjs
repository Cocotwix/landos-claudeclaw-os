import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectTraceRedaction,
  readZipEntries,
  sanitizeTraceBuffer,
  writeStoredZip,
} from './trace-sanitizer.mjs';

test('trace sanitizer removes cookies, auth headers, tokens, sessions, and query values while preserving a readable archive', () => {
  const canary = 'CANARY-SECRET-8f9d1b';
  const traceLines = [
    JSON.stringify({ type: 'before', apiName: 'page.goto', params: { url: `http://localhost:3141/deal?token=${canary}&view=market` } }),
    JSON.stringify({ type: 'request', headers: [{ name: 'cookie', value: `landos_session=${canary}` }, { name: 'authorization', value: `Bearer ${canary}` }], storageState: { cookies: [{ name: 'landos_session', value: canary }] } }),
    JSON.stringify({ type: 'after', result: 'operator-visible content preserved' }),
  ].join('\n');
  const original = writeStoredZip([
    { name: 'trace.trace', data: Buffer.from(traceLines) },
    { name: 'trace.network', data: Buffer.from(JSON.stringify({ url: `http://localhost/api?session=${canary}`, response: 200 })) },
    { name: 'resources/screenshot.jpeg', data: Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]) },
  ]);
  const sanitized = sanitizeTraceBuffer(original);
  assert.ok(sanitized.stats.redactions >= 3);
  assert.equal(sanitized.buffer.includes(Buffer.from(canary)), false);
  assert.deepEqual(inspectTraceRedaction(sanitized.buffer).errors, []);
  const entries = readZipEntries(sanitized.buffer);
  assert.deepEqual(entries.map((entry) => entry.name), ['trace.trace', 'trace.network', 'resources/screenshot.jpeg']);
  assert.match(entries[0].data.toString('utf8'), /operator-visible content preserved/);
  assert.deepEqual(entries[2].data, Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]));
});

test('redaction inspection rejects an unsanitized trace canary', () => {
  const unsafe = writeStoredZip([{ name: 'trace.trace', data: Buffer.from('{"headers":[{"name":"cookie","value":"unsafe-session"}]}') }]);
  const inspection = inspectTraceRedaction(unsafe);
  assert.equal(inspection.valid, false);
  assert.match(inspection.errors[0], /recognized sensitive value/);
});
