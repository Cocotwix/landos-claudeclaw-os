import { beforeEach, describe, expect, it } from 'vitest';

import { buildAcquisitionDossier, type AcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import { readCompiledKnowledge } from './compiled-knowledge-read.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { computeQuickFlipScreen, evaluateSellerPrice } from './quick-flip-screen.js';
import {
  propertyExpertReviewPrompt,
  propertyStructuredExtractionPrompt,
  type IntelligencePassContext,
} from './intelligence-stack-contract.js';
import { compileJurisdictionKnowledgeFromDeal, jurisdictionKnowledgeScopeKey } from './jurisdiction-knowledge.js';
import { persistControllingAuthority, persistSubdivisionRegulations } from './land-use-intelligence-store.js';
import {
  compiledJurisdictionKnowledgeSection,
  readPropertyCompiledKnowledge,
} from './property-compiled-knowledge.js';
import { upsertPropertyCard } from './property-card.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';
import { saveRegulationDocuments, type RegulationJurisdiction } from './regulation-document-store.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';

// The FIRST cross-department reuse of the Knowledge Compiler. What is proven
// here is that Property Intelligence RECEIVES already-verified jurisdiction
// knowledge as reusable evidence without compiling, researching or writing,
// and that only CURRENT knowledge is ever presented as settled.

const NOW = '2026-08-18T12:00:00.000Z';

beforeEach(() => { _initTestLandosDb(); });

function canonicalDeal(input: { place?: string; state?: string; apn?: string } = {}) {
  const place = input.place ?? 'Fairview';
  const state = input.state ?? 'TN';
  const county = place === 'Fairview' ? 'Williamson' : 'Test County';
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: `${place} reuse fixture` });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: `100 Test Road, ${place}, ${state}`,
    apn: input.apn ?? `${deal.id}-TEST`,
    county,
    state,
    acres: 10,
    verified: true,
    verificationSource: 'Official county assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  createPropertyIdentityVersion({
    dealCardId: deal.id,
    propertyCardId: card.id,
    status: 'candidate',
    address: `100 Test Road, ${place}, ${state}`,
    city: place,
    county,
    state,
    zip: null,
    apn: input.apn ?? `${deal.id}-TEST`,
    owner: null,
    acreage: 10,
    basis: 'Confirmed test fixture identity.',
    confidence: 1,
    sourceRefs: [],
    changeReason: 'compiled knowledge reuse fixture',
    createdBy: 'test',
  });
  return { deal, card };
}

function authority(dealCardId: number, input: { place?: string; state?: string } = {}): ControllingLandUseAuthority {
  const place = input.place ?? 'Fairview';
  const state = input.state ?? 'TN';
  const source = {
    label: `${place} Planning Department`,
    url: `https://www.${place.toLowerCase()}.${state.toLowerCase()}.gov/planning`,
    tier: 'official_government_source' as const,
    quote: `${place} administers zoning and subdivision review.`,
    retrievedAt: NOW,
  };
  const assignment = {
    name: place,
    level: 'municipal' as const,
    determination: 'confirmed' as const,
    basis: source.quote,
    sources: [source],
    competingClaims: [],
  };
  return {
    dealCardId,
    municipality: place,
    county: place === 'Fairview' ? 'Williamson' : 'Test County',
    state,
    incorporationStatus: 'incorporated',
    incorporationBasis: source.quote,
    zoningAuthority: assignment,
    subdivisionAuthority: assignment,
    planningBody: `${place} Planning Commission`,
    geographyEvidence: null,
    sources: [source],
    conflicts: [],
    limitations: [],
    verifiedAt: NOW,
  };
}

function regulations(dealCardId: number, input: { place?: string; state?: string } = {}): SubdivisionRegulations {
  const place = input.place ?? 'Fairview';
  const state = input.state ?? 'TN';
  const sourceUrl = `https://www.${place.toLowerCase()}.${state.toLowerCase()}.gov/subdivision-regulations.pdf`;
  const rule = {
    key: 'minimum_frontage' as const,
    label: 'Minimum frontage',
    value: '200 feet on a public or approved private street',
    quote: 'Each lot shall have at least two hundred feet of frontage.',
    section: '4-102.2',
    sourceLabel: `${place} Subdivision Regulations`,
    sourceUrl,
    authorityName: place,
    effectiveOrAsOf: null,
    confidence: 'confirmed' as const,
    limitations: [],
  };
  return {
    dealCardId,
    authorityName: place,
    authorityDetermination: 'confirmed',
    documents: [{
      label: rule.sourceLabel,
      url: sourceUrl,
      tier: 'official_government_source',
      adoptedOrAsOf: null,
      draftOrProposed: false,
      retrievedAt: NOW,
    }],
    rules: [rule],
    thresholds: {
      minorDefinition: null,
      majorDefinition: null,
      administrativeSplitThreshold: null,
      maxLotsBeforeMajorReview: null,
      statedMaxMinorLots: null,
      basis: 'No numeric threshold was needed for this fixture.',
    },
    reviewSequence: [],
    limitations: [],
    retrievedAt: NOW,
  } as SubdivisionRegulations;
}

/** DEAL A: verified research is compiled into persistent jurisdiction knowledge. */
function compilingDeal(input: { place?: string; state?: string; apn?: string } = {}) {
  const subject = canonicalDeal(input);
  const heldAuthority = authority(subject.deal.id, input);
  const heldRegulations = regulations(subject.deal.id, input);
  persistControllingAuthority({ authority: heldAuthority });
  persistSubdivisionRegulations({ regulations: heldRegulations });
  const jurisdiction: RegulationJurisdiction = {
    authorityName: heldAuthority.subdivisionAuthority.name as string,
    level: heldAuthority.subdivisionAuthority.level,
    state: heldAuthority.state as string,
  };
  saveRegulationDocuments(jurisdiction, heldRegulations.documents.map((document) => ({
    url: document.url as string,
    label: document.label,
    adoptedOrAsOf: document.adoptedOrAsOf,
    draftOrProposed: document.draftOrProposed,
    ruleCount: heldRegulations.rules.length,
  })));
  const compiled = compileJurisdictionKnowledgeFromDeal(subject.deal.id);
  return { ...subject, jurisdiction, compiled };
}

/** DEAL B: a DIFFERENT property in the SAME jurisdiction. It compiles nothing. */
function reusingDeal(input: { place?: string; state?: string; apn?: string } = {}) {
  const subject = canonicalDeal(input);
  persistControllingAuthority({ authority: authority(subject.deal.id, input) });
  return subject;
}

function knowledgeWriteCount(): number {
  const db = getLandosDb();
  const records = db.prepare('SELECT COUNT(*) AS n FROM landos_knowledge_record').get() as { n: number };
  const supports = db.prepare('SELECT COUNT(*) AS n FROM landos_knowledge_support').get() as { n: number };
  return records.n + supports.n;
}

function setStateOf(subjectLike: string, patch: Record<string, string | null>): void {
  const assignments = Object.keys(patch).map((column) => `${column}=?`).join(', ');
  getLandosDb()
    .prepare(`UPDATE landos_knowledge_record SET ${assignments} WHERE subject_key LIKE ?`)
    .run(...Object.values(patch), `${subjectLike}%`);
}

function dossier(): AcquisitionDossier {
  return buildAcquisitionDossier({
    dealCardId: 89,
    now: () => new Date(NOW),
    propertyIntelligence: {
      snapshot: {
        identity: {
          state: 'confirmed',
          displayAddress: '0 Kingwood Blvd, Fairview, TN 37062',
          apn: '042-123.00-000',
          county: 'Williamson',
          stateCode: 'TN',
          acres: 51.11,
        },
      },
    },
  } as unknown as PropertyFileSource);
}

function passContext(): IntelligencePassContext {
  const quickFlip = computeQuickFlipScreen({ supportedFmv: null, fmvBasis: null, acceptedCompCount: 0, expectedResaleDays: null });
  return {
    layers: ['property'],
    phase: 'pre_call',
    quickFlip,
    sellerPriceVerdict: evaluateSellerPrice(quickFlip, null),
    canonicalScores: { property: 82, market: null, seller: null },
    sellerEstablished: false,
    guidance: [],
    readinessHeadline: null,
    knownUnresolved: [],
    retainedReads: {},
  };
}

const ENVELOPE = { dealCardId: 89, generatedAt: NOW, contextFingerprint: 'fp-test' };

describe('generic compiled-knowledge reader', () => {
  it('returns CURRENT compiled knowledge with provenance and derived state', () => {
    const deal = compilingDeal();
    const scopeKey = jurisdictionKnowledgeScopeKey(deal.jurisdiction) as string;
    const read = readCompiledKnowledge({ domain: 'jurisdiction', scopeKind: 'jurisdiction', scopeKey, now: NOW });

    expect(read.current.length).toBeGreaterThan(0);
    expect(read.modelCalls).toBe(0);
    expect(read.researchRuns).toBe(0);
    expect(read.knowledgeWrites).toBe(0);
    const fact = read.current[0];
    expect(fact.state).toBe('CURRENT');
    expect(fact.subjectKey.length).toBeGreaterThan(0);
    expect(fact.statement.length).toBeGreaterThan(0);
    expect(fact.scopeKey).toBe(scopeKey);
    expect(fact.confidence.length).toBeGreaterThan(0);
    expect(fact.lastVerifiedAt.length).toBeGreaterThan(0);
    expect(fact.sources.length).toBeGreaterThan(0);
  });

  it('fails closed on an unresolved scope and on a foreign domain', () => {
    compilingDeal();
    expect(readCompiledKnowledge({ scopeKind: 'jurisdiction', scopeKey: '  ' }).items).toEqual([]);
    expect(readCompiledKnowledge({
      domain: 'market',
      scopeKind: 'jurisdiction',
      scopeKey: jurisdictionKnowledgeScopeKey({ authorityName: 'Fairview', level: 'municipal', state: 'TN' }) as string,
    }).items).toEqual([]);
  });

  it('never exposes rejected or candidate records as knowledge', () => {
    const deal = compilingDeal();
    const scopeKey = jurisdictionKnowledgeScopeKey(deal.jurisdiction) as string;
    setStateOf('subdivision.', { status: 'rejected' });
    const read = readCompiledKnowledge({ domain: 'jurisdiction', scopeKind: 'jurisdiction', scopeKey, now: NOW });
    expect(read.items.some((item) => item.subjectKey.startsWith('subdivision.'))).toBe(false);
  });
});

describe('property intelligence compiled-knowledge reuse', () => {
  it('delivers CURRENT jurisdiction knowledge to a DIFFERENT deal in the SAME jurisdiction with no recompile, model call or research call', () => {
    const dealA = compilingDeal({ apn: 'DEAL-A' });
    expect(dealA.compiled?.accepted ?? 0).toBeGreaterThan(0);

    const dealB = reusingDeal({ apn: 'DEAL-B' });
    const before = knowledgeWriteCount();
    const reused = readPropertyCompiledKnowledge(dealB.deal.id, { now: NOW });
    const after = knowledgeWriteCount();

    expect(reused.scopeKey).toBe(jurisdictionKnowledgeScopeKey(dealA.jurisdiction));
    expect(reused.current.length).toBeGreaterThan(0);
    expect(reused.modelCalls).toBe(0);
    expect(reused.researchRuns).toBe(0);
    expect(reused.knowledgeWrites).toBe(0);
    // Zero knowledge writes on a normal deterministic read.
    expect(after).toBe(before);
  });

  it('isolates a DIFFERENT jurisdiction from deal A knowledge', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const dealC = reusingDeal({ place: 'Dickson', apn: 'DEAL-C' });
    const reused = readPropertyCompiledKnowledge(dealC.deal.id, { now: NOW });
    expect(reused.scopeKey).toContain('dickson');
    expect(reused.current).toEqual([]);
    expect(compiledJurisdictionKnowledgeSection(reused)).toBe('');
  });

  it('reuses nothing when the controlling jurisdiction is unresolved', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const orphan = canonicalDeal({ apn: 'NO-AUTHORITY' });
    const reused = readPropertyCompiledKnowledge(orphan.deal.id, { now: NOW });
    expect(reused.scopeKey).toBeNull();
    expect(reused.current).toEqual([]);
  });

  it('keeps STALE knowledge out of current and labels it as needing refresh', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const dealB = reusingDeal({ apn: 'DEAL-B' });
    setStateOf('subdivision.', { fresh_until: '2020-01-01T00:00:00.000Z' });

    const reused = readPropertyCompiledKnowledge(dealB.deal.id, { now: NOW });
    expect(reused.current.every((fact) => !fact.subjectKey.startsWith('subdivision.'))).toBe(true);
    expect(reused.stale.some((fact) => fact.subjectKey.startsWith('subdivision.'))).toBe(true);
    const section = compiledJurisdictionKnowledgeSection(reused);
    expect(section).toContain('PAST FRESHNESS');
    expect(section).toContain('[STALE]');
  });

  it('never presents CONFLICTING or UNRESOLVED knowledge as settled', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const dealB = reusingDeal({ apn: 'DEAL-B' });
    setStateOf('subdivision.', { status: 'conflicting' });

    const reused = readPropertyCompiledKnowledge(dealB.deal.id, { now: NOW });
    expect(reused.current.every((fact) => !fact.subjectKey.startsWith('subdivision.'))).toBe(true);
    expect(reused.notSettled.some((fact) => fact.state === 'CONFLICTING')).toBe(true);
    const section = compiledJurisdictionKnowledgeSection(reused);
    expect(section).toContain('NOT SETTLED');
    expect(section).toContain('[CONFLICTING]');
  });

  it('never returns SUPERSEDED knowledge as current evidence', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const dealB = reusingDeal({ apn: 'DEAL-B' });
    setStateOf('subdivision.', { status: 'superseded' });

    const reused = readPropertyCompiledKnowledge(dealB.deal.id, { now: NOW });
    expect(reused.current.every((fact) => !fact.subjectKey.startsWith('subdivision.'))).toBe(true);
    expect(reused.stale.every((fact) => !fact.subjectKey.startsWith('subdivision.'))).toBe(true);
    expect(reused.notSettled.every((fact) => !fact.subjectKey.startsWith('subdivision.'))).toBe(true);
    expect(compiledJurisdictionKnowledgeSection(reused)).not.toContain('[SUPERSEDED]');
  });
});

describe('property stage A and B receive compiled knowledge as reusable evidence', () => {
  it('includes the labeled compiled jurisdiction knowledge section with provenance and state', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const dealB = reusingDeal({ apn: 'DEAL-B' });
    const reused = readPropertyCompiledKnowledge(dealB.deal.id, { now: NOW });

    const stageA = propertyExpertReviewPrompt(dossier(), [], passContext(), ENVELOPE, reused);
    expect(stageA).toContain('=== COMPILED JURISDICTION KNOWLEDGE (REUSABLE VERIFIED EVIDENCE) ===');
    expect(stageA).toContain('CURRENT compiled jurisdiction rules');
    expect(stageA).toContain('[CURRENT]');
    expect(stageA).toContain(reused.scopeKey as string);
    expect(stageA).toContain('confidence confirmed');
    expect(stageA).toContain('https://www.fairview.tn.gov');

    const stageB = propertyStructuredExtractionPrompt(dossier(), [], 'review', passContext(), ENVELOPE, reused);
    expect(stageB).toContain('=== COMPILED JURISDICTION KNOWLEDGE (REUSABLE VERIFIED EVIDENCE) ===');
  });

  it('keeps jurisdiction rules distinct from parcel-specific fact and never promotes them', () => {
    compilingDeal({ apn: 'DEAL-A' });
    const dealB = reusingDeal({ apn: 'DEAL-B' });
    const stageA = propertyExpertReviewPrompt(dossier(), [], passContext(), ENVELOPE, readPropertyCompiledKnowledge(dealB.deal.id, { now: NOW }));
    expect(stageA).toContain('REUSABLE JURISDICTION-LEVEL EVIDENCE, not parcel-specific fact');
    expect(stageA).toContain('combine it with parcel-specific evidence');
    // The parcel-specific property file remains its own separate section.
    expect(stageA).toContain('=== COMPLETE CURRENT PROPERTY FILE (JSON) ===');
    expect(stageA.indexOf('=== COMPLETE CURRENT PROPERTY FILE (JSON) ==='))
      .toBeLessThan(stageA.indexOf('=== COMPILED JURISDICTION KNOWLEDGE'));
  });

  it('omits the section entirely when no compiled knowledge exists', () => {
    const orphan = canonicalDeal({ apn: 'NO-AUTHORITY' });
    const stageA = propertyExpertReviewPrompt(dossier(), [], passContext(), ENVELOPE, readPropertyCompiledKnowledge(orphan.deal.id, { now: NOW }));
    expect(stageA).not.toContain('COMPILED JURISDICTION KNOWLEDGE');
  });
});
