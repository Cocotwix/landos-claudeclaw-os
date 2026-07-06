import { describe, it, expect } from 'vitest';
import {
  buildSmartIntake, identityConfidence, categorizeDealIntelligence,
} from './smart-intake.js';
import {
  maskFieldLabels, normalizeApn, extractApnCandidates,
} from './intake-normalize.js';
import { classifySmartIntake } from './intake-router.js';

// The exact real-world intake that previously failed: "Parcel ID" was read as
// State = ID (Idaho), Tennessee was dropped, and the alternate APN was ignored.
const SCOTT_COUNTY = `County: Scott County, Tennessee
Location: Henson Lane (near Oneida/Helenwood, TN)
Parcel ID: 094-020.08 (094 02008 000)`;

describe('field-label masking (root cause)', () => {
  it('never reads a label suffix as a state', () => {
    // "Parcel ID", "Owner ID", "Tax ID", "GIS ID", "Record ID" all end in "ID".
    for (const label of ['Parcel ID', 'Owner ID', 'Tax ID', 'GIS ID', 'Record ID', 'Property ID']) {
      expect(maskFieldLabels(`${label}: 123`).includes('ID')).toBe(false);
    }
  });

  it('leaves the numeric value and real state names intact', () => {
    const masked = maskFieldLabels(SCOTT_COUNTY);
    expect(masked).toContain('094-020.08');   // value untouched
    expect(masked).toContain('Tennessee');    // real state untouched
    expect(masked).toContain('TN');           // real state code untouched
    expect(masked).not.toMatch(/Parcel ID/);  // label blanked
  });

  it('preserves character offsets (equal-length blanking)', () => {
    const src = 'Parcel ID: 5';
    expect(maskFieldLabels(src).length).toBe(src.length);
  });
});

describe('APN normalization', () => {
  it('generates common county formats for a dotted/dashed APN', () => {
    const n = normalizeApn('094-020.08')!;
    expect(n).toBeTruthy();
    expect(n.digits).toBe('09402008');
    expect(n.variants).toContain('094-020.08');
    expect(n.variants).toContain('09402008');
    expect(n.variants).toContain('094 020 08');
  });

  it('rejects street numbers, dates, and phone numbers', () => {
    expect(normalizeApn('12')).toBeNull();            // too few digits
    expect(normalizeApn('07-04-2026')).toBeNull();    // MM-DD-YYYY
    expect(normalizeApn('205-555-0142')).toBeNull();  // US phone
    expect(normalizeApn('1-800-555-1234')).toBeNull();// phone with country code
  });

  it('captures the primary APN and a parenthetical alternate', () => {
    const c = extractApnCandidates(SCOTT_COUNTY);
    expect(c.primary).toBe('094-020.08');
    expect(c.alternates).toContain('094 02008 000');
    // Union of variants must include every common county format across both APNs.
    for (const v of ['09402008', '09402008000', '094-020.08', '094 02008 000', '094-02008-000']) {
      expect(c.allVariants, v).toContain(v);
    }
  });

  it('does not emit a contained fragment as a separate APN', () => {
    const c = extractApnCandidates(SCOTT_COUNTY);
    expect(c.alternates).not.toContain('020.08'); // tail of 094-020.08
  });
});

describe('Scott County, TN acceptance case', () => {
  const r = buildSmartIntake(SCOTT_COUNTY);

  it('recognizes Tennessee and never interprets Parcel ID as State ID', () => {
    expect(r.fields.state).toBe('TN');
    expect(r.fields.city).not.toBe('Parcel');
  });

  it('normalizes both APNs and captures the alternate', () => {
    expect(r.fields.apn).toBe('094-020.08');
    expect(r.fields.apnAlternates).toContain('094 02008 000');
    expect((r.fields.apnVariants ?? []).length).toBeGreaterThan(4);
  });

  it('routes to Property Resolution with a Likely confidence + reasons', () => {
    expect(r.route).toBe('property_resolution');
    expect(r.identityClass).toBe('apn_county');
    expect(r.confidence.label).toBe('Likely');
    expect(r.confidence.percent).toBeGreaterThanOrEqual(70);
    expect(r.confidence.reasons.join(' ')).toMatch(/Scott/);
  });

  it('is ready to auto-continue into Property Intelligence', () => {
    expect(r.readyForPropertyIntelligence).toBe(true);
    expect(r.nextStep).toMatch(/Property Intelligence/);
  });
});

describe('messy real-world inputs', () => {
  it('seller text: phone is not an APN, "in" is not Indiana, county is not "County Road"', () => {
    const r = buildSmartIntake(
      `Hey this is about the 40 acres off County Road 12 in Marion County, AL.
       Owner is Betty Sue Harkins, she inherited it in probate and wants to sell fast.
       Asking around $85k. Call her back at 205-555-0142 before Friday.`,
    );
    expect(r.fields.state).toBe('AL');           // not "IN" from the word "in"
    expect(r.fields.county).toBe('Marion');      // not "acres off" / "County Road"
    expect(r.fields.owner).toBe('Betty Sue Harkins'); // leading "is" stripped
    expect(r.fields.apn).toBeUndefined();        // phone number not an APN
  });

  it('CRM export: labeled County + APN + owner resolve cleanly', () => {
    const r = buildSmartIntake(
      `Lead ID: 88213
       APN: 16-038-07-001
       County: Cherokee, GA
       Owner Name: WRIGHT FAMILY TRUST
       Acreage: ~12.5`,
    );
    expect(r.fields.apn).toBe('16-038-07-001');
    expect(r.fields.county).toBe('Cherokee');
    expect(r.fields.state).toBe('GA');
    expect(r.fields.owner).toBe('WRIGHT FAMILY TRUST');
  });

  it('call transcript: county is a single token, not the whole clause', () => {
    const r = buildSmartIntake(
      `[Voice transcribed]: the property is on Gilstrap Road in White County Georgia, parcel number is like 042 123`,
    );
    expect(r.fields.county).toBe('White');
    expect(r.fields.state).toBe('GA');
  });
});

describe('deal intelligence categorization', () => {
  it('separates seller claims, risks, tasks, and contacts with evidence status', () => {
    const items = categorizeDealIntelligence(
      `Owner wants to sell fast, asking $85k.
       Might be landlocked, no legal access.
       Call the seller back on Friday.
       Reach her at 205-555-0142.
       Is there a survey on file?`,
    );
    const by = (cat: string) => items.find((i) => i.category === cat);
    expect(by('Seller Information')?.evidenceStatus).toBe('Seller Stated');
    expect(by('Risks')).toBeTruthy();
    expect(by('Follow-up Tasks')).toBeTruthy();
    expect(by('Contacts')).toBeTruthy();
    expect(by('Discovery Questions')).toBeTruthy();
  });

  it('never mixes an official-source line with a seller claim', () => {
    const items = categorizeDealIntelligence(
      `County assessor lists 12 acres.
       Seller says it is more like 15 acres.`,
    );
    expect(items[0].evidenceStatus).toBe('Official Source');
    expect(items[1].evidenceStatus).toBe('Seller Stated');
  });
});

describe('confidence engine', () => {
  it('caps at Likely pre-resolution and explains itself', () => {
    const cls = classifySmartIntake(SCOTT_COUNTY);
    const conf = identityConfidence(cls.parsedFields, cls.identityClass);
    expect(['Likely', 'Possible', 'Insufficient Evidence']).toContain(conf.label);
    expect(conf.label).not.toBe('Verified'); // never asserted without a source
    expect(conf.reasons.length).toBeGreaterThan(0);
  });

  it('rates city+state only as Insufficient Evidence for a specific parcel', () => {
    const cls = classifySmartIntake('market stats for White County, GA');
    const conf = identityConfidence(cls.parsedFields, cls.identityClass);
    expect(conf.label).toBe('Insufficient Evidence');
  });
});
