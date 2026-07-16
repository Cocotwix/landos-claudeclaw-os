import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { ingestCanonicalDealKnowledge } from './rag-ingest.js';
import { _resetRagSchemaCache, buildAgentRagContext, retrieveRagChunks } from './rag-knowledge.js';

beforeEach(() => {
  _initTestLandosDb();
  _resetRagSchemaCache();
});

describe('canonical Deal Card RAG bridge', () => {
  it('retrieves property-specific current evidence and isolates rejected history', () => {
    ingestCanonicalDealKnowledge({
      subject: { dealCardId: 14, cardId: 14, apn: 'R300 018 000 0085 0000', address: '473 SEASIDE RD', locality: 'St. Helena Island', county: 'Beaufort', state: 'SC' },
      accessCurrent: 'Official parcel geometry. Seaside Road centerline proximity only. Deed easement language and visual conflict reviewed; parcel-road contact and legal access unresolved.',
      accessHistorical: 'Rejected prior claim: mapped public-road frontage on Seaside Road.',
      zoningCurrent: 'Jurisdiction Beaufort County, South Carolina. Rural T2R zoning and St. Helena Cultural Overlay apply.',
      documentTitle: 'Deed to Trustees',
      documentSource: 'Beaufort County Register of Deeds',
      documentPages: [{ pageNumber: 4, section: 'Attachment A', text: 'Parcel II is Lot 4 of Mulberry Hill Plantation. Prior deed Book 18 Page 330.' }],
      marketCurrent: 'Geography hierarchy St. Helena Island, Beaufort County, SC. Accepted sold and active comps remain in separate acreage clusters. Source confidence is separate from comparability.',
      marketHistorical: 'Rejected Camp Davidson and wrong-state comp candidates; historical only.',
      qaCurrent: 'Unsafe phrases: mapped frontage, usable acreage from wetland subtraction, PASS while unresolved.',
    });

    const access = buildAgentRagContext({ agent: 'access', dealCardId: 14, county: 'Beaufort', state: 'SC', focus: 'Seaside parcel geometry visual conflict frontage' });
    expect(access.chunks.some((h) => h.docKey === 'canonical_access:14')).toBe(true);
    expect(access.historicalChunks.some((h) => h.docKey === 'canonical_access_history:14' && h.evidenceStatus === 'rejected')).toBe(true);
    expect(access.chunks.some((h) => h.evidenceStatus === 'rejected')).toBe(false);

    const zoning = buildAgentRagContext({ agent: 'zoning', dealCardId: 14, focus: 'T2R Cultural Overlay jurisdiction' });
    expect(zoning.chunks.some((h) => h.docKey === 'canonical_zoning:14')).toBe(true);

    const documents = buildAgentRagContext({ agent: 'documents', dealCardId: 14, focus: 'Mulberry Hill prior deed' });
    const deed = documents.chunks.find((h) => h.docKey === 'canonical_deed_pages:14');
    expect(deed?.pageNumber).toBe(4);

    const market = buildAgentRagContext({ agent: 'market', dealCardId: 14, focus: 'geography hierarchy accepted rejected cluster assignments comparability' });
    expect(market.chunks.some((h) => h.docKey === 'canonical_market:14')).toBe(true);
    expect(market.historicalChunks.some((h) => h.docKey === 'canonical_market_history:14')).toBe(true);

    const qa = buildAgentRagContext({ agent: 'qa', dealCardId: 14, focus: 'unsafe phrase usable acreage PASS frontage' });
    expect(qa.chunks.some((h) => h.docKey === 'canonical_qa:14')).toBe(true);

    expect(retrieveRagChunks({ query: 'Camp Davidson wrong-state', dealCardId: 14 })).toHaveLength(0);
    expect(retrieveRagChunks({ query: 'Camp Davidson wrong-state', dealCardId: 14, includeHistorical: true }).some((h) => h.evidenceStatus === 'rejected')).toBe(true);

    const rejectedOnly = retrieveRagChunks({
      query: 'Camp Davidson wrong-state', dealCardId: 14,
      evidenceStatuses: ['rejected'], limit: 10,
    });
    expect(rejectedOnly.length).toBeGreaterThan(0);
    expect(rejectedOnly.every((h) => h.evidenceStatus === 'rejected')).toBe(true);

    const marketScoped = buildAgentRagContext({ agent: 'market', dealCardId: 14, focus: 'frontage comparable rejected', includeHistorical: true, limitPerQuery: 20 });
    expect(marketScoped.historicalChunks.some((h) => h.docKey.startsWith('canonical_access_history:'))).toBe(false);
    const accessScoped = buildAgentRagContext({ agent: 'access', dealCardId: 14, focus: 'frontage comparable rejected', includeHistorical: true, limitPerQuery: 20 });
    expect(accessScoped.historicalChunks.some((h) => h.docKey.startsWith('canonical_market_history:'))).toBe(false);
  });

  it('never leaks another property card document into the subject context', () => {
    ingestCanonicalDealKnowledge({
      subject: { dealCardId: 99, cardId: 99, county: 'Monroe', state: 'TN' },
      accessCurrent: 'Camp Davidson candidate mismatch for another property.',
    });
    expect(retrieveRagChunks({ query: 'Camp Davidson mismatch', dealCardId: 14 }).some((h) => h.dealCardId === 99)).toBe(false);
  });
});
