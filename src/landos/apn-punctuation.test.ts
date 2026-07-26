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
