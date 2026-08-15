// Comparable provenance, presented the way an operator reads it.
//
// A deduplicated comp carries every observation that described the parcel, and
// its `source` is those observations joined with " + ". That string is a record
// of the reconciliation, not a label: rendering it verbatim puts a paragraph of
// repeated provider names where a name belongs, and one 5,347-character value
// stretched the comp map's hover preview to 4,652px, off the canvas.
//
// Every surface that shows "who said this" goes through here, so the same
// record always names the same providers in the list, the map and full details.

/** The provider an observation label belongs to, or the label itself. */
export function providerLabel(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  if (key.includes('landportal')) return 'LandPortal';
  if (key.includes('zillow')) return 'Zillow';
  if (key.includes('redfin')) return 'Redfin';
  if (key.includes('realtor')) return 'Realtor.com';
  return value;
}

/**
 * The providers named by one possibly-joined source label.
 *
 * For records that carry only a `source` string and no origins list, this is
 * the safe way to render it: "LandPortal + Hermes / LandPortal + LandPortal"
 * becomes "LandPortal".
 */
export function providerSummary(value: string | null | undefined): string {
  const names = Array.from(new Set(
    String(value ?? '').split(' + ').map((label) => label.trim()).filter(Boolean).map(providerLabel),
  ));
  return names.join(' · ');
}

export interface CompProvenanceRecord {
  source: string;
  origins: string[];
  fromLandPortalSidebar: boolean;
  fromLandPortalShowOnMap: boolean;
}

/**
 * The distinct providers behind one physical property, in first-seen order.
 *
 * Joined labels are split back into the observations they were made from, so a
 * record merged three times reads as the two or three providers that actually
 * described it rather than as the merge history.
 */
export function compProviders(c: Pick<CompProvenanceRecord, 'source' | 'origins'>): string[] {
  return Array.from(new Set(
    [c.source, ...(c.origins ?? [])]
      .flatMap((label) => String(label ?? '').split(' + '))
      .map((label) => label.trim())
      .filter(Boolean)
      .map(providerLabel),
  ));
}

/**
 * Which LandPortal surfaces published this comp.
 *
 * LandPortal is read twice — the comparable sidebar and Show on Map — and a
 * record both surfaces carry is one property corroborated twice, never two
 * comps. Naming the surfaces is how the operator can see that corroboration
 * instead of inferring it from a single "LandPortal" badge.
 */
export function landPortalSurfaceLabel(
  c: Pick<CompProvenanceRecord, 'fromLandPortalSidebar' | 'fromLandPortalShowOnMap'>,
): string | null {
  if (c.fromLandPortalSidebar && c.fromLandPortalShowOnMap) return 'LandPortal sidebar + Show on Map';
  if (c.fromLandPortalSidebar) return 'LandPortal sidebar';
  if (c.fromLandPortalShowOnMap) return 'LandPortal Show on Map';
  return null;
}
