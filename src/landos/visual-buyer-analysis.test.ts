// Visual Buyer Analysis contract: structure, grounding constraints,
// prohibited-claim guard, canonical persistence with supersession, and the
// V2 projection (full analysis in Property Intelligence, concise summary on
// Overview with an expand control).

import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { importHermesLandPortalFile } from './hermes-landportal-import.js';
import { upsertPropertyCard } from './property-card.js';
import { resetPropertyResearchStoreCache } from './property-research-store.js';
import {
  loadVisualBuyerAnalysis,
  persistVisualBuyerAnalysis,
  validateVisualBuyerAnalysis,
  type VisualBuyerAnalysis,
} from './visual-buyer-analysis.js';
import os from 'node:os';

const SUBJECT_URL = 'https://landportal.com/?property=Zmlwcz0zNjAxMSZhcG49MDUzODg5Kzc1LjAwLTEtMjQuMTEmcHJvcGVydHlpZD04OTUwNTM4NQ%3D%3D';

function analysis(overrides: Partial<VisualBuyerAnalysis> = {}): VisualBuyerAnalysis {
  return {
    generatedAt: '2026-08-04T16:00:00.000Z',
    subjectLabel: 'ONEIL RD, PORT BYRON, NY 13140',
    basedOn: ['close parcel aerial', 'default 3D view', 'Street View x3', 'soil overlay'],
    observedFeatures: [
      { label: 'Open areas', detail: 'Cleared meadow at the road.', views: ['aerials'], basis: 'direct_observation' },
    ],
    buyerInterpretation: [
      { label: 'Likely buyer appeal', detail: 'Rural homesite character.', views: ['Street View'], basis: 'reasonable_interpretation' },
    ],
    unresolvedDiligence: ['Recorded legal access'],
    buyerPerspective: {
      strongestAdvantages: ['Paved frontage'],
      importantConcerns: ['Corridor rights unresolved'],
      bestFitBuyers: ['Homesite builders'],
      weakerFitBuyers: ['Commercial users'],
      preliminaryImpression: 'Attractive discovery-stage tract.',
      materialToValueOrStrategy: ['Closed in-band sale'],
    },
    evidenceReconciliation: {
      supportingViews: ['aerials', '3D', 'Street View'],
      supersededConclusions: [
        { prior: 'Corridor might be an active railroad.', reconciled: 'Cleared corridor without rails; not operating as a railroad; rights unconfirmed.', strongerEvidence: 'Street View crossing scene' },
      ],
      remainingUncertain: ['Corridor rights'],
      overallConfidence: 'moderate',
      confidenceWhy: 'Ground-level confirmation exists; rights questions remain open.',
    },
    overviewSummary: {
      physicalCharacter: 'Meadow and woods on a paved road.',
      mainBuyerAppeal: 'Private rural homesite.',
      topConcern: 'Corridor rights unresolved.',
    },
    ...overrides,
  };
}

function subjectCard() {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'ONEIL RD' });
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: 'ONEIL RD', city: 'PORT BYRON', state: 'NY', zip: '13140',
    county: 'Cayuga', apn: '053889 75.00-1-24.11', fips: '36011', lpUrl: SUBJECT_URL,
    verified: true, verificationSource: 'Retained exact parcel evidence',
  }).card;
  expect(linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' }).error).toBeUndefined();
  return { deal, card };
}

beforeEach(() => {
  _initTestLandosDb();
  resetPropertyResearchStoreCache();
});

describe('Visual Buyer Analysis validation', () => {
  it('accepts a complete grounded analysis', () => {
    expect(validateVisualBuyerAnalysis(analysis())).toEqual([]);
  });

  it('rejects an analysis grounded in too few views (single-aerial conclusions)', () => {
    const problems = validateVisualBuyerAnalysis(analysis({ basedOn: ['close parcel aerial'] }));
    expect(problems.join(' ')).toMatch(/never one aerial alone/);
  });

  it('rejects prohibited guaranteed or legal conclusions', () => {
    for (const bad of [
      'Guaranteed buildable homesite.',
      'Legal access is confirmed by the frontage.',
      'Septic approval is assured.',
      'The corridor is an active railroad.',
      'The corridor is a public trail.',
    ]) {
      const problems = validateVisualBuyerAnalysis(analysis({
        buyerPerspective: { ...analysis().buyerPerspective, preliminaryImpression: bad },
      }));
      expect(problems.join(' '), bad).toMatch(/prohibited/);
    }
  });

  it('rejects sections with missing content or ungrounded lines', () => {
    expect(validateVisualBuyerAnalysis(analysis({ unresolvedDiligence: [] })).join(' ')).toMatch(/section C/);
    expect(validateVisualBuyerAnalysis(analysis({
      observedFeatures: [{ label: 'X', detail: 'Y', views: [], basis: 'direct_observation' }],
    })).join(' ')).toMatch(/cites no supporting views/);
  });
});

describe('Visual Buyer Analysis canonical persistence', () => {
  function persist(target: ReturnType<typeof subjectCard>, value: VisualBuyerAnalysis) {
    return persistVisualBuyerAnalysis({
      propertyCardId: target.card.id, dealCardId: target.deal.id,
      address: 'ONEIL RD, PORT BYRON, NY 13140', county: 'Cayuga', state: 'NY',
      apn: '053889 75.00-1-24.11', fips: '36011', landPortalPropertyId: '89505385',
      sourceUrl: SUBJECT_URL, analysis: value,
    });
  }

  it('persists through the existing canonical research path and reads back', () => {
    const target = subjectCard();
    expect(persist(target, analysis())).toEqual({ persisted: true, reason: null });
    const loaded = loadVisualBuyerAnalysis(target.card.id);
    expect(loaded?.overviewSummary.topConcern).toBe('Corridor rights unresolved.');
    expect(loaded?.evidenceReconciliation.supersededConclusions).toHaveLength(1);
  });

  it('joins the identity retained by earlier lanes instead of re-deriving it', () => {
    const target = subjectCard();
    // A prior Hermes subject import establishes the retained identity.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vba-identity-'));
    const file = path.join(dir, 'subject.json');
    fs.writeFileSync(file, JSON.stringify({
      subject_url: SUBJECT_URL, subject_verification_status: 'verified_exact_subject',
      address: 'ONEIL RD, PORT BYRON, NY 13140', county: 'Cayuga County', apn: '053889 75.00-1-24.11',
      captured_at: '2026-08-01T14:00:00.000Z', specialist_category: 'subject', completed_categories: ['subject'], comps: [],
    }));
    importHermesLandPortalFile(file, { propertyCardId: target.card.id });
    expect(persist(target, analysis())).toEqual({ persisted: true, reason: null });
    expect(loadVisualBuyerAnalysis(target.card.id)).not.toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a newer analysis supersedes the retained one (no stale interpretation)', () => {
    const target = subjectCard();
    persist(target, analysis());
    persist(target, analysis({
      generatedAt: '2026-08-05T10:00:00.000Z',
      overviewSummary: { physicalCharacter: 'Updated.', mainBuyerAppeal: 'Updated appeal.', topConcern: 'Updated concern.' },
    }));
    expect(loadVisualBuyerAnalysis(target.card.id)?.overviewSummary.topConcern).toBe('Updated concern.');
  });

  it('refuses to persist an invalid analysis', () => {
    const target = subjectCard();
    const result = persist(target, analysis({ observedFeatures: [] }));
    expect(result.persisted).toBe(false);
    expect(loadVisualBuyerAnalysis(target.card.id)).toBeNull();
  });
});

describe('V2 projection (source contract)', () => {
  const ROUTES_SRC = fs.readFileSync(path.join(process.cwd(), 'src/landos/routes.ts'), 'utf8');
  const PAGE_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/pages/AcquisitionWorkspaceV2.tsx'), 'utf8');
  const PI_SRC = fs.readFileSync(
    path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
    'utf8',
  );

  it('serves the retained analysis in the PI read', () => {
    expect(ROUTES_SRC).toMatch(/visualBuyerAnalysis: linkCardId != null \? loadVisualBuyerAnalysis\(linkCardId\) : null/);
  });

  it('renders the full analysis with sections A-E in Property Intelligence', () => {
    for (const marker of ['Directly observed features', 'Buyer-oriented interpretation', 'Unresolved diligence', 'Potential buyer perspective', 'evidence reconciliation']) {
      expect(PI_SRC).toContain(marker);
    }
    expect(PI_SRC).toMatch(/supersededConclusions/);
  });

  it('shows a concise grounded summary on Overview with a control opening the full analysis', () => {
    expect(PAGE_SRC).toMatch(/Visual buyer summary/);
    expect(PAGE_SRC).toMatch(/physicalCharacter/);
    expect(PAGE_SRC).toMatch(/mainBuyerAppeal/);
    expect(PAGE_SRC).toMatch(/topConcern/);
    expect(PAGE_SRC).toMatch(/Open the full Visual Buyer Analysis/);
    expect(PAGE_SRC).toMatch(/switchSection\(e as unknown as MouseEvent, 'property-intelligence'\)/);
  });
});
