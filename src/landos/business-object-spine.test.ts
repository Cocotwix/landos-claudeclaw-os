import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, attachCardSourceEvidence } from './property-card.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertDealCardDd } from './deal-card-dd.js';
import { addSellerStatedFact } from './seller-stated-facts.js';
import {
  assembleBusinessObjects,
  whatBlocksThisDeal,
  computeDecisionGrade,
  computeParcelCompleteness,
  computeMissingCriticalInfo,
  generateVerificationTasks,
  computePropertyIntelligence,
  subjectCoreParcelEvidence,
  makeSlot,
  evidenceProvenance,
  type PropertyIntelInput,
  type SourceEvidenceRecord,
} from './business-object-spine.js';

const NOW = 1_700_000_000_000;
const SUBJECT = 7;

/** Offer-usable evidence scoped to a specific property card (default: the
 *  subject card) describing a core parcel fact. */
function usableEvidence(fact: string, cardId: number = SUBJECT): SourceEvidenceRecord {
  return {
    sourceId: `test-ev-${cardId}`, sourceType: 'official', classification: 'official',
    sourceName: fact, sourceUrlOrRef: 'https://assessor.county.gov/parcel/123',
    retrievedAt: '2026-07-01', factsSupported: [fact], reliability: 'high',
    usableForOfferLogic: true, cardId, note: '',
  };
}

/** A fully-unknown baseline input; override the parts a test cares about. */
function intelInput(overrides: Partial<PropertyIntelInput> = {}): PropertyIntelInput {
  return {
    dealId: 1,
    subjectCardId: null,
    parcelIdentityStatus: 'local_area_context_not_verified',
    parcelIdentityVerified: false,
    owner: makeSlot('owner', null),
    apn: makeSlot('apn', null),
    county: makeSlot('county', null),
    state: makeSlot('state', null),
    location: makeSlot('location', null),
    acreage: makeSlot('acreage', null),
    coordinates: null,
    propertyType: makeSlot('propertyType', null),
    access: makeSlot('access', null),
    zoning: makeSlot('zoning', null),
    taxAssessor: makeSlot('taxAssessor', null),
    sourceEvidence: [],
    dataGaps: [],
    now: NOW,
    ...overrides,
  };
}

function decisionGradeInput(): PropertyIntelInput {
  return intelInput({
    subjectCardId: SUBJECT,
    parcelIdentityStatus: 'source_verified',
    parcelIdentityVerified: true,
    owner: makeSlot('owner', 'Jane Doe', { verified: true }),
    apn: makeSlot('apn', 'R12345', { verified: true }),
    acreage: makeSlot('acreage', 12.5, { verified: true }),
    county: makeSlot('county', 'Runnels', { verified: true }),
    state: makeSlot('state', 'TX', { verified: true }),
    location: makeSlot('location', '2510 State Highway 153', { verified: true }),
    sourceEvidence: [usableEvidence('owner record'), usableEvidence('APN parcel record')],
  });
}

beforeEach(() => {
  _initTestLandosDb();
});

// ── Pure core ────────────────────────────────────────────────────────────

describe('decision-grade core (pure)', () => {
  it('an empty packet is NOT decision-grade and names every missing critical fact', () => {
    const input = intelInput();
    const missing = computeMissingCriticalInfo(input);
    expect(missing).toEqual([
      'Verified parcel identity',
      'Owner',
      'APN / parcel number',
      'Acreage',
      'Source evidence for core parcel facts',
    ]);
    const dg = computeDecisionGrade(input);
    expect(dg.decisionGrade).toBe(false);
    expect(dg.reason).toContain('Not decision-grade');
    expect(dg.reason).toContain('Owner');
  });

  it('a fully-known verified packet IS decision-grade', () => {
    const dg = computeDecisionGrade(decisionGradeInput());
    expect(dg.decisionGrade).toBe(true);
    expect(computeMissingCriticalInfo(decisionGradeInput())).toEqual([]);
  });

  it('a present-but-unverified parcel identity is still NOT decision-grade', () => {
    // Owner/APN/acreage present, but parcel identity not verified and no usable
    // evidence: county links / seller-stated values never make a deal decision-grade.
    const input = intelInput({
      owner: makeSlot('owner', 'Someone'),
      apn: makeSlot('apn', '000'),
      acreage: makeSlot('acreage', 5),
    });
    expect(computeDecisionGrade(input).decisionGrade).toBe(false);
    expect(computeMissingCriticalInfo(input)).toContain('Verified parcel identity');
    expect(computeMissingCriticalInfo(input)).toContain('Source evidence for core parcel facts');
  });

  it('completeness is 0 for an empty packet and 100 for a fully verified one', () => {
    expect(computeParcelCompleteness(intelInput())).toBe(0);
    expect(computeParcelCompleteness(decisionGradeInput())).toBe(100);
  });

  it('makeSlot labels an absent value Not checked and a present unverified value Needs verification', () => {
    expect(makeSlot('owner', null).label).toBe('Not checked');
    expect(makeSlot('owner', null).known).toBe(false);
    expect(makeSlot('owner', 'X').label).toBe('Needs verification');
    expect(makeSlot('owner', 'X', { verified: true }).label).toBe('Verified');
  });

  it('evidence provenance buckets classify official/vendor/public/browser/manual', () => {
    expect(evidenceProvenance('official', true).classification).toBe('official');
    expect(evidenceProvenance('landportal', true).classification).toBe('vendor');
    expect(evidenceProvenance('marketplace', true).classification).toBe('public');
    expect(evidenceProvenance('local_context', true).classification).toBe('browser');
    expect(evidenceProvenance('official', false).classification).toBe('manual');
  });
});

describe('verification task generation (pure)', () => {
  it('creates a blocking critical task per missing critical fact', () => {
    const tasks = generateVerificationTasks(intelInput());
    const keys = tasks.map((t) => t.taskId);
    expect(keys).toContain('vt-1-parcel_identity');
    expect(keys).toContain('vt-1-owner');
    expect(keys).toContain('vt-1-apn');
    expect(keys).toContain('vt-1-acreage');
    expect(keys).toContain('vt-1-source_evidence');
    expect(tasks.filter((t) => t.blocking).length).toBe(5);
    expect(tasks.every((t) => t.ownerDepartment === 'due-diligence-research')).toBe(true);
    // Owner/APN/acreage/identity are critical; evidence is high.
    expect(tasks.find((t) => t.taskId === 'vt-1-owner')!.criticality).toBe('critical');
    expect(tasks.find((t) => t.taskId === 'vt-1-source_evidence')!.criticality).toBe('high');
  });

  it('a decision-grade packet produces no blocking tasks', () => {
    const tasks = generateVerificationTasks(decisionGradeInput());
    expect(tasks.filter((t) => t.blocking).length).toBe(0);
  });

  it('DD data gaps become medium, non-blocking DD tasks (deduped)', () => {
    const tasks = generateVerificationTasks(decisionGradeInput());
    const withGaps = generateVerificationTasks({
      ...decisionGradeInput(),
      dataGaps: ['Confirm road frontage', 'Confirm road frontage', 'Check flood zone'],
    });
    expect(tasks.length).toBe(0);
    const gapTasks = withGaps.filter((t) => t.taskId.includes('gap'));
    expect(gapTasks.length).toBe(2); // deduped
    expect(gapTasks.every((t) => t.criticality === 'medium' && !t.blocking)).toBe(true);
  });

  it('task ids are deterministic (idempotent re-projection)', () => {
    const a = generateVerificationTasks(intelInput()).map((t) => t.taskId);
    const b = generateVerificationTasks(intelInput()).map((t) => t.taskId);
    expect(a).toEqual(b);
  });
});

// ── Hardening: core parcel evidence gate (pure) ──────────────────────────

describe('decision-grade evidence gate (Codex hardening)', () => {
  it('unrelated zoning/official evidence does NOT satisfy the core parcel evidence gate', () => {
    // Identity verified and owner/APN/acreage source-verified, but the only
    // evidence is zoning — not a core parcel fact. Still NOT decision-grade.
    const input = intelInput({
      subjectCardId: SUBJECT,
      parcelIdentityVerified: true,
      owner: makeSlot('owner', 'Jane Doe', { verified: true }),
      apn: makeSlot('apn', 'R12345', { verified: true }),
      acreage: makeSlot('acreage', 10, { verified: true }),
      sourceEvidence: [usableEvidence('zoning district designation')],
    });
    expect(subjectCoreParcelEvidence(input)).toEqual([]);
    expect(computeMissingCriticalInfo(input)).toContain('Source evidence for core parcel facts');
    expect(computeDecisionGrade(input).decisionGrade).toBe(false);
  });

  it('owner/APN/acreage present but unsupported does NOT pass decision-grade', () => {
    // Values present but not verified, and no core parcel evidence backs them.
    const input = intelInput({
      subjectCardId: SUBJECT,
      parcelIdentityVerified: true,
      owner: makeSlot('owner', 'Someone'),
      apn: makeSlot('apn', 'R000'),
      acreage: makeSlot('acreage', 5),
      sourceEvidence: [],
    });
    const missing = computeMissingCriticalInfo(input);
    expect(missing).toContain('Owner');
    expect(missing).toContain('APN / parcel number');
    expect(missing).toContain('Acreage');
    expect(missing).toContain('Source evidence for core parcel facts');
    expect(computeDecisionGrade(input).decisionGrade).toBe(false);
  });

  it('multi-parcel evidence leakage does NOT pass decision-grade for the wrong parcel', () => {
    // Subject is parcel A (id 1); the only core evidence is scoped to parcel B
    // (id 2). It stays visible as general deal evidence but must not satisfy A.
    const input = intelInput({
      dealId: 5,
      subjectCardId: 1,
      parcelIdentityVerified: true,
      owner: makeSlot('owner', 'A Owner'),
      apn: makeSlot('apn', 'A-APN'),
      acreage: makeSlot('acreage', 8),
      sourceEvidence: [usableEvidence('owner + APN parcel record', 2)],
    });
    expect(subjectCoreParcelEvidence(input)).toEqual([]);
    const pkt = computePropertyIntelligence(input);
    expect(pkt.decisionGrade).toBe(false);
    expect(pkt.missingCriticalInfo).toContain('Owner');
    expect(pkt.missingCriticalInfo).toContain('Source evidence for core parcel facts');
    // Evidence remains visible on the packet (general deal evidence).
    expect(pkt.sourceEvidence.length).toBe(1);
  });

  it('verified core parcel evidence scoped to the subject property DOES pass', () => {
    const input = decisionGradeInput(); // subject-scoped core evidence
    expect(subjectCoreParcelEvidence(input).length).toBeGreaterThan(0);
    expect(computeDecisionGrade(input).decisionGrade).toBe(true);
    expect(computeMissingCriticalInfo(input)).toEqual([]);
  });
});

// ── Assembly / regression (real Deal Card data) ──────────────────────────

describe('assembleBusinessObjects — decision-grade FAILURE regression', () => {
  it('a lead with only an address (2510 State Highway 153, Winters, TX) is NOT decision-grade', () => {
    // Real Deal Card + subject property card with NO owner / APN / acreage /
    // verification / source evidence — the exact business failure state.
    const cardRow = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '2510 State Highway 153, Winters, TX',
      state: 'TX',
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '2510 State Highway 153' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: cardRow.id, role: 'subject' });

    const bundle = assembleBusinessObjects(deal.id, NOW)!;
    expect(bundle).toBeDefined();

    // 1. Business object exists; 2. facts known; 4. missing critical facts.
    expect(bundle.leadIntake.dealId).toBe(deal.id);
    expect(bundle.leadIntake.provided.address).toBe('2510 State Highway 153, Winters, TX');
    const pkt = bundle.propertyIntelligence;
    expect(pkt.owner.known).toBe(false);
    expect(pkt.owner.label).toBe('Not checked');
    expect(pkt.apn.known).toBe(false);
    expect(pkt.acreage.known).toBe(false);
    expect(pkt.parcelIdentityVerified).toBe(false);

    // 5. decision-grade: false, and the header says so.
    expect(pkt.decisionGrade).toBe(false);
    expect(bundle.header.decisionGrade).toBe(false);
    expect(bundle.header.decisionGradeReason).toContain('Not decision-grade');
    expect(bundle.header.decisionConfidence).toBe('blocked');

    // 4. missing critical info surfaced.
    expect(bundle.header.missingCriticalInfo).toContain('Owner');
    expect(bundle.header.missingCriticalInfo).toContain('APN / parcel number');
    expect(bundle.header.missingCriticalInfo).toContain('Acreage');
    expect(bundle.header.missingCriticalInfo).toContain('Verified parcel identity');

    // VerificationTasks created for the gaps; 6/7 owner of next action.
    expect(bundle.header.blockingVerificationTasks.length).toBeGreaterThanOrEqual(4);
    expect(bundle.header.nextActionOwner).toBe('due-diligence-research');
    expect(bundle.opportunity.nextBestAction).toBeTruthy();
  });

  it('county context does not fabricate parcel facts: seller-stated + data gaps flow into the packet', () => {
    const cardRow = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '2510 State Highway 153, Winters, TX',
      state: 'TX',
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Winters TX' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: cardRow.id, role: 'subject' });
    upsertDealCardDd(deal.id, { county: 'Runnels', dataGaps: ['Confirm legal access'] });
    addSellerStatedFact(cardRow.id, { kind: 'price_expectation', value: 'wants 50k' });

    const bundle = assembleBusinessObjects(deal.id, NOW)!;
    expect(bundle.leadIntake.sellerStatedFacts.some((f) => f.kind === 'price_expectation')).toBe(true);
    // County present from DD, but still not decision-grade (no owner/apn/acreage/identity).
    expect(bundle.propertyIntelligence.county.known).toBe(true);
    expect(bundle.propertyIntelligence.decisionGrade).toBe(false);
    // The DD data gap became an owned, non-blocking task.
    const gapTask = bundle.verificationTasks.find((t) => t.question.includes('Confirm legal access'));
    expect(gapTask).toBeDefined();
    expect(gapTask!.blocking).toBe(false);
  });
});

describe('assembleBusinessObjects — multi-parcel evidence leakage', () => {
  it("a verified sibling parcel's evidence does not make the unverified subject decision-grade", () => {
    // Subject parcel A: unverified, no core evidence.
    const parcelA = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Parcel A, Winters, TX', state: 'TX',
    }).card;
    // Sibling parcel B: fully verified with core parcel evidence attached.
    const parcelB = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Parcel B, Winters, TX',
      apn: 'B-999', county: 'Runnels', state: 'TX', acres: 20, owner: 'B Owner',
      verified: true, verificationSource: 'county assessor record (APN + county)',
    }).card;
    attachCardSourceEvidence({
      cardId: parcelB.id, fact: 'owner + APN parcel record',
      sourceUrl: 'https://assessor.runnels.tx.gov/parcel/B-999', parcelVerified: true,
    });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Two-parcel deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: parcelA.id, role: 'subject' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: parcelB.id, role: 'package_member' });

    const bundle = assembleBusinessObjects(deal.id, NOW)!;
    expect(bundle.propertyIntelligence.subjectCardId).toBe(parcelA.id);
    // Subject A is NOT decision-grade despite B's verified core evidence.
    expect(bundle.propertyIntelligence.decisionGrade).toBe(false);
    expect(bundle.header.missingCriticalInfo).toContain('Source evidence for core parcel facts');
    // B's evidence is still visible as general deal evidence.
    expect(bundle.sourceEvidence.some((e) => e.cardId === parcelB.id)).toBe(true);
  });
});

describe('assembleBusinessObjects — decision-grade PASS', () => {
  it('a verified parcel with owner + acreage + usable evidence is decision-grade', () => {
    const cardRow = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '2510 State Highway 153, Winters, TX',
      apn: 'R12345', county: 'Runnels', state: 'TX', acres: 12.5, owner: 'Jane Doe',
      verified: true, verificationSource: 'county assessor record (APN + county)',
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Winters verified' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: cardRow.id, role: 'subject' });
    attachCardSourceEvidence({
      cardId: cardRow.id, fact: 'owner + APN',
      sourceUrl: 'https://assessor.runnels.tx.gov/parcel/R12345', parcelVerified: true,
    });

    const bundle = assembleBusinessObjects(deal.id, NOW)!;
    const pkt = bundle.propertyIntelligence;
    expect(pkt.parcelIdentityVerified).toBe(true);
    expect(pkt.owner.known).toBe(true);
    expect(pkt.owner.verified).toBe(true);
    expect(pkt.decisionGrade).toBe(true);
    expect(bundle.header.decisionConfidence).toBe('high');
    expect(bundle.header.blockingVerificationTasks.length).toBe(0);
    expect(pkt.parcelCompletenessScore).toBeGreaterThanOrEqual(80);
    // The packet mints the ConfirmedParcel token for downstream departments.
    expect(bundle.confirmedParcel).not.toBeNull();
    expect(bundle.confirmedParcel!.dealCardId).toBe(deal.id);
  });
});

describe('assembleBusinessObjects — ConfirmedParcel token production', () => {
  it('a Candidate (unverified) parcel yields no token', () => {
    const cardRow = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '2510 State Highway 153, Winters, TX', state: 'TX',
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Winters TX' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: cardRow.id, role: 'subject' });
    expect(assembleBusinessObjects(deal.id, NOW)!.confirmedParcel).toBeNull();
  });
});

// ── Executive / Jarvis-Neo query ─────────────────────────────────────────

describe('whatBlocksThisDeal (Jarvis/Neo)', () => {
  it('answers what blocks the deal and who owns the next action from canonical objects', () => {
    const cardRow = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '2510 State Highway 153, Winters, TX', state: 'TX',
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Winters TX' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: cardRow.id, role: 'subject' });

    const ans = whatBlocksThisDeal(deal.id)!;
    expect(ans.decisionGrade).toBe(false);
    expect(ans.blockers.length).toBeGreaterThanOrEqual(4);
    expect(ans.answer).toContain('blocked by');
    expect(ans.nextActionOwner).toBe('due-diligence-research');
    expect(ans.blockingTasks.length).toBeGreaterThanOrEqual(4);
  });

  it('returns undefined for a missing deal card', () => {
    expect(whatBlocksThisDeal(999999)).toBeUndefined();
  });
});
