/**
 * Property Evidence Package — the reusable, source-aware contract that LandOS
 * surfaces (lead/deal card, Property Intelligence, Market Intelligence, and
 * God's Eye View) exchange WITHOUT rerunning underlying research.
 *
 * Doctrine embedded in the types:
 * - Every fact carries source authority, retrieval date, confidence, and
 *   whether it is a confirmed fact vs an AI interpretation.
 * - Parcel geometry is optional: consumers must function on coordinates,
 *   parcel identifiers, imagery, and whatever evidence exists (PERMANENT
 *   MEMORY invariants 2-4 still gate parcel identity itself).
 * - Sold comps + their median sold $/acre remain the primary rough-FMV
 *   baseline; active listings inform competition and exit positioning only.
 *   Nothing here invents numeric adjustments from visual differences.
 */

export type EvidenceConfidence = 'confirmed' | 'well-supported' | 'likely' | 'unresolved';

export interface EvidenceSource {
  /** Human-readable authority, e.g. "Marion County GIS", "LandPortal", "Redfin sale history". */
  authority: string;
  /** Original source link when one exists. */
  url?: string;
  /** Primary/official vs reputable secondary vs search-result evidence. */
  tier?: 'primary' | 'secondary' | 'search-result';
  retrievedAt?: string; // ISO date
  publishedAt?: string; // ISO date
}

export interface EvidencedValue<T> {
  value: T;
  source?: EvidenceSource;
  confidence?: EvidenceConfidence;
  /** true = confirmed fact; false = AI interpretation/derivation. */
  confirmedFact?: boolean;
  note?: string;
}

export interface GeoPoint { lat: number; lon: number; }

/** GeoJSON-style geometry, kept loose on purpose (source shapes vary). */
export interface GeoGeometry {
  type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'Point';
  coordinates: unknown;
}

export interface PhotoRef {
  url: string;
  source?: EvidenceSource;
  caption?: string;
  capturedAt?: string;
}

export interface StreetViewpoint {
  point: GeoPoint;
  headingDeg?: number;
  captureDate?: string;
  source?: EvidenceSource;
}

export interface ConstraintArea {
  kind: 'wetland' | 'flood-zone' | 'slope' | 'buffer' | 'easement' | 'other';
  label?: string;
  geometry?: GeoGeometry;
  affectedAcres?: EvidencedValue<number>;
  source?: EvidenceSource;
}

export interface ComparableSale {
  id?: string;
  address?: string;
  apn?: string;
  point?: GeoPoint;
  acres?: number;
  soldPrice?: number;
  soldDate?: string;
  listDate?: string;
  daysOnMarket?: number;
  pricePerAcre?: number;
  /** Why this comp is in (or out of) the set — preserved, never re-derived. */
  inclusionReason?: string;
  rejectionReason?: string;
  source?: EvidenceSource;
  photos?: PhotoRef[];
}

export interface ActiveListing {
  id?: string;
  address?: string;
  point?: GeoPoint;
  acres?: number;
  listPrice?: number;
  listDate?: string;
  daysOnMarket?: number;
  pricePerAcre?: number;
  source?: EvidenceSource;
}

export interface OperatorFinding {
  kind: 'annotation' | 'measurement' | 'screenshot' | 'note';
  label?: string;
  geometry?: GeoGeometry;
  valueText?: string;
  imageUrl?: string;
  createdAt?: string;
}

/** The initial property-entry contract (task items a–ab). All optional except identity+location basics. */
export interface PropertyEvidencePackage {
  // a/b — identifiers
  leadId?: number | string;
  dealId?: number | string;
  propertyId?: string;
  address?: string;
  apn?: string;
  county?: string;
  state?: string;
  fips?: string;
  landportalId?: string;

  // c/d — geometry + location
  parcelGeometry?: GeoGeometry;
  subject: GeoPoint;

  // e — size + jurisdiction
  acreage?: EvidencedValue<number>;
  jurisdiction?: EvidencedValue<string>;

  // f/g/h — imagery
  photos?: PhotoRef[];
  aerialImagery?: PhotoRef[];
  streetViewpoints?: StreetViewpoint[];

  // i–n — constraints and access
  wetlands?: ConstraintArea[];
  floodZones?: ConstraintArea[];
  terrain?: {
    elevationFt?: EvidencedValue<number>;
    slopeSummary?: EvidencedValue<string>;
    contours?: GeoGeometry;
    constraints?: ConstraintArea[];
  };
  soils?: EvidencedValue<string>[];
  septicEvidence?: EvidencedValue<string>[];
  buildableAreas?: ConstraintArea[];
  roadFrontage?: EvidencedValue<string>;
  roadClassification?: EvidencedValue<string>;
  accessEvidence?: EvidencedValue<string>[];

  // o/p — improvements + access points
  drivewayCandidates?: GeoPoint[];
  improvements?: EvidencedValue<string>[];

  // q/r/s — land cover, utilities, zoning
  landCover?: EvidencedValue<string>;
  utilities?: EvidencedValue<string>[];
  zoning?: EvidencedValue<string>;
  futureLandUse?: EvidencedValue<string>;

  // t/u/v/w — market evidence
  soldComps?: ComparableSale[];
  activeListings?: ActiveListing[];

  // ab — operator work product
  operatorFindings?: OperatorFinding[];

  /** Free-form extras; forward-compatible. */
  extras?: Record<string, unknown>;
}
