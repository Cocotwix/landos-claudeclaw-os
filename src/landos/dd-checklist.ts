// LandOS — canonical Due Diligence fact checklist (shared).
//
// One source of truth for the standard DD field set, used by both the Discovery
// Call Report (property-analysis-report) and the Deal Card report/UI. Every
// standard field is accounted for: a Verified value cites its source; anything a
// connected provider did not return is an explicit Unknown / Needs Verification
// row — never silently omitted, never fabricated. Pure + deterministic; no calls.

import type { DukeLandFacts } from './duke-property-data.js';

export const NEEDS_VERIFICATION_LABEL = 'Unknown / Needs Verification';

export interface DdChecklistRow {
  key: string;
  label: string;
  /** Formatted Verified value, or null when not provided. */
  value: string | null;
  status: 'verified' | 'needs_verification';
  /** Named source/provider for a Verified value; null otherwise. PER FIELD — a
   *  row's source reflects whoever supplied THAT fact (Realie, FEMA, NWI, USGS,
   *  Census, Google visual), never a single global stamp. */
  source: string | null;
  /** Provenance for the field's value (all optional, populated when known). */
  timestamp?: string | null;
  url?: string | null;
  confidence?: 'high' | 'medium' | 'low' | 'none' | null;
  /** Label for the kind of fact (e.g. 'visual signal' for Google). */
  factKind?: 'verified' | 'visual_signal';
  /** True for fields with no connected provider yet (e.g. utilities). */
  noConnectedSource?: boolean;
}

/** A government-DD result shape (from the report's govDd) to merge per-field. */
export interface GovDdForChecklist {
  flood: { status: string; zone: string | null; source: string | null; timestamp: string | null };
  wetlands: { status: string; type: string | null; source: string | null; timestamp: string | null };
  slope: { status: string; slopeDeg: number | null; source: string | null; timestamp: string | null };
}

/**
 * Merge verified government-DD facts into the checklist, each carrying its OWN
 * provider/source/url/timestamp (no mislabeling as the parcel provider). Replaces
 * the corresponding Needs-Verification rows (femaPct/wetlandsPct/slopeAvgDeg).
 * Pure; only replaces a row when the gov result is verified.
 */
export function mergeGovDdRows(rows: DdChecklistRow[], gov: GovDdForChecklist | undefined): DdChecklistRow[] {
  if (!gov) return rows;
  const replace: Record<string, DdChecklistRow | null> = {
    femaPct: gov.flood.status === 'verified' ? { key: 'femaPct', label: 'FEMA flood zone', value: gov.flood.zone, status: 'verified', source: 'FEMA NFHL', url: gov.flood.source, timestamp: gov.flood.timestamp, confidence: 'high' } : null,
    wetlandsPct: gov.wetlands.status === 'verified' ? { key: 'wetlandsPct', label: 'Wetlands (NWI)', value: gov.wetlands.type, status: 'verified', source: 'USFWS NWI', url: gov.wetlands.source, timestamp: gov.wetlands.timestamp, confidence: 'high' } : null,
    slopeAvgDeg: gov.slope.status === 'verified' ? { key: 'slopeAvgDeg', label: 'Average slope', value: gov.slope.slopeDeg == null ? null : `~${gov.slope.slopeDeg}°`, status: 'verified', source: 'USGS 3DEP', url: gov.slope.source, timestamp: gov.slope.timestamp, confidence: 'medium' } : null,
  };
  return rows.map((r) => replace[r.key] ?? r);
}

const DD_LAND_FIELDS: Array<{ key: keyof DukeLandFacts; label: string; fmt?: (v: number | string) => string }> = [
  { key: 'acres', label: 'Acreage', fmt: (v) => `${v} ac` },
  { key: 'zoning', label: 'Zoning' },
  { key: 'landUse', label: 'Land use' },
  { key: 'roadFrontageFt', label: 'Road frontage', fmt: (v) => `${v} ft` },
  { key: 'landLocked', label: 'Access (landlocked flag)' },
  { key: 'nearWater', label: 'Near water' },
  { key: 'wetlandsPct', label: 'Wetlands', fmt: (v) => `~${v}%` },
  { key: 'femaPct', label: 'FEMA flood zone', fmt: (v) => `~${v}%` },
  { key: 'slopeAvgDeg', label: 'Average slope', fmt: (v) => `~${v}°` },
  { key: 'buildabilityPct', label: 'Buildability', fmt: (v) => `~${v}%` },
  { key: 'buildableAcres', label: 'Buildable acres', fmt: (v) => `${v} ac` },
  { key: 'buildingAreaSqft', label: 'Building area', fmt: (v) => `${v} sqft` },
];

const DD_UTILITY_FIELDS = ['Power', 'Water', 'Sewer / septic'];

function present(v: unknown): v is number | string {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  return false;
}

/** Build the full DD checklist from canonical land facts (+ named source). */
export function buildDdChecklist(landFacts: Partial<DukeLandFacts> = {}, source: string | null = null): DdChecklistRow[] {
  const rows: DdChecklistRow[] = [];
  for (const f of DD_LAND_FIELDS) {
    const v = (landFacts as Record<string, unknown>)[f.key as string];
    rows.push(present(v)
      ? { key: f.key as string, label: f.label, value: f.fmt ? f.fmt(v) : String(v), status: 'verified', source }
      : { key: f.key as string, label: f.label, value: null, status: 'needs_verification', source: null });
  }
  for (const u of DD_UTILITY_FIELDS) {
    rows.push({ key: `utility_${u}`, label: u, value: null, status: 'needs_verification', source: null, noConnectedSource: true });
  }
  return rows;
}

export interface DdCompleteness {
  /** Standard DD fields counted (all rows, incl. utilities). */
  total: number;
  verified: number;
  needsVerification: number;
  /** verified / total, 0–100, rounded. */
  percentComplete: number;
  /** e.g. "3 of 15 DD fields verified (20%)". */
  label: string;
}

/** Summarize DD completeness from checklist rows. Pure; counts every standard
 *  field (utilities included) so the denominator reflects the full DD picture. */
export function summarizeDdCompleteness(rows: DdChecklistRow[]): DdCompleteness {
  const total = rows.length;
  const verified = rows.filter((r) => r.status === 'verified').length;
  const needsVerification = total - verified;
  const percentComplete = total > 0 ? Math.round((verified / total) * 100) : 0;
  return {
    total,
    verified,
    needsVerification,
    percentComplete,
    label: `${verified} of ${total} DD fields verified (${percentComplete}%)`,
  };
}

/** Render checklist rows as Markdown bullet lines (used by the Discovery Report). */
export function renderDdChecklistMarkdown(rows: DdChecklistRow[]): string[] {
  return rows.map((r) => {
    if (r.status !== 'verified') return `- **${r.label}:** ${NEEDS_VERIFICATION_LABEL}${r.noConnectedSource ? ' (no connected source)' : ''}`;
    const label = r.factKind === 'visual_signal' ? 'Visual signal' : 'Verified';
    const src = r.source ? ` (source: ${r.source})` : '';
    return `- **${r.label}:** ${r.value} — ${label}${src}`;
  });
}
