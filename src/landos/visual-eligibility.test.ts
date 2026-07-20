// Visual-association regression suite (the De Queen wrong-imagery fix).
//
// The regression: Google captures generated from the raw multi-APN intake string
// "002-07637-000 and 002-07579-000, Dequeen Arkansas" (sourceCoords: null)
// produced downtown / nearby-business imagery in correctly-named card-15 files.
// A card-scoped filename is NOT association proof. These tests lock the
// deterministic eligibility model and every layer that consumes it.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  assessVisualAssociation,
  filterEligibleAssetMap,
  isMultiApnString,
  looksLikeApnIntakeText,
  MAX_PARCEL_CONTEXT_DISTANCE_M,
  UNVERIFIED_IMAGERY_MESSAGE,
  type VisualAssociation,
} from './visual-eligibility.js';
import { capturePropertyVisuals, type FetchBinary } from './google-visual-capture.js';
import { sanitizeVisualIntelligenceRecord, type VisualIntelligenceRecord } from './visual-intelligence.js';
import { auditDealCardCoherence } from './deal-card-audit.js';
import { extractZipCandidate, extractApnCandidates } from './intake-normalize.js';
import { buildSmartIntake } from './smart-intake.js';

const BAD_INTAKE = '002-07637-000 and 002-07579-000, Dequeen Arkansas';
const COORDS = { lat: 34.0402368, lng: -94.3348612 };

// ── The deterministic eligibility decision ───────────────────────────────────

describe('assessVisualAssociation — parcel-association proof required', () => {
  const eligible: VisualAssociation = {
    targetKind: 'parcel', cardId: 15, apn: '002-07637-000',
    sourceCoords: COORDS, basis: 'verified_parcel_coordinates', captureQuery: '34.0402368,-94.3348612',
  };

  it('accepts verified-parcel-coordinate imagery', () => {
    expect(assessVisualAssociation(eligible, { expectedCardId: 15 }).eligible).toBe(true);
  });

  it('a missing association record (legacy capture) never qualifies — filename is not proof', () => {
    const v = assessVisualAssociation(null, { expectedCardId: 15 });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/parcel association could not be confirmed/i);
  });

  it('rejects city-centroid imagery', () => {
    const v = assessVisualAssociation({ ...eligible, basis: 'city_centroid' });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/city area, not the parcel/i);
  });

  it('rejects nearby-business Street View', () => {
    const v = assessVisualAssociation({ ...eligible, basis: 'nearby_business' });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/nearby business/i);
  });

  it('rejects a multi-APN capture query regardless of claimed basis', () => {
    const v = assessVisualAssociation({ ...eligible, captureQuery: BAD_INTAKE });
    expect(v.eligible).toBe(false);
    expect(v.basis).toBe('multi_apn_string');
  });

  it('rejects coordinate bases with no source coordinates', () => {
    const v = assessVisualAssociation({ ...eligible, sourceCoords: null });
    expect(v.eligible).toBe(false);
    expect(v.basis).toBe('missing_source_coords');
  });

  it('Street View is nearby parcel context and legacy frontage attribution is rejected', () => {
    const legacy = assessVisualAssociation({ ...eligible, basis: 'frontage_street_view' });
    expect(legacy.eligible).toBe(false);
    const near = assessVisualAssociation({ ...eligible, basis: 'parcel_nearby_street_view', distanceToParcelM: 40 });
    expect(near.eligible).toBe(true);
    const far = assessVisualAssociation({ ...eligible, basis: 'parcel_nearby_street_view', distanceToParcelM: MAX_PARCEL_CONTEXT_DISTANCE_M + 1 });
    expect(far.eligible).toBe(false);
  });

  it('Parcel B cannot inherit Parcel A imagery (card mismatch)', () => {
    const v = assessVisualAssociation({ ...eligible, cardId: 15 }, { expectedCardId: 16 });
    expect(v.eligible).toBe(false);
    expect(v.basis).toBe('inherited_from_other_card');
  });

  it('a superseded visual is never eligible again', () => {
    const v = assessVisualAssociation({ ...eligible, eligibility: 'superseded', ineligibilityReason: 'superseded by corrected capture' });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/superseded/i);
  });

  it('APN-specific LandPortal page imagery remains eligible', () => {
    const v = assessVisualAssociation({
      targetKind: 'parcel', cardId: 15, apn: '002-07637-000',
      basis: 'landportal_parcel_page', sourceUrl: 'https://app.landportal.example/parcel/x',
    }, { expectedCardId: 15 });
    expect(v.eligible).toBe(true);
  });

  it('filterEligibleAssetMap drops association-less and cross-card assets', () => {
    const out = filterEligibleAssetMap({
      good: { storedPath: 'a.png', association: eligible },
      legacy: { storedPath: 'street_view_static_c15_ab242063285b9bea.png' }, // card-named, no association
      foreign: { storedPath: 'b.png', association: { ...eligible, cardId: 9 } },
    } as never, 15);
    expect(Object.keys(out)).toEqual(['good']);
  });
});

// ── Multi-APN / intake-text detection ────────────────────────────────────────

describe('multi-APN and intake-text detection', () => {
  it('detects the De Queen multi-APN string', () => {
    expect(isMultiApnString(BAD_INTAKE)).toBe(true);
    expect(looksLikeApnIntakeText(BAD_INTAKE)).toBe(true);
  });
  it('a real street address is not intake text', () => {
    expect(isMultiApnString('123 Main St, De Queen, AR 71832')).toBe(false);
    expect(looksLikeApnIntakeText('123 Main St, De Queen, AR 71832')).toBe(false);
  });
});

// ── Capture path — never from raw text, never without coordinates ────────────

describe('capturePropertyVisuals — parcel-association gate', () => {
  const env = { GOOGLE_MAPS_API_KEY: 'test-key' };
  const noFetch: FetchBinary = async () => { throw new Error('fetch must not be called'); };

  it('refuses the raw multi-APN capture target outright', async () => {
    const res = await capturePropertyVisuals(
      { propertyLabel: BAD_INTAKE, address: BAD_INTAKE, coords: COORDS, cardId: 15, association: { apn: null, basis: 'verified_parcel_coordinates' } },
      { env, fetchImpl: noFetch },
    );
    expect(res.captured).toBe(false);
    expect(res.reason).toMatch(/multi-APN intake string/i);
  });

  it('blocks Google imagery without verified parcel coordinates', async () => {
    const res = await capturePropertyVisuals(
      { propertyLabel: 'APN 002-07637-000', address: '002-07637-000', coords: null, cardId: 15, association: { apn: '002-07637-000', basis: 'verified_parcel_coordinates' } },
      { env, fetchImpl: noFetch },
    );
    expect(res.captured).toBe(false);
    expect(res.reason).toMatch(/verified parcel coordinates are not available/i);
    expect(Object.keys(res.assets)).toHaveLength(0);
  });

  it('blocks capture when no association basis is recorded', async () => {
    const res = await capturePropertyVisuals(
      { propertyLabel: 'x', address: null, coords: COORDS, cardId: 15 },
      { env, fetchImpl: noFetch },
    );
    expect(res.captured).toBe(false);
    expect(res.reason).toMatch(/association basis/i);
  });

  it('captures from verified coordinates with association metadata; URLs are coords-only', async () => {
    const urls: string[] = [];
    const png = new Uint8Array(9000).buffer;
    const fetchImpl: FetchBinary = async (url: string) => {
      urls.push(url);
      if (/streetview\/metadata/.test(url)) {
        const body = Buffer.from(JSON.stringify({ status: 'OK', location: { lat: COORDS.lat + 0.0002, lng: COORDS.lng } }));
        return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
      }
      return { ok: true, status: 200, arrayBuffer: async () => png };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-'));
    const res = await capturePropertyVisuals(
      { propertyLabel: 'APN 002-07637-000', address: null, coords: COORDS, cardId: 15, association: { apn: '002-07637-000', basis: 'verified_parcel_coordinates' } },
      { env, fetchImpl, storeDir: dir, usageFile: path.join(dir, 'usage.json') },
    );
    expect(res.captured).toBe(true);
    // No Google URL may carry the intake text; every image URL is coords-only.
    for (const u of urls) expect(u).not.toMatch(/Dequeen|07637-000/);
    const sat = res.assets.maps_static!;
    expect(sat.association?.basis).toBe('verified_parcel_coordinates');
    expect(sat.association?.sourceCoords).toEqual(COORDS);
    const sv = res.assets.street_view_static!;
    expect(sv.association?.basis).toBe('parcel_nearby_street_view');
    expect(sv.association?.distanceToParcelM).toBeLessThanOrEqual(MAX_PARCEL_CONTEXT_DISTANCE_M);
  });

  it('skips Street View when the nearest pano is beyond the frontage distance', async () => {
    const png = new Uint8Array(9000).buffer;
    const fetchImpl: FetchBinary = async (url: string) => {
      if (/streetview\/metadata/.test(url)) {
        const body = Buffer.from(JSON.stringify({ status: 'OK', location: { lat: COORDS.lat + 0.01, lng: COORDS.lng } })); // ~1.1 km away
        return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
      }
      return { ok: true, status: 200, arrayBuffer: async () => png };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-'));
    const res = await capturePropertyVisuals(
      { propertyLabel: 'APN x', address: null, coords: COORDS, cardId: 15, association: { apn: 'x', basis: 'verified_parcel_coordinates' } },
      { env, fetchImpl, storeDir: dir, usageFile: path.join(dir, 'usage.json') },
    );
    expect(res.assets.maps_static).toBeTruthy();
    expect(res.assets.street_view_static).toBeUndefined();
  });
});

// ── Visual Intelligence sanitizer (gallery/hero, read-time) ─────────────────

describe('sanitizeVisualIntelligenceRecord — excluded imagery never renders', () => {
  const ts = '2026-07-12T00:00:00.000Z';
  const lp = { source: 'landportal', label: 'LandPortal', state: 'captured', storedPath: '/s/lp.png', imageRoute: '/api/x', timestamp: ts, subject: { address: null, lat: COORDS.lat, lng: COORDS.lng } } as never;
  const badStreet = { source: 'street_view', label: 'Street View', state: 'captured', storedPath: '/s/street_view_static_c15_ab242063285b9bea.png', imageRoute: '/api/y', timestamp: ts, subject: { address: BAD_INTAKE, lat: null, lng: null } } as never;
  const record = {
    cardId: 15, generatedAt: ts, subject: { address: BAD_INTAKE, lat: null, lng: null },
    sources: [lp, badStreet], gallery: [badStreet, lp], hero: badStreet, heroReason: 'x',
    observations: [], observationSummary: '', staticMapFallbackOnly: true, note: '',
  } as unknown as VisualIntelligenceRecord;

  it('drops the association-less Google capture, keeps LandPortal, recomputes the hero', () => {
    const out = sanitizeVisualIntelligenceRecord(record, {
      rawGoogle: { street_view_static: { storedPath: '/s/street_view_static_c15_ab242063285b9bea.png' } },
      eligibleGoogle: {},
    });
    expect(out.hero?.source).toBe('landportal');
    expect(out.gallery.map((a) => a.source)).toEqual(['landportal']);
    const street = out.sources.find((s) => s.source === 'street_view')!;
    expect(street.state).toBe('unavailable');
    expect(street.storedPath).toBeUndefined();
    expect(street.blocker).toMatch(/parcel association could not be confirmed/i);
  });

  it('keeps an association-proven Google capture eligible', () => {
    const out = sanitizeVisualIntelligenceRecord(record, {
      rawGoogle: { street_view_static: { storedPath: '/s/street_view_static_c15_ab242063285b9bea.png' } },
      eligibleGoogle: { street_view_static: { storedPath: '/s/street_view_static_c15_ab242063285b9bea.png' } },
    });
    expect(out.gallery.some((a) => a.source === 'street_view')).toBe(true);
    // LandPortal still outranks Street View for the hero.
    expect(out.hero?.source).toBe('landportal');
  });
});

// ── Orchestrator audit — subject association, not card-scoped URLs ───────────

describe('auditDealCardCoherence — imagery must carry association proof', () => {
  const base = {
    exists: true,
    visualContext: { assets: [{ status: 'captured', imageUrl: '/api/landos/visual/image?cardId=15&service=street_view_static' }] },
    landportalInspection: { parcelUrl: 'https://lp/parcel', assets: [] },
  };

  it('fails when a rendered visual is not in the eligible set — filename/card id alone never passes', () => {
    const a = auditDealCardCoherence({ report: base as never, subjectCardId: 15, eligibleVisualServices: [] });
    const check = a.checks.find((c) => c.id === 'imagery_association')!;
    expect(check.pass).toBe(false);
    expect(check.detail).toBe(UNVERIFIED_IMAGERY_MESSAGE);
    expect(a.passed).toBe(false);
  });

  it('passes when the rendered visual is association-proven', () => {
    const a = auditDealCardCoherence({ report: base as never, subjectCardId: 15, eligibleVisualServices: ['street_view_static'] });
    expect(a.checks.find((c) => c.id === 'imagery_association')!.pass).toBe(true);
  });
});

// ── APN-as-ZIP regression ────────────────────────────────────────────────────

describe('APN segments are never ZIP codes', () => {
  it('the De Queen multi-APN string yields NO zip and two APNs', () => {
    expect(extractZipCandidate(BAD_INTAKE)).toBeUndefined();
    const apns = extractApnCandidates(BAD_INTAKE);
    expect(apns.parcels.length).toBe(2);
    expect(apns.parcels.join(' ')).toMatch(/002-07637-000/);
    expect(apns.parcels.join(' ')).toMatch(/002-07579-000/);
  });

  it('a real ZIP still extracts', () => {
    expect(extractZipCandidate('123 Main St, De Queen, AR 71832')).toBe('71832');
    expect(extractZipCandidate('De Queen AR 71832-1234')).toBe('71832');
  });

  it('a two-segment APN like 027 04512 is never promoted to a ZIP code', () => {
    expect(extractZipCandidate('Parcel ID 027 04512, Cocke County, TN')).toBeUndefined();
    expect(extractZipCandidate('027 04512, Newport TN')).toBeUndefined();
  });

  it('smart intake on the raw lead: two APNs, De Queen AR, no street address, raw preserved, resolution required', () => {
    const si = buildSmartIntake(BAD_INTAKE);
    expect(si.rawText).toBe(BAD_INTAKE);
    expect(si.apn.primary).toBeTruthy();
    expect((si.fields.parcels ?? []).length).toBe(2);
    expect(si.fields.state).toBe('AR');
    expect((si.fields.city ?? '').toLowerCase()).toContain('queen');
    // No street address inferred from APN tokens, and no ZIP field fabricated.
    expect(/^\s*\d+\s+[A-Za-z]/.test(si.fields.address ?? '')).toBe(false);
    expect(si.confidence.label).not.toBe('Verified'); // parcel resolution still required
  });
});
