// Street View must be a real visual investigation, and a visual observation may
// only exist where a retained image exists.
//
// These cases prove the two rules structurally: the capture path inspects the
// parcel frontage, then junctions traced from the aerial, then the surrounding
// roads, and states truthfully when no usable panorama exists anywhere; and the
// only constructor for a visual observation refuses unless the artifact it names
// is a real retained image.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  capturePropertyVisuals,
  observationIsArtifactBacked,
  visualObservation,
  type FetchBinary,
} from './google-visual-capture.js';
import { MAX_PARCEL_CONTEXT_DISTANCE_M } from './visual-eligibility.js';

const ENV = { GOOGLE_MAPS_API_KEY: 'test-key' };
const PARCEL = { lat: 44.8583, lng: -85.4021 };
const ASSOCIATION = { apn: '28-11-100-001-00', basis: 'verified_parcel_coordinates' as const };

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const PNG = () => new Uint8Array(4096).buffer;

/** Injected fetch whose metadata answer is decided per requested location. */
function fetchWithPanos(
  panoFor: (location: string) => { lat: number; lng: number } | null,
  seen?: string[],
): FetchBinary {
  return async (url: string) => {
    seen?.push(url);
    if (/streetview\/metadata/.test(url)) {
      const location = new URL(url).searchParams.get('location') ?? '';
      const pano = panoFor(location);
      const body = Buffer.from(JSON.stringify(pano ? { status: 'OK', location: pano } : { status: 'ZERO_RESULTS' }));
      return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => PNG() };
  };
}

function capture(input: Parameters<typeof capturePropertyVisuals>[0], fetchImpl: FetchBinary, dir = tempDir('gvc-')) {
  return capturePropertyVisuals(input, { env: ENV, fetchImpl, storeDir: dir, usageFile: path.join(dir, 'usage.json') });
}

describe('Street View is positioned by a real investigation, never by assumption', () => {
  it('captures at the parcel frontage when a panorama actually stands there', async () => {
    const seen: string[] = [];
    const res = await capture(
      { propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 61, association: ASSOCIATION },
      fetchWithPanos(() => ({ lat: PARCEL.lat + 0.0004, lng: PARCEL.lng }), seen),
    );
    expect(res.streetView?.coverage).toBe('captured');
    expect(res.streetView?.junction?.label).toBe('Parcel frontage');
    expect(res.streetView?.junction?.usable).toBe(true);
    expect(res.assets.street_view_static?.storedPath).toBeTruthy();
    // The camera is aimed back at the parcel from the panorama, and the URL is
    // built from coordinates only.
    const image = seen.find((url) => /maps\/api\/streetview\?/.test(url))!;
    expect(image).toContain('heading=');
    expect(image).not.toMatch(/subject/);
  });

  it('inspects junctions traced from the aerial when the frontage has no panorama', async () => {
    const junction = { lat: PARCEL.lat + 0.0015, lng: PARCEL.lng + 0.0015 };
    const res = await capture(
      {
        propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 62, association: ASSOCIATION,
        tracedJunctions: [{ label: 'apparent dirt route meets the public road', coords: junction, tracedFromArtifact: 'landportal_overview' }],
      },
      fetchWithPanos((location) => (location.startsWith(`${junction.lat}`) ? { lat: junction.lat, lng: junction.lng } : null)),
    );
    expect(res.streetView?.coverage).toBe('captured');
    expect(res.streetView?.junction?.label).toMatch(/^Traced junction — apparent dirt route/);
    // The frontage was inspected first; the traced junction was not assumed.
    expect(res.streetView?.probes[0].label).toBe('Parcel frontage');
    expect(res.streetView?.probes[0].pano).toBeNull();
  });

  it('refuses a junction candidate that carries no traced coordinates or artifact', async () => {
    const res = await capture(
      {
        propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 63, association: ASSOCIATION,
        tracedJunctions: [
          { label: 'Elk Lake Rd', coords: { lat: Number.NaN, lng: Number.NaN }, tracedFromArtifact: 'landportal_overview' },
          { label: 'guessed corner', coords: { lat: PARCEL.lat, lng: PARCEL.lng }, tracedFromArtifact: '   ' },
        ],
      },
      fetchWithPanos(() => null),
    );
    expect(res.streetView?.probes.some((probe) => probe.label.includes('Elk Lake Rd'))).toBe(false);
    expect(res.streetView?.probes.some((probe) => probe.label.includes('guessed corner'))).toBe(false);
  });

  it('sweeps the surrounding roads before concluding anything', async () => {
    const res = await capture(
      { propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 64, association: ASSOCIATION },
      fetchWithPanos(() => null),
    );
    expect(res.streetView?.probes.length).toBeGreaterThan(1);
    expect(res.streetView?.probes.some((probe) => probe.label.startsWith('Surrounding road sweep'))).toBe(true);
  });

  it('says plainly that usable coverage does not exist rather than degrading to an assumption', async () => {
    const res = await capture(
      { propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 65, association: ASSOCIATION },
      fetchWithPanos(() => null),
    );
    expect(res.streetView?.coverage).toBe('no_usable_coverage');
    expect(res.streetView?.reason).toMatch(/usable Street View coverage does not exist/i);
    expect(res.streetView?.junction).toBeNull();
    expect(res.assets.street_view_static).toBeUndefined();
    // The aerial is still captured: Street View coverage is a separate question.
    expect(res.assets.maps_static?.storedPath).toBeTruthy();
  });

  it('never uses a panorama that stands beyond frontage distance from the parcel', async () => {
    const res = await capture(
      { propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 66, association: ASSOCIATION },
      fetchWithPanos(() => ({ lat: PARCEL.lat + 0.05, lng: PARCEL.lng })), // ~5.5 km away
    );
    expect(res.assets.street_view_static).toBeUndefined();
    expect(res.streetView?.coverage).toBe('no_usable_coverage');
    expect(res.streetView?.reason).toMatch(new RegExp(`${MAX_PARCEL_CONTEXT_DISTANCE_M} m frontage limit`));
    expect(res.streetView?.probes.every((probe) => probe.usable === false)).toBe(true);
  });

  it('records that no investigation ran when the capture gate refuses the target', async () => {
    const res = await capturePropertyVisuals(
      { propertyLabel: 'x', address: null, coords: null, cardId: 67, association: ASSOCIATION },
      { env: ENV, fetchImpl: async () => { throw new Error('fetch must not be called'); } },
    );
    expect(res.streetView?.attempted).toBe(false);
    expect(res.streetView?.coverage).toBe('not_attempted');
    expect(res.streetView?.probes).toEqual([]);
  });
});

describe('a visual observation may only exist where its image exists', () => {
  it('refuses a finding whose artifact was never retained', () => {
    expect(visualObservation(
      { service: 'street_view_static', storedPath: path.join(tempDir('gvc-missing-'), 'never-written.png'), timestamp: 't' },
      { label: 'Entrances and barriers', detail: 'A gated gravel entrance is visible.' },
    )).toBeNull();
  });

  it('refuses a finding with no artifact at all — prose cannot become a sighting', () => {
    expect(visualObservation(null, { label: 'Entrances and barriers', detail: 'A gated entrance is present.' })).toBeNull();
    expect(visualObservation(undefined, { label: 'x', detail: 'y' })).toBeNull();
  });

  it('refuses an empty finding even when the artifact is real', () => {
    const dir = tempDir('gvc-empty-');
    const file = path.join(dir, 'pano.png');
    fs.writeFileSync(file, Buffer.from([1, 2, 3]));
    const asset = { service: 'street_view_static' as const, storedPath: file, timestamp: 't' };
    expect(visualObservation(asset, { label: '  ', detail: 'something' })).toBeNull();
    expect(visualObservation(asset, { label: 'something', detail: '   ' })).toBeNull();
  });

  it('binds an accepted finding to the retained image bytes', async () => {
    const dir = tempDir('gvc-backed-');
    const res = await capture(
      { propertyLabel: 'subject', address: null, coords: PARCEL, cardId: 68, association: ASSOCIATION },
      fetchWithPanos(() => ({ lat: PARCEL.lat + 0.0004, lng: PARCEL.lng })),
      dir,
    );
    const stored = res.assets.street_view_static!;
    const observed = visualObservation(
      { service: 'street_view_static', storedPath: stored.storedPath, timestamp: stored.timestamp },
      { label: 'Road surface', detail: 'Paved two-lane road with a gravel shoulder at the junction.' },
    )!;
    expect(observed.basis).toBe('direct_observation');
    expect(observed.artifact.sha256).toBe(stored.sha256);
    expect(observed.artifact.bytes).toBeGreaterThan(0);
    expect(observationIsArtifactBacked(observed)).toBe(true);
  });

  it('reports an observation whose artifact has since gone as unbacked', () => {
    const dir = tempDir('gvc-gone-');
    const file = path.join(dir, 'pano.png');
    fs.writeFileSync(file, Buffer.from([9, 9, 9]));
    const observed = visualObservation(
      { service: 'street_view_static', storedPath: file, timestamp: 't' },
      { label: 'Road surface', detail: 'Gravel shoulder visible.' },
    )!;
    expect(observationIsArtifactBacked(observed)).toBe(true);
    fs.rmSync(file);
    expect(observationIsArtifactBacked(observed)).toBe(false);
    expect(observationIsArtifactBacked(null)).toBe(false);
  });
});
