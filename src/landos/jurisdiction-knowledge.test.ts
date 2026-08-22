import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { invokeRuntimeCapability } from './capability-registry.js';
import type { CapabilityResult } from './capability-contract.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import {
  persistControllingAuthority,
  persistSubdivisionRegulations,
  readSubdivisionRuleEvidence,
} from './land-use-intelligence-store.js';
import {
  compileJurisdictionKnowledgeFromDeal,
  jurisdictionKnowledgeScopeKey,
  readJurisdictionKnowledge,
} from './jurisdiction-knowledge.js';
import { acceptKnowledgeCandidate, readKnowledge } from './compiled-knowledge-store.js';
import { upsertPropertyCard } from './property-card.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';
import { saveRegulationDocuments, type RegulationJurisdiction } from './regulation-document-store.js';
import type { RuleConfidence, SubdivisionRegulations } from './subdivision-regulations.js';
import type { ZoningSubdivisionFacts } from './zoning-subdivision-capability.js';

const NOW = '2026-08-18T12:00:00.000Z';
const OLD = '2024-01-01T00:00:00.000Z';

beforeEach(() => { _initTestLandosDb(); });

function canonicalDeal(input: { place?: string; state?: string; apn?: string } = {}) {
  const place = input.place ?? 'Fairview';
  const state = input.state ?? 'TN';
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: `${place} knowledge fixture` });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: `100 Test Road, ${place}, ${state}`,
    apn: input.apn ?? `${deal.id}-TEST`,
    county: place === 'Fairview' ? 'Williamson' : 'Test County',
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
    county: place === 'Fairview' ? 'Williamson' : 'Test County',
    state,
    zip: null,
    apn: input.apn ?? `${deal.id}-TEST`,
    owner: null,
    acreage: 10,
    basis: 'Confirmed test fixture identity.',
    confidence: 1,
    sourceRefs: [],
    changeReason: 'jurisdiction knowledge fixture',
    createdBy: 'test',
  });
  return { deal, card };
}

function authority(dealCardId: number, input: { place?: string; state?: string; verifiedAt?: string } = {}): ControllingLandUseAuthority {
  const place = input.place ?? 'Fairview';
  const state = input.state ?? 'TN';
  const source = {
    label: `${place} Planning Department`,
    url: `https://www.${place.toLowerCase()}.${state.toLowerCase()}.gov/planning`,
    tier: 'official_government_source' as const,
    quote: `${place} administers zoning and subdivision review.`,
    retrievedAt: input.verifiedAt ?? NOW,
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
    verifiedAt: input.verifiedAt ?? NOW,
  };
}

function regulations(dealCardId: number, input: {
  place?: string;
  state?: string;
  value?: string;
  effective?: string | null;
  retrievedAt?: string;
  confidence?: RuleConfidence;
  key?: SubdivisionRegulations['rules'][number]['key'];
} = {}): SubdivisionRegulations {
  const place = input.place ?? 'Fairview';
  const state = input.state ?? 'TN';
  const sourceUrl = `https://www.${place.toLowerCase()}.${state.toLowerCase()}.gov/subdivision-regulations.pdf`;
  const rule = {
    key: input.key ?? 'minimum_frontage',
    label: 'Minimum frontage',
    value: input.value ?? '200 feet on a public or approved private street',
    quote: 'Each lot shall have at least two hundred feet of frontage.',
    section: '4-102.2',
    sourceLabel: `${place} Subdivision Regulations`,
    sourceUrl,
    authorityName: place,
    effectiveOrAsOf: input.effective ?? null,
    confidence: input.confidence ?? 'confirmed',
    limitations: [],
  } satisfies SubdivisionRegulations['rules'][number];
  return {
    dealCardId,
    authorityName: place,
    authorityDetermination: 'confirmed',
    documents: [{
      label: rule.sourceLabel,
      url: sourceUrl,
      tier: 'official_government_source',
      adoptedOrAsOf: input.effective ?? null,
      draftOrProposed: false,
      retrievedAt: input.retrievedAt ?? NOW,
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
    retrievedAt: input.retrievedAt ?? NOW,
  };
}

function retainAndCompile(input: Parameters<typeof regulations>[1] & { apn?: string } = {}) {
  const subject = canonicalDeal({ place: input.place, state: input.state, apn: input.apn });
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

function facts(result: CapabilityResult): ZoningSubdivisionFacts {
  return result.facts as ZoningSubdivisionFacts;
}

describe('Jurisdiction Knowledge V1 acceptance', () => {
  it('accepts only verified official evidence and rejects unsupported model prose', () => {
    const unverified = retainAndCompile({ confidence: 'likely' });
    expect(unverified.compiled.rejected).toBeGreaterThan(0);
    expect(readJurisdictionKnowledge(unverified.jurisdiction, { subjectPrefix: 'subdivision.' }).items).toHaveLength(0);

    const proposal = acceptKnowledgeCandidate({
      domain: 'jurisdiction', knowledgeType: 'factual', scopeKind: 'jurisdiction',
      scopeKey: jurisdictionKnowledgeScopeKey(unverified.jurisdiction) as string,
      subjectKey: 'subdivision.model_claim', statement: 'A model proposed this rule.', value: 'unsupported',
      sourceAuthority: 'official_government_source', confidence: 'confirmed', sensitivity: 'public',
      retrievedAt: NOW, lastVerifiedAt: NOW, freshnessPolicy: 'jurisdiction_procedure', supports: [],
      compilerVersion: 'test', createdBy: 'test', acceptanceReason: 'model proposal',
    });
    expect(proposal.outcome).toBe('rejected');
  });

  it('normalizes and isolates exact jurisdiction scopes', () => {
    const fairview = retainAndCompile();
    expect(fairview.compiled.scopeKey).toBe('TN:municipal:fairview');
    const franklin = readJurisdictionKnowledge({ authorityName: 'Franklin', level: 'municipal', state: 'TN' });
    expect(franklin.items).toHaveLength(0);
  });

  it('does not contaminate another jurisdiction with Deal A evidence', () => {
    retainAndCompile({ place: 'Fairview', apn: 'A-1' });
    const other = retainAndCompile({ place: 'Franklin', apn: 'B-1', value: '100 feet' });
    const rules = readJurisdictionKnowledge(other.jurisdiction, { subjectPrefix: 'subdivision.' });
    expect(rules.items.map((item) => item.record.value)).not.toContainEqual(expect.objectContaining({ value: '200 feet on a public or approved private street' }));
  });

  it('keeps current and superseded historical knowledge separate', () => {
    const first = retainAndCompile({ effective: '2023-01-01', value: '200 feet', apn: 'A-1' });
    retainAndCompile({ effective: '2024-01-01', value: '150 feet', apn: 'A-2' });
    const current = readJurisdictionKnowledge(first.jurisdiction, { subjectPrefix: 'subdivision.' });
    const history = readJurisdictionKnowledge(first.jurisdiction, { subjectPrefix: 'subdivision.', includeHistorical: true });
    expect(current.items).toHaveLength(1);
    expect((current.items[0].record.value as Record<string, unknown>).value).toBe('150 feet');
    expect(history.counts.superseded).toBe(1);
  });

  it('preserves conflicting verified claims without false certainty', () => {
    const first = retainAndCompile({ value: '200 feet', apn: 'A-1' });
    retainAndCompile({ value: '150 feet', apn: 'A-2' });
    const bundle = readJurisdictionKnowledge(first.jurisdiction, { subjectPrefix: 'subdivision.' });
    expect(bundle.counts.conflicting).toBe(2);
    expect(bundle.counts.current).toBe(0);
  });

  it('uses effective versions to supersede while retaining the old record', () => {
    const first = retainAndCompile({ effective: '2023-01-01', value: '200 feet', apn: 'A-1' });
    const second = retainAndCompile({ effective: '2024-01-01', value: '150 feet', apn: 'A-2' });
    expect(second.compiled.superseded).toBeGreaterThanOrEqual(1);
    const bundle = readJurisdictionKnowledge(first.jurisdiction, { subjectPrefix: 'subdivision.', includeHistorical: true });
    expect(bundle.counts.current).toBe(1);
    expect(bundle.counts.superseded).toBe(1);
  });

  it('persists freshness and computes stale at read time', () => {
    const old = retainAndCompile({ retrievedAt: OLD });
    const bundle = readJurisdictionKnowledge(old.jurisdiction, { subjectPrefix: 'subdivision.', now: NOW });
    expect(bundle.counts.stale).toBe(1);
    expect(bundle.items[0].record.freshUntil).not.toBeNull();
  });

  it('retrieves exact structured subjects without a model or research run', () => {
    const fairview = retainAndCompile();
    const scopeKey = jurisdictionKnowledgeScopeKey(fairview.jurisdiction) as string;
    const bundle = readKnowledge({ scopeKind: 'jurisdiction', scopeKey, subjectPrefix: 'subdivision.minimum_frontage' });
    expect(bundle.counts.current).toBe(1);
    expect(bundle.items[0].record.subjectKey).toBe('subdivision.minimum_frontage');
    expect(bundle.modelCalls).toBe(0);
    expect(bundle.researchRuns).toBe(0);
  });

  it('adds no vector, embedding or external knowledge dependency', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    const implementation = `${readFileSync('src/landos/compiled-knowledge-store.ts', 'utf8')}\n${readFileSync('src/landos/jurisdiction-knowledge.ts', 'utf8')}`;
    expect(packageJson).not.toMatch(/qdrant|pgvector|kernel-memory/i);
    expect(implementation).not.toMatch(/from ['"][^'"]*(?:qdrant|pgvector|redis|kernel-memory)|\bcreateEmbedding\b/i);
  });

  it('compiles Fairview from retained evidence with no new research or model call', () => {
    const fairview = retainAndCompile();
    expect(fairview.compiled.accepted).toBeGreaterThanOrEqual(3);
    expect(fairview.compiled.researchRuns).toBe(0);
    expect(fairview.compiled.modelCalls).toBe(0);
    expect(fairview.compiled.compileTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('reuses Fairview knowledge on a second parcel without rerunning rule research', async () => {
    const first = retainAndCompile({ apn: 'FAIRVIEW-A' });
    const second = canonicalDeal({ apn: 'FAIRVIEW-B' });
    persistControllingAuthority({ authority: authority(second.deal.id) });
    let researchRuns = 0;
    const result = await invokeRuntimeCapability({
      capabilityId: 'zoning-subdivision',
      caller: { type: 'deal_card', ref: `deal:${second.deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: second.card.id, dealCardId: second.deal.id },
      mode: 'reuse',
      parameters: { lane: 'retained_rules' },
      context: { surface: 'test' },
    }, { runLandUseResearch: async () => { researchRuns += 1; throw new Error('research must not run'); } });
    const projected = facts(result);
    expect(projected.jurisdiction.knowledge.scopeKey).toBe(first.compiled.scopeKey);
    expect(projected.jurisdiction.rulePackageReused).toBe(true);
    expect(projected.rules.package.some((rule) => rule.key === 'minimum_frontage')).toBe(true);
    expect(projected.summary).toContain('reused from compiled knowledge');
    expect(researchRuns).toBe(0);
  });

  it('never infers parcel-specific zoning from jurisdiction knowledge', async () => {
    retainAndCompile({ apn: 'FAIRVIEW-A' });
    const second = canonicalDeal({ apn: 'FAIRVIEW-B' });
    persistControllingAuthority({ authority: authority(second.deal.id) });
    const result = await invokeRuntimeCapability({
      capabilityId: 'zoning-subdivision', caller: { type: 'deal_card' },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: second.card.id, dealCardId: second.deal.id },
      mode: 'reuse', parameters: { lane: 'retained_rules' }, context: {},
    });
    expect(facts(result).zoning.established).toBe(false);
    expect(facts(result).zoning.districtCode).toBeNull();
  });

  it('keeps unknown subjects unknown instead of manufacturing fields', () => {
    const fairview = retainAndCompile();
    const bundle = readJurisdictionKnowledge(fairview.jurisdiction, { subjectPrefix: 'subdivision.septic_implication' });
    expect(bundle.items).toHaveLength(0);
  });

  it('performs SELECT-only retrieval and does not compile on repeated reads', () => {
    const fairview = retainAndCompile();
    const beforeRecords = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_knowledge_record').get() as { n: number }).n;
    const beforeAudit = (getLandosDb().prepare("SELECT COUNT(*) AS n FROM landos_audit_log WHERE action LIKE 'knowledge_%'").get() as { n: number }).n;
    readJurisdictionKnowledge(fairview.jurisdiction);
    readJurisdictionKnowledge(fairview.jurisdiction);
    const afterRecords = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_knowledge_record').get() as { n: number }).n;
    const afterAudit = (getLandosDb().prepare("SELECT COUNT(*) AS n FROM landos_audit_log WHERE action LIKE 'knowledge_%'").get() as { n: number }).n;
    expect(afterRecords).toBe(beforeRecords);
    expect(afterAudit).toBe(beforeAudit);
  });

  it('retains resolvable evidence traceability for every compiled rule', () => {
    const fairview = retainAndCompile();
    const bundle = readJurisdictionKnowledge(fairview.jurisdiction, { subjectPrefix: 'subdivision.' });
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].sources[0]).toEqual(expect.objectContaining({
      evidenceNamespace: 'property_evidence',
      url: expect.stringMatching(/^https:\/\//),
    }));
    const evidenceIds = readSubdivisionRuleEvidence(fairview.deal.id).map((row) => String(row.evidenceId));
    expect(evidenceIds).toContain(bundle.items[0].sources[0].evidenceRef);
  });
});
