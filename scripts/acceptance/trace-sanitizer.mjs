import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const TEXT_EXTENSIONS = /(?:\.trace|\.network|\.stacks|\.json|\.jsonl|\.html?|\.txt|\.css|\.js|\.mjs|\.cjs|\.md|\.svg|\.xml)$/i;
const SENSITIVE_NAME = /^(?:authorization|proxy-authorization|cookie|cookies|set-cookie|password|passwd|secret|client-secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session|sessionid|session[_-]?token)$/i;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP end-of-central-directory record not found');
}

export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`invalid central directory entry ${index}`);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe ZIP entry name ${JSON.stringify(name)}`);
    if ((flags & 1) !== 0) throw new Error(`encrypted ZIP entry ${name} cannot be inspected`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`invalid local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    if (data.length !== uncompressedSize) throw new Error(`uncompressed size mismatch for ${name}`);
    if (crc32(data) !== expectedCrc) throw new Error(`CRC-32 mismatch for ${name}`);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function writeStoredZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + fileName.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
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
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(fileName.length, 28);
    directory.writeUInt32LE(offset, 42);
    fileName.copy(directory, 46);
    central.push(directory);
    offset += local.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return value;
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    return url.toString();
  } catch {
    return value;
  }
}

function redactString(value, stats) {
  let output = value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
  output = output
    .replace(/(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)(?:bearer\s+)?[^\s,;"'}]+/gi, (_match, name, separator) => {
      stats.redactions += 1;
      return `${name}${separator}[REDACTED]`;
    })
    .replace(/bearer\s+[a-z0-9._~+\/-]+/gi, () => {
      stats.redactions += 1;
      return 'Bearer [REDACTED]';
    })
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, () => {
      stats.redactions += 1;
      return '[REDACTED_JWT]';
    })
    .replace(/((?:token|secret|password|api[_-]?key|session|claim)=)[^&\s"'<>]+/gi, (_match, prefix) => {
      stats.redactions += 1;
      return `${prefix}[REDACTED]`;
    });
  return output;
}

function redactValue(value, stats, sensitive = false) {
  if (sensitive) {
    if (value === null || value === undefined) return value;
    stats.redactions += 1;
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, stats, true));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry, stats, true)]));
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactString(value, stats);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, stats, false));
  if (!value || typeof value !== 'object') return value;
  const namedSensitive = typeof value.name === 'string' && SENSITIVE_NAME.test(value.name);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = key === 'value' && namedSensitive
      ? redactValue(entry, stats, true)
      : redactValue(entry, stats, SENSITIVE_NAME.test(key));
  }
  return output;
}

function isLikelyText(name, data) {
  if (TEXT_EXTENSIONS.test(name)) return true;
  if (data.length > 5_000_000 || data.includes(0)) return false;
  const text = data.toString('utf8');
  return Buffer.from(text, 'utf8').equals(data);
}

function redactTextEntry(name, data, stats) {
  if (!isLikelyText(name, data)) return data;
  const text = data.toString('utf8');
  const lines = text.split('\n');
  const redacted = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      return JSON.stringify(redactValue(JSON.parse(line), stats));
    } catch {
      return redactString(line, stats);
    }
  }).join('\n');
  return Buffer.from(redacted, 'utf8');
}

export function sanitizeTraceBuffer(buffer) {
  const entries = readZipEntries(buffer);
  const stats = { entriesInspected: entries.length, textEntriesInspected: 0, redactions: 0 };
  const sanitized = entries.map((entry) => {
    if (isLikelyText(entry.name, entry.data)) stats.textEntriesInspected += 1;
    return { name: entry.name, data: redactTextEntry(entry.name, entry.data, stats) };
  });
  return { buffer: writeStoredZip(sanitized), stats };
}

export async function sanitizeTraceArchive(inputPath, outputPath) {
  const result = sanitizeTraceBuffer(await readFile(inputPath));
  await writeFile(outputPath, result.buffer, { flag: 'wx' });
  return result.stats;
}

export function inspectTraceRedaction(buffer) {
  const errors = [];
  let entries;
  try {
    entries = readZipEntries(buffer);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
  for (const entry of entries) {
    if (!isLikelyText(entry.name, entry.data)) continue;
    const stats = { redactions: 0 };
    const sanitized = redactTextEntry(entry.name, entry.data, stats);
    if (!sanitized.equals(entry.data)) errors.push(`${entry.name} still contains ${stats.redactions} recognized sensitive value(s)`);
  }
  return { valid: errors.length === 0, errors, entriesInspected: entries.length };
}
