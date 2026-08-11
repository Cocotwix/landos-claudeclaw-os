// LandPortal capture-workflow contract: G Maps rule, default 3D, rendered
// soil overlay, dedicated buildability view, and the Street View pass.
//
// The SOP and the live Hermes skill must state the workflows consistently;
// the importer must admit the new capture categories, reject soil or
// buildability screenshots that do not attest rendered overlay polygons, and
// persist Street View observations or an explicit unavailability record.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import {
  importHermesLandPortalFile,
  type HermesLandPortalSubject,
  type HermesLandPortalVisualArtifact,
} from './hermes-landportal-import.js';
import { hermesLandPortalPrompt } from './hermes-landportal-auto.js';
import { loadPropertyInspection, upsertPropertyCard } from './property-card.js';
import { resetPropertyResearchStoreCache } from './property-research-store.js';

const SUBJECT_URL = 'https://landportal.com/?property=Zmlwcz0zNjAxMSZhcG49MDUzODg5Kzc1LjAwLTEtMjQuMTEmcHJvcGVydHlpZD04OTUwNTM4NQ%3D%3D';

// Docs wrap prose across lines; contract matching runs on collapsed whitespace.
const collapse = (textIn: string): string => textIn.replace(/\s+/g, ' ');
const SOP = collapse(fs.readFileSync(path.join(process.cwd(), 'docs/landos/property-intelligence-sop.md'), 'utf8'));
const SKILL = collapse(fs.readFileSync(
  path.join(process.cwd(), 'config/hermes/landos-profile/skills/landos-landportal/SKILL.md'),
  'utf8',
));

let tempDirs: string[] = [];

function artifact(overrides: Partial<HermesLandPortalVisualArtifact> & { dir: string }): HermesLandPortalVisualArtifact {
  const { dir, ...rest } = overrides;
  const key = rest.key ?? 'default_3d';
  const file = path.join(dir, `${key}.png`);
  // Real bytes above the 8 KB blank-image floor, unique per key so the
  // duplicate-hash gate does not collapse distinct fixture captures.
  fs.writeFileSync(file, Buffer.concat([Buffer.from(key, 'utf8'), Buffer.alloc(16 * 1024, 7)]));
  return {
    key,
    label: rest.label ?? key,
    kind: rest.kind ?? 'parcel_3d',
    purpose: rest.purpose ?? 'test capture',
    source_path: `${key}.png`,
    timestamp: '2026-08-04T12:00:00.000Z',
    requested_view: rest.requested_view ?? 'default_3d',
    active_view: rest.active_view ?? rest.requested_view ?? 'default_3d',
    boundary_required: rest.boundary_required ?? false,
    boundary_visible: rest.boundary_visible ?? true,
    tiles_loaded: true,
    camera_scale: rest.camera_scale ?? 'parcel',
    clipped: false,
    obstructions: [],
    overlay: rest.overlay ?? null,
    note: rest.note ?? null,
    overlay_rendered: rest.overlay_rendered,
  };
}

function visualsPayload(dir: string, artifacts: HermesLandPortalVisualArtifact[], extra: Partial<HermesLandPortalSubject> = {}): string {
  const payload: HermesLandPortalSubject = {
    subject_url: SUBJECT_URL,
    subject_verification_status: 'verified_exact_subject',
    subject_verification_note: 'URL identity and DOM Parcel ID agree.',
    address: 'ONEIL RD, PORT BYRON, NY 13140',
    county: 'Cayuga County',
    apn: '053889 75.00-1-24.11',
    captured_at: '2026-08-04T12:00:00.000Z',
    specialist_category: 'visuals',
    completed_categories: ['visuals'],
    comps: [],
    visual_artifacts: artifacts,
    ...extra,
  };
  const file = path.join(dir, 'visuals.json');
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

function subjectCard() {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'ONEIL RD' });
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'ONEIL RD',
    city: 'PORT BYRON',
    state: 'NY',
    zip: '13140',
    county: 'Cayuga',
    apn: '053889 75.00-1-24.11',
    fips: '36011',
    lpUrl: SUBJECT_URL,
    verified: true,
    verificationSource: 'Retained exact parcel evidence',
  }).card;
  expect(linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' }).error).toBeUndefined();
  return { deal, card };
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-capture-workflows-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  _initTestLandosDb();
  resetPropertyResearchStoreCache();
});

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('SOP and live Hermes skill state the workflows consistently', () => {
  it.each([['SOP', SOP], ['SKILL', SKILL]])('%s requires selecting and confirming G Maps without touching the Show on Map rule', (_name, doc) => {
    expect(doc).toMatch(/select(?:ing)?(?: and (?:visually )?confirm(?:ing)?)? (?:the )?[`"]?G Maps[`"]?/i);
    expect(doc).toMatch(/never assume it is already selected/i);
    expect(doc).toMatch(/Show on Map link[\s\S]{0,200}?(?:separate comparable page|never a base-map)/i);
  });

  it.each([['SOP', SOP], ['SKILL', SKILL]])('%s requires the framed Overview, land-locked investigation, and comp image drill-down', (_name, doc) => {
    expect(doc).toMatch(/landportal_overview/i);
    expect(doc).toMatch(/nearest (?:named )?public road/i);
    expect(doc).toMatch(/apparent access route/i);
    expect(doc).toMatch(/Land Locked: Yes|Land[- ]locked access trigger/i);
    expect(doc).toMatch(/recorded instrument/i);
    expect(doc).toMatch(/drill into every sidebar row/i);
    expect(doc).toMatch(/image|thumbnail/i);
  });

  it.each([['SOP', SOP], ['SKILL', SKILL]])('%s approves the default 3D framing and forbids substitutes', (_name, doc) => {
    expect(doc).toMatch(/default (?:LandPortal )?3D (?:view|framing)/i);
    expect(doc).toMatch(/do not rotate, tilt, zoom, or reposition/i);
    expect(doc).toMatch(/(?:never|is never) a substitute for (?:it|the 3D capture)|substitute a 2D aerial/i);
  });

  it.each([['SOP', SOP], ['SKILL', SKILL]])('%s requires rendered colored soil polygons before capture', (_name, doc) => {
    expect(doc).toMatch(/colored soil polygons/i);
    expect(doc).toMatch(/never rely (?:only )?on a short fixed delay/i);
    expect(doc).toMatch(/Map Unit Name, Drainage Class, Farmland Classification, Capability Class/i);
    expect(doc).toMatch(/only base imagery|base imagery alone|base imagery without soil colors/i);
  });

  it.each([['SOP', SOP], ['SKILL', SKILL]])('%s defines the Show Buildability workflow with the yellow overlay', (_name, doc) => {
    expect(doc).toMatch(/Slope Analysis/);
    expect(doc).toMatch(/Show Buildability/);
    expect(doc).toMatch(/yellow[- ]toned overlay/i);
    expect(doc).toMatch(/Buildability/);
  });

  it.each([['SOP', SOP], ['SKILL', SKILL]])('%s defines the Street View scan with grounded observation language', (_name, doc) => {
    expect(doc).toMatch(/Street View/);
    expect(doc).toMatch(/left, right, across the road/i);
    expect(doc).toMatch(/direct[ _](?:visual[ _])?observation/i);
    expect(doc).toMatch(/railroad, public trail, private road, utility corridor, or legal access route/i);
    expect(doc).toMatch(/unavailab/i);
  });
});

describe('the visuals assignment requests the new captures', () => {
  it('asks the visuals specialist for default 3D, soil, buildability, and Street View with the render attestation', () => {
    const prompt = hermesLandPortalPrompt({
      runId: 'test', dealCardId: 1, propertyCardId: 1,
      address: 'ONEIL RD, PORT BYRON, NY 13140', apn: '053889 75.00-1-24.11',
      owner: null, county: 'Cayuga', state: 'NY', landPortalPropertyId: '89505385',
    }, 'C:/tmp/out.json', 'visuals');
    for (const view of ['landportal_overview', 'default_3d', 'soil', 'buildability', 'street_view']) expect(prompt).toContain(view);
    expect(prompt).toContain('overlay_rendered');
    expect(prompt).toContain('street_view_observations');
    expect(prompt).toContain('access_evidence');
    expect(prompt).toMatch(/place the (?:Street View )?marker on the nearest public road/i);
  });
});

describe('importer admits the new capture categories', () => {
  it('persists default 3D, rendered soil, rendered buildability, and street view captures under their keys', () => {
    const target = subjectCard();
    const dir = tempDir();
    const file = visualsPayload(dir, [
      artifact({ dir, key: 'default_3d', requested_view: 'default_3d', kind: 'parcel_3d', label: 'Default 3D view' }),
      artifact({ dir, key: 'soil_overlay', requested_view: 'soil', kind: 'overlay', label: 'Soil type overlay', overlay: 'Soil Type', overlay_rendered: true }),
      artifact({ dir, key: 'buildability', requested_view: 'buildability', kind: 'overlay', label: 'Buildability', overlay: 'Buildability', overlay_rendered: true }),
      artifact({ dir, key: 'street_view', requested_view: 'street_view', kind: 'street_view', label: 'Street View — subject frontage' }),
    ], {
      street_view_available: true,
      street_view_observations: [
        { label: 'Road surface', detail: 'Paved two-lane rural road with gravel shoulder.', basis: 'direct_observation' },
        { label: 'Diagonal corridor', detail: 'Level cleared linear corridor; no rails or signals visible.', basis: 'reasonable_interpretation' },
      ],
    });

    const imported = importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    expect(imported.persistedCategories).toEqual(['visuals']);
    expect(imported.importedVisualCount).toBe(4);
    expect(imported.rejectedVisualCount).toBe(0);

    const inspection = loadPropertyInspection(target.card.id);
    const keys = (inspection?.assets ?? []).map((a) => a.key).sort();
    expect(keys).toEqual(['buildability', 'default_3d', 'soil_overlay', 'street_view']);
    const buildability = inspection?.assets.find((a) => a.key === 'buildability');
    expect(buildability?.label).toBe('Buildability');
    const observations = inspection?.visualObservations ?? [];
    expect(observations.some((o) => o.label === 'Road surface' && /direct observation/i.test(o.evidence))).toBe(true);
    expect(observations.some((o) => o.label === 'Diagonal corridor' && /reasonable interpretation/i.test(o.evidence))).toBe(true);
  });

  it('rejects soil and buildability captures that do not attest rendered overlay polygons', () => {
    const target = subjectCard();
    const dir = tempDir();
    const file = visualsPayload(dir, [
      artifact({ dir, key: 'soil_overlay', requested_view: 'soil', kind: 'overlay', overlay: 'Soil Type', overlay_rendered: false }),
      artifact({ dir, key: 'buildability', requested_view: 'buildability', kind: 'overlay', overlay: 'Buildability' }),
    ]);

    const imported = importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    expect(imported.importedVisualCount).toBe(0);
    expect(imported.rejectedVisualCount).toBe(2);
    expect((loadPropertyInspection(target.card.id)?.assets ?? []).length).toBe(0);
  });

  it('records Street View unavailability explicitly instead of silently skipping', () => {
    const target = subjectCard();
    const dir = tempDir();
    const file = visualsPayload(dir, [
      artifact({ dir, key: 'default_3d', requested_view: 'default_3d', kind: 'parcel_3d' }),
    ], {
      street_view_available: false,
      street_view_note: 'No Street View coverage exists along Onionville Rd at the subject frontage.',
    });

    importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    const observations = loadPropertyInspection(target.card.id)?.visualObservations ?? [];
    const record = observations.find((o) => o.label === 'Street View unavailable');
    expect(record).toBeDefined();
    expect(record?.detail).toMatch(/No Street View coverage/);
  });
});
