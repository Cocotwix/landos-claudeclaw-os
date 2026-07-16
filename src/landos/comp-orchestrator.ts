// Parallel multi-provider comp mission — one shared orchestration primitive.
//
// Tyler's non-negotiable shape: comparable research runs across ALL approved
// providers (LandPortal visible rows, Zillow, Redfin, Realie, Realtor, county
// recorded sales, …) as ONE parallel, unified workflow. No provider is the
// whole mission; no provider failure ends the mission; providers never wait on
// each other to FETCH. Persistence/dedup stays ordered by the caller (the
// unified registry + landos_comp dedupe is order-sensitive by design).
//
// This module is pure orchestration + labeling helpers:
//   • runCompProvidersParallel — concurrent provider execution with a hard
//     per-provider time budget and a full provider-run audit.
//   • labeledPricePerAcre — the single PPA rule: Sold PPA / Asking PPA /
//     Pending Asking PPA, never shown when price or acreage is missing/invalid.
//   • distanceMilesFromSubject — straight-line distance when both ends have
//     coordinates (never fabricated when they don't).
//   • classifyNonSelected — every candidate that is NOT a selected primary comp
//     keeps a visible classification + reason (nothing silently discarded).

import type { CompRegistry, UniqueComp } from './comp-registry.js';
import { haversineMeters } from './parallel-resolution.js';

// ── Parallel provider execution ──────────────────────────────────────────────

export interface CompProviderJob {
  /** Operator-facing provider name ('Zillow', 'Redfin', 'LandPortal visible', …). */
  provider: string;
  /** Fetch-only work. MUST NOT persist — the caller persists in stable order. */
  run: () => Promise<unknown>;
}

export interface CompProviderRun {
  provider: string;
  status: 'succeeded' | 'failed' | 'timeout';
  /** The provider's raw result when it succeeded (caller knows its own type). */
  result: unknown;
  elapsedMs: number;
  note: string;
}

const DEFAULT_PROVIDER_BUDGET_MS = 180_000;

/**
 * Run every provider job CONCURRENTLY with a hard per-provider budget. A
 * provider that throws or exceeds its budget yields a failed/timeout run —
 * the mission always returns one run per job, in the jobs' order.
 */
export async function runCompProvidersParallel(
  jobs: CompProviderJob[],
  opts: { perProviderTimeoutMs?: number; now?: () => number } = {},
): Promise<CompProviderRun[]> {
  const budget = opts.perProviderTimeoutMs ?? DEFAULT_PROVIDER_BUDGET_MS;
  const now = opts.now ?? (() => Date.now());
  return Promise.all(jobs.map(async (job): Promise<CompProviderRun> => {
    const start = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CompProviderRun>((resolve) => {
      timer = setTimeout(() => resolve({
        provider: job.provider, status: 'timeout', result: null,
        elapsedMs: budget,
        note: `${job.provider} exceeded its ${Math.round(budget / 1000)}s budget; other providers were not affected.`,
      }), budget);
    });
    try {
      const result = await Promise.race([
        job.run().then((r): CompProviderRun => ({
          provider: job.provider, status: 'succeeded', result: r, elapsedMs: now() - start,
          note: `${job.provider} completed.`,
        })),
        timeout,
      ]);
      return result;
    } catch (err) {
      return {
        provider: job.provider, status: 'failed', result: null, elapsedMs: now() - start,
        note: `${job.provider} failed: ${err instanceof Error ? err.message : String(err)} — other providers were not affected.`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }));
}

// ── Price-per-acre labeling (the single shared PPA rule) ─────────────────────

export type PpaLabel = 'Sold PPA' | 'Asking PPA' | 'Pending Asking PPA';

export interface LabeledPpa {
  label: PpaLabel;
  /** Raw precision preserved. */
  value: number;
  /** Operator display, sensibly rounded (e.g. "$4,850/ac"). */
  display: string;
}

/**
 * The one PPA rule. Sold PPA = verified sale price ÷ verified acreage; Asking
 * PPA = current asking price ÷ acreage; Pending Asking PPA = last confirmed
 * asking price ÷ acreage. Returns null when price or acreage is missing,
 * invalid, zero, or negative — a PPA is never fabricated.
 */
export function labeledPricePerAcre(
  priceKind: string | null | undefined,
  price: number | null | undefined,
  acres: number | null | undefined,
): LabeledPpa | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return null;
  const kind = String(priceKind ?? '').toLowerCase();
  const label: PpaLabel = kind === 'sold' ? 'Sold PPA' : kind === 'pending' ? 'Pending Asking PPA' : 'Asking PPA';
  const value = price / acres;
  const rounded = value >= 10_000 ? Math.round(value / 100) * 100 : value >= 1_000 ? Math.round(value / 50) * 50 : Math.round(value);
  return { label, value, display: `$${rounded.toLocaleString('en-US')}/ac` };
}

// ── Distance ─────────────────────────────────────────────────────────────────

/** Straight-line miles between subject and comp; null unless BOTH have coords. */
export function distanceMilesFromSubject(
  subject: { lat?: number | null; lng?: number | null } | null | undefined,
  comp: { lat?: number | null; lng?: number | null } | null | undefined,
): number | null {
  const sLat = subject?.lat, sLng = subject?.lng, cLat = comp?.lat, cLng = comp?.lng;
  if (typeof sLat !== 'number' || typeof sLng !== 'number' || typeof cLat !== 'number' || typeof cLng !== 'number') return null;
  if (![sLat, sLng, cLat, cLng].every(Number.isFinite)) return null;
  const meters = haversineMeters({ lat: sLat, lng: sLng }, { lat: cLat, lng: cLng });
  return Math.round((meters / 1609.344) * 100) / 100;
}

// ── Non-selected candidate classification ────────────────────────────────────

export type NonSelectedClass =
  | 'secondary_sold'
  | 'small_lot_context'
  | 'large_acreage_context'
  | 'active_context'
  | 'weak_context'
  | 'duplicate'
  | 'rejected'
  | 'insufficient_data';

export interface NonSelectedCandidate {
  key: string | null;
  address: string | null;
  provider: string | null;
  classification: NonSelectedClass;
  reason: string;
}

/**
 * Every candidate that did NOT make the primary selected set keeps a visible
 * classification + why. Sold-but-not-selected stays a secondary sold comp (or
 * acreage-band context); actives stay asking-price context; the registry's
 * rejected/merged audits are surfaced as-is. Nothing is silently discarded.
 */
export function classifyNonSelected(
  registry: CompRegistry,
  selectedKeys: ReadonlySet<string>,
): NonSelectedCandidate[] {
  const out: NonSelectedCandidate[] = [];
  const classifyUnique = (c: UniqueComp, sold: boolean): NonSelectedCandidate => {
    let classification: NonSelectedClass;
    let reason: string;
    if (!sold) {
      classification = 'active_context';
      reason = 'Active listing — asking-price context only, never sold evidence.';
    } else if (c.comparability === 'small_lot_context') {
      classification = 'small_lot_context';
      reason = c.comparabilityWhy || 'Materially smaller than the subject — local context, not a direct comp.';
    } else if (c.comparability === 'large_acreage_context') {
      classification = 'large_acreage_context';
      reason = c.comparabilityWhy || 'Materially larger than the subject — local context, not a direct comp.';
    } else if (c.comparability === 'weak_context') {
      classification = 'weak_context';
      reason = c.comparabilityWhy || 'Usable market color only.';
    } else {
      classification = 'secondary_sold';
      reason = 'Qualified closed sale, outranked by the selected primary set.';
    }
    return { key: c.key, address: c.address, provider: c.providers[0] ?? null, classification, reason };
  };
  for (const c of registry.validatedSold) {
    if (selectedKeys.has(c.key)) continue;
    out.push(classifyUnique(c, true));
  }
  for (const c of registry.validatedActive) {
    if (selectedKeys.has(c.key)) continue;
    out.push(classifyUnique(c, false));
  }
  for (const m of registry.duplicateMerges) {
    out.push({ key: null, address: m.keptAddress, provider: m.providers[0] ?? null, classification: 'duplicate', reason: `${m.mergedCount} provider row(s) merged into one record (matched by ${m.matchedBy}); each provider stays attached to the kept record.` });
  }
  for (const r of registry.rejected) {
    out.push({ key: null, address: r.address, provider: r.provider, classification: 'rejected', reason: r.reason });
  }
  return out;
}
