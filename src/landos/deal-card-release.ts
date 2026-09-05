// LandOS Deal Card release gate.
//
// One reproducible command that decides whether a fresh lead can become a
// complete, usable Deal Card without manual repair. It exercises the SAME
// production New Lead route the operator's UI posts to
// (`POST /api/landos/leads/manual`), in physically isolated synthetic QA
// storage, and it must complete FIVE CONSECUTIVE cases. A failure anywhere
// resets the consecutive count to zero — five individually repaired runs are
// not five consecutive runs, and this harness cannot report them as such.
//
// What it deliberately does NOT do:
//   * fabricate provider data. With no external lanes reachable, the correct
//     result is an honest limitation, not an invented FMV. The contracts below
//     therefore assert STRUCTURE and HONESTY, never a specific dollar value.
//   * touch operating data. The QA profile is refused unless it resolves
//     physically outside the operating store, and the operating database is
//     hashed before and after to prove it never moved.
//
// The regression phase is separate and READ-ONLY: it opens the operating
// database directly, without writing, to prove the canonical family and the
// standing live-proof parcels still read correctly.

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { Hono } from 'hono';

import { getLandosStorageProfile } from './storage-profile.js';
import { scrubSecretsFromText } from './browser-qa.js';

export interface ReleaseCase {
  ordinal: number;
  key: string;
  label: string;
  /** What the handoff requires this case to cover. */
  coverage: string;
  body: Record<string, unknown>;
  /**
   * The operator's answer to the ONE focused clarification an incomplete lead
   * produces, submitted through the same production New Lead path. Present only
   * on cases whose intake is deliberately incomplete; the gate proves the answer
   * resumes the waiting card instead of opening a second one.
   */
  clarification?: Record<string, unknown>;
}

export interface ContractCheck {
  contract: string;
  assertion: string;
  passed: boolean;
  detail: string;
}

export interface ReleaseCaseResult {
  ordinal: number;
  key: string;
  label: string;
  dealCardId: number | null;
  createdNewDealCard: boolean | null;
  checks: ContractCheck[];
  passed: boolean;
}

export interface DealCardReleaseReport {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcome: 'pass' | 'fail';
  consecutivePasses: number;
  requiredConsecutivePasses: 5;
  storageProfile: { mode: string; syntheticOnly: boolean; databasePath: string };
  operatingDatabase: { sha256Before: string; sha256After: string; unchanged: boolean };
  cases: ReleaseCaseResult[];
  regression: ContractCheck[];
  failure?: string;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}

/**
 * The five cases the handoff names. They are fixtures: synthetic sellers,
 * synthetic parcels, no real business identity.
 */
export const RELEASE_CASES: ReleaseCase[] = [
  {
    ordinal: 1,
    key: 'clean_address_and_apn',
    label: 'Clean address + APN',
    coverage: 'clean address + APN',
    body: {
      sellerName: 'QA Fixture Seller One',
      address: '4120 Release Harness Rd, Testville, NC',
      apn: '0771-00-11-2233',
      county: 'Test County', state: 'NC', zip: '28752', acreage: '12.5',
      leadSource: 'deal-card-release-qa',
    },
  },
  {
    ordinal: 2,
    key: 'address_only',
    label: 'Address only',
    coverage: 'address only',
    body: {
      sellerName: 'QA Fixture Seller Two',
      address: '4210 Release Harness Rd, Testville, NC',
      state: 'NC',
      leadSource: 'deal-card-release-qa',
    },
    // LandOS asks for the parcel number; the operator answers with the same
    // address plus the APN, county and ZIP through the same New Lead form.
    clarification: {
      sellerName: 'QA Fixture Seller Two',
      address: '4210 Release Harness Rd, Testville, NC',
      state: 'NC', county: 'Test County', zip: '28752',
      apn: '0771-00-11-5566',
      leadSource: 'deal-card-release-qa',
    },
  },
  {
    ordinal: 3,
    key: 'malformed_clues',
    label: 'Malformed / mixed APN, acreage, state and ZIP clues',
    coverage: 'malformed/mixed APN, acreage, state or ZIP clues',
    body: {
      sellerName: 'QA Fixture Seller Three',
      address: '4310 Release Harness Rd, Testville, NC',
      // The exact defect class that created Deal 114: the acreage absorbed into
      // the parcel identifier. Plus a ZIP echoing the house number, and a state
      // that disagrees with the address.
      apn: '0771-00-11-44553.75',
      zip: '4310', state: 'ID', county: 'Test County', acreage: '3.75',
      leadSource: 'deal-card-release-qa',
    },
  },
  {
    ordinal: 4,
    key: 'thin_market_provider_unavailable',
    label: 'Thin market / external provider unavailable',
    coverage: 'thin market or an unavailable external provider',
    body: {
      sellerName: 'QA Fixture Seller Four',
      address: '4410 Release Harness Rd, Remote Testville, NC',
      apn: '0771-00-11-6677',
      county: 'Test County', state: 'NC', zip: '28752', acreage: '154',
      leadSource: 'deal-card-release-qa',
      sellerClues: 'Remote parcel with no nearby sales. QA fixture only.',
    },
  },
  {
    ordinal: 5,
    key: 'partial_parcel_boundary',
    label: 'Partial parcel / related parcel / retained improvement',
    coverage: 'partial parcel, related parcel, retained improvement or assemblage boundary',
    body: {
      sellerName: 'QA Fixture Seller Five',
      address: '4510 Release Harness Rd, Testville, NC',
      apn: '0771-00-11-8899',
      county: 'Test County', state: 'NC', zip: '28752', acreage: '2.0',
      leadSource: 'deal-card-release-qa',
      sellerClues: 'Selling only the vacant 2-acre portion; the house and well on the '
        + 'remainder are retained by the seller. QA fixture only.',
    },
  },
];

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function check(contract: string, assertion: string, passed: boolean, detail: string): ContractCheck {
  return { contract, assertion, passed, detail };
}

export interface DealCardReleaseOptions {
  projectRoot: string;
  operatingDatabasePath?: string;
  reportRoot?: string;
  now?: () => Date;
  /** Injected so the harness can be exercised without a real operating DB. */
  openOperatingDb?: (file: string) => OperatingReader | null;
  /** Reads the live valuation for a real Deal Card; see LiveValuationFetch. */
  fetchLiveValuation?: LiveValuationFetch;
  /** Reads the live currentness of a real Deal Card; see LiveCurrentnessFetch. */
  fetchLiveCurrentness?: LiveCurrentnessFetch;
  /** The standing live-proof Deal Cards whose current guidance must render. */
  standingDealCardIds?: number[];
}

/**
 * Whether a real Deal Card's operator surface renders CURRENT guidance for its
 * accepted subject: the Property Intelligence read is correlated to the current
 * subject token, and the Stage 3/5 artifacts and the Deal Brain decision are
 * subject-equivalent. Read from the running operator application, GET only.
 */
export type LiveCurrentnessFetch = (dealCardId: number) => Promise<{
  subjectVersion: string | null;
  snapshotStale: boolean | null;
  snapshotRanAgainst: string | null;
  propertyStatus: string | null;
  marketStatus: string | null;
  developmentPathStatus: string | null;
  decisionCorrelation: string | null;
  decisionSubjectVersion: string | null;
  hasLandosAction: boolean;
  hasOperatorAction: boolean;
} | null>;

/** The narrow read-only view of operating data the regression phase needs. */
export interface OperatingReader {
  dealCard(id: number): { id: number; canonical: number | null; title: string } | undefined;
  currentIdentity(id: number): { apn: string | null; acreage: number | null; basis: string } | undefined;
  currentIdentityVersionId(id: number): number | null;
  evidenceCount(ids: number[], factKey: string): number;
  close(): void;
}

/**
 * The live valuation for a real Deal Card, fetched from the running operator
 * application. The isolated QA fixtures carry no price-bearing evidence, so the
 * valuation contract can only be PROVEN against operating data — proving it
 * here is what stops the gate quietly passing on an untested contract.
 */
export type LiveValuationFetch = (dealCardId: number) => Promise<{
  offer40: number | null;
  offer60: number | null;
  hasOffer50: boolean;
  combined: { value: number | null; method: string; calculation: string } | null;
  provenance: { subjectIdentityVersionId: number | null; methodVersion?: string; correlationId?: string } | null;
} | null>;

function defaultOperatingReader(file: string): OperatingReader | null {
  if (!fs.existsSync(file)) return null;
  // Loaded through createRequire, not a bare `require`: this module is ESM, and
  // the native sqlite binding has no ESM entry point.
  const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
  // READ-ONLY. The regression phase proves operating data still reads correctly;
  // it must never be able to change it.
  const db = new Database(file, { readonly: true, fileMustExist: true });
  return {
    dealCard: (id) => db.prepare(
      'SELECT id, canonical_deal_card_id AS canonical, title FROM landos_deal_card WHERE id = ?',
    ).get(id) as { id: number; canonical: number | null; title: string } | undefined,
    currentIdentity: (id) => db.prepare(
      'SELECT apn, acreage, basis FROM landos_property_identity_version WHERE deal_card_id=? AND is_current=1 ORDER BY id DESC LIMIT 1',
    ).get(id) as { apn: string | null; acreage: number | null; basis: string } | undefined,
    currentIdentityVersionId: (id) => (db.prepare(
      'SELECT id FROM landos_property_identity_version WHERE deal_card_id=? AND is_current=1 ORDER BY id DESC LIMIT 1',
    ).get(id) as { id: number } | undefined)?.id ?? null,
    evidenceCount: (ids, factKey) => (db.prepare(
      `SELECT COUNT(*) AS n FROM landos_property_evidence_item WHERE deal_card_id IN (${ids.map(() => '?').join(',')}) AND fact_key = ?`,
    ).get(...ids, factKey) as { n: number }).n,
    close: () => db.close(),
  };
}

/**
 * Run the release gate.
 *
 * `registerRoutes` is injected so the caller controls when LandOS modules load
 * (the storage mode must be set before they do).
 */
export async function runDealCardRelease(
  registerRoutes: (app: Hono) => void,
  options: DealCardReleaseOptions,
): Promise<DealCardReleaseReport> {
  const profile = getLandosStorageProfile();
  if (profile.mode !== 'qa' || !profile.syntheticOnly) {
    throw new Error('Refusing to run the release gate outside isolated synthetic QA storage');
  }
  const now = options.now ?? (() => new Date());
  const started = now();
  const runId = `deal-card-release-${started.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const operatingDatabasePath = path.resolve(
    options.operatingDatabasePath ?? path.join(options.projectRoot, 'store', 'landos.db'),
  );
  const operatingBefore = fs.existsSync(operatingDatabasePath) ? sha256File(operatingDatabasePath) : '';

  const app = new Hono();
  registerRoutes(app);

  const request = async (method: string, apiPath: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const response = await app.request(apiPath, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, json };
  };

  const cases: ReleaseCaseResult[] = [];
  const regression: ContractCheck[] = [];
  let consecutive = 0;
  let failure: string | undefined;

  try {
    for (const fixture of RELEASE_CASES) {
      const result = await runOneCase(fixture, request);
      cases.push(result);
      if (!result.passed) {
        // Five consecutive means consecutive. A failure resets the count; the
        // sequence must be rerun from clean isolated QA storage.
        consecutive = 0;
        failure = `Case ${fixture.ordinal} (${fixture.label}) failed; consecutive count reset to zero.`;
        break;
      }
      consecutive += 1;
    }

    if (consecutive === RELEASE_CASES.length) {
      regression.push(...runRegression(operatingDatabasePath, options.openOperatingDb ?? defaultOperatingReader));
      regression.push(...await runValuationRegression(options.fetchLiveValuation, options.openOperatingDb ?? defaultOperatingReader, operatingDatabasePath));
      regression.push(...await runCurrentnessRegression(options.fetchLiveCurrentness, options.standingDealCardIds ?? [90, 89, 128]));
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    consecutive = 0;
  }

  const operatingAfter = fs.existsSync(operatingDatabasePath) ? sha256File(operatingDatabasePath) : '';
  const regressionPassed = regression.every((r) => r.passed);
  const finished = now();
  const report: DealCardReleaseReport = {
    schemaVersion: 1,
    runId,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    outcome: consecutive === RELEASE_CASES.length && regressionPassed && operatingBefore === operatingAfter ? 'pass' : 'fail',
    consecutivePasses: consecutive,
    requiredConsecutivePasses: 5,
    storageProfile: { mode: profile.mode, syntheticOnly: profile.syntheticOnly, databasePath: profile.databasePath },
    operatingDatabase: {
      sha256Before: operatingBefore,
      sha256After: operatingAfter,
      unchanged: operatingBefore === operatingAfter,
    },
    cases,
    regression,
    ...(failure ? { failure } : {}),
  };

  const reportRoot = path.resolve(options.reportRoot ?? path.join(options.projectRoot, '.runtime', 'landos', 'deal-card-release'));
  fs.mkdirSync(reportRoot, { recursive: true });
  const jsonPath = path.join(reportRoot, `${runId}.json`);
  const mdPath = path.join(reportRoot, `${runId}.md`);
  // No release report may persist a dashboard token, whatever produced a URL
  // in it. Scrubbed on the way to disk.
  fs.writeFileSync(jsonPath, scrubSecretsFromText(`${JSON.stringify(report, null, 2)}\n`));
  fs.writeFileSync(mdPath, scrubSecretsFromText(renderMarkdown(report)));
  report.reportJsonPath = jsonPath;
  report.reportMarkdownPath = mdPath;
  return report;
}

type Request = (method: string, apiPath: string, body?: unknown) => Promise<{ status: number; json: any }>;

async function runOneCase(fixture: ReleaseCase, request: Request): Promise<ReleaseCaseResult> {
  const checks: ContractCheck[] = [];
  let dealCardId: number | null = null;
  let createdNewDealCard: boolean | null = null;

  // ── Intake ───────────────────────────────────────────────────────────────
  const created = await request('POST', '/api/landos/leads/manual', fixture.body);
  const ok = created.status === 200 || created.status === 201;
  checks.push(check('Canonical identity', 'New Lead accepted and returned a Deal Card',
    ok && Number.isInteger(created.json?.dealCardId),
    ok ? `deal ${created.json?.dealCardId}` : `HTTP ${created.status}`));
  if (!ok || !Number.isInteger(created.json?.dealCardId)) {
    return { ordinal: fixture.ordinal, key: fixture.key, label: fixture.label, dealCardId, createdNewDealCard, checks, passed: false };
  }
  dealCardId = created.json.dealCardId as number;
  createdNewDealCard = created.json?.subjectResolution?.createdNewDealCard ?? null;
  checks.push(check('Canonical identity', 'A fresh subject created exactly one new Deal Card',
    createdNewDealCard === true, `createdNewDealCard=${String(createdNewDealCard)}`));

  // ── Duplicate submission resolves to the same card ───────────────────────
  const duplicate = await request('POST', '/api/landos/leads/manual', fixture.body);
  const duplicateId = duplicate.json?.dealCardId ?? null;
  const duplicateResolved = duplicateId === dealCardId
    && duplicate.json?.subjectResolution?.createdNewDealCard === false;
  checks.push(check('Canonical identity', 'A duplicate submission resolves to the same active Deal Card',
    duplicateResolved,
    `first=${dealCardId} duplicate=${duplicateId} created=${String(duplicate.json?.subjectResolution?.createdNewDealCard)}`));

  // ── The card reads back, and reports its canonical resolution ────────────
  const read = await request('GET', `/api/landos/deal-cards/${dealCardId}`);
  checks.push(check('Evidence', 'The Deal Card read model returns and names its canonical card',
    read.status === 200 && read.json?.canonicalResolution?.canonicalDealCardId === dealCardId,
    `HTTP ${read.status} canonical=${read.json?.canonicalResolution?.canonicalDealCardId}`));

  // The intake pipeline finishes its identity write and subject understanding
  // just after the 201; the operator's page polls for the same moment. Bounded.
  await awaitIntakeSettled(dealCardId, request);

  // ── An incomplete lead: one focused question, and the answer resumes it ──
  if (fixture.clarification) {
    const asked = await request('GET', `/api/landos/deal-cards/${dealCardId}/subject-understanding`);
    const question = asked.json?.understanding?.question?.question ?? null;
    checks.push(check('Canonical identity', 'An incomplete lead asks ONE focused clarification instead of leaving a broken card',
      asked.json?.understanding?.outcome === 'needs_targeted_input' && typeof question === 'string' && question.length > 0,
      `outcome=${asked.json?.understanding?.outcome} question=${question ? `"${String(question).slice(0, 90)}"` : 'none'}`));
    const answered = await request('POST', '/api/landos/leads/manual', fixture.clarification);
    const answeredId = answered.json?.dealCardId ?? null;
    const resolution = answered.json?.subjectResolution ?? {};
    checks.push(check('Canonical identity', 'The clarification answer resumes the waiting card instead of opening a second one',
      answeredId === dealCardId && resolution.createdNewDealCard === false
        && (resolution.resolvedFrom === 'provisional_card_rematched' || resolution.resolvedFrom === 'existing_active_card'),
      `answered=${answeredId} waiting=${dealCardId} created=${String(resolution.createdNewDealCard)} resolvedFrom=${resolution.resolvedFrom}`));
    await awaitIntakeSettled(dealCardId, request, (understanding) => understanding?.outcome !== 'needs_targeted_input');
    const resumed = await request('GET', `/api/landos/deal-cards/${dealCardId}/subject-understanding`);
    const resumedApn = resumed.json?.understanding?.subject?.apn ?? null;
    const expectedApn = String(fixture.clarification.apn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    checks.push(check('Canonical identity', 'Once the identity is answered the card is research-ready on that parcel without manual repair',
      resumed.json?.understanding?.outcome === 'research_ready'
        && String(resumedApn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === expectedApn,
      `outcome=${resumed.json?.understanding?.outcome} apn=${resumedApn}`));
    const subject = await request('GET', `/api/landos/deal-cards/${dealCardId}/property-intelligence?view=workspace-v2`);
    const token = subject.json?.subject?.subjectVersion ?? null;
    checks.push(check('Canonical identity', 'The canonical subject carries a durable identity version after the answer',
      typeof token === 'string' && token.startsWith('iv:')
        && String(subject.json?.subject?.apn ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === expectedApn,
      `subjectVersion=${token} apn=${subject.json?.subject?.apn}`));
  }

  // ── Every Deal Card capability is established or states its limitation ───
  checks.push(...await capabilityLedger(dealCardId, fixture, request));

  // ── Valuation: honest, and never a 50% benchmark ─────────────────────────
  const valuation = await request('GET', `/api/landos/deal-cards/${dealCardId}/comps-valuation`);
  const valuationOk = valuation.status === 200 || valuation.status === 404;
  // The package lives under `compsValuation` on the Deal Card read model.
  const pkg = valuation.json?.compsValuation?.valuationPackage
    ?? valuation.json?.view?.compsValuation?.valuationPackage
    ?? null;
  checks.push(check('Valuation', 'Comparable/valuation read model answers without hanging or erroring',
    valuationOk, `HTTP ${valuation.status}`));
  checks.push(check('Valuation', 'The valuation package is present, or its absence is recorded rather than skipped',
    true,
    pkg ? 'valuation package present; contract assertions below apply'
      : 'no valuation package for this fixture (no price-bearing evidence in isolated QA); '
        + 'the valuation contract is proven against operating data in the regression phase'));
  if (pkg) {
    const combined = pkg.combinedFmv ?? null;
    // Either a value with both benchmarks, or an explicit unavailable state.
    const honest = combined?.value != null
      ? (pkg.offer40 != null && pkg.offer60 != null)
      : (combined?.method === 'unavailable' || combined?.limitation != null);
    checks.push(check('Valuation', 'Combined LandOS FMV is either populated with 40%/60% or explicitly unavailable',
      honest, `value=${combined?.value ?? 'null'} method=${combined?.method} offer40=${pkg.offer40} offer60=${pkg.offer60}`));
    checks.push(check('Valuation', 'No 50% benchmark is present in the valuation package',
      !Object.prototype.hasOwnProperty.call(pkg, 'offer50'),
      'valuation package exposes offer40 and offer60 only'));
    checks.push(check('Valuation', 'The valuation carries currentness provenance',
      typeof pkg.provenance?.correlationId === 'string'
      && typeof pkg.provenance?.methodVersion === 'string'
      && typeof pkg.provenance?.compEvidenceFingerprint === 'string',
      `method=${pkg.provenance?.methodVersion} correlation=${pkg.provenance?.correlationId}`));
  }

  // ── Reliability: an identical re-read writes nothing ─────────────────────
  const first = await request('GET', `/api/landos/deal-cards/${dealCardId}/comps-valuation`);
  const second = await request('GET', `/api/landos/deal-cards/${dealCardId}/comps-valuation`);
  const firstCorrelation = first.json?.compsValuation?.valuationPackage?.provenance?.correlationId ?? null;
  const secondCorrelation = second.json?.compsValuation?.valuationPackage?.provenance?.correlationId ?? null;
  checks.push(check('Reliability', 'An identical rerun correlates identically (no new current artifact)',
    firstCorrelation === secondCorrelation,
    `first=${firstCorrelation} second=${secondCorrelation}`));

  // ── Decision surfaces answer or state their limitation ───────────────────
  const dealBrain = await request('GET', `/api/landos/deal-cards/${dealCardId}/deal-brain`);
  checks.push(check('Decision', 'Deal Brain answers without hanging',
    dealBrain.status === 200 || dealBrain.status === 404, `HTTP ${dealBrain.status}`));

  const zoning = await request('GET', `/api/landos/deal-cards/${dealCardId}/zoning-land-use`);
  checks.push(check('Intelligence', 'Zoning / development path answers or states its evidence limitation',
    zoning.status === 200 || zoning.status === 404, `HTTP ${zoning.status}`));

  const propertyIntelligence = await request('GET', `/api/landos/deal-cards/${dealCardId}/property-intelligence`);
  checks.push(check('Intelligence', 'Property Intelligence answers without hanging',
    propertyIntelligence.status === 200 || propertyIntelligence.status === 404,
    `HTTP ${propertyIntelligence.status}`));

  // ── Reliability: reading the whole card writes nothing ───────────────────
  // The store is fingerprinted, every read surface the Deal Card page uses is
  // opened, and the fingerprint is compared: a page load or hard refresh can
  // never be what makes research, a snapshot or a decision exist.
  const before = storageFingerprint();
  for (const surface of READ_SURFACES) await request('GET', `/api/landos/deal-cards/${dealCardId}${surface}`);
  const after = storageFingerprint();
  checks.push(check('Reliability', 'Opening every Deal Card read surface writes nothing (page load / hard refresh are GET only)',
    before === after, before === after ? `${READ_SURFACES.length} surfaces read; storage fingerprint unchanged` : 'storage fingerprint changed during reads'));

  return {
    ordinal: fixture.ordinal, key: fixture.key, label: fixture.label,
    dealCardId, createdNewDealCard, checks,
    passed: checks.every((c) => c.passed),
  };
}

/**
 * Wait, bounded, until the intake pipeline has retained its subject
 * understanding for the card (and, optionally, until it satisfies `ready`).
 * The New Lead route answers before its identity write and understanding pass
 * complete; the operator's page polls for the same settle, so the gate does too.
 */
async function awaitIntakeSettled(
  dealCardId: number,
  request: Request,
  ready: (understanding: Record<string, any> | null) => boolean = (understanding) => understanding != null,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const read = await request('GET', `/api/landos/deal-cards/${dealCardId}/subject-understanding`);
    if (ready(read.json?.understanding ?? null)) return;
    if (Date.now() >= deadline) return;
    await new Promise((settle) => { setTimeout(settle, 250); });
  }
}

/** Every GET surface the Deal Card page opens; used for the write-free read proof. */
const READ_SURFACES = [
  '', '/property-intelligence?view=workspace-v2', '/property-intelligence?view=deal', '/property-intelligence',
  '/acquisition-intelligence', '/intelligence', '/deal-brain', '/zoning-land-use', '/land-use', '/comps-valuation',
  '/market-pulse', '/research-readiness', '/subject-understanding', '/official-parcel-gis', '/government-records',
  '/public-records', '/assessor-tax', '/intake', '/county-verification', '/property-resolution', '/comps',
  '/activity', '/blockers',
];

/** SHA-256 over the isolated QA store's main file and WAL, so a write during reads is visible. */
function storageFingerprint(): string {
  const { databasePath } = getLandosStorageProfile();
  const hash = createHash('sha256');
  for (const file of [databasePath, `${databasePath}-wal`]) {
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

const STAGE_STATUSES = new Set(['current', 'partial_current', 'pending', 'historical']);
const READINESS_STATUSES = new Set(['green', 'yellow', 'red', 'blue', 'gray']);
const SUBJECT_STATUSES = new Set(['confirmed', 'candidate', 'unresolved', 'provisional', 'conflict', 'rejected']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The Deal Card capability ledger.
 *
 * One check per capability the operational contract names. Each proves the
 * capability is EITHER established on the read model OR states its limitation
 * in the vocabulary the Deal Card renders (current / partial / pending /
 * blocked / not researched with a reason). A capability that is silently
 * absent — no state, no reason — fails; a fixture that cannot reach a provider
 * passes only by saying so.
 */
async function capabilityLedger(dealCardId: number, fixture: ReleaseCase, request: Request): Promise<ContractCheck[]> {
  const checks: ContractCheck[] = [];
  const get = async (surface: string) => (await request('GET', `/api/landos/deal-cards/${dealCardId}${surface}`)).json ?? {};
  const root = await get('');
  const ws = await get('/property-intelligence?view=workspace-v2');
  const full = await get('/property-intelligence');
  const readiness = await get('/research-readiness');
  const understanding = await get('/subject-understanding');
  const intake = await get('/intake');
  const marketPulse = await get('/market-pulse');
  const dealBrain = await get('/deal-brain');
  const government = await get('/government-records');
  const publicRecords = await get('/public-records');
  const blockers = await get('/blockers');
  const pi = ws.propertyIntelligence ?? {};
  const items: Array<Record<string, any>> = readiness.manifest?.items ?? [];
  const item = (id: string) => items.find((entry) => entry.id === id);
  const itemStates = (ids: string[]) => ids.every((id) => {
    const entry = item(id);
    return !!entry && READINESS_STATUSES.has(entry.status) && text(entry.reason ?? entry.statusLabel).length > 0;
  });
  const itemSummary = (ids: string[]) => ids.map((id) => `${id}=${item(id)?.status ?? 'missing'}`).join(' ');
  const stage = (product: Record<string, any> | null | undefined) =>
    !!product && STAGE_STATUSES.has(product.status) && (product.status === 'current' || text(product.limitation).length > 0);

  // 1. Raw seller evidence and original intake.
  const rawNotes = text(root.dealCard?.seller_notes);
  checks.push(check('Capability', '1. Raw seller evidence and the original intake are retained verbatim on the card',
    rawNotes.includes(String(fixture.body.address ?? fixture.body.apn ?? '')) && !!intake.canonicalIdentity,
    rawNotes ? `intake retained (${rawNotes.length} chars); canonical identity status=${intake.canonicalIdentity?.status}` : 'no retained intake'));

  // 2. Acquisition subject and related parcels.
  checks.push(check('Capability', '2. The acquisition subject and its related-parcel scope are established with the subject-fact guard',
    !!root.parcelScope && text(root.parcelScope.subjectFactGuard).length > 0 && Array.isArray(full.parcelRoster),
    `subjectApn=${root.parcelScope?.subjectApn ?? 'none'} neighbors=${root.parcelScope?.neighbors?.length ?? 0} roster=${full.parcelRoster?.length ?? 'missing'}`));

  // 3. Canonical address, APN, county, state, ZIP, acreage, boundary and jurisdiction.
  const subject = ws.subject ?? {};
  const outcome = understanding.understanding?.outcome ?? null;
  const focused = understanding.understanding?.question?.question ?? null;
  checks.push(check('Capability', '3. The canonical subject is stated with its basis, or LandOS asks one focused clarification',
    SUBJECT_STATUSES.has(subject.status) && text(subject.basis).length > 0
      && (subject.subjectResolved === true || outcome === 'research_ready' || (outcome === 'needs_targeted_input' && !!focused)),
    `status=${subject.status} apn=${subject.apn ?? 'none'} county=${subject.county ?? 'none'} state=${subject.state ?? 'none'} `
      + `zip=${subject.zip ?? 'none'} acreage=${subject.acreage?.value ?? 'none'}/${subject.acreage?.basis ?? 'none'} understanding=${outcome}`));

  // 4. Duplicate prevention and canonical resolution.
  checks.push(check('Capability', '4. The card names its canonical Deal Card and its alias set',
    root.canonicalResolution?.canonicalDealCardId === dealCardId && Array.isArray(root.canonicalResolution?.aliasDealCardIds),
    JSON.stringify(root.canonicalResolution ?? null)));

  // 5. Assessor / property appraiser evidence.
  checks.push(check('Capability', '5. Assessor / property appraiser evidence is established or its state is stated',
    itemStates(['assessor_tax']), itemSummary(['assessor_tax'])));

  // 6. Official parcel characteristics.
  checks.push(check('Capability', '6. The official parcel record lane reports its result or its limitation',
    itemStates(['official_parcel_record']) && text(pi.officialParcelGis?.statusHeadline).length > 0,
    `${itemSummary(['official_parcel_record'])} · ${text(pi.officialParcelGis?.statusHeadline)}`));

  // 7. LandPortal characteristics and retained source evidence.
  checks.push(check('Capability', '7. LandPortal property characteristics are retained or the lane states it has not run',
    itemStates(['landportal_research']) && 'landPortalFacts' in pi,
    itemSummary(['landportal_research'])));

  // 8. Market Research.
  checks.push(check('Capability', '8. Market Research is current, partial with its limitation, or explicitly pending',
    stage(ws.stage3Status?.market), `${ws.stage3Status?.market?.status}: ${text(ws.stage3Status?.market?.limitation).slice(0, 100)}`));

  // 9. Market Intelligence and Market Pulse.
  checks.push(check('Capability', '9. Market Pulse answers for the area or states that its geography is unavailable',
    !!marketPulse.marketPulse && text(marketPulse.marketPulse.label).length > 0 && itemStates(['market_statistics', 'area_market_context']),
    `${text(marketPulse.marketPulse?.label)} · growth=${marketPulse.marketPulse?.growth?.status} · ${itemSummary(['market_statistics', 'area_market_context'])}`));

  // 10. Visual and geographic intelligence.
  checks.push(check('Capability', '10. Visual and geographic intelligence is captured or its absence is stated',
    itemStates(['visual_evidence']), itemSummary(['visual_evidence'])));

  // 11. Seller Intelligence or explicit pending seller state.
  checks.push(check('Capability', '11. Seller Intelligence is read or the seller state is explicitly pending',
    text(ws.sellerReadStatus?.status).length > 0 && text(ws.sellerReadStatus?.basis).length > 0,
    `${ws.sellerReadStatus?.status}: ${text(ws.sellerReadStatus?.basis).slice(0, 100)}`));

  // 12. Closed land comps, active competition, current valuation.
  const combined = pi.compsValuation?.valuationPackage?.combinedFmv ?? null;
  checks.push(check('Capability', '12. Comps and valuation are stated as a Combined LandOS FMV or an explicit collection limitation',
    itemStates(['comps_collection', 'valuation']) && !!combined && (combined.value != null || text(combined.limitation).length > 0),
    `${itemSummary(['comps_collection', 'valuation'])} · combined=${combined?.value ?? 'null'} (${combined?.method ?? 'none'})`));

  // 13. Zoning and by-right uses.
  checks.push(check('Capability', '13. Current zoning is established with authority or its research state is stated',
    itemStates(['current_zoning']) && text(pi.landUse?.governingAuthority?.patternLabel).length > 0,
    `${itemSummary(['current_zoning'])} · authority=${text(pi.landUse?.governingAuthority?.patternLabel)}`));

  // 14 and 15. Minor and major subdivision / entitlement pathways.
  checks.push(check('Capability', '14. Minor subdivision pathway is placed or the Development Path states it is pending',
    itemStates(['subdivision_rules']) && stage(ws.developmentPathStatus),
    `${itemSummary(['subdivision_rules'])} · ${ws.developmentPathStatus?.status}: ${text(ws.developmentPathStatus?.limitation).slice(0, 90)}`));
  checks.push(check('Capability', '15. Major subdivision / entitlement pathway shares that Development Path state',
    stage(ws.developmentPathStatus), `${ws.developmentPathStatus?.status}`));

  // 16. Access, frontage, utilities, wetlands, flood exposure and other constraints.
  const constraintIds = ['access', 'road_frontage', 'public_water', 'public_sewer', 'well_outlook', 'septic_outlook'];
  checks.push(check('Capability', '16. Access, frontage, utilities and physical constraints each carry a state and a reason',
    itemStates(constraintIds) && 'missingDiligence' in pi, itemSummary(constraintIds)));

  // 17. Deed retrieval and deed analysis.
  const authorities: Array<Record<string, any>> = publicRecords.hierarchy?.authorities ?? [];
  const recorder = authorities.find((authority) => /clerk|recorder|register of deeds|land records/i.test(text(authority.label)));
  const governmentStated = government.governmentRecords
    ? Array.isArray(government.governmentRecords.artifacts) && Array.isArray(government.governmentRecords.jobs)
    : text(government.limitation).length > 0;
  checks.push(check('Capability', '17. Deed retrieval names the official land-records authority and reports retained instruments, none, or why it waits',
    governmentStated && !!recorder,
    `authority=${text(recorder?.label) || 'none'} ${government.governmentRecords
      ? `artifacts=${government.governmentRecords.artifacts?.length} evidence=${government.governmentRecords.evidenceCount}`
      : `limitation="${text(government.limitation).slice(0, 90)}"`}`));

  // 18. Strategy Comparison.
  const decision = ws.dealDecision ?? null;
  checks.push(check('Capability', '18. Strategy Comparison is present on the current decision or the card states why no decision exists yet',
    (decision && decision.correlation === 'equivalent' && !!decision.strategyComparison) || text(ws.researchStability?.reason).length > 0,
    decision ? `decision ${decision.snapshotId} (${decision.correlation})` : `no decision: ${text(ws.researchStability?.reason).slice(0, 110)}`));

  // 19. Deal Brain guidance.
  checks.push(check('Capability', '19. Deal Brain answers about the same subject token every other surface carries',
    text(dealBrain.subject?.subjectVersion).length > 0 && dealBrain.subject?.subjectVersion === subject.subjectVersion,
    `dealBrain=${dealBrain.subject?.subjectVersion} card=${subject.subjectVersion}`));

  // 20. One LandOS action and one operator action.
  const landosAction = text(decision?.nextActions?.landos?.action ?? decision?.nextActions?.landos?.headline ?? decision?.nextActions?.landos);
  const operatorAction = text(decision?.nextActions?.operator?.action ?? decision?.nextActions?.operator?.headline ?? decision?.nextActions?.operator);
  const fallbackAction = text(blockers.blockers?.nextBestAction) || text(focused);
  checks.push(check('Capability', '20. One clear LandOS action and one clear operator action are stated',
    (landosAction.length > 0 && operatorAction.length > 0) || fallbackAction.length > 0,
    landosAction ? `landos="${landosAction.slice(0, 70)}" operator="${operatorAction.slice(0, 70)}"` : `next action="${fallbackAction.slice(0, 120)}"`));

  return checks;
}

/**
 * READ-ONLY regression against operating data.
 *
 * Proves the canonical family and the standing live-proof parcels still read
 * correctly after the change. It opens the operating database read-only and
 * writes nothing; the caller separately proves the file hash did not move.
 */
function runRegression(
  operatingDatabasePath: string,
  open: (file: string) => OperatingReader | null,
): ContractCheck[] {
  const checks: ContractCheck[] = [];
  let reader: OperatingReader | null = null;
  try { reader = open(operatingDatabasePath); } catch (error) {
    return [check('Regression', 'Operating database readable for regression',
      false, error instanceof Error ? error.message : String(error))];
  }
  if (!reader) {
    return [check('Regression', 'Operating database readable for regression', false,
      `not found at ${operatingDatabasePath}`)];
  }
  try {
    const canonical = reader.dealCard(90);
    checks.push(check('Regression', 'Deal 90 is present and is itself canonical',
      canonical != null && canonical.canonical == null,
      canonical ? `deal 90 canonical pointer=${String(canonical.canonical)}` : 'deal 90 missing'));

    for (const aliasId of [114, 115]) {
      const alias = reader.dealCard(aliasId);
      checks.push(check('Regression', `Alias Deal ${aliasId} resolves to Deal 90`,
        alias != null && alias.canonical === 90,
        alias ? `deal ${aliasId} -> ${String(alias.canonical)}` : `deal ${aliasId} missing`));
    }

    // The operator-accepted governing acreage is retained on an alias and must
    // be reachable from the canonical family without having been copied.
    const acceptance = reader.evidenceCount([90, 114, 115], 'Operator-accepted governing acreage');
    checks.push(check('Regression', 'The operator-accepted governing acreage is reachable from the Deal 90 family',
      acceptance >= 1, `${acceptance} acceptance row(s) in the family`));

    const fairview = reader.dealCard(89);
    const fairviewIdentity = reader.currentIdentity(89);
    checks.push(check('Regression', 'Deal 89 retains its accepted subject identity',
      fairview != null && fairviewIdentity != null && !!fairviewIdentity.apn,
      fairviewIdentity ? `apn=${fairviewIdentity.apn} acreage=${String(fairviewIdentity.acreage)}` : 'no current identity'));
  } finally {
    try { reader.close(); } catch { /* read-only handle */ }
  }
  return checks;
}

/**
 * Prove the valuation contract against a real Deal Card.
 *
 * Deal 90 carries genuine multi-lane comp evidence, so it is the only place the
 * benchmark rules and the currentness correlation can actually be exercised.
 * When no live reader is supplied the checks are reported as UNPROVEN rather
 * than silently omitted — a contract the gate did not test must never look like
 * a contract the gate passed.
 */
async function runValuationRegression(
  fetchLive: LiveValuationFetch | undefined,
  open: (file: string) => OperatingReader | null,
  operatingDatabasePath: string,
): Promise<ContractCheck[]> {
  const CANONICAL = 90;
  if (!fetchLive) {
    return [check('Valuation', 'Valuation contract proven against operating data', false,
      'no live valuation reader supplied; the 40/60, no-50% and correlation rules were NOT exercised')];
  }
  let live;
  try { live = await fetchLive(CANONICAL); } catch (error) {
    return [check('Valuation', 'Valuation contract proven against operating data', false,
      error instanceof Error ? error.message : String(error))];
  }
  if (!live) {
    return [check('Valuation', 'Valuation contract proven against operating data', false,
      `no valuation package returned for Deal ${CANONICAL}`)];
  }
  const checks: ContractCheck[] = [];
  checks.push(check('Valuation', 'A current Combined LandOS FMV exists on the canonical Deal Card',
    live.combined?.value != null, `value=${live.combined?.value ?? 'null'} method=${live.combined?.method}`));
  checks.push(check('Valuation', 'Combined LandOS FMV is the average of the two lane views when both exist',
    live.combined?.method !== 'average' || /÷ 2/.test(live.combined?.calculation ?? ''),
    live.combined?.calculation ?? 'no calculation recorded'));
  // EXACT, not rounded to $500. The benchmarks are what the operator opens and
  // negotiates at, so 40% of $52,000 is $20,800 and not $21,000: a $200 drift
  // introduced by presentation rounding is real money on the offer, and it also
  // made the stated percentage untrue of the stated FMV.
  checks.push(check('Valuation', 'The 40% and 60% benchmarks derive from that Combined FMV',
    live.combined?.value == null
      || (live.offer40 === Math.round(live.combined.value * 0.4)
        && live.offer60 === Math.round(live.combined.value * 0.6)),
    `fmv=${live.combined?.value} offer40=${live.offer40} offer60=${live.offer60}`));
  checks.push(check('Valuation', 'No 50% value is exposed in the valuation package',
    !live.hasOffer50, live.hasOffer50 ? 'offer50 present' : 'offer40 and offer60 only'));

  let reader: OperatingReader | null = null;
  try { reader = open(operatingDatabasePath); } catch { reader = null; }
  const acceptedVersionId = reader?.currentIdentityVersionId(CANONICAL) ?? null;
  try { reader?.close(); } catch { /* read-only handle */ }
  checks.push(check('Valuation', 'The valuation correlates to the ACCEPTED subject version',
    acceptedVersionId != null && live.provenance?.subjectIdentityVersionId === acceptedVersionId,
    `accepted=${acceptedVersionId} valuation=${live.provenance?.subjectIdentityVersionId ?? 'null'}`));
  checks.push(check('Valuation', 'The valuation carries a method version and a correlation id',
    !!live.provenance?.methodVersion && !!live.provenance?.correlationId,
    `method=${live.provenance?.methodVersion} correlation=${live.provenance?.correlationId}`));
  return checks;
}

/**
 * Prove the standing live-proof Deal Cards render CURRENT guidance for their
 * accepted subject on the running operator application: the Property
 * Intelligence read is correlated (no "prior read" banner), the Stage 3/5
 * artifacts are subject-equivalent, and the Deal Brain decision consumed the
 * same subject token. Historical artifacts may exist; none may present as
 * current. Reported UNPROVEN when no live reader is supplied.
 */
async function runCurrentnessRegression(
  fetchLive: LiveCurrentnessFetch | undefined,
  dealCardIds: number[],
): Promise<ContractCheck[]> {
  if (!fetchLive) {
    return [check('Currentness', 'Standing Deal Cards render current guidance', false,
      'no live currentness reader supplied; the artifact-currentness contract was NOT exercised')];
  }
  const checks: ContractCheck[] = [];
  for (const id of dealCardIds) {
    let live;
    try { live = await fetchLive(id); } catch (error) {
      checks.push(check('Currentness', `Deal ${id} renders current guidance for its accepted subject`, false,
        error instanceof Error ? error.message : String(error)));
      continue;
    }
    if (!live) {
      checks.push(check('Currentness', `Deal ${id} renders current guidance for its accepted subject`, false, 'no live read model returned'));
      continue;
    }
    const currentStage = (status: string | null) => status === 'current' || status === 'partial_current';
    checks.push(check('Currentness', `Deal ${id}: the Property Intelligence read is correlated to the accepted subject (no prior-read banner)`,
      live.snapshotStale === false && live.snapshotRanAgainst === live.subjectVersion,
      `subject=${live.subjectVersion} ranAgainst=${live.snapshotRanAgainst ?? 'null'} stale=${String(live.snapshotStale)}`));
    checks.push(check('Currentness', `Deal ${id}: Property, Market and Development Path artifacts are current for that subject`,
      currentStage(live.propertyStatus) && currentStage(live.marketStatus) && currentStage(live.developmentPathStatus),
      `property=${live.propertyStatus} market=${live.marketStatus} developmentPath=${live.developmentPathStatus}`));
    checks.push(check('Currentness', `Deal ${id}: the Deal Brain decision consumed that same subject and names both next actions`,
      live.decisionCorrelation === 'equivalent' && live.decisionSubjectVersion === live.subjectVersion && live.hasLandosAction && live.hasOperatorAction,
      `correlation=${live.decisionCorrelation} decisionSubject=${live.decisionSubjectVersion} landosAction=${live.hasLandosAction} operatorAction=${live.hasOperatorAction}`));
  }
  return checks;
}

function renderMarkdown(report: DealCardReleaseReport): string {
  const lines = [
    '# LandOS Deal Card Release Gate', '',
    `- Outcome: **${report.outcome.toUpperCase()}**`,
    `- Consecutive complete cases: **${report.consecutivePasses} / ${report.requiredConsecutivePasses}**`,
    `- Run: \`${report.runId}\``,
    `- Window: ${report.startedAt} to ${report.finishedAt}`,
    `- Storage: ${report.storageProfile.mode} (syntheticOnly=${report.storageProfile.syntheticOnly})`,
    `- Operating database unchanged: **${report.operatingDatabase.unchanged}**`,
    '', '## Cases', '',
  ];
  for (const result of report.cases) {
    lines.push(`### ${result.ordinal}. ${result.label} — ${result.passed ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push('| Contract | Assertion | Result | Detail |');
    lines.push('|---|---|---|---|');
    for (const c of result.checks) {
      lines.push(`| ${c.contract} | ${c.assertion} | ${c.passed ? 'PASS' : 'FAIL'} | ${c.detail} |`);
    }
    lines.push('');
  }
  if (report.regression.length) {
    lines.push('## Regression (read-only, operating data)', '');
    lines.push('| Assertion | Result | Detail |');
    lines.push('|---|---|---|');
    for (const c of report.regression) lines.push(`| ${c.assertion} | ${c.passed ? 'PASS' : 'FAIL'} | ${c.detail} |`);
    lines.push('');
  }
  if (report.failure) lines.push('## Failure', '', report.failure, '');
  return `${lines.join('\n')}\n`;
}
