import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';

import { patternMatches } from './runtime-helpers.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const WEBM_SEGMENT = Buffer.from([0x18, 0x53, 0x80, 0x67]);
const WEBM_TRACKS = Buffer.from([0x16, 0x54, 0xae, 0x6b]);
const WEBM_CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
const ZIP_LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRows(inflated, width, height, bytesPerPixel) {
  const rowLength = width * bytesPerPixel;
  const expected = (rowLength + 1) * height;
  if (inflated.length !== expected) throw new Error(`decoded pixel stream length ${inflated.length} did not equal ${expected}`);
  const pixels = Buffer.alloc(rowLength * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    if (filter > 4) throw new Error(`unsupported PNG filter ${filter}`);
    const rowOffset = y * rowLength;
    const previousOffset = (y - 1) * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[previousOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[previousOffset + x - bytesPerPixel] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      pixels[rowOffset + x] = value & 0xff;
    }
    inputOffset += rowLength;
  }
  return pixels;
}

function sampleColor(pixels, pixelIndex, colorType, palette) {
  if (colorType === 0) {
    const value = pixels[pixelIndex];
    return `${value},${value},${value}`;
  }
  if (colorType === 2) {
    const offset = pixelIndex * 3;
    return `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`;
  }
  if (colorType === 3) {
    const offset = pixels[pixelIndex] * 3;
    if (!palette || offset + 2 >= palette.length) return 'invalid-palette-index';
    return `${palette[offset]},${palette[offset + 1]},${palette[offset + 2]}`;
  }
  if (colorType === 4) {
    const offset = pixelIndex * 2;
    return `${pixels[offset]},${pixels[offset]},${pixels[offset]},${pixels[offset + 1]}`;
  }
  const offset = pixelIndex * 4;
  return `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export function inspectPng(buffer) {
  const errors = [];
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 128) return { valid: false, errors: ['PNG is too small to contain visual evidence'] };
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return { valid: false, errors: ['invalid PNG signature'] };
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let palette;
  let sawEnd = false;
  const idat = [];
  try {
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const crcOffset = dataEnd;
      if (crcOffset + 4 > buffer.length) throw new Error(`truncated ${type || 'unknown'} chunk`);
      const crcInput = buffer.subarray(offset + 4, dataEnd);
      const expectedCrc = buffer.readUInt32BE(crcOffset);
      if (crc32(crcInput) !== expectedCrc) throw new Error(`${type} chunk CRC mismatch`);
      const data = buffer.subarray(dataStart, dataEnd);
      if (type === 'IHDR') {
        if (length !== 13) throw new Error('IHDR length is not 13');
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'PLTE') palette = Buffer.from(data);
      else if (type === 'IDAT') idat.push(Buffer.from(data));
      else if (type === 'IEND') {
        sawEnd = true;
        break;
      }
      offset = crcOffset + 4;
    }
    if (!sawEnd) throw new Error('IEND chunk is missing');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('IHDR dimensions are invalid');
    if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
    if (![0, 2, 3, 4, 6].includes(colorType)) throw new Error(`unsupported color type ${colorType}`);
    if (interlace !== 0) throw new Error('interlaced PNGs are not supported by the deterministic evidence validator');
    if (idat.length === 0) throw new Error('IDAT chunk is missing');
    const bytesPerPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    const pixels = decodePngRows(inflateSync(Buffer.concat(idat)), width, height, bytesPerPixel);
    const pixelCount = width * height;
    const sampleCount = Math.min(4096, pixelCount);
    const unique = new Set();
    for (let index = 0; index < sampleCount; index += 1) {
      const pixelIndex = Math.min(pixelCount - 1, Math.floor((index * pixelCount) / sampleCount));
      unique.add(sampleColor(pixels, pixelIndex, colorType, palette));
      if (unique.size >= 256) break;
    }
    if (width < 240 || height < 120) errors.push(`screenshot dimensions ${width}x${height} are below 240x120`);
    if (buffer.length < 1_000) errors.push(`screenshot byte length ${buffer.length} is too small for inspectable UI evidence`);
    if (unique.size < 4) errors.push(`screenshot has only ${unique.size} sampled colors and appears blank or content-free`);
    return { valid: errors.length === 0, errors, width, height, uniqueColorSamples: unique.size };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], width, height };
  }
}

export function inspectTraceZip(buffer) {
  const errors = [];
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 1_000) errors.push('trace.zip is too small to contain an inspectable Playwright trace');
  if (!buffer.subarray(0, 4).equals(ZIP_LOCAL_SIGNATURE)) errors.push('trace.zip has no ZIP local-file signature');
  if (buffer.indexOf(ZIP_END_SIGNATURE) < 0) errors.push('trace.zip has no ZIP end-of-central-directory record');
  if (buffer.indexOf(Buffer.from('trace.trace')) < 0) errors.push('trace.zip does not contain the Playwright trace.trace entry');
  return { valid: errors.length === 0, errors };
}

export function inspectWebm(buffer) {
  const errors = [];
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 1_000) errors.push('video.webm is too small to contain inspectable video evidence');
  if (!buffer.subarray(0, 4).equals(EBML_SIGNATURE)) errors.push('video.webm has no EBML signature');
  if (!buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1').toLocaleLowerCase('en-US').includes('webm')) {
    errors.push('video.webm does not identify a WebM document type');
  }
  if (buffer.indexOf(WEBM_SEGMENT) < 0) errors.push('video.webm has no Matroska Segment element');
  if (buffer.indexOf(WEBM_TRACKS) < 0) errors.push('video.webm has no Tracks element');
  if (buffer.indexOf(WEBM_CLUSTER) < 0) errors.push('video.webm has no media Cluster element');
  return { valid: errors.length === 0, errors };
}

async function existingFile(path) {
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}

export async function resolvePlaywrightFfmpeg(environment = process.env) {
  if (environment.LANDOS_ACCEPTANCE_FFMPEG_PATH?.trim()) {
    const explicit = await existingFile(environment.LANDOS_ACCEPTANCE_FFMPEG_PATH.trim());
    if (!explicit) throw new Error('LANDOS_ACCEPTANCE_FFMPEG_PATH does not identify a readable decoder');
    return explicit;
  }
  const playwrightRoot = dirname(require.resolve('playwright-core/package.json'));
  const browsers = JSON.parse(await readFile(join(playwrightRoot, 'browsers.json'), 'utf8'));
  const revision = browsers.browsers?.find((entry) => entry.name === 'ffmpeg')?.revision;
  if (!revision) throw new Error('installed Playwright does not declare an FFmpeg revision');
  let cacheRoot;
  if (environment.PLAYWRIGHT_BROWSERS_PATH === '0') cacheRoot = join(playwrightRoot, '.local-browsers');
  else if (environment.PLAYWRIGHT_BROWSERS_PATH?.trim()) cacheRoot = environment.PLAYWRIGHT_BROWSERS_PATH.trim();
  else if (process.platform === 'win32') cacheRoot = join(environment.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  else if (process.platform === 'darwin') cacheRoot = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  else cacheRoot = join(environment.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright');
  const executable = process.platform === 'win32' ? 'ffmpeg-win64.exe' : process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux';
  const bundled = await existingFile(join(cacheRoot, `ffmpeg-${revision}`, executable));
  if (!bundled) throw new Error(`Playwright FFmpeg ${revision} is not installed; run the documented Playwright browser install first`);
  return bundled;
}

export async function inspectDecodedWebm(path, environment = process.env) {
  const structural = inspectWebm(await readFile(path));
  if (!structural.valid) return structural;
  let decoder;
  try {
    decoder = await resolvePlaywrightFfmpeg(environment);
    const { stdout } = await execFileAsync(decoder, [
      '-hide_banner', '-loglevel', 'error',
      '-i', path,
      '-map', '0:v:0', '-an',
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
      '-f', 'webm', 'pipe:1',
    ], {
      encoding: 'buffer',
      maxBuffer: 50_000_000,
      timeout: 180_000,
      windowsHide: true,
      shell: false,
    });
    const decoded = inspectWebm(stdout);
    if (!decoded.valid || stdout.length < 10_000) {
      return { valid: false, errors: ['FFmpeg did not decode and remux an inspectable video stream'] };
    }
    return { valid: true, errors: [], decodedByteLength: stdout.length };
  } catch (error) {
    return { valid: false, errors: [`FFmpeg could not fully decode video evidence (${error instanceof Error ? error.message : String(error)})`] };
  }
}

function capturedWithin(value, startedAt, completedAt) {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  if (!startedAt || !completedAt) return true;
  return instant >= Date.parse(startedAt) && instant <= Date.parse(completedAt) + 60_000;
}

export function inspectConsoleCapture(value, { allowedErrorPatterns = [], startedAt, completedAt } = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['console.json root must be an object'], relevantErrorCount: 0 };
  if (value.schemaVersion !== '1.0.0') errors.push('console.json schemaVersion must be 1.0.0');
  if (!Array.isArray(value.entries)) errors.push('console.json entries must be an array');
  if (!capturedWithin(value.capturedAt, startedAt, completedAt)) errors.push('console.json capturedAt falls outside the run');
  const entries = Array.isArray(value.entries) ? value.entries : [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`console.json entries[${index}] must be an object`);
      continue;
    }
    if (!['debug', 'info', 'log', 'warning', 'error'].includes(entry.type)) errors.push(`console.json entries[${index}].type is invalid`);
    if (typeof entry.text !== 'string') errors.push(`console.json entries[${index}].text must be a string`);
    if (typeof entry.relevant !== 'boolean') errors.push(`console.json entries[${index}].relevant must be boolean`);
    if (!capturedWithin(entry.timestamp, startedAt, completedAt)) errors.push(`console.json entries[${index}].timestamp falls outside the run`);
    const relevant = entry.type === 'error' && !patternMatches(entry.text ?? '', allowedErrorPatterns);
    if (entry.relevant !== relevant) errors.push(`console.json entries[${index}].relevant contradicts contract-derived classification`);
  }
  const relevantErrorCount = entries.filter((entry) => entry?.type === 'error' && !patternMatches(entry?.text ?? '', allowedErrorPatterns)).length;
  return { valid: errors.length === 0, errors, relevantErrorCount };
}

export function inspectNetworkCapture(value, { requiredNetworkPatterns = [], startedAt, completedAt } = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['network-failures.json root must be an object'], requiredFailureCount: 0 };
  if (value.schemaVersion !== '1.0.0') errors.push('network-failures.json schemaVersion must be 1.0.0');
  if (!Array.isArray(value.failures)) errors.push('network-failures.json failures must be an array');
  if (!capturedWithin(value.capturedAt, startedAt, completedAt)) errors.push('network-failures.json capturedAt falls outside the run');
  const failures = Array.isArray(value.failures) ? value.failures : [];
  for (const [index, failure] of failures.entries()) {
    if (!failure || typeof failure !== 'object' || Array.isArray(failure)) {
      errors.push(`network-failures.json failures[${index}] must be an object`);
      continue;
    }
    if (typeof failure.method !== 'string' || failure.method.length === 0) errors.push(`network-failures.json failures[${index}].method is invalid`);
    if (typeof failure.urlPath !== 'string' || !failure.urlPath.startsWith('/')) errors.push(`network-failures.json failures[${index}].urlPath must be a query-free path`);
    if (failure.urlPath.includes('?') || failure.urlPath.includes('#')) errors.push(`network-failures.json failures[${index}].urlPath contains query or fragment data`);
    if (typeof failure.required !== 'boolean') errors.push(`network-failures.json failures[${index}].required must be boolean`);
    if (!capturedWithin(failure.timestamp, startedAt, completedAt)) errors.push(`network-failures.json failures[${index}].timestamp falls outside the run`);
    const required = patternMatches(failure.urlPath ?? '', requiredNetworkPatterns);
    if (failure.required !== required) errors.push(`network-failures.json failures[${index}].required contradicts contract-derived classification`);
  }
  const requiredFailureCount = failures.filter((failure) => patternMatches(failure?.urlPath ?? '', requiredNetworkPatterns)).length;
  return { valid: errors.length === 0, errors, requiredFailureCount };
}

export async function artifactMetadata(path, relativePath, contentValidation, capturedAt = new Date().toISOString()) {
  const buffer = await readFile(path);
  return {
    path: relativePath,
    mediaType: mediaTypeFor(relativePath),
    byteLength: buffer.length,
    sha256: sha256(buffer),
    capturedAt,
    contentValidation,
  };
}

export function mediaTypeFor(path) {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.zip')) return 'application/zip';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
