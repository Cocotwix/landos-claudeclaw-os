/**
 * Persistent County Capability Registry and verified browser-recipe history.
 *
 * A platform-family classification is not a support claim. `implementationStatus`
 * records whether a county is merely observed, fixture-tested, or proven live.
 * Recipes become current only after a successful, evidenced property lookup.
 */

import type Database from 'better-sqlite3';
import { getLandosDb } from './db.js';
import { redactAccountSecrets } from './government-account-manager.js';

export const COUNTY_PLATFORM_FAMILIES = [
  'arcgis',
  'schneider_beacon',
  'qpublic',
  'vision_government_solutions',
  'tyler_technologies',
  'mapgeo',
  'patriot_properties',
  'custom_county_portal',
  'unknown',
] as const;
export type CountyPlatformFamily = (typeof COUNTY_PLATFORM_FAMILIES)[number];

export const COUNTY_SEARCH_METHODS = ['address', 'apn', 'owner', 'coordinates', 'map'] as const;
export type CountySearchMethod = (typeof COUNTY_SEARCH_METHODS)[number];
export type CountyLoginRequirement = 'public' | 'account_optional' | 'account_required' | 'unknown';
export type CountyCaptchaState = 'none_observed' | 'present_human_required' | 'unknown';
export type CountyImplementationStatus = 'observed_only' | 'fixture_tested' | 'live_tested' | 'unsupported';
export type CountyManagedAccountState =
  | 'none'
  | 'existing_managed_account'
  | 'account_created'
  | 'verification_pending'
  | 'human_action_required'
  | 'access_blocked';
export type RegistryConfidence = 'low' | 'medium' | 'high';

export interface CountyEvidenceProvenance {
  sourceUrl: string;
  sourceLabel: string;
  observedAt: string;
  evidenceReference: string;
  classification: 'official' | 'government_platform' | 'operator_verified' | 'fixture';
}

export interface CountyCapability {
  state: string;
  county: string;
  officialGisUrl: string | null;
  assessorUrl: string | null;
  taxUrl: string | null;
  recorderUrl: string | null;
  planningZoningUrl: string | null;
  platformFamily: CountyPlatformFamily;
  implementationStatus: CountyImplementationStatus;
  supportedSearchMethods: CountySearchMethod[];
  loginRequirement: CountyLoginRequirement;
  managedAccountId: string | null;
  managedAccountState: CountyManagedAccountState;
  captchaState: CountyCaptchaState;
  availableLayers: string[];
  currentRecipeVersion: number | null;
  lastSuccessfulRun: string | null;
  lastVerifiedDate: string | null;
  knownFailureModes: string[];
  confidence: RegistryConfidence;
  evidenceProvenance: CountyEvidenceProvenance[];
  createdAt: string;
  updatedAt: string;
}

export type CountyRecipeAction =
  | 'navigate'
  | 'select_search_method'
  | 'fill_identifier'
  | 'submit'
  | 'wait_for_results'
  | 'select_result'
  | 'capture_evidence'
  | 'validate_fact';

export interface CountyRecipeStep {
  action: CountyRecipeAction;
  target?: string;
  url?: string;
  valueSource?: 'address' | 'apn' | 'owner' | 'county' | 'state' | 'zip';
  expected?: string;
  timeoutMs?: number;
}

export type CountyRecipeStatus = 'current' | 'stale' | 'superseded';

export interface CountyNavigationRecipe {
  state: string;
  county: string;
  version: number;
  status: CountyRecipeStatus;
  platformFamily: CountyPlatformFamily;
  searchMethods: CountySearchMethod[];
  steps: CountyRecipeStep[];
  verifiedAt: string;
  verifiedRunReference: string;
  evidenceProvenance: CountyEvidenceProvenance[];
  consecutiveFailures: number;
  lastFailureReason: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CountyCapabilityInput {
  state: string;
  county: string;
  officialGisUrl?: string | null;
  assessorUrl?: string | null;
  taxUrl?: string | null;
  recorderUrl?: string | null;
  planningZoningUrl?: string | null;
  platformFamily?: CountyPlatformFamily;
  implementationStatus?: CountyImplementationStatus;
  supportedSearchMethods?: CountySearchMethod[];
  loginRequirement?: CountyLoginRequirement;
  managedAccountId?: string | null;
  managedAccountState?: CountyManagedAccountState;
  captchaState?: CountyCaptchaState;
  availableLayers?: string[];
  knownFailureModes?: string[];
  confidence?: RegistryConfidence;
  evidenceProvenance: CountyEvidenceProvenance[];
}

export interface VerifiedRecipeInput {
  state: string;
  county: string;
  platformFamily: CountyPlatformFamily;
  searchMethods: CountySearchMethod[];
  steps: CountyRecipeStep[];
  verification: {
    status: 'successful';
    verifiedAt: string;
    runReference: string;
    validatedFacts: string[];
    evidenceProvenance: CountyEvidenceProvenance[];
  };
}

export class CountyCapabilityRegistry {
  constructor(
    private readonly db: Database.Database = getLandosDb(),
    private readonly now: () => Date = () => new Date(),
    private readonly staleAfterFailures = 2,
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS landos_county_capability (
        state                    TEXT NOT NULL,
        county                   TEXT NOT NULL,
        official_gis_url         TEXT,
        assessor_url             TEXT,
        tax_url                  TEXT,
        recorder_url             TEXT,
        planning_zoning_url      TEXT,
        platform_family          TEXT NOT NULL,
        implementation_status    TEXT NOT NULL,
        search_methods_json      TEXT NOT NULL,
        login_requirement        TEXT NOT NULL,
        managed_account_id       TEXT,
        managed_account_state    TEXT NOT NULL,
        captcha_state            TEXT NOT NULL,
        available_layers_json    TEXT NOT NULL,
        current_recipe_version   INTEGER,
        last_successful_run      TEXT,
        last_verified_date       TEXT,
        known_failure_modes_json TEXT NOT NULL,
        confidence               TEXT NOT NULL,
        evidence_json            TEXT NOT NULL,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL,
        PRIMARY KEY(state, county)
      );
      CREATE INDEX IF NOT EXISTS idx_landos_county_capability_platform
        ON landos_county_capability(platform_family, implementation_status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS landos_county_navigation_recipe (
        state                  TEXT NOT NULL,
        county                 TEXT NOT NULL,
        version                INTEGER NOT NULL,
        status                 TEXT NOT NULL,
        platform_family        TEXT NOT NULL,
        search_methods_json    TEXT NOT NULL,
        steps_json             TEXT NOT NULL,
        verified_at            TEXT NOT NULL,
        verified_run_reference TEXT NOT NULL,
        evidence_json          TEXT NOT NULL,
        consecutive_failures   INTEGER NOT NULL DEFAULT 0,
        last_failure_reason    TEXT,
        last_failure_at        TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        PRIMARY KEY(state, county, version)
      );
      CREATE INDEX IF NOT EXISTS idx_landos_county_recipe_current
        ON landos_county_navigation_recipe(state, county, status, version DESC);
    `);
  }

  upsert(input: CountyCapabilityInput): CountyCapability {
    const key = normalizeCountyKey(input);
    const previous = this.get(key.state, key.county);
    const now = this.isoNow();
    const record: CountyCapability = {
      state: key.state,
      county: key.county,
      officialGisUrl: normalizeOptionalUrl(input.officialGisUrl ?? previous?.officialGisUrl ?? null),
      assessorUrl: normalizeOptionalUrl(input.assessorUrl ?? previous?.assessorUrl ?? null),
      taxUrl: normalizeOptionalUrl(input.taxUrl ?? previous?.taxUrl ?? null),
      recorderUrl: normalizeOptionalUrl(input.recorderUrl ?? previous?.recorderUrl ?? null),
      planningZoningUrl: normalizeOptionalUrl(input.planningZoningUrl ?? previous?.planningZoningUrl ?? null),
      platformFamily: input.platformFamily ?? previous?.platformFamily ?? 'unknown',
      implementationStatus: input.implementationStatus ?? previous?.implementationStatus ?? 'observed_only',
      supportedSearchMethods: uniqueSearchMethods(input.supportedSearchMethods ?? previous?.supportedSearchMethods ?? []),
      loginRequirement: input.loginRequirement ?? previous?.loginRequirement ?? 'unknown',
      managedAccountId: cleanNullable(input.managedAccountId ?? previous?.managedAccountId ?? null),
      managedAccountState: input.managedAccountState ?? previous?.managedAccountState ?? 'none',
      captchaState: input.captchaState ?? previous?.captchaState ?? 'unknown',
      availableLayers: uniqueSafeStrings(input.availableLayers ?? previous?.availableLayers ?? []),
      currentRecipeVersion: previous?.currentRecipeVersion ?? null,
      lastSuccessfulRun: previous?.lastSuccessfulRun ?? null,
      lastVerifiedDate: previous?.lastVerifiedDate ?? null,
      knownFailureModes: uniqueSafeStrings(input.knownFailureModes ?? previous?.knownFailureModes ?? []),
      confidence: input.confidence ?? previous?.confidence ?? 'low',
      evidenceProvenance: normalizeEvidence(input.evidenceProvenance),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    assertSafeCapability(record);
    this.writeCapability(record);
    return this.get(key.state, key.county)!;
  }

  get(state: string, county: string): CountyCapability | null {
    const key = normalizeCountyKey({ state, county });
    const row = this.db.prepare('SELECT * FROM landos_county_capability WHERE state = ? AND county = ?')
      .get(key.state, key.county);
    return row ? capabilityFromRow(row as Record<string, unknown>) : null;
  }

  list(state?: string): CountyCapability[] {
    const rows = state
      ? this.db.prepare('SELECT * FROM landos_county_capability WHERE state = ? ORDER BY county').all(normalizeState(state))
      : this.db.prepare('SELECT * FROM landos_county_capability ORDER BY state, county').all();
    return (rows as Record<string, unknown>[]).map(capabilityFromRow);
  }

  /** Publish a new recipe only after an evidenced lookup successfully validated facts. */
  recordVerifiedRecipe(input: VerifiedRecipeInput): CountyNavigationRecipe {
    const key = normalizeCountyKey(input);
    const capability = this.get(key.state, key.county);
    if (!capability) throw new Error(`County capability ${key.county}, ${key.state} must exist before publishing a recipe.`);
    validateVerifiedRecipe(input);
    const now = this.isoNow();
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(
        'SELECT COALESCE(MAX(version), 0) AS version FROM landos_county_navigation_recipe WHERE state = ? AND county = ?',
      ).get(key.state, key.county) as { version: number };
      const version = Number(row.version) + 1;
      this.db.prepare(
        `UPDATE landos_county_navigation_recipe SET status = 'superseded', updated_at = ?
         WHERE state = ? AND county = ? AND status = 'current'`,
      ).run(now, key.state, key.county);
      this.db.prepare(`
        INSERT INTO landos_county_navigation_recipe (
          state, county, version, status, platform_family, search_methods_json, steps_json,
          verified_at, verified_run_reference, evidence_json, consecutive_failures,
          last_failure_reason, last_failure_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'current', ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
      `).run(
        key.state, key.county, version, input.platformFamily,
        JSON.stringify(uniqueSearchMethods(input.searchMethods)), JSON.stringify(input.steps),
        normalizeIso(input.verification.verifiedAt), clean(input.verification.runReference),
        JSON.stringify(normalizeEvidence(input.verification.evidenceProvenance)), now, now,
      );
      this.db.prepare(`
        UPDATE landos_county_capability
        SET current_recipe_version = ?, last_successful_run = ?, last_verified_date = ?,
            platform_family = ?, updated_at = ?
        WHERE state = ? AND county = ?
      `).run(
        version, clean(input.verification.runReference), normalizeIso(input.verification.verifiedAt),
        input.platformFamily, now, key.state, key.county,
      );
      return version;
    });
    const version = transaction();
    return this.getRecipe(key.state, key.county, version)!;
  }

  getRecipe(state: string, county: string, version: number): CountyNavigationRecipe | null {
    const key = normalizeCountyKey({ state, county });
    const row = this.db.prepare(
      'SELECT * FROM landos_county_navigation_recipe WHERE state = ? AND county = ? AND version = ?',
    ).get(key.state, key.county, version);
    return row ? recipeFromRow(row as Record<string, unknown>) : null;
  }

  recipeHistory(state: string, county: string): CountyNavigationRecipe[] {
    const key = normalizeCountyKey({ state, county });
    return (this.db.prepare(
      'SELECT * FROM landos_county_navigation_recipe WHERE state = ? AND county = ? ORDER BY version DESC',
    ).all(key.state, key.county) as Record<string, unknown>[]).map(recipeFromRow);
  }

  /** Returns only a current, recently verified recipe. Expired knowledge is marked stale. */
  getUsableRecipe(state: string, county: string, options: { maxAgeDays?: number; now?: Date } = {}): CountyNavigationRecipe | null {
    const key = normalizeCountyKey({ state, county });
    const row = this.db.prepare(
      `SELECT * FROM landos_county_navigation_recipe
       WHERE state = ? AND county = ? AND status = 'current' ORDER BY version DESC LIMIT 1`,
    ).get(key.state, key.county) as Record<string, unknown> | undefined;
    if (!row) return null;
    const recipe = recipeFromRow(row);
    const maxAgeMs = Math.max(1, options.maxAgeDays ?? 90) * 86_400_000;
    const now = options.now ?? this.now();
    if (now.getTime() - new Date(recipe.verifiedAt).getTime() > maxAgeMs) {
      this.markRecipeStale(key.state, key.county, recipe.version, 'Recipe verification is older than the allowed age.');
      return null;
    }
    return recipe;
  }

  recordRecipeSuccess(state: string, county: string, version: number, runReference: string, verifiedAt = this.isoNow()): CountyNavigationRecipe {
    const recipe = this.requireRecipe(state, county, version);
    if (recipe.status === 'superseded') throw new Error('A superseded county recipe cannot be reactivated as current.');
    const key = normalizeCountyKey({ state, county });
    const at = normalizeIso(verifiedAt);
    const run = clean(runReference);
    if (!run) throw new Error('A successful county run requires a safe run reference.');
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE landos_county_navigation_recipe
        SET status = 'current', consecutive_failures = 0, last_failure_reason = NULL,
            last_failure_at = NULL, verified_at = ?, verified_run_reference = ?, updated_at = ?
        WHERE state = ? AND county = ? AND version = ?
      `).run(at, run, this.isoNow(), key.state, key.county, version);
      this.db.prepare(`
        UPDATE landos_county_capability
        SET current_recipe_version = ?, last_successful_run = ?, last_verified_date = ?, updated_at = ?
        WHERE state = ? AND county = ?
      `).run(version, run, at, this.isoNow(), key.state, key.county);
    })();
    return this.getRecipe(key.state, key.county, version)!;
  }

  recordRecipeFailure(
    state: string,
    county: string,
    version: number,
    reason: string,
    options: { structuralChangeObserved?: boolean; failedAt?: string } = {},
  ): CountyNavigationRecipe {
    const recipe = this.requireRecipe(state, county, version);
    const key = normalizeCountyKey({ state, county });
    const failures = recipe.consecutiveFailures + 1;
    const stale = options.structuralChangeObserved || failures >= Math.max(1, this.staleAfterFailures);
    const safe = safeText(reason);
    const at = normalizeIso(options.failedAt ?? this.isoNow());
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE landos_county_navigation_recipe
        SET status = ?, consecutive_failures = ?, last_failure_reason = ?, last_failure_at = ?, updated_at = ?
        WHERE state = ? AND county = ? AND version = ?
      `).run(stale ? 'stale' : recipe.status, failures, safe, at, this.isoNow(), key.state, key.county, version);
      const capability = this.get(key.state, key.county);
      if (capability) {
        const failuresList = uniqueSafeStrings([...capability.knownFailureModes, safe]);
        this.db.prepare(`
          UPDATE landos_county_capability
          SET known_failure_modes_json = ?, current_recipe_version = ?, updated_at = ?
          WHERE state = ? AND county = ?
        `).run(JSON.stringify(failuresList), stale ? null : capability.currentRecipeVersion, this.isoNow(), key.state, key.county);
      }
    })();
    return this.getRecipe(key.state, key.county, version)!;
  }

  markRecipeStale(state: string, county: string, version: number, reason: string): CountyNavigationRecipe {
    const recipe = this.requireRecipe(state, county, version);
    const key = normalizeCountyKey({ state, county });
    const safe = safeText(reason);
    const now = this.isoNow();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE landos_county_navigation_recipe
        SET status = 'stale', last_failure_reason = ?, last_failure_at = ?, updated_at = ?
        WHERE state = ? AND county = ? AND version = ?
      `).run(safe, now, now, key.state, key.county, version);
      this.db.prepare(`
        UPDATE landos_county_capability SET current_recipe_version = NULL, updated_at = ?
        WHERE state = ? AND county = ? AND current_recipe_version = ?
      `).run(now, key.state, key.county, version);
    })();
    return { ...recipe, status: 'stale', lastFailureReason: safe, lastFailureAt: now, updatedAt: now };
  }

  private writeCapability(record: CountyCapability): void {
    this.db.prepare(`
      INSERT INTO landos_county_capability (
        state, county, official_gis_url, assessor_url, tax_url, recorder_url, planning_zoning_url,
        platform_family, implementation_status, search_methods_json, login_requirement,
        managed_account_id, managed_account_state, captcha_state, available_layers_json,
        current_recipe_version, last_successful_run, last_verified_date, known_failure_modes_json,
        confidence, evidence_json, created_at, updated_at
      ) VALUES (
        @state, @county, @officialGisUrl, @assessorUrl, @taxUrl, @recorderUrl, @planningZoningUrl,
        @platformFamily, @implementationStatus, @searchMethods, @loginRequirement,
        @managedAccountId, @managedAccountState, @captchaState, @availableLayers,
        @currentRecipeVersion, @lastSuccessfulRun, @lastVerifiedDate, @knownFailureModes,
        @confidence, @evidence, @createdAt, @updatedAt
      )
      ON CONFLICT(state, county) DO UPDATE SET
        official_gis_url = excluded.official_gis_url, assessor_url = excluded.assessor_url,
        tax_url = excluded.tax_url, recorder_url = excluded.recorder_url,
        planning_zoning_url = excluded.planning_zoning_url, platform_family = excluded.platform_family,
        implementation_status = excluded.implementation_status, search_methods_json = excluded.search_methods_json,
        login_requirement = excluded.login_requirement, managed_account_id = excluded.managed_account_id,
        managed_account_state = excluded.managed_account_state, captcha_state = excluded.captcha_state,
        available_layers_json = excluded.available_layers_json, current_recipe_version = excluded.current_recipe_version,
        last_successful_run = excluded.last_successful_run, last_verified_date = excluded.last_verified_date,
        known_failure_modes_json = excluded.known_failure_modes_json, confidence = excluded.confidence,
        evidence_json = excluded.evidence_json, updated_at = excluded.updated_at
    `).run({
      ...record,
      searchMethods: JSON.stringify(record.supportedSearchMethods), availableLayers: JSON.stringify(record.availableLayers),
      knownFailureModes: JSON.stringify(record.knownFailureModes), evidence: JSON.stringify(record.evidenceProvenance),
    });
  }

  private requireRecipe(state: string, county: string, version: number): CountyNavigationRecipe {
    const recipe = this.getRecipe(state, county, version);
    if (!recipe) throw new Error(`County recipe ${county}, ${state} v${version} was not found.`);
    return recipe;
  }

  private isoNow(): string { return this.now().toISOString(); }
}

/** Classifies common portal families; it does not assert the portal has a working recipe. */
export function identifyCountyPlatformFamily(input: { url: string; title?: string }): CountyPlatformFamily {
  const blob = `${input.url} ${input.title ?? ''}`.toLowerCase();
  if (/arcgis\.com|arcgisserver|featureserver|mapserver|experience\.arcgis/.test(blob)) return 'arcgis';
  if (/beacon\.schneidercorp|schneider\s+beacon/.test(blob)) return 'schneider_beacon';
  if (/qpublic\.net|\bqpublic\b/.test(blob)) return 'qpublic';
  if (/vgsi\.com|vision\s+government\s+solutions/.test(blob)) return 'vision_government_solutions';
  if (/tylertech|tyler\s+technologies|iasworld|eagleweb/.test(blob)) return 'tyler_technologies';
  if (/mapgeo\.io|\bmapgeo\b/.test(blob)) return 'mapgeo';
  if (/patriotproperties|patriot\s+properties/.test(blob)) return 'patriot_properties';
  if (/\.(gov|us)(?:[/:]|$)|county|assessor|gis/.test(blob)) return 'custom_county_portal';
  return 'unknown';
}

function validateVerifiedRecipe(input: VerifiedRecipeInput): void {
  if (input.verification.status !== 'successful') throw new Error('Only a successfully verified county workflow may become a recipe.');
  normalizeIso(input.verification.verifiedAt);
  if (!clean(input.verification.runReference)) throw new Error('A verified county recipe requires a run reference.');
  if (input.verification.validatedFacts.length === 0) throw new Error('A verified county recipe must validate at least one extracted fact.');
  if (input.verification.evidenceProvenance.length === 0) throw new Error('A verified county recipe requires evidence provenance.');
  if (input.steps.length === 0) throw new Error('A verified county recipe requires navigation steps.');
  for (const step of input.steps) validateRecipeStep(step);
  normalizeEvidence(input.verification.evidenceProvenance);
}

function validateRecipeStep(step: CountyRecipeStep): void {
  if (!['navigate', 'select_search_method', 'fill_identifier', 'submit', 'wait_for_results', 'select_result', 'capture_evidence', 'validate_fact'].includes(step.action)) {
    throw new Error(`Unsupported county recipe action: ${String(step.action)}`);
  }
  const blob = JSON.stringify(step);
  if (/password|passcode|otp|cookie|authorization|access.?token|refresh.?token|session.?id|credential/i.test(blob)
    || /[?&](token|code|key|secret|signature)=/i.test(blob)) {
    throw new Error('County navigation recipes cannot contain credentials, secrets, verification challenges, or session state.');
  }
  if (step.action === 'fill_identifier' && !step.valueSource) throw new Error('Identifier-fill steps must reference a safe intake field.');
  if (step.url) normalizeOptionalUrl(step.url);
  if (step.timeoutMs !== undefined && (!Number.isFinite(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 60_000)) {
    throw new Error('County recipe timeouts must be bounded between 100 and 60000 milliseconds.');
  }
}

function assertSafeCapability(record: CountyCapability): void {
  const blob = JSON.stringify(record);
  if (/password|passcode|verification(code|link)|otp|cookie|authorization|access.?token|refresh.?token|session.?id/i.test(blob)
    || /[?&](token|code|key|secret|signature)=/i.test(blob)) {
    throw new Error('County capability metadata cannot contain credentials, verification challenges, or authenticated session state.');
  }
}

function normalizeEvidence(input: CountyEvidenceProvenance[]): CountyEvidenceProvenance[] {
  return input.map((evidence) => {
    const item: CountyEvidenceProvenance = {
      sourceUrl: normalizeOptionalUrl(evidence.sourceUrl) ?? '',
      sourceLabel: safeText(evidence.sourceLabel),
      observedAt: normalizeIso(evidence.observedAt),
      evidenceReference: safeText(evidence.evidenceReference),
      classification: evidence.classification,
    };
    if (!item.sourceUrl || !item.sourceLabel || !item.evidenceReference) throw new Error('County evidence requires a source URL, label, and safe reference.');
    return item;
  });
}

function capabilityFromRow(row: Record<string, unknown>): CountyCapability {
  return {
    state: String(row.state), county: String(row.county), officialGisUrl: nullable(row.official_gis_url),
    assessorUrl: nullable(row.assessor_url), taxUrl: nullable(row.tax_url), recorderUrl: nullable(row.recorder_url),
    planningZoningUrl: nullable(row.planning_zoning_url), platformFamily: row.platform_family as CountyPlatformFamily,
    implementationStatus: row.implementation_status as CountyImplementationStatus,
    supportedSearchMethods: parseJson<CountySearchMethod[]>(row.search_methods_json, []),
    loginRequirement: row.login_requirement as CountyLoginRequirement, managedAccountId: nullable(row.managed_account_id),
    managedAccountState: row.managed_account_state as CountyManagedAccountState, captchaState: row.captcha_state as CountyCaptchaState,
    availableLayers: parseJson<string[]>(row.available_layers_json, []), currentRecipeVersion: nullableNumber(row.current_recipe_version),
    lastSuccessfulRun: nullable(row.last_successful_run), lastVerifiedDate: nullable(row.last_verified_date),
    knownFailureModes: parseJson<string[]>(row.known_failure_modes_json, []), confidence: row.confidence as RegistryConfidence,
    evidenceProvenance: parseJson<CountyEvidenceProvenance[]>(row.evidence_json, []), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function recipeFromRow(row: Record<string, unknown>): CountyNavigationRecipe {
  return {
    state: String(row.state), county: String(row.county), version: Number(row.version), status: row.status as CountyRecipeStatus,
    platformFamily: row.platform_family as CountyPlatformFamily,
    searchMethods: parseJson<CountySearchMethod[]>(row.search_methods_json, []),
    steps: parseJson<CountyRecipeStep[]>(row.steps_json, []), verifiedAt: String(row.verified_at),
    verifiedRunReference: String(row.verified_run_reference), evidenceProvenance: parseJson<CountyEvidenceProvenance[]>(row.evidence_json, []),
    consecutiveFailures: Number(row.consecutive_failures), lastFailureReason: nullable(row.last_failure_reason),
    lastFailureAt: nullable(row.last_failure_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function normalizeCountyKey(input: { state: string; county: string }): { state: string; county: string } {
  const state = normalizeState(input.state);
  const county = clean(input.county).replace(/\s+county$/i, '');
  if (!state || !county) throw new Error('County capability requires both state and county.');
  return { state, county };
}

function normalizeState(input: string): string { return clean(input).toUpperCase(); }
function uniqueSearchMethods(input: CountySearchMethod[]): CountySearchMethod[] {
  return [...new Set(input.filter((item) => (COUNTY_SEARCH_METHODS as readonly string[]).includes(item)))];
}
function uniqueSafeStrings(input: string[]): string[] { return [...new Set(input.map(safeText).filter(Boolean))]; }
function safeText(input: string): string { return redactAccountSecrets(clean(input)).slice(0, 500); }
function clean(input: string): string { return String(input ?? '').trim().replace(/\s+/g, ' '); }
function cleanNullable(input: string | null): string | null { const value = input === null ? '' : clean(input); return value || null; }
function normalizeOptionalUrl(input: string | null): string | null {
  if (!input) return null;
  const value = clean(input);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid county source URL: ${value}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('County source URLs must use HTTP or HTTPS.');
  if ([...url.searchParams.keys()].some((key) => /token|code|key|secret|signature|session/i.test(key))) {
    throw new Error('County source URLs cannot contain credential or session query parameters.');
  }
  return url.toString();
}
function normalizeIso(input: string): string {
  const date = new Date(input);
  if (!input || Number.isNaN(date.getTime())) throw new Error(`Invalid registry timestamp: ${input}`);
  return date.toISOString();
}
function nullable(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function parseJson<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value)) as T; } catch { return fallback; } }

