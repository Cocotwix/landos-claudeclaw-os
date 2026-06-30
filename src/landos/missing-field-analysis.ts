// LandOS — Missing-field analysis (Phase 3).
//
// After LandPortal returns, decide what STILL needs collecting before duplicating
// work at the county. The browser workflow is LandPortal-first: it drives, then a
// structured missing-fields list determines what County Records must fill. This
// prevents collecting the same information twice. Pure + deterministic.

import type { NormalizedProperty } from './normalized-property.js';
import type { BrowserEvidence } from './browser-intelligence.js';

/** The canonical pre-call DD field set, each mapped to the county workflow that
 *  can fill it when LandPortal did not. New fields append here. */
export const DD_FIELDS = [
  'address', 'apn', 'owner', 'county', 'state', 'acreage',
  'land_use', 'zoning', 'fema_flood', 'wetlands', 'road_frontage', 'utilities',
  'coordinates', 'tax_status', 'tax_values', 'recorded_deed', 'plat',
  'mailing_address', 'ownership_verification', 'gis_parcel',
] as const;
export type DdField = (typeof DD_FIELDS)[number];

/** Which county workflow fills each field (when missing). Fields LandPortal
 *  normally provides still map to a county fallback. */
export const COUNTY_WORKFLOW_FOR: Record<DdField, string> = {
  address: 'assessor', apn: 'assessor', owner: 'assessor', county: 'assessor',
  state: 'assessor', acreage: 'assessor', land_use: 'assessor', zoning: 'planning_zoning',
  fema_flood: 'gis', wetlands: 'gis', road_frontage: 'gis', utilities: 'assessor',
  coordinates: 'gis', tax_status: 'tax_office', tax_values: 'tax_office',
  recorded_deed: 'recorder', plat: 'recorder', mailing_address: 'assessor',
  ownership_verification: 'recorder', gis_parcel: 'gis',
};

/** Records that the county is the AUTHORITATIVE source for — these are requested
 *  from the county even if LandPortal showed a hint (verification of record). */
const COUNTY_AUTHORITATIVE: ReadonlySet<DdField> = new Set([
  'recorded_deed', 'plat', 'tax_status', 'ownership_verification', 'gis_parcel',
]);

export interface MissingFieldAnalysis {
  /** Fields present after LandPortal (no county work needed). */
  have: DdField[];
  /** Fields still missing — county records should attempt to fill. */
  missing: DdField[];
  /** The distinct county workflows to run (deduped) for the missing fields. */
  countyWorkflows: string[];
  /** Fields the county verifies authoritatively even if LandPortal hinted them. */
  countyVerifies: DdField[];
  /** Human-readable summary for the operator. */
  summary: string;
}

function hasField(p: NormalizedProperty, browserFields: Record<string, string>, f: DdField): boolean {
  const fk = Object.keys(browserFields).map((k) => k.toLowerCase());
  const inBrowser = (...names: string[]) => names.some((n) => fk.some((k) => k.includes(n)));
  switch (f) {
    case 'address': return !!p.address || inBrowser('address');
    case 'apn': return !!p.apn || inBrowser('apn', 'parcel');
    case 'owner': return !!p.owner || inBrowser('owner');
    case 'county': return !!p.county || inBrowser('county');
    case 'state': return !!p.state || inBrowser('state');
    case 'acreage': return p.acres != null || inBrowser('acre', 'lot size');
    case 'coordinates': return !!p.coordinates || inBrowser('lat', 'coordinate');
    case 'land_use': return inBrowser('land use', 'use code');
    case 'zoning': return inBrowser('zoning', 'zoned');
    case 'fema_flood': return inBrowser('fema', 'flood');
    case 'wetlands': return inBrowser('wetland');
    case 'road_frontage': return inBrowser('frontage', 'road front');
    case 'utilities': return inBrowser('utilit', 'water', 'sewer', 'septic', 'power');
    case 'tax_values': return inBrowser('tax', 'assess');
    default: return false; // county-authoritative records are never "had" from LandPortal alone
  }
}

/**
 * Analyze what County Records still needs to collect after LandPortal. Pure.
 * Fields LandPortal already provided are excluded (no duplicate retrieval);
 * county-authoritative records (deed/plat/tax status/ownership/GIS parcel) are
 * always listed for the county even if LandPortal hinted at them.
 */
export function analyzeMissingFields(
  property: NormalizedProperty,
  landPortalEvidence?: BrowserEvidence | null,
): MissingFieldAnalysis {
  const bf = landPortalEvidence?.fields ?? {};
  const have: DdField[] = [];
  const missing: DdField[] = [];
  const countyVerifies: DdField[] = [];

  for (const f of DD_FIELDS) {
    const present = hasField(property, bf, f);
    if (COUNTY_AUTHORITATIVE.has(f)) {
      // Always have the county confirm the authoritative record.
      countyVerifies.push(f);
      if (!present) missing.push(f);
      else have.push(f);
      continue;
    }
    if (present) have.push(f);
    else missing.push(f);
  }

  const countyWorkflows = Array.from(new Set(
    [...missing, ...countyVerifies].map((f) => COUNTY_WORKFLOW_FOR[f]),
  ));

  return {
    have,
    missing,
    countyWorkflows,
    countyVerifies,
    summary: missing.length
      ? `LandPortal provided ${have.length} field(s). County Records should fill ${missing.length} gap(s) via: ${countyWorkflows.join(', ')}. No field already retrieved is collected again.`
      : `LandPortal provided everything needed; County Records only verifies authoritative records (${countyVerifies.join(', ')}).`,
  };
}
