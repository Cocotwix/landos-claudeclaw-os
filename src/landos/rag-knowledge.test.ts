import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  _resetRagSchemaCache,
  buildAgentRagContext,
  chunkText,
  htmlToText,
  ingestRagDocument,
  ragIndexStats,
  retrieveRagChunks,
  setRagEvidenceStatus,
  toFtsQuery,
} from './rag-knowledge.js';

beforeEach(() => {
  _initTestLandosDb();
  _resetRagSchemaCache();
});

describe('RAG ingestion + chunking', () => {
  it('chunks long text paragraph-aware and preserves page metadata', () => {
    const para = 'A sentence about easements and access rights. '.repeat(60);
    const chunks = chunkText(`${para}\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(2000);

    const res = ingestRagDocument({
      docKey: 'deed:TEST1', title: 'Test deed', docType: 'deed_ocr', source: 'recorder',
      dealCardId: 14, county: 'Beaufort', state: 'SC',
      pages: [
        { pageNumber: 1, text: 'This deed conveys Lot 4 of Mulberry Hill Plantation to the trustees.' },
        { pageNumber: 4, text: 'No express easement language appears in this instrument.' },
      ],
    });
    expect(res.chunks).toBe(2);
    const hits = retrieveRagChunks({ query: 'Mulberry Hill plat lot', dealCardId: 14 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].pageNumber).toBe(1);
    expect(hits[0].docType).toBe('deed_ocr');
  });

  it('is idempotent by content hash and re-chunks on content change', () => {
    const base = { docKey: 'ord:T2R', title: 'T2R ordinance', docType: 'zoning_ordinance' as const, source: 'county', text: 'Minimum lot size is one acre in the rural district.' };
    const first = ingestRagDocument(base);
    const again = ingestRagDocument(base);
    expect(again.skipped).toBe(true);
    expect(again.documentId).toBe(first.documentId);
    const changed = ingestRagDocument({ ...base, text: 'Minimum lot size is two acres in the rural district after amendment.' });
    expect(changed.skipped).toBe(false);
    const rows = getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_rag_document').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('strips html and builds safe FTS queries', () => {
    expect(htmlToText('<p>Setbacks are <b>25 feet</b>.</p><script>evil()</script>')).toContain('Setbacks are 25 feet.');
    expect(htmlToText('<p>x</p>')).not.toContain('evil');
    expect(toFtsQuery('easement "right-of-way" (25m)')).not.toContain('(');
    expect(toFtsQuery('')).toBe('""');
  });
});

describe('RAG retrieval policy', () => {
  it('excludes rejected/superseded chunks unless historical context is requested', () => {
    ingestRagDocument({ docKey: 'r1', title: 'Rejected frontage claim', docType: 'rejected_research', source: 'qa', evidenceStatus: 'rejected', text: 'Claimed mapped frontage on Seaside Road was rejected as unsafe language.' });
    ingestRagDocument({ docKey: 'a1', title: 'Accepted access research', docType: 'accepted_research', source: 'landos', text: 'Road proximity only; parcel contact unresolved on Seaside Road.' });
    const current = retrieveRagChunks({ query: 'Seaside frontage', limit: 10 });
    expect(current.some((h) => h.docKey === 'r1')).toBe(false);
    expect(current.some((h) => h.docKey === 'a1')).toBe(true);
    const historical = retrieveRagChunks({ query: 'Seaside frontage', includeHistorical: true, limit: 10 });
    expect(historical.some((h) => h.docKey === 'r1')).toBe(true);
  });

  it('scopes property documents to the card and keeps jurisdictional docs shared', () => {
    ingestRagDocument({ docKey: 'deed14', title: 'Card 14 deed', docType: 'deed_ocr', source: 'recorder', dealCardId: 14, text: 'Trustee authority language for the subject parcel deed.' });
    ingestRagDocument({ docKey: 'deed99', title: 'Card 99 deed', docType: 'deed_ocr', source: 'recorder', dealCardId: 99, text: 'Trustee authority language for another property deed.' });
    ingestRagDocument({ docKey: 'ordX', title: 'County ordinance', docType: 'zoning_ordinance', source: 'county', text: 'Trustee subdivision authority rules in the ordinance.' });
    const hits = retrieveRagChunks({ query: 'trustee authority', dealCardId: 14, limit: 10 });
    const keys = hits.map((h) => h.docKey);
    expect(keys).toContain('deed14');
    expect(keys).toContain('ordX');
    expect(keys).not.toContain('deed99');
  });

  it('agent bundles retrieve per-policy doc types and log retrievals; status updates flow', () => {
    ingestRagDocument({ docKey: 'pb1', title: 'Road access playbook', docType: 'playbook', source: 'docs', text: 'Never call centerline proximity frontage; check easement and right-of-way instruments first.' });
    ingestRagDocument({ docKey: 'mk1', title: 'Market scan', docType: 'market_research', source: 'landos', text: 'Sold comparable cluster analysis for rural parcels; price per acre patterns.' });
    const ctx = buildAgentRagContext({ agent: 'access', dealCardId: 14, focus: 'easement right of way' });
    expect(ctx.chunks.some((c) => c.docKey === 'pb1')).toBe(true);
    expect(ctx.chunks.some((c) => c.docKey === 'mk1')).toBe(false); // market docs are not access-policy types
    const log = getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_rag_retrieval_log').get() as { n: number };
    expect(log.n).toBeGreaterThan(0);

    expect(setRagEvidenceStatus('mk1', 'superseded')).toBe(true);
    const market = buildAgentRagContext({ agent: 'market', focus: 'sold comparable cluster' });
    expect(market.chunks.some((c) => c.docKey === 'mk1')).toBe(false);

    const stats = ragIndexStats();
    expect(stats.documents).toBe(2);
    expect(stats.byStatus.find((s) => s.status === 'superseded')?.documents).toBe(1);
  });
});
