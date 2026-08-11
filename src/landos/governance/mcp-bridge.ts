// Narrow application-owned bridge for the governed LandOS MCP servers.
//
// The Python MCP process may select only one compile-time operation below. The
// bridge never accepts SQL, paths, commands, URLs to fetch, or generic method
// names. All business reads/writes go through existing canonical LandOS APIs.

import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { PROJECT_ROOT } from '../../config.js';
import { getLandosDb } from '../db.js';
import { getDealCardIdForPropertyCard } from '../deal-card.js';
import { apnEquivalent } from '../property-intelligence-snapshot.js';
import { PropertyIntelligenceStore } from '../property-intelligence-store.js';
import type { SpecialistId, SpecialistStatus } from '../property-intelligence-specialists.js';
import type { NormalizedPropertyEvidence, PropertyProviderResult } from '../property-intelligence-contract.js';
import { PropertyResearchStore } from '../property-research-store.js';
import { getPropertyCard, getPropertyCardRow, normalizeAddressKey, type PropertyCardRow } from '../property-card.js';
import {
  getMrGeoSummary,
  listMrSnapshots,
  type MrGeoSummary,
} from '../market-research-snapshots.js';
import { resolveCountyRefByName } from '../market-matrix-store.js';

// These repository-owned JavaScript validators are the canonical v1.0.0
// acceptance implementation. TypeScript declarations are intentionally local
// to this bounded bridge rather than duplicated in shared application code.
// @ts-expect-error Authoritative repository JavaScript module has no declaration file.
import { validateAcceptanceContract, validateAcceptanceResults } from '../../../scripts/acceptance/contract-validator.mjs';
// @ts-expect-error Authoritative repository JavaScript module has no declaration file.
import { renderAcceptanceReport } from '../../../scripts/acceptance/generate-report.mjs';
// @ts-expect-error Authoritative repository JavaScript module has no declaration file.
import { inspectConsoleCapture, inspectNetworkCapture, inspectPng, inspectTraceZip, inspectWebm } from '../../../scripts/acceptance/artifact-inspector.mjs';
// @ts-expect-error Authoritative repository JavaScript module has no declaration file.
import { resolveExpectedBinding } from '../../../scripts/acceptance/contract-builder.mjs';

export const LANDOS_BRIDGE_OPERATIONS = [
  'get_property_context',
  'get_accepted_evidence',
  'get_provider_and_specialist_status',
  'get_acceptance_expectations',
  'get_visible_and_canonical_counts',
  'get_market_research_context',
  'get_source_registry_entries',
  'begin_acceptance_run',
  'record_visual_claim',
  'record_screenshot_artifact',
  'record_refresh_result',
  'record_restart_result',
  'record_console_result',
  'record_network_result',
  'submit_pass_or_fail_report',
  'save_verified_property_fact',
  'save_verified_comp',
  'save_verified_visual_artifact',
  'report_specialist_progress',
  'complete_or_fail_research_category',
] as const;

export type LandosBridgeOperation = (typeof LANDOS_BRIDGE_OPERATIONS)[number];

const operationSet = new Set<string>(LANDOS_BRIDGE_OPERATIONS);
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const safeId = z.string().regex(/^[a-z0-9][a-z0-9._:-]{2,179}$/);
const isoTimestamp = z.string().datetime({ offset: true });
const httpsUrl = z.string().url().refine((value) => value.startsWith('https://'), 'HTTPS URL required');
const category = z.enum(['subject', 'comps', 'visuals', 'market', 'zoning', 'environmental', 'access_utilities', 'documents']);
const identity = z.object({
  property_card_id: z.number().int().positive(),
  address: z.string().min(5).max(500),
  apn: z.string().min(4).max(96).nullable(),
  property_id: z.string().regex(/^[1-9][0-9]{3,19}$/).nullable(),
}).strict();

const fact = z.object({
  identity,
  category,
  field: z.string().min(1).max(500),
  value: scalar,
  evidence_type: z.literal('fact'),
  strength: z.enum(['official_record', 'provider_verified']),
  provider_id: safeId,
  source_url: httpsUrl,
  retrieved_at: isoTimestamp,
  confidence: z.literal('high'),
}).strict();

const comp = z.object({
  identity,
  category: z.literal('comps'),
  evidence_type: z.literal('comp'),
  provider_id: safeId,
  price: z.number().positive(),
  acres: z.number().positive(),
  apn: z.string().min(4).max(96).nullable(),
  address: z.string().min(1).max(500).nullable(),
  price_per_acre: z.number().positive().nullable(),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source_url: httpsUrl,
  retrieved_at: isoTimestamp,
}).strict().superRefine((value, context) => {
  if (!value.apn && !value.address) context.addIssue({ code: 'custom', message: 'comp APN or address is required' });
  if (value.price_per_acre != null) {
    const expected = value.price / value.acres;
    if (Math.abs(value.price_per_acre - expected) > Math.max(1, expected * 0.01)) {
      context.addIssue({ code: 'custom', message: 'price_per_acre conflicts with price divided by acres' });
    }
  }
});

const visual = z.object({
  identity,
  category: z.literal('visuals'),
  evidence_type: z.literal('visual'),
  provider_id: safeId,
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  label: z.string().min(1).max(500),
  purpose: z.string().min(1).max(4_000),
  artifact_path: z.string().min(5).max(512),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  captured_at: isoTimestamp,
  requested_view: z.enum(['parcel_context', 'road_frontage', 'wetlands', 'fema_flood', 'soil', 'contours', 'front_3d', 'rear_3d', 'comparables_map']),
  active_view: z.enum(['parcel_context', 'road_frontage', 'wetlands', 'fema_flood', 'soil', 'contours', 'front_3d', 'rear_3d', 'comparables_map']),
  boundary_required: z.boolean(),
  boundary_visible: z.boolean(),
  tiles_loaded: z.literal(true),
  camera_scale: z.enum(['parcel', 'context', 'county', 'national']),
  clipped: z.literal(false),
  obstructions: z.array(z.string().min(1).max(500)),
}).strict().superRefine((value, context) => {
  const normalized = value.artifact_path.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    context.addIssue({ code: 'custom', message: 'visual artifact path must be a safe relative path' });
  }
  if (value.active_view !== value.requested_view) context.addIssue({ code: 'custom', message: 'active view must match requested view' });
  if (value.boundary_required && !value.boundary_visible) context.addIssue({ code: 'custom', message: 'required boundary is not visible' });
});

const progress = z.object({
  identity,
  category,
  provider_id: safeId,
  status: z.enum(['pending', 'running']),
  progress_percent: z.number().int().min(0).max(99),
  note: z.string().min(1).max(4_000),
  reported_at: isoTimestamp,
}).strict();

const categoryResult = z.object({
  identity,
  category,
  provider_id: safeId,
  outcome: z.enum(['complete', 'failed']),
  summary: z.string().min(1).max(4_000),
  completed_at: isoTimestamp,
  retained_item_count: z.number().int().nonnegative(),
}).strict();

const verdict = z.enum(['PASS', 'FAIL']);
const screenshotName = z.enum(['new-lead.png', 'deal-card-loaded.png', 'changed-section.png', 'relevant-tab-or-panel.png', 'after-refresh.png', 'after-restart.png']);
const acceptanceClaim = z.object({
  claimId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
  operatorSection: z.string().min(1).max(500),
  propertyAddress: z.string().min(5).max(500),
  claim: z.string().min(1).max(4_000),
  expectedValue: scalar,
  visibleValue: scalar,
  status: verdict,
  evidencePath: screenshotName,
  timestamp: isoTimestamp,
  refreshResult: verdict,
  restartResult: verdict,
  contaminationResult: verdict,
}).strict();
const acceptanceCheck = z.object({ status: verdict, visibleValuesRetained: z.boolean(), timestamp: isoTimestamp }).strict();
const consoleResult = z.object({ path: z.literal('console.json'), relevantErrorCount: z.number().int().nonnegative(), timestamp: isoTimestamp }).strict();
const networkResult = z.object({ path: z.literal('network-failures.json'), requiredFailureCount: z.number().int().nonnegative(), timestamp: isoTimestamp }).strict();
const contentValidation = z.discriminatedUnion('kind', [
  z.object({
    validated: z.literal(true),
    kind: z.literal('screenshot'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    uniqueColorSamples: z.number().int().positive(),
  }).strict(),
  z.object({ validated: z.literal(true), kind: z.literal('trace') }).strict(),
  z.object({ validated: z.literal(true), kind: z.literal('video') }).strict(),
  z.object({ validated: z.literal(true), kind: z.literal('console') }).strict(),
  z.object({ validated: z.literal(true), kind: z.literal('network') }).strict(),
]);
const acceptanceArtifact = z.object({
  path: z.string().min(3).max(200),
  mediaType: z.string().min(3).max(100),
  byteLength: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: isoTimestamp,
  contentValidation,
}).strict();

const argumentSchemas: Record<LandosBridgeOperation, z.ZodType> = {
  get_property_context: z.object({ property_card_id: z.number().int().positive() }).strict(),
  get_accepted_evidence: z.object({ property_card_id: z.number().int().positive(), category: category.nullable(), limit: z.number().int().min(1).max(200) }).strict(),
  get_provider_and_specialist_status: z.object({ property_card_id: z.number().int().positive() }).strict(),
  get_acceptance_expectations: z.object({ property_card_id: z.number().int().positive(), sprint_name: z.string().min(3).max(120).nullable() }).strict(),
  get_visible_and_canonical_counts: z.object({ property_card_id: z.number().int().positive() }).strict(),
  get_market_research_context: z.object({ property_card_id: z.number().int().positive(), scope: z.enum(['state', 'county', 'zip', 'acreage_band']) }).strict(),
  get_source_registry_entries: z.object({ kind: z.enum(['assessor', 'gis', 'zoning', 'subdivision', 'market', 'infrastructure', 'development', 'demographic']).nullable(), jurisdiction: z.string().min(2).max(500).nullable(), limit: z.number().int().min(1).max(200) }).strict(),
  begin_acceptance_run: z.object({ contract: z.record(z.string(), z.unknown()) }).strict(),
  record_visual_claim: z.object({ run_id: safeId, claim: acceptanceClaim }).strict(),
  record_screenshot_artifact: z.object({ run_id: safeId, artifact: acceptanceArtifact }).strict(),
  record_refresh_result: z.object({ run_id: safeId, result: acceptanceCheck }).strict(),
  record_restart_result: z.object({ run_id: safeId, result: acceptanceCheck }).strict(),
  record_console_result: z.object({ run_id: safeId, result: consoleResult }).strict(),
  record_network_result: z.object({ run_id: safeId, result: networkResult }).strict(),
  submit_pass_or_fail_report: z.object({ run_id: safeId, report: z.record(z.string(), z.unknown()) }).strict(),
  save_verified_property_fact: z.object({ fact }).strict(),
  save_verified_comp: z.object({ comp }).strict(),
  save_verified_visual_artifact: z.object({ artifact: visual }).strict(),
  report_specialist_progress: z.object({ progress }).strict(),
  complete_or_fail_research_category: z.object({ result: categoryResult }).strict(),
};

class BridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function dict(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('invalid_arguments', 'expected an object');
  return value as Record<string, unknown>;
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeProviderId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length >= 3 ? normalized.slice(0, 179) : `provider-${hash(value).slice(0, 12)}`;
}

function httpsOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') ? value : null;
}

function requireCard(propertyCardId: number): PropertyCardRow {
  const card = getPropertyCardRow(propertyCardId);
  if (!card) throw new BridgeError('not_found', `canonical Property Card ${propertyCardId} was not found`);
  return card;
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function canonicalDisplayAddress(card: PropertyCardRow): string {
  const street = card.active_input_address.trim();
  const streetKey = normalizeAddressKey(street);
  const city = card.city.trim();
  const state = card.state.trim().toUpperCase();
  const zip = card.zip.trim();
  const parts = [street];
  if (city && !streetKey.includes(normalizeAddressKey(city))) parts.push(city);
  const stateZip = [state, zip].filter(Boolean).join(' ');
  if (stateZip && !streetKey.includes(normalizeAddressKey(stateZip))) parts.push(stateZip);
  return parts.join(', ');
}

function assertIdentity(value: z.infer<typeof identity>): { card: PropertyCardRow; dealCardId: number } {
  const card = requireCard(value.property_card_id);
  const incomingAddress = normalizeAddressKey(value.address);
  const allowedAddresses = new Set([
    normalizeAddressKey(card.active_input_address),
    normalizeAddressKey(canonicalDisplayAddress(card)),
  ]);
  if (!allowedAddresses.has(incomingAddress)) {
    throw new BridgeError('identity_conflict', 'incoming address does not match the canonical Property Card');
  }
  if (card.apn && (!value.apn || !apnEquivalent(card.apn, value.apn))) {
    throw new BridgeError('identity_conflict', 'incoming APN does not match the canonical Property Card');
  }
  if (card.lp_property_id && (!value.property_id || card.lp_property_id !== value.property_id)) {
    throw new BridgeError('identity_conflict', 'incoming LandPortal property id does not match the canonical Property Card');
  }
  const dealCardId = getDealCardIdForPropertyCard(card.id);
  if (!dealCardId) throw new BridgeError('not_found', 'canonical Property Card is not linked to a Deal Card');
  return { card, dealCardId };
}

function canonicalInput(card: PropertyCardRow, dealCardId: number) {
  const address = canonicalDisplayAddress(card);
  return {
    propertyCardId: card.id,
    dealCardId,
    normalizedAddress: address,
    address,
    city: nullableText(card.city),
    county: nullableText(card.county),
    state: nullableText(card.state),
    zip: nullableText(card.zip),
    apn: nullableText(card.apn),
    fips: nullableText(card.fips),
    landPortalPropertyId: nullableText(card.lp_property_id),
  };
}

function categoryForEvidence(item: NormalizedPropertyEvidence, laneId = ''): z.infer<typeof category> {
  const text = `${laneId} ${item.field} ${item.kind}`.toLowerCase();
  if (item.kind === 'comp' || /comp/.test(text)) return 'comps';
  if (item.kind === 'visual' || /visual|imagery|map/.test(text)) return 'visuals';
  if (/zoning|land.use/.test(text)) return 'zoning';
  if (/wetland|flood|soil|terrain|slope|environment/.test(text)) return 'environmental';
  if (/access|road|utility|utilities/.test(text)) return 'access_utilities';
  if (/document|deed|title/.test(text)) return 'documents';
  if (/market/.test(text)) return 'market';
  return 'subject';
}

const categoryToSpecialist: Record<z.infer<typeof category>, SpecialistId> = {
  subject: 'parcel_identity',
  comps: 'comparables',
  visuals: 'evidence_visuals',
  market: 'market_intelligence',
  zoning: 'zoning_land_use',
  environmental: 'environmental_terrain',
  access_utilities: 'access_utilities',
  documents: 'evidence_visuals',
};

const specialistToCategory = new Map<SpecialistId, z.infer<typeof category>>(
  Object.entries(categoryToSpecialist).map(([key, value]) => [value, key as z.infer<typeof category>]),
);

function receipt(recordId: string, recordedAt: string) {
  return { accepted: true as const, record_id: recordId, recorded_at: recordedAt };
}

function providerResult(input: {
  recordHash: string;
  laneId: string;
  providerId: string;
  card: PropertyCardRow;
  dealCardId: number;
  completedAt: string;
  evidence: NormalizedPropertyEvidence[];
  status?: 'verified' | 'failed';
  failureReason?: string | null;
}): PropertyProviderResult {
  const status = input.status ?? 'verified';
  const valid = status === 'verified';
  return {
    contractVersion: 'property-provider-v1',
    runId: `mcp-${input.recordHash.slice(0, 32)}`,
    laneId: input.laneId,
    providerId: input.providerId,
    input: canonicalInput(input.card, input.dealCardId),
    execution: {
      attempted: true,
      startedAt: input.completedAt,
      completedAt: input.completedAt,
      durationMs: 0,
      result: null,
    },
    validation: {
      valid,
      subjectClassification: valid ? 'verified_subject' : 'no_match',
      checks: [{
        check: 'canonical_property_identity',
        passed: valid,
        reason: valid ? 'MCP payload matched the canonical Property Card before admission.' : input.failureReason ?? 'Research category failed.',
      }],
      rejectedEvidenceIds: [],
    },
    evidence: input.evidence,
    status,
    persistence: {
      attempted: false,
      persisted: false,
      retainedEvidenceCount: 0,
      rejectedEvidenceCount: 0,
      reason: null,
    },
    failureReason: input.failureReason ?? null,
  };
}

function persistProviderResult(result: PropertyProviderResult): PropertyProviderResult {
  const persisted = new PropertyResearchStore().persistProviderResult(result);
  if (!persisted.persistence.persisted) {
    throw new BridgeError('admission_rejected', persisted.persistence.reason || 'canonical Property Research admission rejected the result');
  }
  return persisted;
}

function acceptanceRoot(): string {
  const qaOverride = process.env.LANDOS_ACCEPTANCE_QA_ROOT?.trim();
  if (qaOverride) {
    if (process.env.LANDOS_STORAGE_MODE !== 'qa') {
      throw new BridgeError('policy_blocked', 'LANDOS_ACCEPTANCE_QA_ROOT is allowed only in isolated QA storage mode');
    }
    const resolved = path.resolve(qaOverride);
    const relation = path.relative(path.resolve(PROJECT_ROOT), resolved);
    if (relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation))) {
      throw new BridgeError('policy_blocked', 'QA acceptance root must remain outside the repository');
    }
    return resolved;
  }
  return path.join(path.resolve(PROJECT_ROOT), '.landos', 'acceptance');
}

function containedRunDirectory(runId: string): string {
  if (!safeId.safeParse(runId).success) throw new BridgeError('invalid_arguments', 'invalid acceptance run id');
  const root = acceptanceRoot();
  const directory = path.resolve(root, runId);
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new BridgeError('policy_blocked', 'acceptance run escaped its governed root');
  return directory;
}

const acceptanceJournal = z.object({
  schemaVersion: z.literal('1.0.0'),
  runId: safeId,
  contractId: z.string().min(3).max(160),
  propertyAddress: z.string().min(5).max(500),
  startedAt: isoTimestamp,
  revision: z.number().int().nonnegative(),
  claims: z.record(z.string(), acceptanceClaim),
  screenshotArtifacts: z.record(z.string(), acceptanceArtifact),
  refresh: acceptanceCheck.nullable(),
  restart: acceptanceCheck.nullable(),
  console: consoleResult.nullable(),
  network: networkResult.nullable(),
  submitted: z.boolean(),
  submittedAt: isoTimestamp.nullable(),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();

type AcceptanceJournal = z.infer<typeof acceptanceJournal>;

function journalPath(runId: string): string {
  const root = path.join(acceptanceRoot(), '.mcp-journals');
  const file = path.resolve(root, `${runId}.json`);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new BridgeError('policy_blocked', 'acceptance journal escaped its governed root');
  return file;
}

/**
 * Whether a failure to create the lock file means "someone else holds it right
 * now", rather than a real fault.
 *
 * `open(lock, 'wx')` reports EEXIST on POSIX when the lock is held. Windows has
 * a second way to say the same thing: a file that has been unlinked while a
 * handle is still open enters a delete-pending state, and opening it returns
 * ERROR_ACCESS_DENIED, which libuv maps to EPERM (EACCES on some paths). That
 * is exactly the window between another holder's close() and its unlink(), so
 * treating it as fatal turns ordinary contention into an intermittent failure
 * under parallel load. Both are contention, and both must wait for the lock.
 *
 * A genuine permission fault still surfaces: it simply does so as a bounded
 * `conflict` after the deadline, carrying the underlying code.
 */
export function isLockContention(code: string | undefined): boolean {
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES';
}

async function withJournalLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
  const root = path.join(acceptanceRoot(), '.mcp-journals');
  await mkdir(root, { recursive: true });
  const lock = path.resolve(root, `${runId}.lock`);
  const relative = path.relative(root, lock);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new BridgeError('policy_blocked', 'acceptance lock escaped its governed root');
  const deadline = Date.now() + 5_000;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let lastCode: string | undefined;
  while (!handle) {
    try {
      handle = await open(lock, 'wx');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!isLockContention(code)) throw error;
      lastCode = code;
      if (Date.now() >= deadline) {
        throw new BridgeError(
          'conflict',
          `acceptance run is busy with another immutable journal update (last lock error ${lastCode})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => undefined);
  }
}

async function loadAcceptanceRun(runId: string): Promise<{ directory: string; contract: Record<string, unknown>; journal: AcceptanceJournal }> {
  const directory = containedRunDirectory(runId);
  if (!existsSync(path.join(directory, 'acceptance-contract.json')) || !existsSync(journalPath(runId))) {
    throw new BridgeError('not_found', `acceptance run ${runId} was not found`);
  }
  const contract = await readFixedJson(path.join(directory, 'acceptance-contract.json'));
  const journal = acceptanceJournal.parse(await readFixedJson(journalPath(runId)));
  if (journal.runId !== runId || journal.contractId !== contract.contractId
    || normalizeAddressKey(journal.propertyAddress) !== normalizeAddressKey(String(dict(contract.property).normalizedAddress))) {
    throw new BridgeError('identity_conflict', 'acceptance journal does not match its contract or property');
  }
  return { directory, contract, journal };
}

async function saveJournal(journal: AcceptanceJournal): Promise<void> {
  const next = acceptanceJournal.parse({ ...journal, revision: journal.revision + 1 });
  await writeAtomic(journalPath(journal.runId), `${JSON.stringify(next, null, 2)}\n`);
  journal.revision = next.revision;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function recordSingleton<K extends 'refresh' | 'restart' | 'console' | 'network'>(
  runId: string,
  key: K,
  value: NonNullable<AcceptanceJournal[K]>,
  recordedAt: string,
): Promise<ReturnType<typeof receipt>> {
  return withJournalLock(runId, async () => {
    const { journal } = await loadAcceptanceRun(runId);
    if (journal.submitted) throw new BridgeError('conflict', 'submitted acceptance runs are immutable');
    (journal[key] as AcceptanceJournal[K]) = value as AcceptanceJournal[K];
    await saveJournal(journal);
    return receipt(`acceptance-${key}:${hash(value).slice(0, 32)}`, recordedAt);
  });
}

async function readFixedJson(file: string): Promise<Record<string, unknown>> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new BridgeError('policy_blocked', 'acceptance artifact must be a regular non-symlink file');
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  return dict(value);
}

async function writeAtomic(file: string, value: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, file);
}

interface AcceptancePackage {
  directory: string;
  contract: Record<string, unknown>;
  results: Record<string, unknown> | null;
}

async function acceptancePackages(): Promise<AcceptancePackage[]> {
  const root = acceptanceRoot();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const packages: AcceptancePackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name);
    const contractFile = path.join(directory, 'acceptance-contract.json');
    if (!existsSync(contractFile)) continue;
    try {
      const contract = await readFixedJson(contractFile);
      const errors = validateAcceptanceContract(contract) as string[];
      if (errors.length) continue;
      const resultsFile = path.join(directory, 'results.json');
      const results = existsSync(resultsFile) ? await readFixedJson(resultsFile) : null;
      packages.push({ directory, contract, results });
    } catch {
      // A malformed package is never projected into canonical MCP reads.
    }
  }
  const configured = path.join(PROJECT_ROOT, 'config', 'acceptance', '704-bell-known-defect.contract.json');
  if (existsSync(configured)) {
    try {
      const contract = await readFixedJson(configured);
      if ((validateAcceptanceContract(contract) as string[]).length === 0) {
        packages.push({ directory: path.dirname(configured), contract, results: null });
      }
    } catch {
      // The versioned contract validator remains authoritative.
    }
  }
  return packages.sort((a, b) => String(b.contract.createdAt ?? '').localeCompare(String(a.contract.createdAt ?? '')));
}

function sameAcceptanceProperty(card: PropertyCardRow, contract: Record<string, unknown>): boolean {
  const property = dict(contract.property);
  const contractAddress = normalizeAddressKey(String(property.address ?? ''));
  if (![normalizeAddressKey(card.active_input_address), normalizeAddressKey(canonicalDisplayAddress(card))].includes(contractAddress)) return false;
  const contractApn = nullableText(String(property.apn ?? ''));
  return !card.apn || !!contractApn && apnEquivalent(card.apn, contractApn);
}

function claimContractMap(contract: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const claims = Array.isArray(contract.claims) ? contract.claims.map(dict) : [];
  return new Map(claims.map((claim) => [String(claim.id), claim]));
}

function passIsDefensible(report: Record<string, unknown>): boolean {
  const claims = Array.isArray(report.claims) ? report.claims.map(dict) : [];
  const counts = Array.isArray(report.counts) ? report.counts.map(dict) : [];
  const refresh = dict(report.refresh);
  const restart = dict(report.restart);
  const contamination = dict(report.contamination);
  const consoleResult = dict(report.console);
  const network = dict(report.network);
  const lifecycle = dict(report.lifecycle);
  const freshness = dict(report.freshness);
  return claims.every((claim) => ['status', 'refreshResult', 'restartResult', 'contaminationResult'].every((key) => claim[key] === 'PASS'))
    && counts.every((count) => count.canonicalAccepted === count.displayed && count.displayed === count.renderedRows && !(Number(count.canonicalAccepted) > 0 && count.emptyStateVisible === true))
    && refresh.status === 'PASS' && refresh.visibleValuesRetained === true
    && restart.status === 'PASS' && restart.visibleValuesRetained === true
    && contamination.status === 'PASS' && Array.isArray(contamination.detectedValues) && contamination.detectedValues.length === 0
    && consoleResult.relevantErrorCount === 0
    && network.requiredFailureCount === 0
    && lifecycle.isolatedContext === true
    && lifecycle.contextsCreated === lifecycle.contextsClosed
    && lifecycle.pagesCreated === lifecycle.pagesClosed
    && lifecycle.normalOperatorBrowserUntouched === true
    && lifecycle.cleanupCompleted === true
    && (freshness.required !== true || freshness.isFresh === true);
}

async function validateArtifactFiles(directory: string, report: Record<string, unknown>): Promise<void> {
  const artifacts = Array.isArray(report.artifacts) ? report.artifacts.map(dict) : [];
  const seen = new Set<string>();
  const allowed = new Set(['new-lead.png', 'deal-card-loaded.png', 'changed-section.png', 'relevant-tab-or-panel.png', 'after-refresh.png', 'after-restart.png', 'trace.zip', 'video.webm', 'console.json', 'network-failures.json']);
  for (const artifact of artifacts) {
    const name = String(artifact.path ?? '');
    if (!allowed.has(name) || seen.has(name)) throw new BridgeError('admission_rejected', `undeclared or duplicate acceptance artifact ${JSON.stringify(name)}`);
    seen.add(name);
    await validateOneArtifactFile(directory, artifact);
  }
  if (seen.size !== allowed.size) throw new BridgeError('admission_rejected', 'complete metadata for the ten captured acceptance artifacts is required');
  const inspectedConsole = inspectConsoleCapture(JSON.parse(await readFile(path.join(directory, 'console.json'), 'utf8')));
  const inspectedNetwork = inspectNetworkCapture(JSON.parse(await readFile(path.join(directory, 'network-failures.json'), 'utf8')));
  if (inspectedConsole.relevantErrorCount !== dict(report.console).relevantErrorCount) {
    throw new BridgeError('admission_rejected', 'console summary differs from inspected console.json');
  }
  if (inspectedNetwork.requiredFailureCount !== dict(report.network).requiredFailureCount) {
    throw new BridgeError('admission_rejected', 'network summary differs from inspected network-failures.json');
  }
}

async function validateOneArtifactFile(directory: string, artifact: Record<string, unknown>): Promise<void> {
  const name = String(artifact.path ?? '');
  const file = path.join(directory, name);
  const relative = path.relative(directory, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new BridgeError('policy_blocked', 'acceptance artifact escaped its run directory');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new BridgeError('admission_rejected', `${name} must be a regular non-symlink file`);
  const bytes = await readFile(file);
  if (bytes.byteLength !== artifact.byteLength) throw new BridgeError('admission_rejected', `${name} byte length differs from submitted metadata`);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new BridgeError('admission_rejected', `${name} SHA-256 differs from submitted metadata`);
  let inspection: { errors: string[]; width?: number; height?: number; uniqueColorSamples?: number; relevantErrorCount?: number; requiredFailureCount?: number } = { errors: [] };
  if (name.endsWith('.png')) inspection = inspectPng(bytes);
  else if (name === 'trace.zip') inspection = inspectTraceZip(bytes);
  else if (name === 'video.webm') inspection = inspectWebm(bytes);
  else if (name === 'console.json') inspection = inspectConsoleCapture(JSON.parse(bytes.toString('utf8')));
  else if (name === 'network-failures.json') inspection = inspectNetworkCapture(JSON.parse(bytes.toString('utf8')));
  if (inspection.errors.length) throw new BridgeError('admission_rejected', `${name} content failed canonical inspection: ${inspection.errors.join('; ')}`);
  const content = dict(artifact.contentValidation);
  if (name.endsWith('.png') && (content.width !== inspection.width || content.height !== inspection.height || content.uniqueColorSamples !== inspection.uniqueColorSamples)) {
    throw new BridgeError('admission_rejected', `${name} visual metadata differs from inspected content`);
  }
  if (name === 'console.json' && artifact.path === 'console.json' && inspection.relevantErrorCount !== undefined) {
    // The final report equality check binds this inspected file to its journaled summary.
  }
  if (name === 'network-failures.json' && inspection.requiredFailureCount !== undefined) {
    // The final report equality check binds this inspected file to its journaled summary.
  }
}

async function validateExactPackageFiles(directory: string): Promise<void> {
  const expected = new Set(['acceptance-contract.json', 'acceptance-report.md', 'results.json', 'new-lead.png', 'deal-card-loaded.png', 'changed-section.png', 'relevant-tab-or-panel.png', 'after-refresh.png', 'after-restart.png', 'trace.zip', 'video.webm', 'console.json', 'network-failures.json']);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) {
    throw new BridgeError('admission_rejected', 'acceptance package must contain exactly the 13 regular required artifacts');
  }
}

async function execute(operation: LandosBridgeOperation, args: Record<string, unknown>): Promise<unknown> {
  switch (operation) {
    case 'get_property_context': {
      const propertyCardId = Number(args.property_card_id);
      const card = getPropertyCard(propertyCardId);
      if (!card) throw new BridgeError('not_found', `canonical Property Card ${propertyCardId} was not found`);
      const propertyId = /^[1-9][0-9]{3,19}$/.test(card.lp_property_id) ? card.lp_property_id : null;
      return {
        identity: { property_card_id: card.id, address: canonicalDisplayAddress(card), apn: nullableText(card.apn), property_id: propertyId },
        deal_card_id: getDealCardIdForPropertyCard(card.id) ?? null,
        county: nullableText(card.county),
        state: /^[A-Z]{2}$/.test(card.state) ? card.state : null,
        canonical: card.verification_status === 'verified_property',
        retrieved_at: new Date().toISOString(),
      };
    }
    case 'get_accepted_evidence': {
      const propertyCardId = Number(args.property_card_id);
      requireCard(propertyCardId);
      const requestedCategory = args.category as z.infer<typeof category> | null;
      const limit = Number(args.limit);
      const record = new PropertyResearchStore().loadForProperty(propertyCardId);
      const laneByProvider = new Map(Object.values(record?.lanes ?? {}).map((lane) => [lane.providerId, lane.laneId]));
      const all = (record?.evidence ?? []).flatMap((item) => {
        if (!item.validation.valid || item.subjectClassification !== 'verified_subject' || item.strength === 'context_only' || item.kind === 'estimate') return [];
        const evidenceCategory = categoryForEvidence(item, laneByProvider.get(item.providerId) ?? '');
        if (requestedCategory && requestedCategory !== evidenceCategory) return [];
        const value = item.value == null || ['string', 'number', 'boolean'].includes(typeof item.value)
          ? item.value as string | number | boolean | null
          : JSON.stringify(item.value);
        return [{
          evidence_id: safeProviderId(item.id),
          property_card_id: item.propertyCardId,
          category: evidenceCategory,
          kind: item.kind,
          field: item.field.slice(0, 500),
          value,
          source_url: httpsOrNull(item.sourceUrl),
          strength: item.strength,
          retrieved_at: item.retrievedAt,
        }];
      });
      return { items: all.slice(0, limit), total: all.length, truncated: all.length > limit };
    }
    case 'get_provider_and_specialist_status': {
      const propertyCardId = Number(args.property_card_id);
      const card = requireCard(propertyCardId);
      const specialists: Array<Record<string, unknown>> = [];
      const research = new PropertyResearchStore().loadForProperty(propertyCardId);
      for (const lane of Object.values(research?.lanes ?? {})) {
        const status = lane.latestAttemptStatus === 'context_only' ? 'unavailable' : lane.latestAttemptStatus;
        specialists.push({
          category: categoryForEvidence({ kind: 'status', field: lane.laneId } as NormalizedPropertyEvidence, lane.laneId),
          provider_id: safeProviderId(lane.providerId),
          status,
          started_at: null,
          completed_at: lane.latestAttemptAt,
          note: lane.latestFailureReason || `Canonical provider lane ${lane.laneId}: ${lane.latestAttemptStatus}.`,
        });
      }
      const dealCardId = getDealCardIdForPropertyCard(card.id);
      if (dealCardId) {
        const store = new PropertyIntelligenceStore();
        const run = store.latestRun(dealCardId);
        if (run) {
          for (const row of store.listSpecialists(run.runId)) {
            const mappedCategory = specialistToCategory.get(row.id);
            if (!mappedCategory) continue;
            const status = row.status === 'queued' ? 'pending'
              : row.status === 'completed' || row.status === 'partial' ? 'verified'
                : row.status === 'blocked' || row.status === 'skipped' ? 'unavailable'
                  : row.status;
            specialists.push({
              category: mappedCategory,
              provider_id: safeProviderId(`property-intelligence:${row.id}`),
              status,
              started_at: row.startedAt,
              completed_at: row.completedAt,
              note: row.summary || row.failureMessage || `Property Intelligence specialist ${row.label}.`,
            });
          }
        }
      }
      return { property_card_id: propertyCardId, specialists, retrieved_at: new Date().toISOString() };
    }
    case 'get_acceptance_expectations': {
      const propertyCardId = Number(args.property_card_id);
      const card = requireCard(propertyCardId);
      const wantedSprint = args.sprint_name as string | null;
      const match = (await acceptancePackages()).find((item) => sameAcceptanceProperty(card, item.contract) && (!wantedSprint || item.contract.sprintName === wantedSprint));
      if (!match) throw new BridgeError('not_found', 'no canonical acceptance contract matches this Property Card and sprint');
      return {
        property_card_id: propertyCardId,
        contract_id: match.contract.contractId,
        sprint_name: match.contract.sprintName,
        independent_authority: match.contract.independentAuthority,
        claims: (match.contract.claims as Array<Record<string, unknown>>).map((claim) => ({
          claim_id: claim.id,
          operator_section: claim.operatorSection,
          claim: claim.claim,
          expected_binding: claim.expectedBinding,
          expected_value: claim.expectedValue,
          evidence_artifacts: claim.evidenceArtifacts,
        })),
      };
    }
    case 'get_visible_and_canonical_counts': {
      const propertyCardId = Number(args.property_card_id);
      const card = requireCard(propertyCardId);
      const match = (await acceptancePackages()).find((item) => sameAcceptanceProperty(card, item.contract) && item.results && (validateAcceptanceResults(item.results) as string[]).length === 0);
      if (!match?.results) throw new BridgeError('not_found', 'no schema-valid canonical visual acceptance result matches this Property Card');
      const counts = (match.results.counts as Array<Record<string, unknown>>).map((count) => ({
        operator_section: count.operatorSection,
        label: count.label,
        canonical_accepted: count.canonicalAccepted,
        visible: count.displayed,
        rendered_rows: count.renderedRows,
        empty_state_visible: count.emptyStateVisible,
      }));
      return { property_card_id: propertyCardId, counts, retrieved_at: new Date().toISOString() };
    }
    case 'get_market_research_context': {
      const propertyCardId = Number(args.property_card_id);
      const scope = args.scope as 'state' | 'county' | 'zip' | 'acreage_band';
      const card = requireCard(propertyCardId);
      const state = nullableText(card.state);
      const countyRef = card.fips?.length === 5
        ? { fips: card.fips }
        : resolveCountyRefByName(card.county, card.state);
      const keys: string[] = scope === 'state' ? state ? [`state:${state}`] : []
        : scope === 'county' ? countyRef ? [`county:${countyRef.fips}`] : []
          : scope === 'zip' ? card.zip ? [`zip:${card.zip}`] : []
            : [card.zip ? `zip:${card.zip}` : '', countyRef ? `county:${countyRef.fips}` : '', state ? `state:${state}` : ''].filter(Boolean);
      if (!keys.length) throw new BridgeError('not_found', `canonical Property Card lacks geography required for ${scope} market context`);
      let selected: MrGeoSummary | null = null;
      // Metric rows are append-only canonical records even while a quarterly
      // snapshot remains open for additive collection.
      for (const snapshot of listMrSnapshots()) {
        for (const key of keys) {
          selected = getMrGeoSummary(snapshot.id, key);
          if (selected) break;
        }
        if (selected) break;
      }
      if (!selected) throw new BridgeError('not_found', 'no retained canonical Market Research snapshot matches the requested scope');
      const source = httpsOrNull(selected.row.sourceRef);
      return {
        property_card_id: propertyCardId,
        scope,
        state,
        county: nullableText(card.county),
        zip: /^\d{5}$/.test(card.zip) ? card.zip : null,
        acreage_band: selected.snapshot.filters.acreageBand,
        metrics: selected.row.metrics,
        sources: source ? [source] : [],
        as_of: nullableText(selected.row.observedAt) || selected.snapshot.collectedAt,
      };
    }
    case 'get_source_registry_entries': {
      const requestedKind = args.kind as string | null;
      const jurisdiction = (args.jurisdiction as string | null)?.trim().toLowerCase() ?? null;
      const limit = Number(args.limit);
      const file = path.join(PROJECT_ROOT, 'config', 'landos-knowledge', 'registries', 'county-gis-source-registry.json');
      const registry = await readFixedJson(file);
      const classify = (sourceType: string): string => /assessor|tax/.test(sourceType) ? 'assessor'
        : /zoning/.test(sourceType) ? 'zoning'
          : /subdivision/.test(sourceType) ? 'subdivision'
            : /market/.test(sourceType) ? 'market'
              : /infrastructure|routing|road/.test(sourceType) ? 'infrastructure'
                : /development/.test(sourceType) ? 'development'
                  : /demographic/.test(sourceType) ? 'demographic' : 'gis';
      const all = (registry.entries as Array<Record<string, unknown>>).flatMap((entry) => {
        const entryKind = classify(String(entry.sourceType ?? ''));
        if (requestedKind && requestedKind !== entryKind) return [];
        if (jurisdiction && !String(entry.jurisdiction ?? '').toLowerCase().includes(jurisdiction)) return [];
        const domains = Array.isArray(entry.allowedDomains) ? entry.allowedDomains : [];
        const freshness = dict(entry.sourceFreshness);
        return [{
          source_id: safeProviderId(String(entry.id)),
          kind: entryKind,
          jurisdiction: entry.jurisdiction,
          official_domain: String(domains[0] ?? new URL(String(entry.url)).hostname),
          base_url: entry.url,
          status: String(entry.status).startsWith('official') || entry.status === 'approved-context' ? 'approved' : 'restricted',
          last_verified_at: `${freshness.verifiedAt}T00:00:00Z`,
        }];
      });
      return { entries: all.slice(0, limit), total: all.length, truncated: all.length > limit };
    }
    case 'begin_acceptance_run': {
      const contract = dict(args.contract);
      const errors = validateAcceptanceContract(contract) as string[];
      if (errors.length) throw new BridgeError('admission_rejected', `acceptance contract failed canonical validation: ${errors.join('; ')}`);
      const startedAt = new Date().toISOString();
      const timestamp = startedAt.replace(/[:.]/g, '-').toLowerCase();
      const sprintSlug = String(contract.sprintName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
      if (!sprintSlug) throw new BridgeError('invalid_arguments', 'acceptance sprint name cannot produce a safe run slug');
      const runId = `${timestamp}-${sprintSlug}`;
      const directory = containedRunDirectory(runId);
      await mkdir(acceptanceRoot(), { recursive: true });
      await mkdir(directory, { recursive: false });
      await writeAtomic(path.join(directory, 'acceptance-contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
      await mkdir(path.dirname(journalPath(runId)), { recursive: true });
      const journal: AcceptanceJournal = {
        schemaVersion: '1.0.0',
        runId,
        contractId: String(contract.contractId),
        propertyAddress: String(dict(contract.property).normalizedAddress),
        startedAt,
        revision: 0,
        claims: {},
        screenshotArtifacts: {},
        refresh: null,
        restart: null,
        console: null,
        network: null,
        submitted: false,
        submittedAt: null,
        reportHash: null,
      };
      await writeAtomic(journalPath(runId), `${JSON.stringify(acceptanceJournal.parse(journal), null, 2)}\n`);
      return { run_id: runId, contract_id: contract.contractId, authority: 'landos-visual-qa', state: 'recording', started_at: startedAt };
    }
    case 'record_visual_claim': {
      const runId = String(args.run_id);
      const claim = acceptanceClaim.parse(args.claim);
      return withJournalLock(runId, async () => {
      const { contract, journal } = await loadAcceptanceRun(runId);
      if (journal.submitted) throw new BridgeError('conflict', 'submitted acceptance runs are immutable');
      const expected = claimContractMap(contract).get(claim.claimId);
      if (!expected || claim.operatorSection !== expected.operatorSection || claim.claim !== expected.claim
        || !sameJson(claim.expectedValue, expected.expectedValue)
        || !sameJson(expected.expectedValue, resolveExpectedBinding(contract, expected.expectedBinding))
        || !(expected.evidenceArtifacts as unknown[]).includes(claim.evidencePath)
        || normalizeAddressKey(claim.propertyAddress) !== normalizeAddressKey(journal.propertyAddress)) {
        throw new BridgeError('admission_rejected', 'visual claim differs from its immutable contract or property identity');
      }
       journal.claims[claim.claimId] = claim;
       await saveJournal(journal);
      return receipt(`acceptance-claim:${hash(claim).slice(0, 32)}`, claim.timestamp);
      });
    }
    case 'record_screenshot_artifact': {
      const runId = String(args.run_id);
      const artifact = acceptanceArtifact.parse(args.artifact);
      if (!screenshotName.safeParse(artifact.path).success || artifact.contentValidation.kind !== 'screenshot') {
        throw new BridgeError('admission_rejected', 'record_screenshot_artifact accepts only the six fixed screenshot artifacts');
      }
      return withJournalLock(runId, async () => {
      const { directory, contract, journal } = await loadAcceptanceRun(runId);
      if (journal.submitted) throw new BridgeError('conflict', 'submitted acceptance runs are immutable');
      if (!(contract.requiredArtifacts as unknown[]).includes(artifact.path)) throw new BridgeError('admission_rejected', 'screenshot is not declared by the immutable contract');
      await validateOneArtifactFile(directory, artifact);
       journal.screenshotArtifacts[artifact.path] = artifact;
       await saveJournal(journal);
      return receipt(`acceptance-artifact:${hash(artifact).slice(0, 32)}`, artifact.capturedAt);
      });
    }
    case 'record_refresh_result': {
      const value = acceptanceCheck.parse(args.result);
      return recordSingleton(String(args.run_id), 'refresh', value, value.timestamp);
    }
    case 'record_restart_result': {
      const value = acceptanceCheck.parse(args.result);
      return recordSingleton(String(args.run_id), 'restart', value, value.timestamp);
    }
    case 'record_console_result': {
      const value = consoleResult.parse(args.result);
      return recordSingleton(String(args.run_id), 'console', value, value.timestamp);
    }
    case 'record_network_result': {
      const value = networkResult.parse(args.result);
      return recordSingleton(String(args.run_id), 'network', value, value.timestamp);
    }
    case 'submit_pass_or_fail_report': {
      const runId = String(args.run_id);
      const report = dict(args.report);
      return withJournalLock(runId, async () => {
      const { directory, contract, journal } = await loadAcceptanceRun(runId);
      const errors = validateAcceptanceResults(report) as string[];
      if (errors.length) throw new BridgeError('admission_rejected', `acceptance results failed canonical validation: ${errors.join('; ')}`);
      const reportHash = hash(report);
      if (journal.submitted) {
        if (journal.reportHash !== reportHash || !journal.submittedAt) throw new BridgeError('conflict', 'submitted acceptance runs are immutable');
        return { accepted: true, run_id: runId, verdict: report.verdict, submitted_at: journal.submittedAt, immutable: true };
      }
      if (report.runId !== runId || report.contractId !== contract.contractId
        || report.sprintName !== contract.sprintName || report.mode !== dict(contract.runPolicy).mode
        || report.startedAt !== journal.startedAt) {
        throw new BridgeError('identity_conflict', 'acceptance report run, contract, sprint, mode, or start time differs from the immutable run');
      }
      if (normalizeAddressKey(String(report.propertyAddress)) !== normalizeAddressKey(String(dict(contract.property).normalizedAddress))) {
        throw new BridgeError('identity_conflict', 'acceptance report belongs to a different property');
      }
      if (dict(report.freshness).required !== dict(contract.runPolicy).freshnessRequired) {
        throw new BridgeError('admission_rejected', 'acceptance report freshness requirement contradicts the immutable contract');
      }
      const expectedClaims = claimContractMap(contract);
      const claims = (report.claims as Array<Record<string, unknown>>).map(dict);
      if (claims.length !== expectedClaims.size || new Set(claims.map((claim) => claim.claimId)).size !== expectedClaims.size) {
        throw new BridgeError('admission_rejected', 'acceptance report must contain every immutable contract claim exactly once');
      }
      for (const claim of claims) {
        const expected = expectedClaims.get(String(claim.claimId));
        if (!expected || claim.operatorSection !== expected.operatorSection || claim.claim !== expected.claim || claim.expectedValue !== expected.expectedValue
          || !sameJson(expected.expectedValue, resolveExpectedBinding(contract, expected.expectedBinding))
          || !(expected.evidenceArtifacts as unknown[]).includes(claim.evidencePath)) {
          throw new BridgeError('admission_rejected', `acceptance claim ${String(claim.claimId)} differs from its immutable contract`);
        }
      }
      if (Object.keys(journal.claims).length !== expectedClaims.size || claims.some((claim) => !sameJson(journal.claims[String(claim.claimId)], claim))) {
        throw new BridgeError('admission_rejected', 'final claim results must exactly equal the complete immutable MCP journal');
      }
      const reportArtifacts = new Map((report.artifacts as Array<Record<string, unknown>>).map((artifact) => [String(artifact.path), artifact]));
      if (Object.keys(journal.screenshotArtifacts).length !== 6
        || Object.entries(journal.screenshotArtifacts).some(([name, artifact]) => !sameJson(reportArtifacts.get(name), artifact))) {
        throw new BridgeError('admission_rejected', 'final screenshot metadata must exactly equal all six immutable journal records');
      }
      if (!journal.refresh || !journal.restart || !journal.console || !journal.network
        || !sameJson(journal.refresh, report.refresh) || !sameJson(journal.restart, report.restart)
        || !sameJson(journal.console, report.console) || !sameJson(journal.network, report.network)) {
        throw new BridgeError('admission_rejected', 'final refresh, restart, console, and network results must exactly equal the complete MCP journal');
      }
      const defensible = passIsDefensible(report);
      if (report.verdict === 'PASS' && !defensible) throw new BridgeError('admission_rejected', 'PASS is not defensible from the submitted acceptance evidence');
      if (report.verdict === 'FAIL' && defensible) throw new BridgeError('admission_rejected', 'FAIL report contains no failing acceptance condition');
      await validateArtifactFiles(directory, report);
      const before = await readdir(directory, { withFileTypes: true });
      const captureSet = new Set(['acceptance-contract.json', 'new-lead.png', 'deal-card-loaded.png', 'changed-section.png', 'relevant-tab-or-panel.png', 'after-refresh.png', 'after-restart.png', 'trace.zip', 'video.webm', 'console.json', 'network-failures.json']);
      if (before.length !== captureSet.size || before.some((entry) => !captureSet.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) {
        throw new BridgeError('admission_rejected', 'pre-submission package must contain exactly the contract and ten captured artifacts');
      }
      await writeAtomic(path.join(directory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
      await writeAtomic(path.join(directory, 'acceptance-report.md'), renderAcceptanceReport(contract, report) as string);
      await validateExactPackageFiles(directory);
      const submittedAt = new Date().toISOString();
      journal.submitted = true;
      journal.submittedAt = submittedAt;
      journal.reportHash = reportHash;
      await saveJournal(journal);
      return { accepted: true, run_id: runId, verdict: report.verdict, submitted_at: submittedAt, immutable: true };
      });
    }
    case 'save_verified_property_fact': {
      const value = fact.parse(args.fact);
      const { card, dealCardId } = assertIdentity(value.identity);
      const recordHash = hash(value);
      const evidence: NormalizedPropertyEvidence = {
        id: `mcp-fact:${recordHash.slice(0, 32)}`,
        propertyCardId: card.id,
        dealCardId,
        providerId: value.provider_id,
        field: value.field,
        value: value.value,
        subjectClassification: 'verified_subject',
        strength: value.strength,
        sourceUrl: value.source_url,
        retrievedAt: value.retrieved_at,
        confidence: 'high',
        kind: 'fact',
        validation: { valid: true, reasons: [] },
      };
      persistProviderResult(providerResult({ recordHash, laneId: `mcp-${value.category}-evidence`, providerId: value.provider_id, card, dealCardId, completedAt: value.retrieved_at, evidence: [evidence] }));
      return receipt(evidence.id, value.retrieved_at);
    }
    case 'save_verified_comp': {
      const value = comp.parse(args.comp);
      const { card, dealCardId } = assertIdentity(value.identity);
      const recordHash = hash(value);
      const evidence: NormalizedPropertyEvidence = {
        id: `mcp-comp:${recordHash.slice(0, 32)}`,
        propertyCardId: card.id,
        dealCardId,
        providerId: value.provider_id,
        field: `comps.${recordHash.slice(0, 20)}`,
        value: {
          price: value.price,
          acres: value.acres,
          apn: value.apn,
          address: value.address,
          pricePerAcre: value.price_per_acre ?? value.price / value.acres,
          saleDate: value.sale_date,
        },
        subjectClassification: 'verified_subject',
        strength: 'provider_verified',
        sourceUrl: value.source_url,
        retrievedAt: value.retrieved_at,
        confidence: 'high',
        kind: 'comp',
        validation: { valid: true, reasons: [] },
      };
      persistProviderResult(providerResult({ recordHash, laneId: 'mcp-comps-evidence', providerId: value.provider_id, card, dealCardId, completedAt: value.retrieved_at, evidence: [evidence] }));
      return receipt(evidence.id, value.retrieved_at);
    }
    case 'save_verified_visual_artifact': {
      const value = visual.parse(args.artifact);
      const { card, dealCardId } = assertIdentity(value.identity);
      const recordHash = hash(value);
      const evidence: NormalizedPropertyEvidence = {
        id: `mcp-visual:${recordHash.slice(0, 32)}`,
        propertyCardId: card.id,
        dealCardId,
        providerId: value.provider_id,
        field: `visuals.${value.key}`,
        value: {
          key: value.key,
          label: value.label,
          purpose: value.purpose,
          artifactPath: value.artifact_path,
          requestedView: value.requested_view,
          activeView: value.active_view,
          boundaryVisible: value.boundary_visible,
          cameraScale: value.camera_scale,
        },
        subjectClassification: 'verified_subject',
        strength: 'provider_verified',
        sourceUrl: null,
        retrievedAt: value.captured_at,
        confidence: 'high',
        kind: 'visual',
        validation: { valid: true, reasons: [] },
        artifactHash: value.sha256,
        viewUrl: null,
      };
      persistProviderResult(providerResult({ recordHash, laneId: 'mcp-visuals-evidence', providerId: value.provider_id, card, dealCardId, completedAt: value.captured_at, evidence: [evidence] }));
      return receipt(evidence.id, value.captured_at);
    }
    case 'report_specialist_progress': {
      const value = progress.parse(args.progress);
      const { dealCardId } = assertIdentity(value.identity);
      const store = new PropertyIntelligenceStore();
      const run = store.activeRun(dealCardId);
      if (!run) throw new BridgeError('not_found', 'no active canonical Property Intelligence run can receive specialist progress');
      const specialistId = categoryToSpecialist[value.category];
      if (!store.listSpecialists(run.runId).some((row) => row.id === specialistId)) {
        throw new BridgeError('not_found', `active Property Intelligence run has no ${specialistId} specialist`);
      }
      store.updateSpecialist({
        runId: run.runId,
        specialistId,
        status: value.status === 'pending' ? 'queued' : 'running',
        summary: value.note,
        startedAt: value.status === 'running' ? value.reported_at : null,
        result: { providerId: value.provider_id, category: value.category, progressPercent: value.progress_percent, reportedAt: value.reported_at },
      });
      return receipt(`mcp-progress:${hash(value).slice(0, 32)}`, value.reported_at);
    }
    case 'complete_or_fail_research_category': {
      const value = categoryResult.parse(args.result);
      const { card, dealCardId } = assertIdentity(value.identity);
      const store = new PropertyIntelligenceStore();
      const run = store.activeRun(dealCardId);
      if (!run) throw new BridgeError('not_found', 'no active canonical Property Intelligence run can receive a terminal specialist result');
      const specialistId = categoryToSpecialist[value.category];
      if (!store.listSpecialists(run.runId).some((row) => row.id === specialistId)) {
        throw new BridgeError('not_found', `active Property Intelligence run has no ${specialistId} specialist`);
      }
      const laneId = `mcp-${value.category}`;
      // The terminal lane is single-assignment per property/category/provider.
      // Hash the entire validated handback so an exact retry is idempotent but
      // a changed outcome, summary, timestamp, or retained count conflicts.
      const recordHash = hash(value);
      const runId = `mcp-${recordHash.slice(0, 32)}`;
      const research = new PropertyResearchStore();
      const existing = research.listLaneAttempts(card.id).find((attempt) => attempt.laneId === laneId && attempt.providerId === value.provider_id && ['verified', 'failed'].includes(attempt.status));
      if (existing && existing.runId !== runId) throw new BridgeError('conflict', 'research category already has an immutable terminal result');
      if (!existing) {
        const evidence: NormalizedPropertyEvidence[] = value.outcome === 'complete' ? [{
          id: `mcp-status:${recordHash.slice(0, 32)}`,
          propertyCardId: card.id,
          dealCardId,
          providerId: value.provider_id,
          field: `research.${value.category}.status`,
          value: value.summary,
          subjectClassification: 'verified_subject',
          strength: 'provider_verified',
          sourceUrl: null,
          retrievedAt: value.completed_at,
          confidence: 'high',
          kind: 'status',
          validation: { valid: true, reasons: [] },
        }] : [];
        const result = providerResult({
          recordHash,
          laneId,
          providerId: value.provider_id,
          card,
          dealCardId,
          completedAt: value.completed_at,
          evidence,
          status: value.outcome === 'complete' ? 'verified' : 'failed',
          failureReason: value.outcome === 'failed' ? value.summary : null,
        });
        getLandosDb().transaction(() => {
          persistProviderResult(result);
          store.updateSpecialist({
            runId: run.runId,
            specialistId,
            status: (value.outcome === 'complete' ? 'completed' : 'failed') as SpecialistStatus,
            summary: value.summary,
            failureMessage: value.outcome === 'failed' ? value.summary : null,
            evidenceCount: value.retained_item_count,
            completedAt: value.completed_at,
            result: { providerId: value.provider_id, category: value.category, outcome: value.outcome, retainedItemCount: value.retained_item_count },
          });
        })();
      }
      return { accepted: true, category: value.category, outcome: value.outcome, recorded_at: value.completed_at };
    }
  }
}

export async function executeLandosBridgeOperation(operation: string, rawArguments: unknown): Promise<unknown> {
  if (!operationSet.has(operation)) throw new BridgeError('operation_denied', `operation ${JSON.stringify(operation)} is not in the fixed LandOS bridge allowlist`);
  const typedOperation = operation as LandosBridgeOperation;
  const parsed = argumentSchemas[typedOperation].safeParse(rawArguments);
  if (!parsed.success) throw new BridgeError('invalid_arguments', z.prettifyError(parsed.error));
  return execute(typedOperation, parsed.data as Record<string, unknown>);
}

async function readStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 2_000_000) throw new BridgeError('invalid_arguments', 'bridge request exceeds 2 MB');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const request = dict(await readStdin());
    const requestKeys = Object.keys(request);
    if (requestKeys.length !== 1 || requestKeys[0] !== 'arguments') throw new BridgeError('invalid_arguments', 'bridge request must contain only arguments');
    const result = await executeLandosBridgeOperation(process.argv[2] ?? '', request.arguments);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : 'bridge_failure';
    const message = error instanceof Error ? error.message : 'LandOS bridge failed';
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.exitCode = 1;
  }
}
