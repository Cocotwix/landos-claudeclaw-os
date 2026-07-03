// Route-level verification for Real Usable Lead Run v1: drive the SAME HTTP path
// the dashboard reads (GET /api/landos/deal-cards/:id + /blockers) for the
// acceptance lead "2510 State Highway 153, Winters, TX" and confirm the Deal
// Card returns a business-useful result — for both an unresolved lead and a
// resolved lead. No paid providers: the deal/property state is persisted
// directly (the same rows the resolution pipeline writes), then read over HTTP.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, attachCardSourceEvidence } from './property-card.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';

const TOKEN = 'test-contract-token';
const ADDR = '2510 State Highway 153, Winters, TX';
let app: Hono;

beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

async function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}

/** An unresolved lead: address only, nothing verified (no paid resolution). */
function unresolvedLead() {
  const card = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: ADDR, state: 'TX' }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: ADDR });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return deal.id;
}

/** A resolved lead: verified parcel + owner/acreage + official core evidence
 *  (the shape property resolution persists on a real match). */
function resolvedLead() {
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: ADDR,
    apn: 'R11223', county: 'Runnels', state: 'TX', acres: 34.7, owner: 'Winters Family Trust',
    verified: true, verificationSource: 'Runnels County assessor record (APN + county)',
  }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: ADDR });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  attachCardSourceEvidence({
    cardId: card.id, fact: 'owner + APN parcel record',
    sourceUrl: 'https://assessor.co.runnels.tx.us/parcel/R11223', parcelVerified: true,
  });
  return deal.id;
}

describe('Real Usable Lead Run v1 — dashboard read path', () => {
  it('UNRESOLVED lead returns a business-useful, honestly-not-decision-grade Deal Card', async () => {
    const id = unresolvedLead();
    const detail = await (await get(`/api/landos/deal-cards/${id}`)).json() as any;
    const h = detail.businessSpine.header;
    const pkt = detail.businessSpine.propertyIntelligence;

    expect(detail.header.decisionGrade).toBe(false);
    expect(h.decisionConfidence).toBe('blocked');
    expect(h.missingCriticalInfo).toEqual(expect.arrayContaining(['Owner', 'APN / parcel number', 'Acreage', 'Verified parcel identity']));
    expect(pkt.owner.label).toBe('Not checked');
    expect(h.nextActionOwner).toBe('due-diligence-research');

    const blockers = ((await (await get(`/api/landos/deal-cards/${id}/blockers`)).json()) as any).blockers;
    expect(blockers.decisionGrade).toBe(false);
    expect(blockers.answer).toContain('blocked by');
    expect(blockers.blockingTasks.length).toBeGreaterThanOrEqual(4);

    // Show the actual business result (visible in test output).
    // eslint-disable-next-line no-console
    console.log('\n=== UNRESOLVED LEAD: ' + ADDR + ' ===\n' + businessSummary(detail, blockers));
  });

  it('RESOLVED lead returns owner/APN/acreage, evidence, confidence, and a clear next action', async () => {
    const id = resolvedLead();
    const detail = await (await get(`/api/landos/deal-cards/${id}`)).json() as any;
    const h = detail.businessSpine.header;
    const pkt = detail.businessSpine.propertyIntelligence;

    expect(detail.header.decisionGrade).toBe(true);
    expect(h.decisionConfidence).toBe('high');
    expect(pkt.owner.value).toBe('Winters Family Trust');
    expect(pkt.owner.verified).toBe(true);
    expect(pkt.acreage.value).toBe(34.7);
    expect(pkt.parcelIdentityVerified).toBe(true);
    expect(detail.businessSpine.sourceEvidence.some((e: any) => e.usableForOfferLogic)).toBe(true);
    expect(h.missingCriticalInfo).toEqual([]);

    const blockers = ((await (await get(`/api/landos/deal-cards/${id}/blockers`)).json()) as any).blockers;
    expect(blockers.decisionGrade).toBe(true);

    // eslint-disable-next-line no-console
    console.log('\n=== RESOLVED LEAD: ' + ADDR + ' ===\n' + businessSummary(detail, blockers));
  });
});

/** Plain-language business summary of the assembled objects (what the operator sees). */
function businessSummary(detail: any, blockers: any): string {
  const h = detail.businessSpine.header;
  const pkt = detail.businessSpine.propertyIntelligence;
  const slot = (s: any) => `${s.known ? s.value : '—'} [${s.label}]`;
  const lines = [
    `Decision-grade: ${h.decisionGrade ? 'YES' : 'NO'}  |  Confidence: ${h.decisionConfidence}  |  Parcel completeness: ${h.parcelCompleteness}%`,
    `Reason: ${pkt.decisionGradeReason}`,
    `Owner:   ${slot(pkt.owner)}`,
    `APN:     ${slot(pkt.apn)}`,
    `Acreage: ${slot(pkt.acreage)}`,
    `County:  ${slot(pkt.county)}   State: ${slot(pkt.state)}`,
    `Parcel identity: ${pkt.parcelIdentityVerified ? 'Verified' : pkt.parcelIdentityStatus}`,
    `Evidence (${detail.businessSpine.sourceEvidence.length}): ${detail.businessSpine.sourceEvidence.map((e: any) => `${e.sourceName}[${e.classification}${e.usableForOfferLogic ? ',offer-usable' : ''}]`).join(', ') || 'none'}`,
    `Missing: ${h.missingCriticalInfo.join(', ') || 'nothing critical'}`,
    `Blockers: ${blockers.answer}`,
    `Next action: ${h.nextBestAction}  (owner: ${h.nextActionOwner})`,
  ];
  return lines.join('\n');
}
