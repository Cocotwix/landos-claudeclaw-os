import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { EscalationLadder, describeStopReason } from './gis-escalation.js';
import { compareAcres, compareAddress, compareCounty, compareParcelIdentifier, reconcileParcelCandidates } from './gis-identity-reconcile.js';
import {
  assertNoPropertyEvidence,
  getDeploymentKnowledge,
  getOfficialParcelGis,
  listDeploymentKnowledge,
  listPlatformProofs,
  officialParcelGisHistory,
  recordPlatformProof,
  rememberDeployment,
  saveOfficialParcelGis,
  type GisDeploymentKnowledge,
} from './gis-platform-knowledge.js';
import { buildOfficialParcelGisView, emptyOfficialParcelGisView } from './official-parcel-gis-view.js';
import { buildZoningHandoff, collectOfficialSourceSeeds } from './official-parcel-gis-run.js';
import { emptyParcelGisResult, type OfficialParcelGisResult, type ParcelCandidate } from './gis-platform-types.js';
import { fingerprintPlatform } from './gis-platform-fingerprint.js';

/* ────────────────────────── rabbit-hole breaker ──────────────────────── */

describe('effort on one government map is bounded and the bound is explicit', () => {
  it('stops the run once the total request ceiling is reached', () => {
    const ladder = new EscalationLadder({ budget: { maxTotalRequests: 3 } });
    for (let i = 0; i < 3; i += 1) ladder.noteRequest();
    expect(ladder.exhausted()).toBe(true);
    expect(ladder.report().stopReason).toBe('total_request_budget');
  });

  it('stops the run on wall clock even when requests remain', () => {
    let clock = 0;
    const ladder = new EscalationLadder({ budget: { maxWallClockMs: 1000 }, now: () => clock });
    expect(ladder.exhausted()).toBe(false);
    clock = 1500;
    expect(ladder.exhausted()).toBe(true);
    expect(ladder.report().stopReason).toBe('wall_clock_budget');
  });

  it('hands a stage off once it has spent its share, without ending the run', () => {
    const ladder = new EscalationLadder({ budget: { maxRequestsPerStage: 2, maxTotalRequests: 50 } });
    ladder.beginStage('structured_service_discovery');
    ladder.noteRequest();
    ladder.noteRequest();
    expect(ladder.stageExhausted()).toBe(true);
    expect(ladder.exhausted()).toBe(false);
  });

  it('defers the interactive route rather than continuing to fight the map', () => {
    // This is the rule the whole sprint hangs on: when interactive effort runs
    // out the answer is a named deferral and a move to another source, never
    // another attempt.
    const ladder = new EscalationLadder({ budget: { maxBrowserInteractions: 2 } });
    expect(ladder.allowBrowserInteraction()).toBe(true);
    expect(ladder.allowBrowserInteraction()).toBe(true);
    expect(ladder.allowBrowserInteraction()).toBe(false);

    const report = ladder.report();
    expect(report.deferredInteractiveRoute).toBe(true);
    expect(report.failureStates).toContain('INTERACTIVE_GIS_ROUTE_DEFERRED');
    expect(describeStopReason(report)).toMatch(/another official source/i);
  });

  it('caps how many official sources may be tried before stopping', () => {
    const ladder = new EscalationLadder({ budget: { maxAlternateSources: 1 } });
    expect(ladder.allowAlternateSource()).toBe(true);
    expect(ladder.allowAlternateSource()).toBe(false);
    expect(ladder.report().stopReason).toBe('alternate_source_budget');
  });

  it('records each stage with its own outcome and cost', () => {
    const ladder = new EscalationLadder();
    ladder.beginStage('platform_fingerprint');
    ladder.noteRequest();
    ladder.endStage('platform_fingerprint', 'succeeded', 'Two official sources available.');
    const report = ladder.report();
    expect(report.stages[0]).toMatchObject({ stage: 'platform_fingerprint', outcome: 'succeeded', requests: 1 });
  });
});

/* ───────────────────────── identity reconciliation ───────────────────── */

const candidate = (over: Partial<ParcelCandidate> = {}): ParcelCandidate => ({
  parcelId: '10.00-1-64.22', address: '1487 Onionville Rd', owner: 'Sterling Trail Tamers, Inc.',
  acres: 11.46, county: 'Cayuga', state: 'NY', handle: '1', ...over,
});

describe('a returned record is never accepted as the subject without checking', () => {
  it('accepts an identifier that differs only by formatting', () => {
    expect(compareParcelIdentifier('055689 10.00-1-64.22', '055689-10.00-1-64.22').outcome).toBe('match');
  });

  it('accepts a bare local key when the same record also carries the jurisdiction code', () => {
    const result = compareParcelIdentifier('055689 10.00-1-64.22', '10.00-1-64.22', { observedJurisdictionCode: '055689' });
    expect(result.outcome).toBe('match');
    expect(result.note).toMatch(/jurisdiction code/i);
  });

  it('accepts an alternate identifier the same record publishes', () => {
    const result = compareParcelIdentifier('055689 10.00-1-64.22', '10.00-1-64.22', { alternateIds: ['055689 10.00-1-64.22'] });
    expect(result.outcome).toBe('match');
  });

  it('rejects a genuinely different parcel', () => {
    expect(compareParcelIdentifier('055689 10.00-1-64.22', '99.00-9-1').outcome).toBe('mismatch');
  });

  it('treats a rounded acreage as agreement and a real difference as a conflict', () => {
    expect(compareAcres(11.46, 11.4625).outcome).toBe('match');
    expect(compareAcres(11.46, 11.5).outcome).toBe('match');
    expect(compareAcres(11.46, 140).outcome).toBe('mismatch');
  });

  it('matches addresses across suffix and directional spellings', () => {
    expect(compareAddress('1487 Onionville Road', '1487 ONIONVILLE RD').outcome).toBe('match');
    expect(compareAddress('1487 Onionville Rd', '22 Other St').outcome).toBe('mismatch');
  });

  it('verifies on an exact identifier match with corroboration', () => {
    const report = reconcileParcelCandidates(
      { apn: '10.00-1-64.22', address: '1487 Onionville Rd', county: 'Cayuga', state: 'NY', knownAcres: 11.46 },
      [candidate()],
    );
    expect(report.status).toBe('verified');
    expect(report.acceptedIndex).toBe(0);
  });

  it('still verifies a non-exact search when a second material dimension corroborates', () => {
    // How a record was FOUND and whether it is the right record are different
    // questions; the confirmation is what counts.
    const report = reconcileParcelCandidates(
      { apn: '10.00-1-64.22', address: '1487 Onionville Rd', county: 'Cayuga', state: 'NY', knownAcres: 11.46 },
      [candidate()],
      { searchWasExact: false },
    );
    expect(report.status).toBe('verified');
  });

  it('stays provisional when a non-exact search has nothing else to corroborate it', () => {
    const report = reconcileParcelCandidates(
      { apn: '10.00-1-64.22' },
      [candidate({ address: null, acres: null, county: null })],
      { searchWasExact: false },
    );
    expect(report.status).toBe('provisional');
  });

  it('refuses everything when every candidate disagrees on something material', () => {
    const report = reconcileParcelCandidates(
      { apn: '10.00-1-64.22', address: '1487 Onionville Rd', knownAcres: 11.46 },
      [candidate({ parcelId: '99.00-9-1', address: '4 Elsewhere Rd', acres: 300 })],
    );
    expect(report.status).toBe('conflict');
    expect(report.acceptedIndex).toBeNull();
  });

  it('refuses to choose between candidates it cannot tell apart', () => {
    const report = reconcileParcelCandidates(
      { address: '1487 Onionville Rd' },
      [candidate({ parcelId: null }), candidate({ parcelId: null, handle: '2' })],
    );
    expect(report.status).toBe('conflict');
    expect(report.reason).toMatch(/matched equally well/i);
  });

  it('does not treat a changed owner as a conflict', () => {
    // The assessment roll lags a sale; an owner difference is information,
    // not grounds to reject a correctly identified parcel.
    const report = reconcileParcelCandidates(
      { apn: '10.00-1-64.22', address: '1487 Onionville Rd', owner: 'Previous Owner LLC', knownAcres: 11.46 },
      [candidate()],
    );
    expect(report.status).toBe('verified');
    expect(report.checks.find((c) => c.dimension === 'owner')?.material).toBe(false);
  });

  it('reports not-found rather than conflict when nothing came back', () => {
    expect(reconcileParcelCandidates({ apn: 'x' }, []).status).toBe('not_found');
  });

  it('does not reject a parcel over a street spelling once the identifier matched', () => {
    // Assessors routinely print a street name differently from the operator's
    // source. An exact identifier match outweighs it, and rejecting on the
    // spelling would throw away correctly matched parcels.
    const report = reconcileParcelCandidates(
      { apn: '054507007', address: '585 MARKSMEN CT', county: 'Fayette', state: 'GA' },
      [candidate({ parcelId: '054507007', address: '585 MARKSMAN CT', acres: 2.03, county: null, state: null })],
    );
    expect(report.status).toBe('verified');
    // Reported, never hidden.
    expect(report.reason).toMatch(/address differs/i);
  });

  it('still rejects a matching identifier in the wrong county', () => {
    const report = reconcileParcelCandidates(
      { apn: '054507007', county: 'Fayette', state: 'GA' },
      [candidate({ parcelId: '054507007', county: 'Somewhere Else', address: null, acres: null })],
    );
    expect(report.status).toBe('conflict');
  });

  it('does not read a numeric county code as a different county', () => {
    // Williamson County TN publishes county "094" (its state county number)
    // and the padded map/parcel key beside a roll-suffixed parcel_id. A code
    // names nothing a county NAME can disagree with, so the correctly matched
    // parcel must not be rejected on it; the roll's acreage gap is noted.
    const report = reconcileParcelCandidates(
      { apn: '046-050.00-000', address: '7348 Overby Rd, Fairview, TN 37062', county: 'Williamson', state: 'TN', knownAcres: 43.7 },
      [candidate({ parcelId: '046    05000 00001046', alternateIds: ['046    05000'], address: '7348 OVERBEY RD', owner: 'KING HERBERT O JR', acres: 34, county: '094', state: null })],
      { searchWasExact: false },
    );
    expect(report.status).toBe('provisional');
    expect(report.acceptedIndex).toBe(0);
    expect(report.checks.find((c) => c.dimension === 'county')?.outcome).toBe('not_comparable');
    // A spelled-out county still agrees with the same county plus the word.
    expect(compareCounty('Williamson', 'Williamson County').outcome).toBe('match');
    expect(compareCounty('Fayette', 'Somewhere Else').outcome).toBe('mismatch');
  });

  it('refuses a record that published nothing comparable', () => {
    // A page that returned no data would otherwise be "accepted" on dimensions
    // that had nothing to disagree about, showing a confident empty parcel.
    const report = reconcileParcelCandidates(
      { apn: '021 033 002', address: '388 GILSTRAP RD', county: 'White', state: 'GA' },
      [candidate({ parcelId: null, address: null, owner: null, acres: null, county: null, state: null })],
    );
    expect(report.status).toBe('not_found');
    expect(report.acceptedIndex).toBeNull();
  });
});

/* ───────────────────── shared vs isolated knowledge ──────────────────── */

function result(over: Partial<OfficialParcelGisResult> = {}): OfficialParcelGisResult {
  return emptyParcelGisResult({
    sourcePlatform: 'arcgis',
    sourceUrl: 'https://gis.example-county.gov/arcgis/rest/services/Tax/Parcels/MapServer/0',
    retrievedAt: '2026-08-06T00:00:00.000Z',
    parcelMatchStatus: 'verified',
    parcelId: '10.00-1-64.22',
    ...over,
  });
}

function deal(id: number, title: string): void {
  const db = getLandosDb();
  db.prepare("INSERT OR IGNORE INTO landos_business_entity (id, name, status) VALUES ('LAND_ALLY','Land Ally','active')").run();
  db.prepare('INSERT INTO landos_deal_card (id, entity, title, status) VALUES (?, ?, ?, ?)').run(id, 'LAND_ALLY', title, 'new');
}

describe('platform method is shared while property evidence stays isolated', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('refuses to write one property\'s evidence into shared deployment knowledge', () => {
    // A shared row is read by every future property. A parcel key that leaked
    // into one would surface on an unrelated deal looking authoritative.
    const leaking: GisDeploymentKnowledge = {
      host: 'gis.example-county.gov', family: 'arcgis', variant: null, servesLabel: 'Cayuga County',
      services: [], parcelLayerUrl: 'https://gis.example-county.gov/arcgis/rest/services/T/P/MapServer/0/query?parcelId=10.00-1-64.22',
      parcelIdField: 'PRINT_KEY', zoningLayerUrl: null, zoningCodeField: null, searchMethods: ['apn'],
      requiresBrowser: false, confidence: 'high', failureModes: [], runs: 0, successes: 0, lastVerifiedAt: null,
    };
    expect(() => assertNoPropertyEvidence(leaking)).toThrow(/property evidence/i);
  });

  it('accepts genuine method knowledge and reuses it for the next property', () => {
    rememberDeployment('https://gis.example-county.gov/arcgis/rest/services/Tax/Parcels/MapServer/0', {
      family: 'arcgis', servesLabel: 'Cayuga County', parcelLayerUrl: 'https://gis.example-county.gov/arcgis/rest/services/Tax/Parcels/MapServer/0',
      parcelIdField: 'PRINT_KEY', searchMethods: ['apn'], confidence: 'high', succeeded: true,
    });
    const learned = getDeploymentKnowledge('gis.example-county.gov');
    expect(learned?.parcelIdField).toBe('PRINT_KEY');
    expect(learned?.successes).toBe(1);
    expect(listDeploymentKnowledge('arcgis')).toHaveLength(1);
  });

  it('keeps a proven capability proven and never claims one that was not', () => {
    recordPlatformProof('arcgis', { detection: true, geometry: true, provenOnHost: 'gis.example-county.gov', succeeded: true });
    recordPlatformProof('arcgis', { detection: true, geometry: false, succeeded: false });
    const proofs = listPlatformProofs();
    expect(proofs.find((p) => p.family === 'arcgis')?.geometry).toBe(true);
    expect(proofs.find((p) => p.family === 'arcgis')?.runs).toBe(2);
    expect(proofs.find((p) => p.family === 'tyler')).toBeUndefined();
  });

  it('never returns one deal\'s parcel evidence on another deal', () => {
    deal(101, 'Property A');
    deal(102, 'Property B');
    saveOfficialParcelGis(101, { result: result({ parcelId: 'A-1', sourceUrl: 'https://a.example.gov/x' }) });
    saveOfficialParcelGis(102, { result: result({ parcelId: 'B-2', sourceUrl: 'https://b.example.gov/y' }) });

    expect(getOfficialParcelGis(101)?.result.parcelId).toBe('A-1');
    expect(getOfficialParcelGis(102)?.result.parcelId).toBe('B-2');
    expect(buildOfficialParcelGisView(101).parcelId).toBe('A-1');
    expect(buildOfficialParcelGisView(102).parcelId).toBe('B-2');
  });

  it('keeps every retrieval instead of overwriting what the operator already saw', () => {
    deal(103, 'Property C');
    saveOfficialParcelGis(103, { result: result({ parcelId: 'first' }) });
    saveOfficialParcelGis(103, { result: result({ parcelId: 'second' }) });
    expect(officialParcelGisHistory(103)).toHaveLength(2);
    // The newest is what the operator reads.
    expect(getOfficialParcelGis(103)?.result.parcelId).toBe('second');
  });

  it('reports an honest empty state for a deal the lane never ran on', () => {
    deal(104, 'Property D');
    const view = buildOfficialParcelGisView(104);
    expect(view.present).toBe(false);
    expect(view.provider).toBe('Not researched');
  });
});

/* ────────────────────────── operator projection ──────────────────────── */

describe('the operator panel states what is known and what is not', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('warns in plain language when a zoning value is an assessment classification', () => {
    deal(201, 'Property E');
    saveOfficialParcelGis(201, {
      result: result({
        zoning: {
          code: 'AR', description: 'Agricultural Residential',
          layer: { layerName: 'Parcel', layerId: '4400', serviceUrl: 'https://x', jurisdiction: 'Sterling', codeField: 'zoning_cd', descriptionField: 'Zoning_desc', geometryRelationship: 'parcel_attribute' },
          authority: 'assessment_classification',
          sourceDisclaimer: 'Zoning codes are used for assessment purposes only.',
          interpreted: false,
        },
      }),
    });
    const view = buildOfficialParcelGisView(201);
    expect(view.zoningStatus).toBe('found');
    expect(view.zoningAuthority).toBe('assessment_classification');
    expect(view.zoningCaveat).toMatch(/not adopted zoning/i);
    expect(view.zoningCaveat).toContain('assessment purposes only');
  });

  it('adds no caveat to a genuine official zoning layer', () => {
    deal(202, 'Property F');
    saveOfficialParcelGis(202, {
      result: result({
        zoning: {
          code: 'RA-1', description: 'Rural Agricultural',
          layer: { layerName: 'Zoning Districts', layerId: '0', serviceUrl: 'https://x', jurisdiction: null, codeField: 'ZONING', descriptionField: 'ZONEDESC', geometryRelationship: 'contains_subject' },
          authority: 'official_zoning_layer', sourceDisclaimer: null, interpreted: false,
        },
      }),
    });
    expect(buildOfficialParcelGisView(202).zoningCaveat).toBeNull();
  });

  it('spells out exactly what disagreed on a conflict', () => {
    deal(203, 'Property G');
    saveOfficialParcelGis(203, {
      result: result({
        parcelMatchStatus: 'conflict', parcelId: null,
        reconciliation: {
          candidatesConsidered: 1, acceptedIndex: null, status: 'conflict', reason: 'disagreed',
          checks: [{ dimension: 'apn', outcome: 'mismatch', expected: '10.00-1-64.22', observed: '99.00-9-1', material: true }],
        },
      }),
    });
    const view = buildOfficialParcelGisView(203);
    expect(view.parcelMatchLabel).toBe('Conflict');
    expect(view.conflictDetails[0]).toContain('99.00-9-1');
  });

  it('keeps service metadata and diagnostics out of the operator view', () => {
    // The panel is an evidence summary. Layer inventories, request counts and
    // raw payloads belong in the retained record, not in front of an operator.
    const view = emptyOfficialParcelGisView();
    expect(Object.keys(view)).not.toContain('availableLayers');
    expect(Object.keys(view)).not.toContain('rawEvidenceRef');
    expect(Object.keys(view)).not.toContain('escalation');
  });
});

/* ───────────────────── source seeds and next-sprint handoff ──────────── */

describe('official sources are gathered from registries, never hardcoded per county', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('always offers the statewide official service as a last resort', () => {
    const seeds = collectOfficialSourceSeeds({ dealCardId: 1, county: 'Nowhere', state: 'NY' });
    expect(seeds.some((s) => s.origin === 'statewide_service')).toBe(true);
  });

  it('puts an operator-supplied source ahead of every learned one', () => {
    const seeds = collectOfficialSourceSeeds(
      { dealCardId: 1, county: 'Cayuga', state: 'NY' },
      { operatorSeeds: [{ url: 'https://ccgis.example.us', label: 'county gis' }] },
    );
    expect(seeds[0].origin).toBe('operator_supplied');
  });

  it('reuses a deployment already learned for the county', () => {
    rememberDeployment('https://ccgis.example.us/arcgis/rest/services/T/P/MapServer/0', {
      family: 'arcgis', servesLabel: 'Cayuga County',
      parcelLayerUrl: 'https://ccgis.example.us/arcgis/rest/services/T/P/MapServer/0', succeeded: true,
    });
    const seeds = collectOfficialSourceSeeds({ dealCardId: 1, county: 'Cayuga', state: 'NY' });
    expect(seeds.some((s) => s.origin === 'learned_deployment')).toBe(true);
  });

  it('returns no seeds for a state and county LandOS knows nothing about', () => {
    expect(collectOfficialSourceSeeds({ dealCardId: 1, county: 'Unknown', state: 'ZZ' })).toHaveLength(0);
  });
});

describe('the next sprint receives a handoff it does not have to re-derive', () => {
  const now = () => '2026-08-06T00:00:00.000Z';

  it('carries identity, geometry, jurisdiction and zoning source without interpreting any of it', () => {
    const handoff = buildZoningHandoff(
      { dealCardId: 81, county: 'Cayuga', state: 'NY', apn: '055689 10.00-1-64.22' },
      result({
        geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]], spatialReference: 4326, centroid: { lat: 1, lng: 1 }, sourceAcres: 11.46, vertexCount: 4 },
        jurisdictionClues: [{ level: 'town', name: 'Sterling', sourceUrl: 'https://x', sourceField: 'Municipali', statement: 'reports Municipali = Sterling' }],
        zoning: {
          code: 'AR', description: null,
          layer: { layerName: 'Parcel', layerId: '4400', serviceUrl: 'https://x', jurisdiction: 'Sterling', codeField: 'zoning_cd', descriptionField: null, geometryRelationship: 'parcel_attribute' },
          authority: 'assessment_classification', sourceDisclaimer: 'assessment only', interpreted: false,
        },
      }),
      fingerprintPlatform({ url: 'https://gis.example-county.gov/arcgis/rest/services/Tax/Parcels/MapServer/0' }),
      now,
    );

    expect(handoff.handoffVersion).toBe(1);
    expect(handoff.subject.dealCardId).toBe(81);
    expect(handoff.geometry?.vertexCount).toBe(4);
    expect(handoff.jurisdictionClues).toHaveLength(1);
    expect(handoff.zoningCode).toBe('AR');
    // The authority label must survive into the handoff, or the next sprint
    // would treat an assessment code as adopted zoning.
    expect(handoff.zoningAuthority).toBe('assessment_classification');
    expect(handoff.unresolvedIdentityIssue).toBeNull();
  });

  it('flags an unresolved identity so the next sprint stops instead of proceeding', () => {
    const handoff = buildZoningHandoff(
      { dealCardId: 82, county: 'Cayuga', state: 'NY' },
      result({ parcelMatchStatus: 'conflict', reconciliation: { candidatesConsidered: 1, acceptedIndex: null, status: 'conflict', reason: 'APN disagreed.', checks: [] } }),
      fingerprintPlatform({ url: 'https://gis.example-county.gov/arcgis/rest/services/Tax/Parcels/MapServer/0' }),
      now,
    );
    expect(handoff.unresolvedIdentityIssue).toBe('APN disagreed.');
  });
});
