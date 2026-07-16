// RAG ingestion bridge — feeds the local FTS index from what LandOS already
// has, without any external call:
//
//   • per-card source evidence (deed findings, official-record notes) → the
//     document agent's long-form recall of what was actually read;
//   • the card's registered documents (title/type/findings text);
//   • repo playbooks + governance docs (docs/landos/*.md) → shared agent
//     instructions and workflow playbooks, jurisdiction-independent.
//
// Everything is idempotent (content-hash keyed) and safe to re-run.

import fs from 'node:fs';
import path from 'node:path';
import { getPropertyCard } from './property-card.js';
import { ingestRagDocument, type RagIngestResult } from './rag-knowledge.js';

export interface CardKnowledgeSubject {
  dealCardId: number;
  cardId: number | null;
  apn?: string | null;
  address?: string | null;
  locality?: string | null;
  county?: string | null;
  state?: string | null;
}

/** Ingest a card's persisted source-evidence rows as retrievable research context. */
export function ingestCardEvidence(subject: CardKnowledgeSubject): RagIngestResult[] {
  if (subject.cardId == null) return [];
  const card = getPropertyCard(subject.cardId);
  const rows = ((card?.sourceEvidence ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      fact: String(r.fact ?? ''),
      note: String(r.note ?? ''),
      sourceUrl: String(r.source_url ?? ''),
      sourceType: String(r.source_type ?? ''),
      dateAccessed: String(r.date_accessed ?? ''),
    }))
    .filter((r) => r.fact || r.note);
  if (!rows.length) return [];
  const text = rows.map((r) => `${r.fact}\n${r.note}${r.sourceUrl ? `\nSource: ${r.sourceUrl}` : ''}`).join('\n\n');
  const meta = {
    dealCardId: subject.dealCardId,
    apn: subject.apn ?? null,
    address: subject.address ?? null,
    locality: subject.locality ?? null,
    county: subject.county ?? null,
    state: subject.state ?? null,
  };
  const results: RagIngestResult[] = [];
  results.push(ingestRagDocument({
    docKey: `card_evidence:${subject.dealCardId}`,
    title: `Accepted source evidence — Deal Card ${subject.dealCardId}`,
    docType: 'accepted_research',
    source: 'LandOS card evidence (validated rows)',
    evidenceStatus: 'accepted',
    text,
    ...meta,
  }));
  // Deed/legal rows separately as deed_ocr-class context (page citations kept in text).
  const deedRows = rows.filter((r) => /deed|easement|trustee|legal description|plat/i.test(`${r.fact} ${r.note}`));
  if (deedRows.length) {
    results.push(ingestRagDocument({
      docKey: `card_deed_findings:${subject.dealCardId}`,
      title: `Recorded-document findings — Deal Card ${subject.dealCardId}`,
      docType: 'deed_ocr',
      source: 'County recorder pages (scanned findings)',
      evidenceStatus: 'accepted',
      text: deedRows.map((r) => `${r.fact}\n${r.note}`).join('\n\n'),
      ...meta,
    }));
  }
  return results;
}

const PLAYBOOK_DIRS = ['docs/landos', 'docs/governance'];
const PLAYBOOK_MAX_FILES = 40;
const PLAYBOOK_MAX_BYTES = 400_000;

/** Index repo playbooks/governance markdown as shared agent knowledge. */
export function ingestRepoPlaybooks(repoRoot = process.cwd()): RagIngestResult[] {
  const results: RagIngestResult[] = [];
  let budget = PLAYBOOK_MAX_FILES;
  for (const dir of PLAYBOOK_DIRS) {
    const abs = path.join(repoRoot, dir);
    let names: string[] = [];
    try { names = fs.readdirSync(abs).filter((n) => n.toLowerCase().endsWith('.md')); } catch { continue; }
    for (const name of names) {
      if (budget <= 0) break;
      let text = '';
      try {
        const stat = fs.statSync(path.join(abs, name));
        if (stat.size > PLAYBOOK_MAX_BYTES) continue;
        text = fs.readFileSync(path.join(abs, name), 'utf8');
      } catch { continue; }
      if (!text.trim()) continue;
      budget -= 1;
      results.push(ingestRagDocument({
        docKey: `playbook:${dir}/${name}`,
        title: name.replace(/\.md$/i, '').replace(/[_-]+/g, ' '),
        docType: /governance/.test(dir) ? 'agent_instructions' : 'playbook',
        source: `${dir}/${name}`,
        evidenceStatus: 'accepted',
        text,
      }));
    }
  }
  return results;
}

export interface CanonicalRagSyncInput {
  subject: CardKnowledgeSubject;
  accessCurrent?: string | null;
  accessHistorical?: string | null;
  zoningCurrent?: string | null;
  documentTitle?: string | null;
  documentSource?: string | null;
  documentOfficialUrl?: string | null;
  documentPages?: Array<{ pageNumber: number; text: string; section?: string }>;
  marketCurrent?: string | null;
  marketHistorical?: string | null;
  qaCurrent?: string | null;
  /** The shared unified readiness record (serialized) — the ONLY readiness
   *  narrative RAG may recall for this card. */
  readinessCurrent?: string | null;
}

/**
 * Index the canonical Deal Card projection for agent recall. Each lane is a
 * retrievable copy, never an authority: canonical records still control and
 * retrieval cannot write back without validation/reconciliation.
 */
export function ingestCanonicalDealKnowledge(input: CanonicalRagSyncInput): RagIngestResult[] {
  const s = input.subject;
  const meta = {
    dealCardId: s.dealCardId,
    apn: s.apn ?? null,
    address: s.address ?? null,
    locality: s.locality ?? null,
    county: s.county ?? null,
    state: s.state ?? null,
  };
  const out: RagIngestResult[] = [];
  const add = (doc: Parameters<typeof ingestRagDocument>[0]) => {
    if (doc.text?.trim() || doc.pages?.some((p) => p.text.trim())) out.push(ingestRagDocument(doc));
  };
  add({
    docKey: `canonical_access:${s.dealCardId}`,
    title: `Canonical parcel geometry, road, deed and visual context - Deal Card ${s.dealCardId}`,
    docType: 'accepted_research',
    source: 'LandOS canonical Deal Card projection',
    evidenceStatus: 'accepted',
    text: input.accessCurrent ?? '',
    ...meta,
  });
  add({
    docKey: `canonical_access_history:${s.dealCardId}`,
    title: `Rejected access/frontage claims - Deal Card ${s.dealCardId}`,
    docType: 'rejected_research',
    source: 'LandOS reconciliation history',
    evidenceStatus: 'rejected',
    text: input.accessHistorical ?? '',
    ...meta,
  });
  add({
    docKey: `canonical_zoning:${s.dealCardId}`,
    title: `Applicable zoning and overlay context - Deal Card ${s.dealCardId}`,
    docType: 'zoning_ordinance',
    source: 'LandOS accepted public-property intelligence',
    evidenceStatus: 'accepted',
    text: input.zoningCurrent ?? '',
    ...meta,
  });
  add({
    docKey: `canonical_deed_pages:${s.dealCardId}`,
    title: input.documentTitle ?? `Recorded document text - Deal Card ${s.dealCardId}`,
    docType: 'deed_ocr',
    source: input.documentSource ?? 'County recorder pages',
    officialUrl: input.documentOfficialUrl ?? null,
    evidenceStatus: 'accepted',
    pages: input.documentPages ?? [],
    ...meta,
  });
  add({
    docKey: `canonical_market:${s.dealCardId}`,
    title: `Accepted comps, geography hierarchy and clusters - Deal Card ${s.dealCardId}`,
    docType: 'market_research',
    source: 'LandOS canonical comparable registry',
    evidenceStatus: 'accepted',
    text: input.marketCurrent ?? '',
    ...meta,
  });
  add({
    docKey: `canonical_market_history:${s.dealCardId}`,
    title: `Rejected and superseded comp candidates - Deal Card ${s.dealCardId}`,
    docType: 'rejected_research',
    source: 'LandOS canonical comparable registry history',
    evidenceStatus: 'rejected',
    text: input.marketHistorical ?? '',
    ...meta,
  });
  add({
    docKey: `canonical_readiness:${s.dealCardId}`,
    title: `Shared unified readiness record - Deal Card ${s.dealCardId}`,
    docType: 'accepted_research',
    source: 'LandOS unified readiness record (one shared record for every tab, report and agent)',
    evidenceStatus: 'accepted',
    text: input.readinessCurrent ?? '',
    ...meta,
  });
  add({
    docKey: `canonical_qa:${s.dealCardId}`,
    title: `Current Deal Card acceptance and unsafe-language checks - Deal Card ${s.dealCardId}`,
    docType: 'qa_finding',
    source: 'LandOS acceptance policy',
    evidenceStatus: 'accepted',
    text: input.qaCurrent ?? '',
    ...meta,
  });
  return out;
}
