import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { artifactMetadata, inspectPng } from './artifact-inspector.mjs';
import { buildRunContract } from './contract-builder.mjs';
import { CAPTURE_ARTIFACTS, SCREENSHOT_ARTIFACTS } from './contract-validator.mjs';
import { generateAcceptanceReport } from './generate-report.mjs';

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

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

export function evidencePng(seed = 1, width = 320, height = 180) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      rows[offset] = (x * 3 + seed * 17) & 0xff;
      rows[offset + 1] = (y * 5 + seed * 29) & 0xff;
      rows[offset + 2] = ((x + y) * 2 + seed * 41) & 0xff;
      rows[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function storedZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + fileName.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    fileName.copy(local, 30);
    locals.push(local, data);
    const directory = Buffer.alloc(46 + fileName.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(fileName.length, 28);
    directory.writeUInt32LE(offset, 42);
    fileName.copy(directory, 46);
    central.push(directory);
    offset += local.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function evidenceTraceZip() {
  const trace = Buffer.from(`${JSON.stringify({ type: 'context-options', browserName: 'chromium' })}\n${'trace-event\n'.repeat(140)}`);
  return storedZip([['trace.trace', trace], ['trace.network', Buffer.from('{"entries":[]}')]]);
}

export function evidenceWebm() {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]),
    Buffer.from('webm', 'ascii'),
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff, 0x16, 0x54, 0xae, 0x6b, 0x80, 0x1f, 0x43, 0xb6, 0x75, 0xff]),
    Buffer.alloc(2_048, 0x55),
  ]);
}

export async function readResults(directory) {
  return JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
}

export async function writeResults(directory, results, regenerateReport = true) {
  await writeFile(join(directory, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  if (regenerateReport) await generateAcceptanceReport(directory);
}

export async function refreshArtifactMetadata(directory, results, name) {
  const index = results.artifacts.findIndex((artifact) => artifact.path === name);
  const existing = results.artifacts[index];
  results.artifacts[index] = await artifactMetadata(
    join(directory, name),
    name,
    existing.contentValidation,
    existing.capturedAt,
  );
}

export async function buildPassingPackage(directory, contractSource) {
  const startedAt = '2026-08-03T01:00:00.000Z';
  const completedAt = '2026-08-03T01:01:00.000Z';
  const template = JSON.parse(await readFile(contractSource, 'utf8'));
  const contract = buildRunContract(template, { mode: 'fixture', startedAt, environment: {} });
  await writeFile(join(directory, 'acceptance-contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
  for (const [index, name] of SCREENSHOT_ARTIFACTS.entries()) await writeFile(join(directory, name), evidencePng(index + 1));
  await writeFile(join(directory, 'trace.zip'), evidenceTraceZip());
  await writeFile(join(directory, 'video.webm'), evidenceWebm());
  await writeFile(join(directory, 'console.json'), `${JSON.stringify({ schemaVersion: '1.0.0', capturedAt: completedAt, entries: [] }, null, 2)}\n`);
  await writeFile(join(directory, 'network-failures.json'), `${JSON.stringify({ schemaVersion: '1.0.0', capturedAt: completedAt, failures: [] }, null, 2)}\n`);
  const artifacts = [];
  for (const name of CAPTURE_ARTIFACTS) {
    let contentValidation;
    if (name.endsWith('.png')) {
      const inspection = inspectPng(await readFile(join(directory, name)));
      contentValidation = {
        validated: true,
        kind: 'screenshot',
        width: inspection.width,
        height: inspection.height,
        uniqueColorSamples: inspection.uniqueColorSamples,
      };
    } else if (name === 'trace.zip') contentValidation = { validated: true, kind: 'trace' };
    else if (name === 'video.webm') contentValidation = { validated: true, kind: 'video' };
    else if (name === 'console.json') contentValidation = { validated: true, kind: 'console' };
    else contentValidation = { validated: true, kind: 'network' };
    artifacts.push(await artifactMetadata(join(directory, name), name, contentValidation, completedAt));
  }
  const values = new Map([
    ['property-identity-visible', contract.property.normalizedAddress],
    ['property-apn-visible', contract.property.apn],
    ['property-id-visible', contract.property.canonicalPropertyId],
    ['canonical-comps-visible', contract.property.canonicalCounts.comps],
    ['comp-count-matches-rows', contract.property.canonicalCounts.comps],
    ['canonical-visual-visible', contract.property.canonicalCounts.visuals],
    ['imagery-not-empty', true],
    ['specialist-results-rendered', true],
    ['no-cross-property-contamination', true],
  ]);
  const claims = contract.claims.map((claim) => ({
    claimId: claim.id,
    operatorSection: claim.operatorSection,
    propertyAddress: contract.property.normalizedAddress,
    claim: claim.claim,
    expectedValue: claim.expectedValue,
    visibleValue: values.get(claim.id),
    status: 'PASS',
    evidencePath: claim.evidenceArtifacts[0],
    timestamp: completedAt,
    refreshResult: 'PASS',
    restartResult: 'PASS',
    contaminationResult: 'PASS',
  }));
  const results = {
    schemaVersion: '1.0.0',
    runId: 'synthetic-passing-run',
    contractId: contract.contractId,
    sprintName: contract.sprintName,
    mode: 'fixture',
    startedAt,
    completedAt,
    propertyAddress: contract.property.normalizedAddress,
    authStateImported: false,
    freshness: { required: false, isFresh: true, evidence: 'Synthetic New Lead fixture created in this isolated test run.' },
    claims,
    counts: [
      { operatorSection: 'Comps & Market', label: 'Accepted sold comps', canonicalAccepted: contract.property.canonicalCounts.comps, displayed: contract.property.canonicalCounts.comps, renderedRows: contract.property.canonicalCounts.comps, emptyStateVisible: false, timestamp: completedAt },
      { operatorSection: 'Documents & Visuals', label: 'Hero property imagery', canonicalAccepted: contract.property.canonicalCounts.visuals, displayed: contract.property.canonicalCounts.visuals, renderedRows: contract.property.canonicalCounts.visuals, emptyStateVisible: false, timestamp: completedAt },
    ],
    lifecycle: { isolatedContext: true, contextsCreated: 1, contextsClosed: 1, pagesCreated: 1, pagesClosed: 1, normalOperatorBrowserUntouched: true, cleanupCompleted: true, verifiedAt: completedAt },
    refresh: { status: 'PASS', visibleValuesRetained: true, timestamp: completedAt },
    restart: { status: 'PASS', visibleValuesRetained: true, timestamp: completedAt },
    contamination: { status: 'PASS', detectedValues: [], timestamp: completedAt },
    console: { path: 'console.json', relevantErrorCount: 0, timestamp: completedAt },
    network: { path: 'network-failures.json', requiredFailureCount: 0, timestamp: completedAt },
    artifacts,
    verdict: 'PASS',
  };
  await writeResults(directory, results, false);
  await generateAcceptanceReport(directory);
  return { contract, results };
}
