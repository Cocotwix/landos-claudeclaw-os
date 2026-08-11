// Rebuilds the committed acceptance-package test fixture that the governed MCP
// bridge tests read. Run only when the canonical inspectors or the acceptance
// results schema change:
//
//   node scripts/acceptance/build-fixture-package.mjs
//
// The fixture cannot be empty or 1x1 placeholder files. The bridge inspects
// every artifact with the canonical inspectors in artifact-inspector.mjs, which
// require a decodable PNG of at least 240x120 carrying at least 1000 bytes and
// four sampled colors, a real ZIP holding a trace.trace entry, and a WebM
// carrying EBML, Segment, Tracks and Cluster markers. These are the smallest
// artifacts that satisfy those inspectors. They are synthetic evidence for
// admission-path tests, never operator captures. results.json is emitted from
// the bytes actually written, so its byteLength, sha256 and visual metadata can
// never drift from the files beside it.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  inspectConsoleCapture,
  inspectNetworkCapture,
  inspectPng,
  inspectTraceZip,
  inspectWebm,
  mediaTypeFor,
} from './artifact-inspector.mjs';
import { validateAcceptanceResults } from './contract-validator.mjs';

const OUTPUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('../../src/landos/fixtures/acceptance-package', import.meta.url));

const ADDRESS = '704 Bell Rd, Red Creek, NY 13143';
const STARTED_AT = '2026-08-03T01:47:47.731Z';
const COMPLETED_AT = '2026-08-03T01:48:47.731Z';
const CAPTURED_AT = '2026-08-03T01:47:52.000Z';
const WIDTH = 320;
const HEIGHT = 180;
const MINIMUM_BYTES = 1_400;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const BANDS = [
  [17, 24, 39], [30, 64, 175], [4, 120, 87], [180, 83, 9],
  [153, 27, 27], [88, 28, 135], [15, 118, 110], [120, 113, 108],
];

function png(seed) {
  const rowLength = WIDTH * 3;
  const raw = Buffer.alloc((rowLength + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowStart = y * (rowLength + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const band = BANDS[(Math.floor((x * BANDS.length) / WIDTH) + seed) % BANDS.length];
      const shade = Math.floor((y * 5) / HEIGHT) * 12;
      const offset = rowStart + 1 + x * 3;
      raw[offset] = Math.min(255, band[0] + shade);
      raw[offset + 1] = Math.min(255, band[1] + shade);
      raw[offset + 2] = Math.min(255, band[2] + shade);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const head = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
  ]);
  // Clean synthetic bands compress far below the 1000-byte floor inspectPng
  // requires, so a labelled tEXt chunk carries both the provenance and the
  // required byte length.
  const label = 'Comment Synthetic LandOS acceptance test fixture. Not a real operator capture. '
    + 'Generated deterministically by scripts/acceptance/build-fixture-package.mjs so the governed MCP '
    + 'bridge inspectors have byte-exact, repository-committable screenshot evidence to validate against. ';
  const overhead = 12 + Buffer.byteLength(label, 'latin1');
  const iend = pngChunk('IEND', Buffer.alloc(0));
  const padding = Math.max(0, MINIMUM_BYTES - head.length - iend.length - overhead);
  return Buffer.concat([head, pngChunk('tEXt', Buffer.from(label + 'x'.repeat(padding), 'latin1')), iend]);
}

function zip(entryName, contents) {
  const name = Buffer.from(entryName, 'ascii');
  const data = Buffer.from(contents, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function ebmlSize(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value | 0x10000000, 0);
  return buffer;
}

function element(id, payload) {
  return Buffer.concat([Buffer.from(id), ebmlSize(payload.length), payload]);
}

function webm() {
  const header = element([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    element([0x42, 0x86], Buffer.from([0x01])),
    element([0x42, 0xf7], Buffer.from([0x01])),
    element([0x42, 0xf2], Buffer.from([0x04])),
    element([0x42, 0xf3], Buffer.from([0x08])),
    element([0x42, 0x82], Buffer.from('webm', 'ascii')),
    element([0x42, 0x87], Buffer.from([0x02])),
    element([0x42, 0x85], Buffer.from([0x02])),
  ]));
  const info = element([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
    element([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])),
    element([0x4d, 0x80], Buffer.from('LandOS acceptance fixture', 'ascii')),
    element([0x57, 0x41], Buffer.from('LandOS acceptance fixture', 'ascii')),
  ]));
  const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], Buffer.concat([
    element([0xd7], Buffer.from([0x01])),
    element([0x73, 0xc5], Buffer.from([0x01])),
    element([0x83], Buffer.from([0x01])),
    element([0x86], Buffer.from('V_VP8', 'ascii')),
    element([0xe0], Buffer.concat([
      element([0xb0], Buffer.from([0x01, 0x40])),
      element([0xba], Buffer.from([0x00, 0xb4])),
    ])),
  ])));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([
    element([0xe7], Buffer.from([0x00])),
    element([0xa3], Buffer.concat([Buffer.from([0x81, 0x00, 0x00, 0x80]), Buffer.alloc(512, 0x00)])),
  ]));
  let body = Buffer.concat([info, tracks, cluster]);
  const shortfall = MINIMUM_BYTES - (header.length + 8 + body.length);
  if (shortfall > 0) body = Buffer.concat([body, element([0xec], Buffer.alloc(shortfall, 0x00))]);
  return Buffer.concat([header, element([0x18, 0x53, 0x80, 0x67], body)]);
}

const SCREENSHOTS = ['new-lead.png', 'deal-card-loaded.png', 'changed-section.png', 'relevant-tab-or-panel.png', 'after-refresh.png', 'after-restart.png'];

const CONSOLE_CAPTURE = {
  schemaVersion: '1.0.0',
  capturedAt: CAPTURED_AT,
  entries: [
    { type: 'info', text: 'LandOS dashboard bundle loaded for the acceptance Deal Card.', relevant: false, timestamp: CAPTURED_AT },
    { type: 'log', text: 'Comps & Market rendered 0 accepted rows for the acceptance property.', relevant: false, timestamp: CAPTURED_AT },
    { type: 'warning', text: 'Documents & Visuals showed its empty state while canonical visuals exist.', relevant: false, timestamp: CAPTURED_AT },
  ],
};

const NETWORK_CAPTURE = { schemaVersion: '1.0.0', capturedAt: CAPTURED_AT, failures: [] };

// The known-defect proof: identity is visible, but nothing canonical renders.
const CLAIMS = [
  ['property-identity-visible', 'Deal Card header', 'The opened Deal Card visibly belongs to the acceptance property.', ADDRESS, ADDRESS, 'PASS', 'deal-card-loaded.png'],
  ['property-apn-visible', 'Deal Card header', 'The opened Deal Card visibly shows the acceptance property APN.', '056400 37.00-1-33', '056400 37.00-1-33', 'PASS', 'deal-card-loaded.png'],
  ['property-id-visible', 'Deal Card header', 'The opened Deal Card visibly shows the canonical property identifier.', '89520173', '', 'FAIL', 'deal-card-loaded.png'],
  ['canonical-comps-visible', 'Comps & Market', 'All canonical Hermes comps are visibly rendered in Comps & Market.', 4, 0, 'FAIL', 'changed-section.png'],
  ['comp-count-matches-rows', 'Comps & Market', 'The number of rendered accepted-comp rows equals the canonical Hermes comp count.', 4, 0, 'FAIL', 'changed-section.png'],
  ['canonical-visual-visible', 'Documents & Visuals', 'The canonical retained visual is visibly rendered in Documents & Visuals.', 1, 0, 'FAIL', 'relevant-tab-or-panel.png'],
  ['imagery-not-empty', 'Documents & Visuals / Hero property imagery', 'The imagery area contains retained subject imagery and does not show an empty state.', true, false, 'FAIL', 'relevant-tab-or-panel.png'],
  ['specialist-results-rendered', 'Comps & Market and Documents & Visuals', 'Claimed specialist comp and visual results are visibly rendered in their operator sections.', true, false, 'FAIL', 'changed-section.png'],
  ['no-cross-property-contamination', 'Whole Deal Card', 'No visible evidence belongs to another property.', true, true, 'PASS', 'deal-card-loaded.png'],
];

await mkdir(OUTPUT, { recursive: true });

const files = new Map(SCREENSHOTS.map((name, index) => [name, png(index)]));
files.set('trace.zip', zip('trace.trace', `${JSON.stringify({
  schemaVersion: '1.0.0',
  note: 'Synthetic Playwright trace placeholder for the committed LandOS acceptance fixture. Not a real trace.',
  runId: 'governed-multi-agent-os-known-defect-fixture',
  startedAt: STARTED_AT,
  completedAt: COMPLETED_AT,
}, null, 2)}\n${'// deterministic filler so inspectTraceZip sees an inspectable archive\n'.repeat(16)}`));
files.set('video.webm', webm());
files.set('console.json', Buffer.from(`${JSON.stringify(CONSOLE_CAPTURE, null, 2)}\n`, 'utf8'));
files.set('network-failures.json', Buffer.from(`${JSON.stringify(NETWORK_CAPTURE, null, 2)}\n`, 'utf8'));

const problems = [];
const artifacts = [];
for (const [name, bytes] of files) {
  await writeFile(path.join(OUTPUT, name), bytes);
  let contentValidation;
  let inspection;
  if (name.endsWith('.png')) {
    inspection = inspectPng(bytes);
    contentValidation = { validated: true, kind: 'screenshot', width: inspection.width, height: inspection.height, uniqueColorSamples: inspection.uniqueColorSamples };
  } else if (name === 'trace.zip') {
    inspection = inspectTraceZip(bytes);
    contentValidation = { validated: true, kind: 'trace' };
  } else if (name === 'video.webm') {
    inspection = inspectWebm(bytes);
    contentValidation = { validated: true, kind: 'video' };
  } else if (name === 'console.json') {
    inspection = inspectConsoleCapture(JSON.parse(bytes.toString('utf8')));
    if (inspection.relevantErrorCount !== 0) problems.push(`${name}: relevantErrorCount must be 0`);
    contentValidation = { validated: true, kind: 'console' };
  } else {
    inspection = inspectNetworkCapture(JSON.parse(bytes.toString('utf8')));
    if (inspection.requiredFailureCount !== 0) problems.push(`${name}: requiredFailureCount must be 0`);
    contentValidation = { validated: true, kind: 'network' };
  }
  if (inspection.errors.length) problems.push(`${name}: ${inspection.errors.join('; ')}`);
  artifacts.push({
    path: name,
    mediaType: mediaTypeFor(name),
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    capturedAt: CAPTURED_AT,
    contentValidation,
  });
}

// Key order below is load-bearing: the bridge journals Zod-parsed records and
// compares them to the submitted report with JSON.stringify, so every object
// here must be declared in its schema's field order.
const results = {
  schemaVersion: '1.0.0',
  runId: 'governed-multi-agent-os-known-defect-fixture',
  contractId: 'landos-704-bell-known-defect-v1',
  sprintName: 'governed-multi-agent-os-known-defect-proof',
  mode: 'fixture',
  startedAt: STARTED_AT,
  completedAt: COMPLETED_AT,
  propertyAddress: ADDRESS,
  authStateImported: false,
  freshness: {
    required: false,
    isFresh: false,
    evidence: 'Synthetic committed fixture package: the acceptance property was entered through New Lead and the pre-existing canonical Deal Card was reopened, so freshness is false for this documented known-defect exception.',
  },
  claims: CLAIMS.map(([claimId, operatorSection, claim, expectedValue, visibleValue, status, evidencePath]) => ({
    claimId,
    operatorSection,
    propertyAddress: ADDRESS,
    claim,
    expectedValue,
    visibleValue,
    status,
    evidencePath,
    timestamp: COMPLETED_AT,
    refreshResult: 'PASS',
    restartResult: 'PASS',
    contaminationResult: 'PASS',
  })),
  counts: [
    { operatorSection: 'Comps & Market', label: 'Accepted sold comps', canonicalAccepted: 4, displayed: 0, renderedRows: 0, emptyStateVisible: true, timestamp: COMPLETED_AT },
    { operatorSection: 'Documents & Visuals', label: 'Hero property imagery', canonicalAccepted: 1, displayed: 0, renderedRows: 0, emptyStateVisible: true, timestamp: COMPLETED_AT },
  ],
  lifecycle: {
    isolatedContext: true,
    contextsCreated: 1,
    contextsClosed: 1,
    pagesCreated: 1,
    pagesClosed: 1,
    normalOperatorBrowserUntouched: true,
    cleanupCompleted: true,
    verifiedAt: COMPLETED_AT,
  },
  refresh: { status: 'PASS', visibleValuesRetained: true, timestamp: COMPLETED_AT },
  restart: { status: 'PASS', visibleValuesRetained: true, timestamp: COMPLETED_AT },
  contamination: { status: 'PASS', detectedValues: [], timestamp: COMPLETED_AT },
  console: { path: 'console.json', relevantErrorCount: 0, timestamp: COMPLETED_AT },
  network: { path: 'network-failures.json', requiredFailureCount: 0, timestamp: COMPLETED_AT },
  artifacts,
  verdict: 'FAIL',
};

const schemaErrors = validateAcceptanceResults(results);
if (schemaErrors.length) problems.push(...schemaErrors);
if (problems.length) {
  console.error(`fixture generation failed canonical inspection:\n  ${problems.join('\n  ')}`);
  process.exitCode = 1;
} else {
  await writeFile(path.join(OUTPUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`wrote ${files.size + 1} fixture files to ${OUTPUT}`);
}
