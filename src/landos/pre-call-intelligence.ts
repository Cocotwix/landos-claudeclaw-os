// LandOS — Pre-Call Intelligence synthesis (pure, derived).
//
// Turns what LandOS retrieved before the seller call into a trustworthy, labeled
// package: an identity TIER (Verified Parcel / Candidate Parcel / Area-Only
// Context), an inferred property type + preliminary strategy, and a Pre-Call
// Intelligence readiness STATUS (not a binary "ready"). Pure + deterministic;
// never fabricates — it organizes what is known and names what is not.

export type IdentityTier = 'verified_parcel' | 'candidate_parcel' | 'area_only_context';

export const IDENTITY_TIER_LABEL: Record<IdentityTier, string> = {
  verified_parcel: 'Verified Parcel',
  candidate_parcel: 'Candidate Parcel',
  area_only_context: 'Area-Only Context',
};

export type PreCallStatus = 'high' | 'moderate' | 'limited' | 'needs_verification';

export const PRE_CALL_STATUS_LABEL: Record<PreCallStatus, string> = {
  high: 'High',
  moderate: 'Moderate',
  limited: 'Limited',
  needs_verification: 'Needs Verification',
};

export interface ParcelFacts {
  verified: boolean;
  /** locality validation passed (or n/a). false only when a conflict downgraded it. */
  localityOk?: boolean;
  acres?: number | null;
  zoning?: string | null;
  landUse?: string | null;
  inputAddress?: string | null;
  owner?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  /** Expanded Realie signals for vacant-vs-improved inference. */
  buildingAreaSqft?: number | null;
  yearBuilt?: number | null;
  residential?: boolean | null;
  marketValue?: number | null;
}

export interface PropertyTypeInference {
  propertyType: string;
  vacantOrImproved: 'vacant' | 'improved' | 'unknown';
  context: 'rural' | 'infill' | 'acreage' | 'development_candidate' | 'unknown';
  likelyBuyer: string;
  viableExits: string[];
  poorFitExits: string[];
  dealKillers: string[];
  opportunities: string[];
  risks: string[];
  postDiscoveryVerifications: string[];
  basis: string;
}

export interface PreCallSourceSignals {
  identityVerified: boolean;
  visualsCaptured: number;
  compsCount: number;
  marketPulse: boolean;
  browserEvidenceCount: number;
  flood?: 'verified' | 'unavailable' | 'needs_verification' | 'error';
  wetlands?: 'verified' | 'unavailable' | 'needs_verification' | 'error';
  slope?: 'verified' | 'unavailable' | 'needs_verification' | 'error';
  demographics?: 'verified' | 'not_configured' | 'no_geography' | 'error' | 'not_run';
}

export interface PreCallIntelligence {
  identityTier: IdentityTier;
  identityTierLabel: string;
  status: PreCallStatus;
  statusLabel: string;
  score: number; // 0-100
  retrieved: string[];
  verified: string[];
  candidateEvidence: string[];
  unknown: string[];
  note: string;
}

/** Vacant-land "0" / "TBD" / "LOT" house-number heuristic. */
function looksVacantAddress(addr?: string | null): boolean {
  const a = (addr ?? '').trim();
  return /^0\b/.test(a) || /\b(lot|tbd|parcel)\b/i.test(a);
}

function acreBand(acres?: number | null): 'infill' | 'small' | 'mid' | 'large' | 'unknown' {
  if (acres == null || !Number.isFinite(acres) || acres <= 0) return 'unknown';
  if (acres < 0.5) return 'infill';
  if (acres < 5) return 'small';
  if (acres < 25) return 'mid';
  return 'large';
}

/**
 * Identity tier: Verified only when the provider verified AND locality validation
 * did not downgrade it. Candidate when there is identity-ish evidence but not a
 * clean verification. Otherwise Area-Only Context (still useful market-wise).
 */
export function deriveIdentityTier(f: ParcelFacts): IdentityTier {
  if (f.verified && f.localityOk !== false) return 'verified_parcel';
  // Candidate: we have an owner OR a specific street address (not just city/zip)
  // but identity isn't fully verified (e.g., locality downgrade, or partial match).
  const hasStreet = !!(f.inputAddress && /\d/.test(f.inputAddress) && !looksVacantAddress(f.inputAddress));
  if ((f.verified && f.localityOk === false) || f.owner || hasStreet) return 'candidate_parcel';
  return 'area_only_context';
}

/** Infer property type + preliminary strategy from collected facts. Never fabricates. */
export function inferPropertyType(f: ParcelFacts): PropertyTypeInference {
  const band = acreBand(f.acres);
  const z = (f.zoning ?? '').toUpperCase();
  const lu = (f.landUse ?? '').toLowerCase();
  // A building footprint / year built / residential flag is the strongest signal
  // that a parcel is improved — it overrides a "0 / vacant-looking" address.
  const hasStructure = (typeof f.buildingAreaSqft === 'number' && f.buildingAreaSqft > 0)
    || (typeof f.yearBuilt === 'number' && f.yearBuilt > 0)
    || f.residential === true;
  const vacant = hasStructure
    ? 'improved' as const
    : looksVacantAddress(f.inputAddress) || /vacant|vac land|0\b/.test(lu)
      ? 'vacant' as const
      : (lu.includes('residential') || lu.includes('improved') || lu.includes('sfr') ? 'improved' as const : 'unknown' as const);

  const residentialZoned = /^R|RES|SF|RA|RR/.test(z);
  const agZoned = /^A|AG|AR/.test(z);
  const commercialZoned = /^C|COM|B-|M-|IND|I-/.test(z);

  let context: PropertyTypeInference['context'] = 'unknown';
  if (band === 'infill') context = 'infill';
  else if (band === 'large') context = 'acreage';
  else if (band === 'small' || band === 'mid') context = residentialZoned ? 'development_candidate' : 'rural';

  let propertyType: string;
  if (vacant === 'vacant' && band === 'large') propertyType = agZoned ? 'Rural / agricultural vacant acreage' : 'Vacant acreage';
  else if (vacant === 'vacant' && band === 'infill') propertyType = 'Infill vacant lot';
  else if (vacant === 'vacant') propertyType = residentialZoned ? 'Vacant residential land' : 'Vacant land';
  else if (vacant === 'improved') propertyType = 'Improved property (structure likely present)';
  else propertyType = band === 'unknown' ? 'Undetermined (insufficient data)' : `Land (${band} acreage band)`;

  const viableExits: string[] = [];
  const poorFitExits: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];
  const dealKillers: string[] = [];
  if (vacant === 'vacant') {
    if (band === 'large') { viableExits.push('Subdivide / split', 'Sell to builder or land investor', 'Owner-finance resale'); poorFitExits.push('Quick retail flip (improved)'); }
    else if (band === 'infill') { viableExits.push('Sell to local builder / infill developer', 'Retail to end-buyer'); poorFitExits.push('Large subdivision'); }
    else { viableExits.push('Retail resale', 'Owner-finance', 'Sell to neighbor/adjacent owner'); }
    opportunities.push('Land entitlement / use upside if zoning supports it');
    risks.push('Access, utilities, flood, wetlands, and buildability are unconfirmed pre-call');
  } else if (vacant === 'improved') {
    viableExits.push('Resale as-is', 'Light rehab + resale'); poorFitExits.push('Raw-land subdivision');
    risks.push('Structure condition, occupancy, and title unconfirmed');
  } else {
    viableExits.push('Determine after confirming vacant vs improved'); risks.push('Property type not yet determinable from available data');
  }
  if (commercialZoned) opportunities.push('Commercial/industrial zoning may support higher-value use');
  if (/county|city of|housing authority|state of/i.test(f.owner ?? '')) risks.push('Government/agency owner — sale process may differ (surplus/auction)');

  const postDiscoveryVerifications = [
    'Confirm legal access / recorded easement (county)',
    'Confirm utilities availability (power/water/sewer/septic)',
    'Confirm zoning / land use with county planning',
    'Confirm flood zone (FEMA) + wetlands (NWI) for the parcel',
    'Confirm taxes/liens/title',
  ];

  const likelyBuyer = vacant === 'vacant'
    ? (band === 'large' ? 'Land investor, builder, or subdivider' : band === 'infill' ? 'Local builder or end-buyer' : 'End-buyer, neighbor, or small investor')
    : vacant === 'improved' ? 'Retail buyer or rehab investor' : 'Undetermined until type confirmed';

  return {
    propertyType, vacantOrImproved: vacant, context, likelyBuyer,
    viableExits, poorFitExits, dealKillers, opportunities, risks, postDiscoveryVerifications,
    basis: `acres=${f.acres ?? 'unknown'} (${band}), zoning=${f.zoning ?? 'unknown'}, landUse=${f.landUse ?? 'unknown'}, address="${f.inputAddress ?? ''}", owner=${f.owner ?? 'unknown'}`,
  };
}

/**
 * Pre-Call Intelligence readiness: did LandOS retrieve and organize everything
 * reasonably obtainable before the call? Scored from retrieved sources — NOT
 * from "do we know everything" (the seller call fills the rest).
 */
export function buildPreCallIntelligence(facts: ParcelFacts, sig: PreCallSourceSignals): PreCallIntelligence {
  const tier = deriveIdentityTier(facts);
  const retrieved: string[] = [];
  const verified: string[] = [];
  const candidateEvidence: string[] = [];
  const unknown: string[] = [];

  if (sig.identityVerified) { verified.push('Parcel identity (Realie official record + locality validation)'); retrieved.push('Parcel identity'); }
  else if (tier === 'candidate_parcel') candidateEvidence.push('Partial identity evidence (address/owner) — not fully verified');
  else unknown.push('Exact parcel identity (Needs Verification)');

  if (sig.visualsCaptured > 0) retrieved.push(`Google visuals (${sig.visualsCaptured})`); else unknown.push('Property visuals');
  if (sig.compsCount > 0) retrieved.push(`Comps (${sig.compsCount})`); else unknown.push('Comparable sales');
  if (sig.marketPulse) retrieved.push('Local market pulse');
  if (sig.browserEvidenceCount > 0) retrieved.push(`Browser market evidence (${sig.browserEvidenceCount})`); else unknown.push('Public web market evidence (browser research)');
  for (const [k, v] of [['Flood (FEMA)', sig.flood], ['Wetlands (NWI)', sig.wetlands], ['Slope (USGS)', sig.slope]] as const) {
    if (v === 'verified') { verified.push(k); retrieved.push(k); } else unknown.push(`${k} (${v ?? 'not retrieved'})`);
  }
  if (sig.demographics === 'verified') { verified.push('Demographics (Census)'); retrieved.push('Demographics (Census)'); }
  else if (sig.demographics && sig.demographics !== 'not_run') unknown.push(`Demographics (Census ${sig.demographics})`);

  // Score: identity is the heaviest signal; the rest are additive.
  let score = 0;
  if (sig.identityVerified) score += 40; else if (tier === 'candidate_parcel') score += 18;
  if (sig.compsCount > 0) score += 18;
  if (sig.visualsCaptured > 0) score += 12;
  if (sig.marketPulse) score += 8;
  if (sig.browserEvidenceCount > 0) score += 10;
  score += [sig.flood, sig.wetlands, sig.slope].filter((x) => x === 'verified').length * 4;
  if (sig.demographics === 'verified') score += 6;
  score = Math.min(100, score);

  const status: PreCallStatus = score >= 70 ? 'high' : score >= 45 ? 'moderate' : score >= 20 ? 'limited' : 'needs_verification';

  return {
    identityTier: tier,
    identityTierLabel: IDENTITY_TIER_LABEL[tier],
    status,
    statusLabel: PRE_CALL_STATUS_LABEL[status],
    score,
    retrieved, verified, candidateEvidence, unknown,
    note: tier === 'verified_parcel'
      ? 'Exact parcel verified; pre-call intelligence assembled from configured sources.'
      : tier === 'candidate_parcel'
        ? 'Parcel not fully verified — treat parcel facts as candidate evidence; market intelligence from area context.'
        : 'Exact parcel not verified — market intelligence generated from area context (city/county/ZIP/acreage). Parcel Identity: Needs Verification.',
  };
}
