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
  /** Named source for a Verified value; null otherwise. */
  source: string | null;
  /** True for fields with no connected provider yet (e.g. utilities). */
  noConnectedSource?: boolean;
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

/** Render checklist rows as Markdown bullet lines (used by the Discovery Report). */
export function renderDdChecklistMarkdown(rows: DdChecklistRow[]): string[] {
  return rows.map((r) =>
    r.status === 'verified'
      ? `- **${r.label}:** ${r.value} — Verified (source: ${r.source})`
      : `- **${r.label}:** ${NEEDS_VERIFICATION_LABEL}${r.noConnectedSource ? ' (no connected source)' : ''}`,
  );
}
