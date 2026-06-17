import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  buildDukePersistPayload,
  persistDukeRunPostDelivery,
  buildDealWritebackInput,
  buildMultiDealWritebackInput,
  type DukeDashboardRunInfo,
} from './duke-persist-adapter.js';
import { upsertDealCardFromDukeRun, getDealCard } from './deal-card.js';

beforeEach(() => {
  _initTestLandosDb();
});

const FAKE_REPORT = [
  'DUKE DEFAULT REPORT — 100 Test Rd, Testville TX',
  '',
  'Land Score: 72 — PURSUE WITH CAUTION (PRELIMINARY)',
  '',
  '[Download PDF](/api/files/report?path=D%3A%5Cduke-reports%5C100-test-rd.pdf)',
].join('\n');

const PERSIST_BLOCK = [
  '```landos-persist',
  JSON.stringify({
    parcel: {
      apn: '123-456-789',
      lpPropertyId: 'LP-FAKE-9',
      fips: '48001',
      county: 'Test County',
      state: 'TX',
      verified: true,
      verificationSource: 'lp_property_data record match (APN + FIPS)',
    },
    facts: [
      { fact: 'acreage', value: '5.2', label: 'Verified', source: 'lp_property_data' },
      { fact: 'flood zone', value: 'unknown', label: 'Needs verification' },
    ],
    reportStatus: 'delivered',
  }),
  '```',
].join('\n');

// A successful run with a verified parcel but NO explicit reportStatus — the
// normal no-comp dashboard case that must default to a Partial report.
const PERSIST_BLOCK_NO_STATUS = [
  '```landos-persist',
  JSON.stringify({
    parcel: {
      apn: '08-2518',
      fips: '37061',
      county: 'Duplin',
      state: 'NC',
      address: '3832 S NC 50 Hwy, Chinquapin, NC',
      verified: true,
      verificationSource: 'lp_property_data record match (APN + FIPS)',
    },
    summary: 'Preliminary no-comp pass; verified parcel identity.',
  }),
  '```',
].join('\n');

// Two verified parcels, neither carrying an explicit reportStatus.
const MULTI_BLOCK_NO_STATUS = [
  '```landos-persist',
  JSON.stringify({
    parcels: [
      { apn: 'A-1', fips: '37061', county: 'Duplin', state: 'NC', address: '1 A Rd, Chinquapin NC', verified: true, verificationSource: 'county assessor record' },
      { apn: 'A-2', fips: '37061', county: 'Duplin', state: 'NC', address: '2 A Rd, Chinquapin NC', verified: true, verificationSource: 'county assessor record' },
    ],
  }),
  '```',
].join('\n');

const successInfo = (overrides: Partial<DukeDashboardRunInfo> = {}): DukeDashboardRunInfo => ({
  agentId: 'duke-due-diligence',
  status: 'success',
  elapsedMs: 98_000,
  toolCalls: 3,
  responseText: FAKE_REPORT,
  ...overrides,
});

describe('buildDukePersistPayload', () => {
  it('maps host runtime metadata with TY_LAND_BIZ default entity', () => {
    const payload = buildDukePersistPayload(successInfo());
    expect(payload.entity).toBe('TY_LAND_BIZ');
    expect(payload.agentId).toBe('duke-due-diligence');
    expect(payload.workflow).toBe('default_duke_report');
    expect(payload.status).toBe('success');
    expect(payload.durationMs).toBe(98_000);
    expect(payload.toolCalls).toBe(3);
    expect(payload.reportStatus).toBe('delivered');
    expect(payload.summary).toContain('DUKE DEFAULT REPORT');
  });

  it('extracts the report PDF link as a decoded file ref', () => {
    const payload = buildDukePersistPayload(successInfo());
    expect(payload.fileRefs).toHaveLength(1);
    expect(payload.fileRefs?.[0]).toMatchObject({
      kind: 'pdf',
      pathOrRef: 'D:\\duke-reports\\100-test-rd.pdf',
    });
  });

  it('drops PDF refs that point inside the repo instead of failing', () => {
    const encoded = encodeURIComponent(process.cwd() + '\\report.pdf');
    const payload = buildDukePersistPayload(successInfo({
      responseText: `Report ready.\n[Download PDF](/api/files/report?path=${encoded})`,
    }));
    expect(payload.fileRefs).toBeUndefined();
  });

  it('takes parcel and facts only from an explicit landos-persist block', () => {
    const noBlock = buildDukePersistPayload(successInfo({
      responseText: 'APN 123-456-789, Test County TX, verified via lp_property_data.',
    }));
    expect(noBlock.parcel).toBeUndefined();
    expect(noBlock.facts).toBeUndefined();

    const withBlock = buildDukePersistPayload(successInfo({
      responseText: FAKE_REPORT + '\n\n' + PERSIST_BLOCK,
    }));
    expect(withBlock.parcel?.apn).toBe('123-456-789');
    expect(withBlock.parcel?.lpPropertyId).toBe('LP-FAKE-9');
    expect(withBlock.facts).toHaveLength(2);
  });

  it('ignores an invalid landos-persist block but records the parse error', () => {
    const payload = buildDukePersistPayload(successInfo({
      responseText: FAKE_REPORT + '\n```landos-persist\n{not json}\n```',
    }));
    expect(payload.parcel).toBeUndefined();
    expect(payload.error).toContain('landos-persist block is not valid JSON');
  });

  it('maps timeout and failed runs to non-delivered report statuses', () => {
    expect(buildDukePersistPayload(successInfo({ status: 'timeout' })).reportStatus).toBe('not_generated');
    expect(buildDukePersistPayload(successInfo({ status: 'failed' })).reportStatus).toBe('failed');
  });
});

describe('persistDukeRunPostDelivery', () => {
  it('persists a successful run with parcel, facts, file ref, run, and audit', () => {
    const result = persistDukeRunPostDelivery(successInfo({
      responseText: FAKE_REPORT + '\n\n' + PERSIST_BLOCK,
    }));
    expect(result).not.toBeNull();
    const db = getLandosDb();
    const run = db.prepare('SELECT * FROM landos_agent_run WHERE id = ?').get(result!.runId) as Record<string, unknown>;
    expect(run.agent_id).toBe('duke-due-diligence');
    expect(run.status).toBe('success');
    expect(run.duration_ms).toBe(98_000);
    const parcel = db.prepare('SELECT * FROM landos_parcel WHERE id = ?').get(result!.parcelId) as Record<string, unknown>;
    expect(parcel.verified).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM landos_fact').get()).toMatchObject({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM landos_file_ref').get()).toMatchObject({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM landos_audit_log WHERE action = 'duke_run_persisted'`).get()).toMatchObject({ n: 1 });
  });

  it('persists the full documented Duke block: forward-looking top-level fields ignored, mirrored facts and URL fileRefs persisted', () => {
    // Mirrors the schema documented in landos-agents/duke-due-diligence/CLAUDE.md
    // (Step 11: landos-persist Block). Top-level fields like lpPropertyUrl,
    // leadName, ownerNameNote, additionalRiskScreens are forward-looking for
    // the Lead Workspace; persistence-critical data is mirrored into
    // facts/fileRefs, which is what the adapter persists today.
    const fullBlock = [
      '```landos-persist',
      JSON.stringify({
        entity: 'TY_LAND_BIZ',
        agentId: 'duke-due-diligence',
        status: 'success',
        reportStatus: 'delivered',
        summary: '100 Test Rd, Testville TX -- Land Score 72, PURSUE WITH CAUTION (PRELIMINARY)',
        verificationStatus: 'verified',
        lpPropertyUrl: 'https://landportal.com/property?propertyid=999999&fips=48001',
        sourceUrls: ['https://landportal.com/property?propertyid=999999&fips=48001'],
        leadName: 'Jane Smith',
        sellerName: null,
        recordOwnerName: 'John Smith',
        recordOwnerSource: 'LandPortal property data (ownername1full)',
        ownerNameNote: 'Last name matches record owner. Possible spouse, family member, or related party. Confirm seller authority during discovery/title.',
        error: null,
        additionalRiskScreens: [
          { screen: 'septic_soil', result: 'LP soil data present; Web Soil Survey skipped (budget)', source: 'lp_property_data' },
        ],
        improvementStatus: 'mobile_or_manufactured_home_present',
        improvementTypeConfidence: 'listing_signal_needs_verification',
        visualImprovementSignal: 'mobile/manufactured home appears present',
        visualConditionSignal: 'dated_repair_needed_signal',
        yardDebrisSignal: 'visible_debris_signal',
        occupancySignal: null,
        manufacturedHomeYearBuilt: '1980',
        manufacturedHomeFinancingSignal: 'practical_financing_caution_1976_to_1984',
        parcel: {
          address: '100 Test Rd',
          city: 'Testville',
          county: 'Test County',
          state: 'TX',
          apn: '123-456-789',
          lpPropertyId: '999999',
          fips: '48001',
          acres: 5.2,
          verified: true,
          verificationSource: 'lp_property_data record match (APN + FIPS)',
        },
        facts: [
          { fact: 'acreage', value: '5.2', label: 'Verified', source: 'lp_property_data' },
          { fact: 'owner_name_note', value: 'Last name matches record owner. Possible spouse, family member, or related party. Confirm seller authority during discovery/title.', label: 'Needs verification' },
          { fact: 'record_owner_name', value: 'John Smith', label: 'Verified', source: 'LandPortal property data (ownername1full)' },
          { fact: 'risk_screen: septic_soil', value: 'LP soil data present; Web Soil Survey skipped (budget)', label: 'Needs verification', source: 'lp_property_data' },
          { fact: 'improvement_status', value: 'mobile_or_manufactured_home_present', label: 'Needs verification', source: 'Zillow/listing visual signal' },
          { fact: 'visual_condition_signal', value: 'dated_repair_needed_signal', label: 'Needs verification', source: 'listing/photo visual signal' },
          { fact: 'yard_debris_signal', value: 'visible_debris_signal', label: 'Needs verification', source: 'listing/photo visual signal' },
          { fact: 'manufactured_home_year_built', value: '1980', label: 'Verified', source: 'county assessor' },
          { fact: 'manufactured_home_financing_signal', value: 'practical_financing_caution_1976_to_1984', label: 'Needs verification', source: 'Duke strategy rule based on reported manufactured home year' },
        ],
        fileRefs: [
          { kind: 'lp_property_url', pathOrRef: 'https://landportal.com/property?propertyid=999999&fips=48001', note: 'Exact LandPortal property URL' },
          { kind: 'visual_evidence', pathOrRef: 'D:\\duke-visual-evidence\\100-test-rd-2026-06-12t10-00-00.png', note: 'county GIS parcel viewer screenshot' },
        ],
      }),
      '```',
    ].join('\n');

    const result = persistDukeRunPostDelivery(successInfo({
      responseText: FAKE_REPORT + '\n\n' + fullBlock,
    }));
    expect(result).not.toBeNull();
    expect(result!.factIds).toHaveLength(9);

    const db = getLandosDb();
    const parcel = db.prepare('SELECT * FROM landos_parcel WHERE id = ?').get(result!.parcelId) as Record<string, unknown>;
    expect(parcel.verified).toBe(1);
    expect(parcel.lp_property_id).toBe('999999');
    const improvementFact = db.prepare(`SELECT value, label FROM landos_fact WHERE fact = 'improvement_status'`).get() as Record<string, unknown>;
    expect(improvementFact.value).toBe('mobile_or_manufactured_home_present');
    expect(improvementFact.label).toBe('Needs verification');
    const mhYearFact = db.prepare(`SELECT value, label, source FROM landos_fact WHERE fact = 'manufactured_home_year_built'`).get() as Record<string, unknown>;
    expect(mhYearFact.value).toBe('1980');
    expect(mhYearFact.label).toBe('Verified');
    expect(mhYearFact.source).toBe('county assessor');
    const financingFact = db.prepare(`SELECT value FROM landos_fact WHERE fact = 'manufactured_home_financing_signal'`).get() as Record<string, unknown>;
    expect(financingFact.value).toBe('practical_financing_caution_1976_to_1984');
    const ownerFact = db.prepare(`SELECT value, label FROM landos_fact WHERE fact = 'owner_name_note'`).get() as Record<string, unknown>;
    expect(ownerFact.label).toBe('Needs verification');
    expect(String(ownerFact.value)).toContain('Last name matches record owner');
    const urlRef = db.prepare(`SELECT path_or_ref FROM landos_file_ref WHERE kind = 'lp_property_url'`).get() as Record<string, unknown>;
    expect(urlRef.path_or_ref).toBe('https://landportal.com/property?propertyid=999999&fips=48001');
    const visualRef = db.prepare(`SELECT path_or_ref, note FROM landos_file_ref WHERE kind = 'visual_evidence'`).get() as Record<string, unknown>;
    expect(visualRef.path_or_ref).toBe('D:\\duke-visual-evidence\\100-test-rd-2026-06-12t10-00-00.png');
    expect(visualRef.note).toBe('county GIS parcel viewer screenshot');
    // PDF link from the report body still auto-captured alongside the explicit refs
    expect(db.prepare(`SELECT COUNT(*) AS n FROM landos_file_ref`).get()).toMatchObject({ n: 3 });
  });

  it('persists run metadata alone when the report has no persist block', () => {
    const result = persistDukeRunPostDelivery(successInfo());
    expect(result).not.toBeNull();
    expect(result!.parcelId).toBeNull();
    expect(result!.factIds).toHaveLength(0);
    expect(result!.fileRefIds).toHaveLength(1); // the PDF link
  });

  it('persists a timeout run with the error recorded', () => {
    const result = persistDukeRunPostDelivery({
      agentId: 'duke-due-diligence',
      status: 'timeout',
      elapsedMs: 165_000,
      toolCalls: 7,
      responseText: null,
      error: 'aborted after 165000ms (timeout 165000ms)',
    });
    expect(result).not.toBeNull();
    const run = getLandosDb().prepare('SELECT status, error FROM landos_agent_run WHERE id = ?')
      .get(result!.runId) as Record<string, unknown>;
    expect(run.status).toBe('timeout');
    expect(run.error).toContain('aborted after 165000ms');
  });

  it('is nonfatal when the hard parcel rule refuses the payload', () => {
    const badBlock = '```landos-persist\n' + JSON.stringify({
      parcel: { verified: true, verificationSource: 'geocoder + map pin' },
    }) + '\n```';
    const errors: Array<{ message: string; err: unknown }> = [];
    const result = persistDukeRunPostDelivery(
      successInfo({ responseText: FAKE_REPORT + '\n' + badBlock }),
      (message, err) => errors.push({ message, err }),
    );
    expect(result).toBeNull(); // no throw — delivery already happened
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('nonfatal');
    expect(String(errors[0].err)).toContain('hard parcel rule');
    // nothing partially written
    const db = getLandosDb();
    for (const table of ['landos_agent_run', 'landos_parcel', 'landos_fact', 'landos_file_ref']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toMatchObject({ n: 0 });
    }
  });

  it('never throws, even with a broken error logger', () => {
    const badBlock = '```landos-persist\n{"parcel":{"verified":true,"verificationSource":"satellite"}}\n```';
    expect(() => persistDukeRunPostDelivery(
      successInfo({ responseText: badBlock }),
      () => { throw new Error('logger exploded'); },
    )).not.toThrow();
  });
});

// ── Deal Card writeback bridge (live runtime path) ──────────────────────────

describe('Deal Card writeback bridge', () => {
  function blockOf(obj: Record<string, unknown>): string {
    return '```landos-persist\n' + JSON.stringify(obj) + '\n```';
  }

  it('a verified Duke run creates/links a Deal Card + verified property card', () => {
    const block = blockOf({
      entity: 'TY_LAND_BIZ',
      summary: '123 Rural Rd -- Land Score 72/100',
      parcel: {
        address: '123 Rural Rd, Lexington SC', apn: 'BR-1', county: 'Lexington', state: 'SC', fips: '45063',
        acres: 5, owner: 'Jane Owner', lpPropertyId: 'LP1', lpUrl: 'https://landportal.example/p/1',
        verified: true, verificationSource: 'lp_resolve_property address filter, verified:true',
      },
      sourceLinks: [{ fact: 'zoning', url: 'https://planning.lexingtoncounty.gov/ord' }],
      risks: ['No LP valuation'],
      nextActions: ['Pull county checklist'],
    });
    persistDukeRunPostDelivery(successInfo({ responseText: FAKE_REPORT + '\n' + block }));

    const db = getLandosDb();
    const card = db.prepare("SELECT * FROM landos_property_card WHERE apn = 'BR-1'").get() as any;
    expect(card).toBeTruthy();
    expect(card.verification_status).toBe('verified_property');
    expect(card.lp_url).toBe('https://landportal.example/p/1'); // passthrough
    const link = db.prepare('SELECT * FROM landos_deal_card_property WHERE card_id = ?').get(card.id) as any;
    expect(link).toBeTruthy(); // linked to a deal card
    const ev = db.prepare('SELECT COUNT(*) AS n FROM landos_card_source_evidence WHERE card_id = ?').get(card.id) as any;
    expect(ev.n).toBeGreaterThan(0);
  });

  it('an address-only / unverified run creates a research card, never verified, no lp_url fabricated', () => {
    const block = blockOf({
      entity: 'TY_LAND_BIZ', summary: 'zero candidates',
      parcel: { address: '83 Bub Wise Rd, Swansea SC', county: 'Lexington', state: 'SC', verified: false },
    });
    persistDukeRunPostDelivery(successInfo({ responseText: FAKE_REPORT + '\n' + block }));
    const db = getLandosDb();
    const card = db.prepare("SELECT * FROM landos_property_card WHERE active_input_address = '83 Bub Wise Rd, Swansea SC'").get() as any;
    expect(card.verification_status).not.toBe('verified_property');
    expect(card.lp_url).toBe(''); // never fabricated
    // research card still linked to a deal card and has a verify next-action.
    const na = db.prepare("SELECT * FROM landos_card_next_action WHERE card_id = ? AND action LIKE 'Verify parcel%'").get(card.id) as any;
    expect(na).toBeTruthy();
  });

  it('owner/contact mismatch adds the neutral confirm-authority action', () => {
    const block = blockOf({
      entity: 'TY_LAND_BIZ',
      parcel: { address: '9 Mismatch Rd, Lexington SC', apn: 'MM-1', county: 'Lexington', fips: '45063', verified: true, verificationSource: 'county assessor record (APN + county)' },
      leadName: 'Bob Wholesaler', recordOwnerName: 'Jane Owner',
    });
    persistDukeRunPostDelivery(successInfo({ responseText: FAKE_REPORT + '\n' + block }));
    const db = getLandosDb();
    const card = db.prepare("SELECT * FROM landos_property_card WHERE apn = 'MM-1'").get() as any;
    const na = db.prepare("SELECT * FROM landos_card_next_action WHERE card_id = ? AND action LIKE 'Confirm relationship and authority%'").get(card.id) as any;
    expect(na).toBeTruthy();
    // neutral: not auto-tagged probate.
    const probate = db.prepare("SELECT COUNT(*) AS n FROM landos_card_activity WHERE card_id = ? AND kind = 'probate'").get(card.id) as any;
    expect(probate.n).toBe(0);
  });

  it('a run with no address and no identity writes no card', () => {
    const before = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_property_card').get() as any).n;
    persistDukeRunPostDelivery(successInfo({ status: 'timeout', responseText: 'LandPortal lookup timed out.' }));
    const after = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_property_card').get() as any).n;
    expect(after).toBe(before);
  });
});

describe('Multi-APN Deal Card writeback (live hook)', () => {
  function multiBlock(): string {
    return '```landos-persist\n' + JSON.stringify({
      entity: 'TY_LAND_BIZ',
      summary: 'Seller has three parcels',
      parcels: [
        { address: '1 Pkg Rd, Lexington SC', apn: 'LA-1', county: 'Lexington', fips: '45063', acres: 5, verified: true, verificationSource: 'county assessor record (APN + county)', recordOwnerName: 'Jane Owner', lpPropertyId: 'LP1', lpUrl: 'https://landportal.example/p/1' },
        { address: '3 Pkg Rd, Lexington SC', apn: 'LA-2', county: 'Lexington', fips: '45063', acres: 6, verified: true, verificationSource: 'lp_resolve_property address filter, verified:true' },
        { address: '5 Pkg Rd, Swansea SC', county: 'Lexington', state: 'SC', verified: false, summary: 'zero candidates; likely worth $30k offer $9k' },
      ],
    }) + '\n```';
  }

  it('a >1-parcel run links multiple distinct property cards to ONE Deal Card via the live hook', () => {
    persistDukeRunPostDelivery(successInfo({ responseText: FAKE_REPORT + '\n' + multiBlock() }));
    const db = getLandosDb();
    const deals = db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as any;
    expect(deals.n).toBe(1);
    const cards = db.prepare('SELECT * FROM landos_property_card ORDER BY id').all() as any[];
    expect(cards.length).toBe(3);
    // APNs distinct, not merged.
    expect(cards.map((c) => c.apn).filter(Boolean).sort()).toEqual(['LA-1', 'LA-2']);
    // All three linked to the single deal.
    const dealId = (db.prepare('SELECT id FROM landos_deal_card LIMIT 1').get() as any).id;
    const links = db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card_property WHERE deal_card_id = ?').get(dealId) as any;
    expect(links.n).toBe(3);
    // lp_url passthrough only where provided.
    const la1 = cards.find((c) => c.apn === 'LA-1');
    const la2 = cards.find((c) => c.apn === 'LA-2');
    expect(la1.lp_url).toBe('https://landportal.example/p/1');
    expect(la2.lp_url).toBe('');
    // Mixed verification: two verified, one research.
    expect(cards.filter((c) => c.verification_status === 'verified_property').length).toBe(2);
    const research = cards.find((c) => c.verification_status !== 'verified_property');
    expect(research.summary).not.toMatch(/\$\s?\d/);
  });

  it('buildMultiDealWritebackInput returns null when fewer than 2 parcels', () => {
    expect(buildMultiDealWritebackInput(successInfo({ responseText: FAKE_REPORT + PERSIST_BLOCK }))).toBeNull();
  });
});

describe('Duke deal writeback defaults to Partial (no-comp) for successful runs', () => {
  it('buildDealWritebackInput defaults a successful no-status run to partial', () => {
    const input = buildDealWritebackInput(successInfo({ responseText: FAKE_REPORT + PERSIST_BLOCK_NO_STATUS }))!;
    expect(input.reportStatus).toBe('partial');
  });

  it('preserves an explicit reportStatus override (delivered) over the partial default', () => {
    const input = buildDealWritebackInput(successInfo({ responseText: FAKE_REPORT + PERSIST_BLOCK }))!;
    expect(input.reportStatus).toBe('delivered');
  });

  it('maps non-success runs the same as before (failed / not_generated)', () => {
    const failed = buildDealWritebackInput(successInfo({ status: 'failed', responseText: FAKE_REPORT + PERSIST_BLOCK_NO_STATUS }))!;
    expect(failed.reportStatus).toBe('failed');
    const timeout = buildDealWritebackInput(successInfo({ status: 'timeout', responseText: FAKE_REPORT + PERSIST_BLOCK_NO_STATUS }))!;
    expect(timeout.reportStatus).toBe('not_generated');
  });

  it('multi-parcel writeback defaults each parcel to partial when no status given', () => {
    const input = buildMultiDealWritebackInput(successInfo({ responseText: FAKE_REPORT + MULTI_BLOCK_NO_STATUS }))!;
    expect(input.parcels.length).toBe(2);
    expect(input.parcels.every((p) => p.reportStatus === 'partial')).toBe(true);
  });

  it('surfaces as latestReportStatus=partial end-to-end (default path, no comp credit)', () => {
    const input = buildDealWritebackInput(successInfo({ responseText: FAKE_REPORT + PERSIST_BLOCK_NO_STATUS }))!;
    const res = upsertDealCardFromDukeRun(input)!;
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.latestReportStatus).toBe('partial');
  });

  it('keeps the parcel-persist payload status unchanged (delivered) for success', () => {
    // The parcel-persist layer is a separate concern and must not flip to partial.
    expect(buildDukePersistPayload(successInfo()).reportStatus).toBe('delivered');
  });
});

describe('Repeated multi-APN live writeback is idempotent', () => {
  function multiBlock(): string {
    return '```landos-persist\n' + JSON.stringify({
      entity: 'TY_LAND_BIZ',
      summary: 'Seller package, three parcels',
      parcels: [
        { address: '1 Idem Rd, Lexington SC', apn: 'ID-1', county: 'Lexington', fips: '45063', acres: 5, verified: true, verificationSource: 'county assessor record (APN + county)' },
        { address: '3 Idem Rd, Lexington SC', apn: 'ID-2', county: 'Lexington', fips: '45063', acres: 6, verified: true, verificationSource: 'county assessor record (APN + county)' },
        { address: '5 Idem Rd, Swansea SC', county: 'Lexington', state: 'SC', verified: false },
      ],
    }) + '\n```';
  }

  it('persistDukeRunPostDelivery twice on the same package yields one Deal Card, no duplicate links', () => {
    persistDukeRunPostDelivery(successInfo({ responseText: FAKE_REPORT + '\n' + multiBlock() }));
    persistDukeRunPostDelivery(successInfo({ responseText: FAKE_REPORT + '\n' + multiBlock() }));
    const db = getLandosDb();
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as any).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_property_card').get() as any).n).toBe(3);
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card_property').get() as any).n).toBe(3);
  });
});
