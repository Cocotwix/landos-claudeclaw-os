// APN capture must survive sentence punctuation.
//
// Live acceptance finding (Phase 3, new-intake condition): an operator paste
// ending "Parcel: 015 027 04512 000 2026." stored the APN WITH the trailing
// period. Official county/state parcel layers match a parcel number exactly, so
// the trailing period silently defeated the lookup and a genuinely resolvable
// parcel stayed provisional — with no visible reason.
//
// This is system-wide: it applies to every intake, not one property.

import { describe, expect, it } from 'vitest';
import { extractApnCandidates } from './intake-normalize.js';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';
import { apnEquivalent, distinctApnIdentities, jurisdictionPrefixBetween, normalizeApn } from './property-intelligence-snapshot.js';
import { extractPropertyArgs } from './duke-preflight.js';

describe('labeled APN capture strips trailing sentence punctuation', () => {
  it('drops a trailing period from a labeled parcel number', () => {
    const result = extractApnCandidates('Cocke County, Tennessee. Parcel: 015 027 04512 000 2026.');
    expect(result.primary).toBeTruthy();
    expect(result.primary!.endsWith('.')).toBe(false);
    expect(normalizeApn(result.primary!)).toBe(normalizeApn('015 027 04512 000 2026'));
  });

  it('drops trailing dashes and slashes too', () => {
    for (const suffix of ['-', '/', ' ', '.']) {
      const result = extractApnCandidates(`APN: 073090 04200${suffix}`);
      expect(result.primary).toBeTruthy();
      expect(/[\s./-]$/.test(result.primary!)).toBe(false);
    }
  });

  it('keeps punctuation that is genuinely inside the identifier', () => {
    const result = extractApnCandidates('Parcel ID: 094-020.08 in Scott County');
    expect(result.primary).toBeTruthy();
    expect(normalizeApn(result.primary!)).toBe(normalizeApn('094-020.08'));
  });

  it('carries through the conversational lead parser', () => {
    const lead = parseConversationalLeadIntake(
      'Seller: Travis Joines. Property address: TALLEY RD, Newport, TN 37843. County: Cocke County, Tennessee. APN: 015 027 04512 000 2026. Acreage: 5.82 acres.',
    );
    expect(lead.apn).toBeTruthy();
    expect(lead.apn!.endsWith('.')).toBe(false);
  });
});

describe('APN formatting equivalence never creates a false conflict', () => {
  it('treats a trailing-period spelling as the same parcel', () => {
    expect(apnEquivalent('015 027 04512 000 2026.', '015 027 04512 000 2026')).toBe(true);
    expect(distinctApnIdentities(['015 027 04512 000 2026.', '015 027 04512 000 2026'])).toHaveLength(1);
  });

  it('still separates two genuinely different parcels', () => {
    expect(distinctApnIdentities(['015 027 04512 000 2026', '015 027 04513 000 2026'])).toHaveLength(2);
  });
});

// ── County/district prefix equivalence ──────────────────────────────────────
// Proven live on Deal 32 against the Tennessee Comptroller layer: ONE Roane
// parcel answers both spellings — PARCELID "073 090    04200 000 2026",
// GISLINK "073090    04200", CMAP 090 / PARCEL 042.00, OWNER "SACHAN DILEEP S".
// LandPortal displays the county-local "map + parcel" form (090 04200); the
// state layer prefixes the county NUMBER (073). Same parcel, two conventions.

describe('jurisdiction-prefix APN equivalence', () => {
  it('treats the Deal 32 state and county-local forms as one parcel', () => {
    expect(apnEquivalent('073090 04200', '090 04200')).toBe(true);
    expect(jurisdictionPrefixBetween('073090 04200', '090 04200')).toBe('073');
    expect(distinctApnIdentities(['073090 04200', '090 04200'])).toEqual(['073090 04200']);
  });

  it('keeps the fuller spelling because it carries the jurisdiction context', () => {
    expect(distinctApnIdentities(['090 04200', '073090 04200'])).toEqual(['073090 04200']);
  });

  it('is order-insensitive and tolerant of punctuation', () => {
    expect(apnEquivalent('090-04200', '073-090-04200')).toBe(true);
    expect(apnEquivalent('073 090 04200', '090 04200')).toBe(true);
  });

  it('refuses to collapse a genuinely different parcel', () => {
    // Same length, different digits — not a prefix relationship at all.
    expect(apnEquivalent('073090 04200', '073090 04201')).toBe(false);
    // A suffix match that would require an implausibly long "prefix" is not a
    // county code; collapsing it would merge two unrelated parcels.
    expect(apnEquivalent('1234567890 04200', '04200')).toBe(false);
    expect(jurisdictionPrefixBetween('1234567890 04200', '04200')).toBeNull();
  });

  it('will not treat a short fragment as a county-local identifier', () => {
    // "04200" alone is a parcel fragment, not a usable local identifier.
    expect(apnEquivalent('073090 04200', '04200')).toBe(false);
  });

  it('still separates two genuinely distinct parcels in one lead', () => {
    expect(distinctApnIdentities(['073090 04200', '073090 04300'])).toHaveLength(2);
  });
});

// Operator acceptance regression: a Tennessee map/group/parcel number
// ("073009G B 03600") was truncated to its first group by a digits-only
// scanner. A truncated parcel number is a DIFFERENT parcel, not a partial one.
describe('alphanumeric parcel numbers with a letter group code', () => {
  it('keeps the whole labeled parcel number', () => {
    expect(extractApnCandidates('APN 073009G B 03600, Roane County, Tennessee').primary)
      .toBe('073009G B 03600');
    expect(extractApnCandidates('Parcel ID: 073 009G B 03600').primary)
      .toBe('073 009G B 03600');
  });

  it('still keeps purely numeric formats intact', () => {
    expect(extractApnCandidates('APN 073090 04200, Roane County TN').primary).toBe('073090 04200');
    expect(extractApnCandidates('apn 015 027 04512 000 2026').primary).toBe('015 027 04512 000 2026');
    expect(extractApnCandidates('APN: 123-45-678').primary).toBe('123-45-678');
  });

  it('never reads a street address, a phone number or prose as a parcel number', () => {
    expect(extractApnCandidates('4713 Sinking Creek Rd, London KY').primary).toBeUndefined();
    expect(extractApnCandidates('12345 Main St, Somewhere TX').primary).toBeUndefined();
    expect(extractApnCandidates('Call Maria at 704 555 0182').primary).toBeUndefined();
    expect(extractApnCandidates('Lot 54 B of the recorded plat').primary).toBeUndefined();
  });
});

// ── The APN the OPERATOR route actually stores ──────────────────────────────
//
// Recovery acceptance finding: proving `extractApnCandidates` keeps a parcel
// number proves nothing about the New Lead route. `fieldsFromArgs` resolves
// `a.apn ?? intake.apn ?? apnCands.primary`, so the value from
// `extractPropertyArgs` OUTRANKS the correct one. Its digits-only token class
// truncated "073 090 04200 A-1" to "073 090 04200" and missed "R1234-567A"
// entirely, and the Deal Card then displayed a DIFFERENT parcel number than
// the operator supplied. These assert the route, not the helper.
describe('New Lead intake preserves a complete APN end to end', () => {
  const routeApn = (raw: string) => parseConversationalLeadIntake(raw).apn;

  it('keeps a trailing alphanumeric group', () => {
    expect(extractPropertyArgs('parcel 073 090 04200 A-1, Roane County, TN')?.apn).toBe('073 090 04200 A-1');
    expect(routeApn('Marcia Alvarez-Doyle, parcel 073 090 04200 A-1, Roane County, Tennessee.')).toBe('073 090 04200 A-1');
    expect(routeApn('APN 073 090 04200 A-1, Roane County, TN')).toBe('073 090 04200 A-1');
  });

  it('keeps a district letter that OPENS the parcel number', () => {
    expect(extractPropertyArgs('parcel R1234-567A, Laurel County, KY')?.apn).toBe('R1234-567A');
    expect(routeApn('Owner Bob Reyes, parcel R1234-567A, Laurel County, Kentucky')).toBe('R1234-567A');
  });

  it('keeps a letter group code BETWEEN numeric groups under either label', () => {
    expect(routeApn('Dana Kirk, APN 073009G B 03600, Roane County, TN')).toBe('073009G B 03600');
    expect(routeApn('Dana Kirk, parcel 073009G B 03600, Roane County, TN')).toBe('073009G B 03600');
  });

  it('still refuses to read a street address as a parcel number', () => {
    // The token class now admits letters, so the street-name guard is the only
    // thing standing between "Parcel: 12 Oak Street" and a corrupt parcel id.
    expect(routeApn('Seller Ann, 4713 Sinking Creek Rd, London, Kentucky')).toBeNull();
    expect(routeApn('Address: 731 Filter Plant Rd, Kingston, TN')).toBeNull();
    expect(routeApn('Parcel: 12 Oak Street, Somewhere, TN')).toBeNull();
    expect(extractPropertyArgs('Address: 731 Filter Plant Rd, Kingston, TN')?.apn).toBeUndefined();
  });

  it('does not alter an APN that ends a sentence', () => {
    // A trailing period defeats the EXACT match an official parcel layer needs.
    expect(routeApn('Parcel: 015 027 04512 000 2026.')).toBe('015 027 04512 000 2026');
    expect(extractPropertyArgs('Parcel: 015 027 04512 000 2026.')?.apn).toBe('015 027 04512 000 2026');
  });

  it('leaves established numeric and dotted formats untouched', () => {
    expect(routeApn('Parcel ID: 094-020.08 in Scott County')).toBe('094-020.08');
    expect(routeApn('APN 073090 04200, Roane County TN')).toBe('073090 04200');
  });
});
