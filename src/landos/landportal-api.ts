// LandPortal internal REST retrieval.
//
// LandPortal is WordPress and serves its own parcel page from
// `POST /wp-json/lp-internal/v1/single-property` with `{property_id, fips}` —
// both of which LandOS already decodes from the canonical parcel URL. One call
// returns ~15KB: 144 subject fields plus the comparables, in about 1.5 seconds.
//
// That replaces the retrieval the browser was doing field by field and comp by
// comp: the field scrape, the comparable sidebar read, and the per-comparable
// drill-down that opened up to twelve pages in sequence. Measured on
// 5170 Hwy 60 the browser pass cost roughly thirteen minutes and returned less.
//
// What it does NOT replace is any capture whose VALUE is the rendered image —
// parcel view, wetlands, contours, 3D, buildability, Street View. Those stay on
// CDP, because there the screenshot is the evidence.
//
// Nothing here changes the evidence model. The field labels below are exactly
// the labels the panel scrape already produced, so every downstream reader —
// screening, valuation, Property Intelligence — sees what it always saw.

/** A `similars` entry as LandPortal returns it. Only the fields LandOS uses. */
export interface LandPortalApiSimilar {
  apn?: string | null;
  fips?: string | null;
  propertyid?: number | string | null;
  mls_propertyid?: number | string | null;
  mls_price?: number | null;
  mls_status?: string | null;
  mls_dom?: number | null;
  area_acres?: number | null;
  new_date?: string | null;
  sold_year?: number | null;
  sold_month?: number | null;
  sold_day?: number | null;
  distance?: number | null;
  situslatitude?: number | null;
  situslongitude?: number | null;
  price_acres?: number | null;
  mls_priceperacre?: number | null;
  vacant?: boolean | null;
  bldg_count?: number | null;
  propertyclassid?: string | null;
  municipality?: string | null;
  situszip5?: string | null;
  landusecode?: string | null;
}

export interface LandPortalApiSubject {
  properties: Record<string, unknown>;
  similars: LandPortalApiSimilar[];
}

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).trim();
};

const num = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // An absent or non-numeric value is NULL, never zero. Coercing '' to 0 would
  // publish "0.00 %" slope or a $0 assessed value for a field LandPortal simply
  // did not supply — a fabricated fact, which is worse than a missing one.
  const cleaned = String(value).replace(/[^0-9.-]/g, '').trim();
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const usd = (value: unknown): string => {
  const parsed = num(value);
  return parsed == null ? '' : `$${parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const pct = (value: unknown, digits = 2): string => {
  const parsed = num(value);
  return parsed == null ? '' : `${parsed.toFixed(digits)} %`;
};

const feet = (value: unknown, digits = 2): string => {
  const parsed = num(value);
  return parsed == null ? '' : `${parsed.toFixed(digits)} ft`;
};

/**
 * Map the API's `properties` onto the EXACT parcel-panel labels the scrape
 * produced. Every key here was read from a real retained inspection, so this is
 * a like-for-like substitution rather than a new vocabulary.
 */
export function landPortalFactsFromApi(properties: Record<string, unknown>): Record<string, string> {
  const p = properties ?? {};
  const out: Record<string, string> = {};
  const put = (label: string, value: string): void => { if (value && value !== '-') out[label] = value; };

  put('Owner Name', text(p.ownername1full));
  put('Owner First Name', text(p.owner1firstname));
  put('Owner Last Name', text(p.owner1lastname));
  put('Parcel ID', text(p.apn));
  put('Parcel Address', text(p.situsfullstreetaddress));
  put('Parcel Address City', text(p.situscity));
  put('Parcel Address State', text(p.situsstate));
  put('Parcel Address Zip Code', text(p.situszip5));
  put('Parcel Address County', text(p.situscounty));
  put('Mailing Address', text(p.mailingfullstreetaddress));
  put('Mailing Address City', text(p.mailingcity));
  put('Mailing Address State', text(p.mailingstate));
  put('Mailing Address ZIP Code', text(p.mailingzip5));

  const acres = num(p.lotsizeacres);
  put('Acres', acres == null ? '' : acres.toFixed(3));
  const calcAcres = num(p.calc_acres);
  put('Calc Acres', calcAcres == null ? '' : calcAcres.toFixed(2));
  put('Parcel SqFt', text(num(p.lotsizesqft)));
  put('Building SqFt', text(num(p.sumbuildingsqft) ?? num(p.buildingarea)));

  put('Land Locked', text(p.land_locked));
  put('Road Frontage', feet(p.road_frontage));
  const waterTypes = text(p.water_feature_types);
  put('Water Feature', text(p.water_feature_is));
  put('Water Feature type(s)', waterTypes);
  put('Water Feature Type', waterTypes);

  put('Zoning Code', text(p.zoning));
  put('Parcel Use Code', text(p.landusecode));
  put('Parcel Use Description', text(p.landusecodedescription));
  put('Legal Description', text(p.legaldescription));
  put('Municipality', text(p.municipality));

  // Screening values the SOP reads straight off the panel.
  put('Wetlands Coverage (%)', text(num(p.wetlands_cover_percentage)));
  put('FEMA Coverage (%)', text(num(p.fema_cover_percentage)));
  put('FEMA Flood Zone', text(p.flfemafloodzone));
  put('FEMA Flood Zone Description', text(p.flfemafloodzone));

  put('Buildability total (%)', pct(p.buildability_total_perc));
  const buildArea = num(p.buildability_area);
  put('Buildability area (acres)', buildArea == null ? '' : `${buildArea.toFixed(2)} ac.`);
  put('Slope Avg', pct(p.slope_average));
  put('Slope Min', pct(p.slope_min));
  put('Slope Max', pct(p.slope_max));
  put('Flat Slope (0-.5%)', pct(p.percentage_of_land_with_flat_slope_0_05));
  put('Minimal Slope (.5-5%)', pct(p.percentage_of_land_with_minimal_slope_05_5));
  put('Moderate Slope (5-10%)', pct(p.percentage_of_land_with_moderate_slope_5_10));
  put('Heavy Slope (10-15%)', pct(p.percentage_of_land_with_heavy_slope_10_15));
  put('Extreme Slope (15%+)', pct(p.percentage_of_land_with_extreme_slope_15));
  put('Elevation Avg', feet(p.elevation_average));
  put('Elevation Min', feet(p.elevation_min));
  put('Elevation Max', feet(p.elevation_max));

  put('Structure Year Built', text(num(p.yearbuilt)));
  put('Number of Bedrooms', text(num(p.bedrooms)));
  put('Number of Baths', text(num(p.bathtotalcalc)));

  put('Assessed Value', usd(p.assdtotalvalue));
  put('Land Assessed Value', usd(p.assdlandvalue));
  put('Improvement Value', text(num(p.assdimprovementvalue)));
  put('Total Market Value', usd(p.markettotalvalue));
  put('Land Market Value', usd(p.marketvalueland));
  put('Tax Amount', usd(p.taxamt));

  const estimate = num(p.tlp_estimate);
  put('Estimate price', estimate == null ? '' : `$${Math.round(estimate).toLocaleString('en-US')}`);
  const ppa = num(p.tlp_ppa);
  put('Estimate PPA', ppa == null ? '' : `$${Math.round(ppa).toLocaleString('en-US')}`);

  put('Centroid Latitude', text(p.situslatitude ?? p.latitude));
  put('Centroid Longitude', text(p.situslongitude ?? p.longitude));

  return out;
}

/** The canonical LandPortal parcel URL for an identity triple. */
export function landPortalParcelUrl(input: { fips: string; apn: string; propertyId: string | number }): string {
  const token = Buffer.from(
    `fips=${input.fips}&apn=${String(input.apn).replace(/ /g, '+')}&propertyid=${input.propertyId}`,
    'utf8',
  ).toString('base64');
  return `https://landportal.com/?property=${token}`;
}

/**
 * Comparable cards in the SAME JSON shape `parseComparableCard` already reads
 * from the sidebar, so the comp pipeline is untouched. The `text` line uses the
 * sidebar's own "identity | $price | acres ac" format.
 */
export function landPortalCompCardsFromApi(similars: LandPortalApiSimilar[]): string[] {
  const cards: string[] = [];
  for (const s of similars ?? []) {
    const apn = text(s.apn).replace(/\s+/g, ' ').trim();
    const price = num(s.mls_price);
    const acres = num(s.area_acres);
    if (!apn || price == null || acres == null) continue;
    const label = apn;
    cards.push(JSON.stringify({
      text: `${label} | $${Math.round(price).toLocaleString('en-US')} | ${acres.toFixed(2)} ac`,
      sectionLabel: '',
      mlsStatus: text(s.mls_status) || null,
      propertyId: s.propertyid == null ? null : String(s.propertyid),
      fips: text(s.fips) || null,
      apn,
      mlsPropertyId: s.mls_propertyid == null ? null : String(s.mls_propertyid),
    }));
  }
  return cards;
}

/**
 * Per-comparable detail in the same `{apn, propertyId, sourceUrl, facts}` shape
 * the drill-down produced — but assembled from the payload we already have,
 * rather than by opening each comparable's page in sequence.
 *
 * These facts carry the coordinates the browser pass never obtained, which is
 * why every comp previously rendered "location unresolved (never guessed)".
 */
export function landPortalCompDetailsFromApi(similars: LandPortalApiSimilar[]): string[] {
  const details: string[] = [];
  for (const s of similars ?? []) {
    const apn = text(s.apn).replace(/\s+/g, ' ').trim();
    if (!apn) continue;
    const facts: Record<string, string> = {};
    const put = (k: string, v: string): void => { if (v) facts[k] = v; };
    put('Parcel ID', apn);
    const acres = num(s.area_acres);
    put('Acres', acres == null ? '' : acres.toFixed(3));
    const price = num(s.mls_price);
    put('Last Sale Price', price == null ? '' : `$${Math.round(price).toLocaleString('en-US')}`);
    put('Last Sale Date', text(s.new_date));
    put('Parcel Address City', text(s.municipality));
    put('Parcel Address Zip Code', text(s.situszip5));
    put('Centroid Latitude', text(s.situslatitude));
    put('Centroid Longitude', text(s.situslongitude));
    put('Parcel Use Code', text(s.landusecode ?? ''));
    put('Building SqFt', s.bldg_count === 0 ? '0' : '');
    const ppa = num(s.mls_priceperacre) ?? num(s.price_acres);
    put('Estimate PPA', ppa == null ? '' : `$${Math.round(ppa).toLocaleString('en-US')}`);
    const sourceUrl = s.fips && s.propertyid
      ? landPortalParcelUrl({ fips: text(s.fips), apn, propertyId: String(s.propertyid) })
      : undefined;
    details.push(JSON.stringify({ apn, propertyId: s.propertyid == null ? null : String(s.propertyid), sourceUrl, facts }));
  }
  return details;
}

/** Parse the `similars` member, which LandPortal returns JSON-encoded. */
export function landPortalSimilarsFrom(properties: Record<string, unknown>): LandPortalApiSimilar[] {
  const raw = properties?.similars;
  if (Array.isArray(raw)) return raw as LandPortalApiSimilar[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as LandPortalApiSimilar[] : [];
    } catch { return []; }
  }
  return [];
}
