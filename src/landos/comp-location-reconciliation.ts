// Retained-comp location reconciliation — the one place LandOS decides whether
// a retained comparable can be placed on a map, and why not when it cannot.
//
// Every mapping surface asks THIS before it renders a record as unplaced, so a
// comp is never dropped because one lookup channel missed while the evidence sat
// in another. Two halves:
//
//   Identity — a retained comp is joined to the location evidence LandOS already
//     holds by canonical registry key, then parcel APN (state-guarded), then
//     reconciled postal address. Joining on the raw captured address alone loses
//     every record whose identity is an APN and every record whose captured text
//     carries provider listing chrome.
//
//   Address — provider listing cards are captured as ONE text run, so a real
//     postal address arrives glued to marketing text ("482 sqftHouse for
//     sale12344 SW Torch Lake Dr, Rapid City, MI 49676"). The address inside
//     that run is captured evidence, not a guess — but it is accepted only once
//     the record's OWN canonical provider URL independently spells out the same
//     address. Nothing is invented, approximated, or carried in from another
//     property; a record whose evidence does not survive that check stays
//     unresolved and says so in the operator's words.
//
// A geocode places a record that LandOS already has an address for. It never
// establishes parcel identity (PERMANENT_MEMORY invariants 2-4), and this module
// never manufactures the address it geocodes.

/** Whether a coordinate pair is a usable point at all. Never repairs one. */
export function validCompPoint(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

const words = (value: string): string[] =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);

/** Normalized geocode-cache/address-join key. Same shape the cache is keyed by. */
export function compAddressKey(address: string | null | undefined): string {
  return (address ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Digits-only parcel key, matching the comp registry's own APN identity rule. */
export function compApnKey(apn: string | null | undefined): string | null {
  const digits = (apn ?? '').replace(/\D/g, '');
  return digits.length >= 5 ? digits : null;
}

// ── Address reconciliation ───────────────────────────────────────────────────

export type CompAddressBasis = 'captured_address' | 'listing_chrome_corroborated';

export interface CompAddressReconciliation {
  /** The postal address the record's own captured evidence states. */
  postalAddress: string;
  basis: CompAddressBasis;
  /** The captured artifact the address was read out of, verbatim. */
  capturedFrom: string;
  /** The second captured artifact that confirmed it, when one was required. */
  corroboratedBy: string | null;
  /** Operator-readable trace of how this address was established. */
  evidenceLine: string;
}

/**
 * Marketing text a provider listing card glues onto the address. Only text that
 * carries one of these markers is ever cleaned, so a real address that happens
 * to begin with "Lot 7" is left exactly as captured.
 */
const LISTING_CHROME_MARKER = /sq\s?ft|for sale|for rent|coming soon|under contract/i;

const CHROME_PREFIXES: RegExp[] = [
  // "482 sqft", "-- sqft", "3 bds", "2 ba", "1.5 acres". The long units carry no
  // trailing boundary because the capture runs them straight into the next word
  // ("482 sqftHouse"); the two-letter ones keep it so "1200 Baxter Rd" survives.
  /^(?:--+|\d[\d,]*(?:\.\d+)?)\s*(?:sq\s?ft|acres?|beds?|bds?|baths?|(?:ac|ba)\b)/i,
  // The property-type word. Anchored on a word boundary so "Landing Way" and
  // "Lot 7 County Rd" are never truncated into a different street.
  /^(?:house|home|lot\s*\/\s*land|land|lot|townhouse|condo|co-op|apartment|manufactured(?:\s+home)?|multi[-\s]?family|farm|ranch|new construction|coming soon|auction|foreclosure|pre-foreclosure|pending|active|under contract)\b/i,
  // The marketing phrase itself. NOT boundary-anchored at the end: the capture
  // runs it straight into the house number ("for sale11892 Cabin Ln").
  /^for\s+sale(?:\s+by\s+owner)?/i,
  /^for\s+rent/i,
  /^[-–—|,:•·]+/,
];

/** A string only counts as a postal address if it names a place, not a road. */
function looksPostal(value: string): boolean {
  return /\d/.test(value) && value.includes(',') && words(value).length >= 3;
}

function stripListingChrome(captured: string): string | null {
  const original = captured.trim();
  let rest = original;
  for (let guard = 0; guard < 12; guard += 1) {
    let matched = false;
    for (const pattern of CHROME_PREFIXES) {
      const hit = rest.match(pattern);
      if (hit && hit[0].length > 0) {
        rest = rest.slice(hit[0].length).trimStart();
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return rest && rest.length < original.length ? rest : null;
}

/** Every word a provider detail URL spells out about its own listing. */
function listingUrlWords(sourceUrl: string | null | undefined): string[] {
  if (!sourceUrl) return [];
  try {
    const parsed = new URL(sourceUrl);
    return words(decodeURIComponent(parsed.pathname));
  } catch {
    return words(String(sourceUrl));
  }
}

/**
 * Recover the postal address a retained comparable's own captured evidence
 * states. Returns null when nothing legitimate states one — that is a correct
 * answer, not a failure to hide.
 */
export function reconcileCompAddress(input: {
  capturedAddress?: string | null;
  sourceUrl?: string | null;
}): CompAddressReconciliation | null {
  const captured = (input.capturedAddress ?? '').replace(/\s+/g, ' ').trim();
  if (!captured) return null;

  // No provider chrome in the first segment: the capture is already the address
  // it claims to be, and reconciling it would only risk corrupting it.
  if (!LISTING_CHROME_MARKER.test(captured.split(',')[0] ?? '')) {
    return {
      postalAddress: captured,
      basis: 'captured_address',
      capturedFrom: captured,
      corroboratedBy: null,
      evidenceLine: `Address as captured from the source record: "${captured}".`,
    };
  }

  // Chrome IS present, so the raw run is not usable as an address. Either the
  // real address survives corroboration below, or this record has none.
  const cleaned = stripListingChrome(captured);
  if (!cleaned || !looksPostal(cleaned)) return null;

  // The chrome-stripped address is only usable once the record's OWN canonical
  // provider URL states the same address. One captured artifact reading it out
  // of another is reconciliation; one artifact alone would be a guess.
  const urlWords = listingUrlWords(input.sourceUrl);
  if (!urlWords.length) return null;
  const addressWords = words(cleaned);
  const corroborated = addressWords.every((word) => urlWords.includes(word));
  if (!corroborated) return null;

  return {
    postalAddress: cleaned,
    basis: 'listing_chrome_corroborated',
    capturedFrom: captured,
    corroboratedBy: input.sourceUrl ?? null,
    evidenceLine: `Address "${cleaned}" read out of the captured listing text and confirmed against this record's own source URL.`,
  };
}

// ── Identity-keyed location evidence ─────────────────────────────────────────

export type CompLocationMatch = 'canonical_key' | 'apn' | 'address';

export interface RetainedLocationRecord {
  /** Canonical registry key for the record, when it has one. */
  key?: string | null;
  apn?: string | null;
  state?: string | null;
  address?: string | null;
  sourceUrl?: string | null;
  lat: number | null;
  lng: number | null;
  /** Where this point came from, quoted back to the operator verbatim. */
  source: string;
}

export interface RetainedLocationIdentity {
  key?: string | null;
  apn?: string | null;
  state?: string | null;
  address?: string | null;
  sourceUrl?: string | null;
}

export interface RetainedLocationHit {
  lat: number;
  lng: number;
  source: string;
  matchedBy: CompLocationMatch;
  /** The identity value that carried the join. */
  reference: string;
}

export interface RetainedLocationIndex {
  find(identity: RetainedLocationIdentity): RetainedLocationHit | null;
  size: number;
}

interface IndexedPoint {
  lat: number;
  lng: number;
  source: string;
  state: string | null;
}

const stateKey = (state: string | null | undefined): string | null => {
  const value = (state ?? '').trim().toUpperCase();
  return value ? value : null;
};

/**
 * Index every point LandOS already retains for this deal's comparables under
 * each identity channel the record can be recognized by. Later records never
 * overwrite an earlier point for the same identity, so the strongest source
 * registered first stays authoritative.
 */
export function buildRetainedLocationIndex(records: RetainedLocationRecord[]): RetainedLocationIndex {
  const byKey = new Map<string, IndexedPoint>();
  const byApn = new Map<string, IndexedPoint>();
  const byAddress = new Map<string, IndexedPoint>();
  let size = 0;

  for (const record of records) {
    if (!validCompPoint(record.lat, record.lng)) continue;
    const point: IndexedPoint = {
      lat: record.lat as number,
      lng: record.lng as number,
      source: record.source,
      state: stateKey(record.state),
    };
    size += 1;
    const key = (record.key ?? '').trim();
    if (key && !byKey.has(key)) byKey.set(key, point);
    const apn = compApnKey(record.apn);
    if (apn && !byApn.has(apn)) byApn.set(apn, point);
    const reconciled = reconcileCompAddress({ capturedAddress: record.address, sourceUrl: record.sourceUrl });
    for (const candidate of [reconciled?.postalAddress, record.address]) {
      const addressKey = compAddressKey(candidate);
      if (addressKey && !byAddress.has(addressKey)) byAddress.set(addressKey, point);
    }
  }

  return {
    size,
    find(identity) {
      const key = (identity.key ?? '').trim();
      const keyed = key ? byKey.get(key) : undefined;
      if (keyed) return { lat: keyed.lat, lng: keyed.lng, source: keyed.source, matchedBy: 'canonical_key', reference: key };

      const apn = compApnKey(identity.apn);
      if (apn) {
        const hit = byApn.get(apn);
        // A parcel number is only unique inside its state. Two states' rolls can
        // reuse the same digits, and a comp must never inherit another
        // property's point (PERMANENT_MEMORY invariant 4).
        const identityState = stateKey(identity.state);
        const conflict = hit && hit.state && identityState && hit.state !== identityState;
        if (hit && !conflict) {
          return { lat: hit.lat, lng: hit.lng, source: hit.source, matchedBy: 'apn', reference: `APN ${(identity.apn ?? '').trim()}` };
        }
      }

      const reconciled = reconcileCompAddress({ capturedAddress: identity.address, sourceUrl: identity.sourceUrl });
      for (const candidate of [reconciled?.postalAddress, identity.address]) {
        const addressKey = compAddressKey(candidate);
        const hit = addressKey ? byAddress.get(addressKey) : undefined;
        if (hit) {
          return { lat: hit.lat, lng: hit.lng, source: hit.source, matchedBy: 'address', reference: candidate as string };
        }
      }
      return null;
    },
  };
}

// ── The reconciliation itself ────────────────────────────────────────────────

export type CompLocationBasis =
  | 'retained_coordinates'
  | 'retained_location_record'
  | 'reconciled_address_geocode';

export interface RetainedCompLocationInput {
  /** Address text exactly as the source published it, chrome and all. */
  capturedAddress?: string | null;
  /** The record's own canonical provider URL — never another property's. */
  sourceUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Label for a point already carried on the record itself. */
  retainedCoordinateSource?: string | null;
  key?: string | null;
  apn?: string | null;
  state?: string | null;
  providerLabel?: string | null;
}

export interface RetainedGeocodeHit {
  lat: number;
  lng: number;
  /** Which retained geocode supplied it, in operator language. */
  source: string;
  resolvedAtIso?: string | null;
}

export interface RetainedCompLocation {
  status: 'mapped' | 'unresolved';
  lat: number | null;
  lng: number | null;
  basis: CompLocationBasis | null;
  /** The exact captured evidence that located it. Null when unresolved. */
  evidence: string | null;
  source: string | null;
  resolvedAtIso: string | null;
  /** The postal address this record reconciles to, when it has one. */
  postalAddress: string | null;
  addressBasis: CompAddressBasis | null;
  /** Why it stays unplaced, in the operator's words. Null when mapped. */
  unresolvedReason: string | null;
}

function unresolved(reason: string, address: CompAddressReconciliation | null): RetainedCompLocation {
  return {
    status: 'unresolved',
    lat: null,
    lng: null,
    basis: null,
    evidence: null,
    source: null,
    resolvedAtIso: null,
    postalAddress: address?.postalAddress ?? null,
    addressBasis: address?.basis ?? null,
    unresolvedReason: reason,
  };
}

/**
 * Reconcile one retained comparable's identity and location evidence, then say
 * whether it can be placed. The order runs strongest evidence first: a point the
 * record already carries, a point LandOS retains for the same identity, then a
 * retained geocode of the address the record's own capture states.
 */
export function reconcileRetainedCompLocation(
  input: RetainedCompLocationInput,
  sources: {
    byIdentity?: RetainedLocationIndex | null;
    byAddress?: ((address: string) => RetainedGeocodeHit | null) | null;
    /** True when a location lookup for this address already ran and found none. */
    addressAlreadyAttempted?: ((address: string) => boolean) | null;
  } = {},
): RetainedCompLocation {
  const address = reconcileCompAddress({ capturedAddress: input.capturedAddress, sourceUrl: input.sourceUrl });
  const provider = (input.providerLabel ?? '').trim();

  if (validCompPoint(input.lat, input.lng)) {
    const source = input.retainedCoordinateSource?.trim()
      || (provider ? `${provider} map point` : 'Retained source coordinates');
    return {
      status: 'mapped',
      lat: input.lat as number,
      lng: input.lng as number,
      basis: 'retained_coordinates',
      evidence: `Placed from the coordinates retained on this record (${source}).`,
      source,
      resolvedAtIso: null,
      postalAddress: address?.postalAddress ?? null,
      addressBasis: address?.basis ?? null,
      unresolvedReason: null,
    };
  }

  const identityHit = sources.byIdentity?.find({
    key: input.key,
    apn: input.apn,
    state: input.state,
    address: input.capturedAddress,
    sourceUrl: input.sourceUrl,
  }) ?? null;
  if (identityHit) {
    return {
      status: 'mapped',
      lat: identityHit.lat,
      lng: identityHit.lng,
      basis: 'retained_location_record',
      evidence: `Placed from location evidence LandOS already retains for this record, joined by ${identityHit.reference} (${identityHit.source}).`,
      source: identityHit.source,
      resolvedAtIso: null,
      postalAddress: address?.postalAddress ?? null,
      addressBasis: address?.basis ?? null,
      unresolvedReason: null,
    };
  }

  if (address && sources.byAddress) {
    const hit = sources.byAddress(address.postalAddress);
    if (hit && validCompPoint(hit.lat, hit.lng)) {
      return {
        status: 'mapped',
        lat: hit.lat,
        lng: hit.lng,
        basis: 'reconciled_address_geocode',
        evidence: `${address.evidenceLine} Placed by the retained ${hit.source} for that address.`,
        source: hit.source,
        resolvedAtIso: hit.resolvedAtIso ?? null,
        postalAddress: address.postalAddress,
        addressBasis: address.basis,
        unresolvedReason: null,
      };
    }
  }

  if (address) {
    // Distinguish "not looked up yet" from "looked up and genuinely not found".
    // Telling the operator to re-run a check that already ran and missed is how
    // an honest unresolved turns into a loop they cannot get out of.
    return unresolved(
      sources.addressAlreadyAttempted?.(address.postalAddress)
        ? `LandOS has this record's address (${address.postalAddress}) but the location check already ran against it and no published location matched, so it stays unplaced rather than being approximated.`
        : `LandOS has this record's address (${address.postalAddress}) but no retained location for it yet. Run the location check to resolve it; nothing is placed until a real location exists.`,
      address,
    );
  }

  const captured = (input.capturedAddress ?? '').trim();
  if (captured) {
    return unresolved(
      `The source published this record as "${captured}", which is not a postal address, and no captured source for this record confirms one. It stays unplaced rather than being guessed onto the map.`,
      null,
    );
  }
  if ((input.apn ?? '').trim()) {
    return unresolved(
      `${provider ? `${provider} identified` : 'Identified'} this record by parcel number ${(input.apn ?? '').trim()} only, with no address or coordinate retained for it. A parcel number is identity, not a location, so it stays unplaced.`,
      null,
    );
  }
  return unresolved(
    'No address, parcel number, or coordinate was retained for this record, so there is nothing legitimate to place it with.',
    null,
  );
}
