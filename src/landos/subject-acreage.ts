// LandOS — the ONE place the subject's governing acreage is decided.
//
// Root cause this module fixes: acreage was proven in the typed evidence store
// (`landos_property_evidence_item`) while the canonical read path
// (`operatorRecordFor` → `buildAcreageBasis`) still drew its inputs only from
// the legacy public-intelligence findings payload and `property_card.acres`.
// When a collector wrote evidence but neither legacy input was populated, the
// Deal Card header rendered the evidence projection's figure while Property,
// Valuation, Strategy, Subdivision and Market all reported "the subject acreage
// is not established" — one Deal Card, two acreage answers, both sincere.
//
// So the signals are read here, once, from every store that can legitimately
// carry a measurement, and handed to the existing shared `buildAcreageBasis`
// precedence. This module adds no new precedence rules of its own: it supplies
// inputs and returns what the shared basis concluded.
//
// It is also where an operator acceptance is recorded. `buildAcreageBasis` has
// always had an `operator_accepted` basis at the top of its precedence, and
// nothing in LandOS ever wrote one, so the highest-authority slot in the system
// was permanently empty and a stale official record outranked the operator.

import { getLandosDb } from './db.js';
import {
  buildAcreageBasis,
  governingAcreageOf,
  supersededAcreageOf,
  type AcreageBasisEntry,
  type AcreageBasisInput,
  type AcreageReconciliation,
  type AcreageSignal,
  type GoverningAcreage,
} from './acreage-basis.js';
import { appendDerivedEvidence } from './derived-intelligence-store.js';
import { dealFamilyFilter, resolveDealFamily } from './canonical-deal-family.js';
import { loadPropertyInspection } from './property-card.js';

/** The evidence domain acreage measurements are filed under. */
const ACREAGE_DOMAIN = 'assessor_gis';
/** The fact key an operator acceptance is written under. */
export const OPERATOR_ACCEPTED_ACREAGE_FACT = 'Operator-accepted governing acreage';
export const OPERATOR_ACCEPTANCE_COLLECTOR = 'operator-acreage-acceptance';

/** One acreage measurement, as retained, with everything needed to judge it. */
export interface SubjectAcreageSignal {
  basis: keyof Pick<AcreageBasisInput, 'assessed' | 'deeded' | 'surveyed' | 'gisGeometry' | 'provider' | 'operatorAccepted'>;
  acres: number;
  source: string;
  /** Where in LandOS this measurement was read from. */
  origin: 'evidence_item' | 'property_inspection' | 'property_card' | 'identity_version';
  /** Source-stated vintage where the source stated one; never a fetch time. */
  observedAt: string | null;
  evidenceId: number | null;
}

export interface SubjectAcreageResolution {
  governing: GoverningAcreage;
  reconciliation: AcreageReconciliation;
  /** Real, correctly sourced measurements the governing basis has retired. */
  superseded: AcreageBasisEntry[];
  /** Every signal that fed the basis, for diagnostics and audit. */
  signals: SubjectAcreageSignal[];
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  // A structured row (an operator acceptance carries its basis and supersession
  // alongside the figure) still has exactly one acreage in it.
  if (value && typeof value === 'object' && 'acres' in value) {
    return numeric((value as { acres: unknown }).acres);
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseJson(value: unknown): unknown {
  try { return JSON.parse(String(value ?? 'null')); } catch { return null; }
}

/**
 * A source-stated vintage, or null.
 *
 * `retrieved_at` is deliberately NOT accepted as a fallback. When LandOS fetched
 * a record says nothing about when the record was measured, and treating the
 * fetch time as an observation date is exactly what would let a provider's
 * cached pre-survey figure outrank a newer survey for being "fresher".
 */
function statedVintage(effectiveAt: unknown): string | null {
  const value = text(effectiveAt);
  if (!value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** The date an operator acceptance says its basis was measured. */
function acceptanceObservedAt(row: { normalized_value_json: string | null }): string | null {
  const payload = parseJson(row.normalized_value_json) as { observedAt?: unknown } | null;
  return statedVintage(payload?.observedAt);
}

interface AcreageEvidenceRow {
  id: number;
  fact_key: string | null;
  normalized_value_json: string | null;
  raw_value_json: string | null;
  source_name: string | null;
  source_tier: string | null;
  effective_at: string | null;
  retrieved_at: string | null;
}

/**
 * Which basis a retained fact key speaks for.
 *
 * Keyed on the fact key rather than on the source tier, because the tier says
 * how trustworthy the SOURCE is, not what the source measured. A provider that
 * republishes the county roll and a provider that computes its own polygon area
 * carry the same tier and mean entirely different things.
 */
function basisForFactKey(factKey: string): SubjectAcreageSignal['basis'] | null {
  const key = factKey.trim().toLowerCase();
  if (key === OPERATOR_ACCEPTED_ACREAGE_FACT.toLowerCase()) return 'operatorAccepted';
  if (/survey|plat/.test(key)) return 'surveyed';
  if (/deed/.test(key)) return 'deeded';
  if (/assessed acreage|assessor acreage|tax roll acreage/.test(key)) return 'assessed';
  if (/gis mapped acreage|mapped acreage|polygon acreage/.test(key)) return 'gisGeometry';
  if (/parcel-record acreage|calculated acreage|provider acreage|acres/.test(key)) return 'provider';
  return null;
}

/**
 * Within one basis, which retained measurement speaks for it.
 *
 * A parcel record's own stated acreage is a better reading of the parcel than
 * the same provider's polygon-derived calculation, so it wins the `provider`
 * slot. Everything not ranked keeps first-seen order.
 */
const PROVIDER_FACT_PREFERENCE = ['parcel-record acreage', 'acres', 'landportal calculated acreage', 'calc acres'];

function preferenceRank(factKey: string): number {
  const index = PROVIDER_FACT_PREFERENCE.indexOf(factKey.trim().toLowerCase());
  return index < 0 ? PROVIDER_FACT_PREFERENCE.length : index;
}

/** Every acreage measurement retained for this deal, newest identity version first. */
export function readSubjectAcreageSignals(dealCardId: number, propertyCardId: number | null): SubjectAcreageSignal[] {
  const signals: SubjectAcreageSignal[] = [];
  const seen = new Set<string>();
  const add = (signal: SubjectAcreageSignal): void => {
    const key = `${signal.basis}|${signal.acres}|${signal.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(signal);
  };

  let rows: AcreageEvidenceRow[] = [];
  try {
    const db = getLandosDb();
    // CANONICAL FAMILY READ. Acreage evidence written before this subject's
    // duplicate cards were canonicalized still carries the alias Deal Card id,
    // and `landos_property_evidence_item` is immutable, so those rows cannot be
    // moved onto the canonical card without weakening the protection that makes
    // them evidence at all. The operator's own accepted governing acreage —
    // the highest-authority basis in the system — was retained on an alias for
    // exactly this reason and was therefore invisible to the canonical card.
    //
    // The reach is deliberately narrow: the family is the canonical card plus
    // the aliases that explicitly resolve to it, never a broad union, so no
    // other property's measurement can enter this subject's acreage.
    const family = dealFamilyFilter(resolveDealFamily(db, dealCardId));
    rows = db.prepare(`
      SELECT id, fact_key, normalized_value_json, raw_value_json, source_name, source_tier,
             effective_at, retrieved_at
      FROM landos_property_evidence_item
      WHERE ${family.sql} AND domain = ?
      ORDER BY id DESC
    `).all(...family.params, ACREAGE_DOMAIN) as AcreageEvidenceRow[];
  } catch { /* evidence store unavailable — the other origins still answer */ }

  const candidates = rows
    .map((row) => {
      const factKey = text(row.fact_key) ?? '';
      const basis = factKey ? basisForFactKey(factKey) : null;
      if (!basis) return null;
      const acres = numeric(parseJson(row.normalized_value_json)) ?? numeric(parseJson(row.raw_value_json));
      if (acres == null) return null;
      return { row, factKey, basis, acres };
    })
    .filter((c): c is { row: AcreageEvidenceRow; factKey: string; basis: SubjectAcreageSignal['basis']; acres: number } => c != null)
    .sort((a, b) => preferenceRank(a.factKey) - preferenceRank(b.factKey));

  for (const candidate of candidates) {
    add({
      basis: candidate.basis,
      acres: candidate.acres,
      source: text(candidate.row.source_name) ?? 'Retained evidence',
      origin: 'evidence_item',
      observedAt: candidate.basis === 'operatorAccepted'
        // An acceptance carries the date its RELIED-UPON basis was measured —
        // the survey date, not when the operator typed it in. Falling back to
        // the row timestamp would date the survey to the moment it was recorded.
        ? acceptanceObservedAt(candidate.row) ?? statedVintage(candidate.row.effective_at) ?? text(candidate.row.retrieved_at)
        : statedVintage(candidate.row.effective_at),
      evidenceId: candidate.row.id,
    });
  }

  // The retained LandPortal parcel fact sheet, for cards whose collectors wrote
  // the inspection activity but not typed evidence rows.
  if (propertyCardId != null) {
    try {
      const facts = loadPropertyInspection(propertyCardId)?.parcelFacts ?? {};
      const record = numeric(facts.Acres);
      if (record != null) {
        add({ basis: 'provider', acres: record, source: 'LandPortal parcel record', origin: 'property_inspection', observedAt: null, evidenceId: null });
      }
      const calculated = numeric(facts['Calc Acres']);
      if (calculated != null) {
        add({ basis: 'provider', acres: calculated, source: 'LandPortal calculated acreage', origin: 'property_inspection', observedAt: null, evidenceId: null });
      }
    } catch { /* no retained inspection — not an acreage question */ }

    try {
      const row = getLandosDb()
        .prepare('SELECT acres, verification_source, verification_status FROM landos_property_card WHERE id = ?')
        .get(propertyCardId) as { acres?: unknown; verification_source?: unknown; verification_status?: unknown } | undefined;
      const acres = numeric(row?.acres);
      if (acres != null) {
        // The card's figure speaks for the assessor roll only when an official
        // record verified the card. An unverified lead's acreage is whatever the
        // intake or a provider supplied, and ranking it as `assessed` let a
        // listing's MLS acreage, once written onto the card, outrank the
        // provider's own parcel-record figure and present itself as official.
        const verified = text(row?.verification_status) === 'verified_property';
        add({
          basis: verified ? 'assessed' : 'provider',
          acres,
          source: text(row?.verification_source) ?? (verified ? 'Accepted property record' : 'Unverified property record'),
          origin: 'property_card',
          observedAt: null,
          evidenceId: null,
        });
      }
    } catch { /* card unreadable — the evidence rows already answered */ }
  }

  return signals;
}

/** The first signal for a basis, as an `AcreageSignal` for the shared builder. */
function signalFor(
  signals: readonly SubjectAcreageSignal[],
  basis: SubjectAcreageSignal['basis'],
  retiredReasons: ReadonlyMap<number, string>,
): AcreageSignal | null {
  const found = signals.find((s) => s.basis === basis);
  if (!found) return null;
  const retired = found.evidenceId != null ? retiredReasons.get(found.evidenceId) : undefined;
  return {
    value: found.acres,
    source: found.source,
    observedAt: found.observedAt,
    retiredBySettlingBasis: retired ? { reason: retired } : null,
  };
}

/**
 * Which retained measurements the current operator acceptance explicitly retires.
 *
 * The acceptance records this itself, because only the operator knows that a
 * given county or aggregator figure is pre-survey lag rather than a competing
 * current measurement. Nothing here infers it.
 */
function retiredEvidenceReasons(dealCardId: number): Map<number, string> {
  const reasons = new Map<number, string>();
  try {
    // Same canonical family as the signals above: the acceptance that names
    // which measurements it retires must be found wherever the signals were.
    const db = getLandosDb();
    const family = dealFamilyFilter(resolveDealFamily(db, dealCardId));
    const rows = db.prepare(`
      SELECT normalized_value_json FROM landos_property_evidence_item
      WHERE ${family.sql} AND domain = ? AND fact_key = ?
      ORDER BY id DESC LIMIT 1
    `).all(...family.params, ACREAGE_DOMAIN, OPERATOR_ACCEPTED_ACREAGE_FACT) as Array<{ normalized_value_json: string }>;
    const payload = parseJson(rows[0]?.normalized_value_json) as { supersedes?: Array<{ evidenceId?: unknown; reason?: unknown }> } | null;
    for (const entry of payload?.supersedes ?? []) {
      const id = Number(entry?.evidenceId);
      const reason = text(entry?.reason);
      if (Number.isInteger(id) && reason) reasons.set(id, reason);
    }
  } catch { /* no acceptance recorded — nothing is retired */ }
  return reasons;
}

/**
 * The governing acreage for this subject and the retained history behind it.
 *
 * Pure read. Never writes, never triggers collection, and never invents a
 * measurement: when nothing has been retained it returns a null governing value
 * so the consumer can say so honestly.
 */
export function resolveSubjectAcreage(dealCardId: number, propertyCardId: number | null): SubjectAcreageResolution {
  const signals = readSubjectAcreageSignals(dealCardId, propertyCardId);
  const retired = retiredEvidenceReasons(dealCardId);
  const reconciliation = buildAcreageBasis({
    operatorAccepted: signalFor(signals, 'operatorAccepted', retired),
    surveyed: signalFor(signals, 'surveyed', retired),
    deeded: signalFor(signals, 'deeded', retired),
    assessed: signalFor(signals, 'assessed', retired),
    gisGeometry: signalFor(signals, 'gisGeometry', retired),
    provider: signalFor(signals, 'provider', retired),
  });

  return {
    governing: governingAcreageOf(reconciliation),
    reconciliation,
    superseded: supersededAcreageOf(reconciliation),
    signals,
  };
}

/**
 * The retained signals shaped for `buildAcreageBasis`, or null when nothing has
 * been retained. Null lets a caller keep its existing fallback rather than
 * replacing a working basis with an empty one.
 */
export function subjectAcreageBasisInput(dealCardId: number, propertyCardId: number | null): AcreageBasisInput | null {
  const signals = readSubjectAcreageSignals(dealCardId, propertyCardId);
  if (signals.length === 0) return null;
  const retired = retiredEvidenceReasons(dealCardId);
  return {
    operatorAccepted: signalFor(signals, 'operatorAccepted', retired),
    surveyed: signalFor(signals, 'surveyed', retired),
    deeded: signalFor(signals, 'deeded', retired),
    assessed: signalFor(signals, 'assessed', retired),
    gisGeometry: signalFor(signals, 'gisGeometry', retired),
    provider: signalFor(signals, 'provider', retired),
  };
}

export interface OperatorAcreageAcceptance {
  dealCardId: number;
  acres: number;
  /** What the operator is relying on ("Signed boundary survey, 2026-08-17"). */
  basisLabel: string;
  /** When the relied-upon measurement was made, ISO-8601. */
  observedAt: string;
  /** Retained measurements this acceptance retires, each with the operator's reason. */
  supersedes?: ReadonlyArray<{ evidenceId: number; reason: string }>;
  /** Free-text note carried with the acceptance. */
  note?: string;
}

/**
 * Record an operator acceptance as the governing acreage.
 *
 * Written as ordinary retained evidence, so it carries a source, a date, a
 * confidence and an audit trail like every other fact, and so a later stronger
 * record can supersede it in turn. It states plainly that the operator is the
 * source: it never labels itself a survey LandOS has not actually read.
 */
export function recordOperatorAcceptedAcreage(input: OperatorAcreageAcceptance): { evidenceIds: number[]; skippedReason: string | null } {
  const acres = numeric(input.acres);
  if (acres == null) throw new Error('An accepted acreage must be a positive number.');
  const basisLabel = text(input.basisLabel);
  if (!basisLabel) throw new Error('An accepted acreage must name the basis the operator relied on.');
  const observedAt = statedVintage(input.observedAt);
  if (!observedAt) throw new Error('An accepted acreage must carry the date its basis was measured.');

  const supersedes = (input.supersedes ?? []).filter((s) => Number.isInteger(s.evidenceId) && text(s.reason));
  const result = appendDerivedEvidence({
    dealCardId: input.dealCardId,
    collectorKey: OPERATOR_ACCEPTANCE_COLLECTOR,
    actor: 'operator',
    rows: [{
      domain: ACREAGE_DOMAIN,
      evidenceKind: 'operator_acceptance',
      factKey: OPERATOR_ACCEPTED_ACREAGE_FACT,
      raw: { acres, basisLabel, observedAt, note: text(input.note) },
      normalized: { acres, basisLabel, observedAt, supersedes, note: text(input.note) },
      // Named for what it is. The operator is the source of the acceptance; the
      // document behind it is described, never claimed as read by LandOS.
      sourceName: `Operator-accepted governing acreage — ${basisLabel}`,
      sourceUrl: null,
      sourceTier: 'operator_statement',
      confidence: 'confirmed',
      retrievedAt: new Date().toISOString(),
      // One current acceptance per (value, basis, date): re-recording the same
      // decision is idempotent, a genuinely different decision is a new row.
      dedupeOn: `operator-acreage:${acres}:${basisLabel}:${observedAt}`,
    }],
  });
  return { evidenceIds: result.evidenceIds, skippedReason: result.skippedReason };
}
