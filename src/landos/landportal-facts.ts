// LandOS — LandPortal Parcel Fact Sheet.
//
// Pure, deterministic normalizer: takes the raw label->value map extracted from a
// LandPortal parcel panel (browser, read-only) and produces ONE structured,
// operator-facing fact sheet for the Property Card. It maps LandPortal's real
// field labels to canonical fields, derives the acquisition-relevant reads
// (access interpretation, buildability, flood/wetlands, water), and generates
// property-specific seller-call questions.
//
// Hard rules:
//   - Never fabricate. A field the panel did not expose is status 'needs_verification'.
//   - Legal Description is captured for provenance but NEVER surfaced in the visible
//     snapshot (Tyler does not use it for acquisition decisions).
//   - "Land Locked: No" means access is FINE — it is interpreted, never shown raw as "No".
//   - Buildability is the real Buildability % / acres, never Building SqFt.
//   - Flood/wetlands show the extracted values, not "overlay captured".
//   - RETENTION IS INDEPENDENT. This sheet is built from the LandPortal fields
//     alone. Whether the official county GIS source resolved has no bearing on
//     it, so a failed official source can never turn retained LandPortal terrain,
//     slope, buildability, wetlands, FEMA, soils, water, frontage, acreage,
//     improvement or parcel-context evidence into "Not retained". `retention`
//     reports exactly which canonical fields LandPortal supplied and which it
//     genuinely did not, so a surface can tell "the source did not publish it"
//     apart from "we failed to keep it".

export type FactStatus = 'verified' | 'needs_verification';

export interface FactRow {
  key: string;
  label: string;
  /** Display value, already formatted. Empty string when not exposed. */
  value: string;
  status: FactStatus;
}

export interface ParcelFactSheet {
  /** Header identity. */
  apn: string | null;
  owner: string | null;
  parcelAddress: string | null;
  city: string | null;
  stateCode: string | null;
  zip: string | null;
  county: string | null;
  /** Township / city / village that governs the parcel, when LandPortal shows it. */
  municipality: string | null;
  acres: number | null;
  acresLabel: string | null;

  /** Derived acquisition reads. */
  access: { label: string; landLocked: string | null; roadFrontage: string | null; roadFrontageFt: number | null };
  buildability: { label: string; pct: string | null; acres: string | null };
  /** Slope and elevation, retained whenever LandPortal publishes them. */
  terrain: {
    slopeAvgPct: string | null;
    slopeUnder10Pct: string | null;
    elevationAvg: string | null;
    elevationMin: string | null;
    elevationMax: string | null;
    label: string;
  };
  environment: {
    femaFloodZone: string | null;
    /** The full FEMA description LandPortal shows, kept complete. */
    femaFloodZoneDescription: string | null;
    femaCoveragePct: string | null;
    wetlandsPct: string | null;
    label: string;
  };
  water: { present: boolean; type: string | null; label: string | null };
  /** Mapped soil evidence, when the parcel panel exposes it. */
  soils: { type: string | null; description: string | null; label: string | null };
  /**
   * Improvement evidence. Deliberately separate from buildability: building
   * square footage is what stands on the parcel, buildability is what could be.
   */
  improvement: {
    buildingSqft: string | null;
    yearBuilt: string | null;
    improvementValue: string | null;
    /** true/false only when the evidence says so; null when unstated. */
    improved: boolean | null;
    label: string;
  };
  /** Surrounding parcel context (use, zoning, size) as LandPortal states it. */
  parcelContext: {
    landUse: string | null;
    landUseCode: string | null;
    zoning: string | null;
    parcelSqft: string | null;
    subdivision: string | null;
    label: string | null;
  };

  /** Valuation (LandPortal assessment/market + LP estimate). */
  valuation: {
    lastSalePrice: number | null; lastSalePriceLabel: string | null; lastSaleDate: string | null;
    assessedValue: string | null; totalMarketValue: string | null; taxAmount: string | null;
    lpEstimatePrice: string | null; lpEstimatePpa: string | null;
  };

  /** Enrichment coordinates (centroid) — supporting only, NEVER identity. */
  centroid: { lat: number | null; lng: number | null };

  /** Ordered snapshot rows for the Property Snapshot section (no Legal Description). */
  snapshot: FactRow[];

  /** Property-specific seller-call questions derived from these facts. */
  sellerQuestions: string[];

  /** Count of exposed vs. needs-verification (for a small completeness read). */
  completeness: { exposed: number; total: number };

  /**
   * Which canonical fields LandPortal actually supplied, and which it did not.
   * A field in `retained` must never be rendered as "Not retained"; a field in
   * `notSupplied` was genuinely absent from the source, which is a different
   * statement and is unaffected by any other source's failure.
   */
  retention: { retained: string[]; notSupplied: string[] };

  /** Raw legal description (captured, never displayed in the snapshot). */
  legalDescription: string | null;
}

function pick(fields: Record<string, string>, ...labels: string[]): string | null {
  for (const l of labels) {
    const v = fields[l];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t && t !== '-' && t !== '—' && !/^n\/?a$/i.test(t)) return t;
    }
  }
  return null;
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function usd(n: number | null): string | null {
  return n == null ? null : `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Normalize a percent-ish LandPortal value ("28.10 %", "0") to "28.10%" / "0%". */
function pct(v: string | null): string | null {
  if (v == null) return null;
  const n = num(v);
  if (n == null) return v.replace(/\s+/g, '');
  return `${n}%`;
}

/** Normalize an acres string ("0.07 ac.") to "0.07 ac". */
function acresStr(v: string | null): string | null {
  if (v == null) return null;
  const n = num(v);
  return n == null ? v : `${n} ac`;
}

export function buildParcelFactSheet(fieldsIn: Record<string, string> | undefined | null): ParcelFactSheet {
  const fields = fieldsIn ?? {};

  const apn = pick(fields, 'Parcel ID', 'APN');
  const owner = pick(fields, 'Owner Name', 'Owner');
  const parcelAddress = pick(fields, 'Parcel Address');
  const city = pick(fields, 'Parcel Address City');
  const stateCode = pick(fields, 'Parcel Address State');
  const zip = pick(fields, 'Parcel Address Zip Code', 'Parcel Address ZIP Code');
  const county = pick(fields, 'Parcel Address County');
  const municipality = pick(fields, 'Municipality', 'Township', 'Parcel Address City Municipality', 'Jurisdiction');
  // Some parcel records expose a placeholder zero in `Acres` while their
  // geometry-backed `Calc Acres` is positive. Never let that placeholder
  // suppress the usable acreage or downstream comparable matching.
  const statedAcres = num(pick(fields, 'Acres'));
  const calculatedAcres = num(pick(fields, 'Calc Acres', 'MLS Acres'));
  const acres = statedAcres != null && statedAcres > 0 ? statedAcres : calculatedAcres;
  const acresLabel = acres != null ? `${acres} ac` : null;
  const parcelSqft = pick(fields, 'Parcel SqFt');
  const landUse = pick(fields, 'Parcel Use Description');
  const landUseCode = pick(fields, 'Parcel Use Code');
  const zoning = pick(fields, 'Zoning Code', 'Zoning');

  // Access interpretation (never shows raw "No").
  const landLocked = pick(fields, 'Land Locked');
  const roadFrontage = pick(fields, 'Road Frontage');
  const roadFrontageFt = num(roadFrontage);
  const hasAccessEvidence = (landLocked != null && /^no$/i.test(landLocked)) || (roadFrontageFt != null && roadFrontageFt > 0);
  const landlockedYes = landLocked != null && /^yes$/i.test(landLocked);
  const accessLabel = landlockedYes
    ? 'Parcel flagged land-locked — confirm legal/physical access before proceeding.'
    : hasAccessEvidence
      ? 'Road frontage present, not landlocked. Legal access likely, verify if needed.'
      : 'Access not confirmed from parcel data — verify legal/physical access.';

  // Buildability = real Buildability %/acres, never Building SqFt.
  const buildPct = pct(pick(fields, 'Buildability total (%)', 'Buildability total', 'Buildability'));
  const buildAcres = acresStr(pick(fields, 'Buildability area (acres)', 'Buildability area'));
  const slopeAvg = pct(pick(fields, 'Slope Avg'));
  const buildLabel = buildPct
    ? `${buildPct} buildable${buildAcres ? ` (${buildAcres})` : ''}${slopeAvg ? ` · avg slope ${slopeAvg}` : ''}`
    : 'Needs verification';

  // Terrain: slope and elevation are retained whenever LandPortal shows them.
  const slopeUnder10 = pct(pick(fields, 'Slope Under 10% (%)', 'Slope Under 10%', 'Pct Under 10% Slope'));
  const elevationAvg = pick(fields, 'Elevation Avg');
  const elevationMin = pick(fields, 'Elevation Min');
  const elevationMax = pick(fields, 'Elevation Max');
  const terrainLabel = [
    slopeAvg ? `avg slope ${slopeAvg}` : null,
    slopeUnder10 ? `${slopeUnder10} under 10% slope` : null,
    elevationAvg ? `elevation ${elevationAvg}` : null,
    elevationMin && elevationMax ? `range ${elevationMin} to ${elevationMax}` : null,
  ].filter(Boolean).join(' · ') || 'Needs verification';

  // Flood / wetlands: extracted values, not "overlay captured". The description
  // LandPortal displays is itself a retained FEMA answer — when only that is
  // exposed it stands in for the zone rather than reading as unretained.
  const femaDescription = pick(fields, 'FEMA Flood Zone Description', 'FEMA Description');
  const femaZone = pick(fields, 'FEMA Flood Zone') ?? femaDescription;
  const femaPct = pct(pick(fields, 'FEMA Coverage (%)', 'FEMA Coverage'));
  const wetPct = pct(pick(fields, 'Wetlands Coverage (%)', 'Wetlands Coverage'));
  const envLabel = femaZone
    ? `${femaZone}${femaPct ? ` (FEMA coverage ${femaPct})` : ''}${wetPct ? ` · wetlands ${wetPct}` : ''}`
    : wetPct
      ? `Wetlands ${wetPct}${femaPct ? ` · FEMA coverage ${femaPct}` : ''}`
      : 'Needs verification';

  // Water feature. A displayed type (e.g. sidebar "Water Feature Type: River")
  // is itself evidence a water feature is present.
  const waterYes = pick(fields, 'Water Feature');
  const waterType = pick(fields, 'Water Feature type(s)', 'Water Feature type', 'Water Feature Type');
  const waterPresent = (waterYes != null && /^yes$/i.test(waterYes)) || (waterType != null && !/^no(?:ne)?$/i.test(waterType));
  const waterLabel = waterPresent ? `Yes${waterType ? `, ${waterType}` : ''}` : waterYes ? 'No' : null;

  // Soils. Mapped soil evidence is parcel intelligence in its own right and is
  // retained whenever the panel exposes it.
  const soilType = pick(fields, 'Soil Type', 'Soil Types', 'Dominant Soil Type');
  const soilDescription = pick(fields, 'Soil Description', 'Soil Type Description');
  const soilLabel = soilType || soilDescription
    ? [soilType, soilDescription].filter(Boolean).join(' — ')
    : null;

  // Improvements. Kept strictly apart from buildability: Building SqFt is what
  // stands on the parcel today, buildability is what the terrain would allow.
  const buildingSqft = pick(fields, 'Building SqFt', 'Building Sq Ft', 'Improvement SqFt');
  const yearBuilt = pick(fields, 'Year Built', 'Effective Year Built');
  const improvementValue = pick(fields, 'Improvement Value', 'Improved Value');
  const buildingSqftNum = num(buildingSqft);
  const improvementValueNum = num(improvementValue);
  const improved = buildingSqftNum != null || improvementValueNum != null || yearBuilt != null
    ? (buildingSqftNum != null && buildingSqftNum > 0)
      || (improvementValueNum != null && improvementValueNum > 0)
      || (yearBuilt != null && (num(yearBuilt) ?? 0) > 0)
    : null;
  const improvementLabel = improved === null
    ? 'Needs verification'
    : improved
      ? `Improved${buildingSqft ? ` · ${buildingSqft} building sq ft` : ''}${yearBuilt ? ` · built ${yearBuilt}` : ''}`
      : 'No improvement reported on the parcel record.';

  // Valuation.
  const lastSalePrice = num(pick(fields, 'Last Sale Price'));
  const lastSaleDate = pick(fields, 'Last Sale Date');
  const assessedValue = pick(fields, 'Assessed Value');
  const totalMarketValue = pick(fields, 'Total Market Value');
  const taxAmount = pick(fields, 'Tax Amount');
  const lpEstimatePrice = pick(fields, 'Estimate price');
  const lpEstimatePpa = pick(fields, 'Estimate PPA');

  const centroidLat = num(pick(fields, 'Centroid Latitude'));
  const centroidLng = num(pick(fields, 'Centroid Longitude'));

  const legalDescription = pick(fields, 'Legal Description');

  // Ordered snapshot (NO legal description; mailing de-emphasized/omitted).
  const rows: Array<[string, string, string | null]> = [
    ['owner', 'Owner', owner],
    ['apn', 'APN', apn],
    ['parcelAddress', 'Parcel Address', parcelAddress],
    ['location', 'City / County', [city, county].filter(Boolean).join(' · ') || null],
    ['municipality', 'Municipality', municipality],
    ['acres', 'Acreage', acresLabel],
    ['parcelSqft', 'Parcel Sq Ft', parcelSqft],
    ['landUse', 'Land Use', landUse],
    ['zoning', 'Zoning', zoning],
    ['access', 'Access', accessLabel],
    ['landLocked', 'Land Locked', landLocked ? (/^no$/i.test(landLocked) ? 'No' : landLocked) : null],
    ['roadFrontage', 'Road Frontage', roadFrontage],
    ['water', 'Water Feature', waterLabel],
    ['soils', 'Soils', soilLabel],
    ['floodZone', 'FEMA Flood Zone', femaZone],
    ['femaCoverage', 'FEMA Coverage', femaPct],
    ['wetlands', 'Wetlands Coverage', wetPct],
    ['buildability', 'Buildability', buildPct ? `${buildPct}${buildAcres ? ` (${buildAcres})` : ''}` : null],
    ['slope', 'Avg Slope', slopeAvg],
    ['slopeUnder10', 'Slope Under 10%', slopeUnder10],
    ['elevationAvg', 'Elevation Avg', elevationAvg],
    ['elevationRange', 'Elevation Range',
      (elevationMin && elevationMax) ? `${elevationMin} to ${elevationMax}` : null],
    ['buildingSqft', 'Building Sq Ft', buildingSqft],
    ['yearBuilt', 'Year Built', yearBuilt],
    ['lastSale', 'Last Sale', lastSalePrice != null ? `${usd(lastSalePrice)}${lastSaleDate ? ` on ${lastSaleDate}` : ''}` : null],
    ['assessed', 'Assessed Value', assessedValue],
    ['marketValue', 'Total Market Value', totalMarketValue],
    ['tax', 'Tax Amount', taxAmount],
    ['lpEstimate', 'LandPortal Estimate', lpEstimatePrice ? `${lpEstimatePrice}${lpEstimatePpa ? ` (${lpEstimatePpa}/ac)` : ''}` : null],
  ];
  const snapshot: FactRow[] = rows.map(([key, label, value]) => ({
    key, label,
    value: value ?? 'Needs verification',
    status: value ? 'verified' : 'needs_verification',
  }));
  const exposed = snapshot.filter((r) => r.status === 'verified').length;

  // Property-specific seller questions.
  const sellerQuestions: string[] = [];
  sellerQuestions.push('Do you know if utilities are available at the road?');
  sellerQuestions.push('Do you have a survey?');
  sellerQuestions.push('Are there any HOA rules, deed restrictions, or neighborhood restrictions?');
  if (waterPresent) {
    const w = (waterType ?? 'water feature').toLowerCase();
    sellerQuestions.push(`Is the ${w} usable, maintained, or subject to a drainage easement?`);
  }
  sellerQuestions.push('Are there any access, road maintenance, or driveway issues?');
  sellerQuestions.push('Are there any unpaid taxes, liens, code violations, or title issues?');
  // Only ask wetland/flood questions when the data actually shows exposure.
  const wetlandsExposed = wetPct != null && num(wetPct)! > 0;
  const floodExposed = femaZone != null && !/not in a flood/i.test(femaZone) && !/^x$/i.test(femaZone);
  if (wetlandsExposed || floodExposed) {
    sellerQuestions.push('Have any wetland delineation or flood-zone determinations been done on the lot?');
  }
  sellerQuestions.push('Why are you looking to sell this lot now?');

  // Retention read. Built from the LandPortal fields alone: no other source's
  // outcome may promote or demote an entry here.
  const canonical: Array<[string, unknown]> = [
    ['owner', owner], ['apn', apn], ['parcelAddress', parcelAddress], ['county', county],
    ['municipality', municipality], ['acres', acres], ['parcelSqft', parcelSqft],
    ['landUse', landUse], ['zoning', zoning],
    ['landLocked', landLocked], ['roadFrontage', roadFrontage],
    ['buildabilityPct', buildPct], ['buildabilityAcres', buildAcres],
    ['slopeAvg', slopeAvg], ['slopeUnder10', slopeUnder10],
    ['elevationAvg', elevationAvg], ['elevationRange', elevationMin && elevationMax ? `${elevationMin} to ${elevationMax}` : null],
    ['femaFloodZone', femaZone], ['femaFloodZoneDescription', femaDescription], ['femaCoverage', femaPct],
    ['wetlandsCoverage', wetPct], ['waterFeature', waterLabel], ['soils', soilLabel],
    ['buildingSqft', buildingSqft], ['yearBuilt', yearBuilt], ['improvementValue', improvementValue],
    ['lastSale', lastSalePrice], ['assessedValue', assessedValue], ['totalMarketValue', totalMarketValue],
    ['taxAmount', taxAmount], ['lpEstimate', lpEstimatePrice], ['centroid', centroidLat != null && centroidLng != null ? 'yes' : null],
  ];
  const retained = canonical.filter(([, value]) => value != null && value !== '').map(([key]) => key);
  const notSupplied = canonical.filter(([, value]) => value == null || value === '').map(([key]) => key);

  return {
    apn, owner, parcelAddress, city, stateCode, zip, county, municipality, acres, acresLabel,
    access: { label: accessLabel, landLocked, roadFrontage, roadFrontageFt },
    buildability: { label: buildLabel, pct: buildPct, acres: buildAcres },
    terrain: {
      slopeAvgPct: slopeAvg, slopeUnder10Pct: slopeUnder10,
      elevationAvg, elevationMin, elevationMax, label: terrainLabel,
    },
    environment: {
      femaFloodZone: femaZone,
      femaFloodZoneDescription: femaDescription,
      femaCoveragePct: femaPct,
      wetlandsPct: wetPct,
      label: envLabel,
    },
    water: { present: waterPresent, type: waterType, label: waterLabel },
    soils: { type: soilType, description: soilDescription, label: soilLabel },
    improvement: {
      buildingSqft, yearBuilt, improvementValue, improved, label: improvementLabel,
    },
    parcelContext: {
      landUse, landUseCode, zoning, parcelSqft,
      subdivision: pick(fields, 'Subdivision', 'Subdivision Name'),
      label: [landUse, zoning ? `zoned ${zoning}` : null, parcelSqft ? `${parcelSqft} sq ft` : null]
        .filter(Boolean).join(' · ') || null,
    },
    retention: { retained, notSupplied },
    valuation: {
      lastSalePrice, lastSalePriceLabel: usd(lastSalePrice), lastSaleDate,
      assessedValue, totalMarketValue, taxAmount, lpEstimatePrice, lpEstimatePpa,
    },
    centroid: { lat: centroidLat, lng: centroidLng },
    snapshot,
    sellerQuestions,
    completeness: { exposed, total: snapshot.length },
    legalDescription,
  };
}
