// Operator-facing comp provider identity.
//
// Internal adapter identifiers (e.g. "homeharvest") are implementation detail
// and must never be the ONLY source description an operator sees. This map
// separates: internal adapter id ↔ operator display name ↔ what the source
// actually is. "homeharvest" is the open-source HomeHarvest extraction lane
// whose underlying listing/sold data comes from Realtor.com (MIT-licensed,
// keyless, non-paid) — the operator-facing truth is "Realtor.com".
//
// Pure. No I/O.

export interface CompProviderIdentity {
  /** Internal adapter identifier (lowercased). */
  adapterId: string;
  /** Operator display name. */
  displayName: string;
  /** What the source is, in one operator-readable line. */
  description: string;
}

const PROVIDERS: CompProviderIdentity[] = [
  { adapterId: 'homeharvest', displayName: 'Realtor.com (HomeHarvest)', description: 'Realtor.com listing and sold data retrieved through the open-source HomeHarvest lane (keyless, non-paid).' },
  { adapterId: 'realie', displayName: 'Realie.ai', description: 'Realie.ai premium comparables (authorized API key).' },
  { adapterId: 'zillow', displayName: 'Zillow', description: 'Zillow public land listings/solds (read-only).' },
  { adapterId: 'zillow_browser', displayName: 'Zillow (browser)', description: 'Zillow public pages read in an isolated browser profile.' },
  { adapterId: 'redfin', displayName: 'Redfin', description: 'Redfin public land listings/solds (read-only).' },
  { adapterId: 'redfin_browser', displayName: 'Redfin (browser)', description: 'Redfin public pages read in an isolated browser profile.' },
  { adapterId: 'landportal', displayName: 'LandPortal (visible sales)', description: 'Free visible "similar sales" rows on the authenticated LandPortal parcel page (never the paid comp report).' },
  { adapterId: 'landportal visible', displayName: 'LandPortal (visible sales)', description: 'Free visible "similar sales" rows on the authenticated LandPortal parcel page (never the paid comp report).' },
  { adapterId: 'apify', displayName: 'Redfin (Apify)', description: 'Redfin extraction through the Apify actor.' },
  { adapterId: 'county', displayName: 'County records', description: 'Official county recorded-sale data.' },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.adapterId, p]));

export function providerIdentity(raw: string | null | undefined): CompProviderIdentity {
  const id = (raw ?? '').trim().toLowerCase();
  const hit = BY_ID.get(id) ?? PROVIDERS.find((p) => id.includes(p.adapterId) || p.adapterId.includes(id));
  if (hit) return hit;
  const cleaned = (raw ?? '').trim() || 'Unknown source';
  return { adapterId: id || 'unknown', displayName: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), description: 'Source adapter without a registered operator name — shown as reported.' };
}

export function providerDisplayName(raw: string | null | undefined): string {
  return providerIdentity(raw).displayName;
}
