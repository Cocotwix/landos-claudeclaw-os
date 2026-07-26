import { describe, it, expect } from 'vitest';
import {
  extractSellerIdentity,
  formatAddressLabel,
  looksLikeStreetAddress,
  streetReferenceFrom,
  sanitizeLocalityCandidate,
  buildLeadCardTitle,
  unresolvedLeadStorageLabel,
  isPlaceholderPropertyLabel,
  UNRESOLVED_LEAD_LABEL,
} from './lead-identity.js';

// The operator acceptance failure this file locks down: an unlabeled paste
// produced no seller, a Deal Card titled "Unidentified seller — <address>", and
// that title was then quoted back to the seller as the road to the property.

describe('extractSellerIdentity — the shapes operators actually paste', () => {
  it('reads an unlabeled name that leads the paste (the reported failure)', () => {
    const seller = extractSellerIdentity('Davan Smith - 4713 sinking creek rd, London Kentucky ');
    expect(seller?.name).toBe('Davan Smith');
    expect(seller?.basis).toMatch(/lead contact/i);
  });

  it('reads a comma-separated leading name', () => {
    expect(extractSellerIdentity('Maria Hernandez, 704-555-0182, 12 acres in Rowan County NC')?.name)
      .toBe('Maria Hernandez');
  });

  it('reads labeled forms with a colon or a verb', () => {
    expect(extractSellerIdentity('Seller: Travis Joines. Property address: TALLEY RD')?.name).toBe('Travis Joines');
    expect(extractSellerIdentity('Seller is Maria Hernandez, 704-555-0182.')?.name).toBe('Maria Hernandez');
    expect(extractSellerIdentity('lead - Bo Jenkins Jr')?.name).toBe('Bo Jenkins Jr');
  });

  it('reads a verb-led introduction anywhere in the paste', () => {
    expect(extractSellerIdentity('Cold call today. Talked to Anita Ruiz about 40 acres.')?.name).toBe('Anita Ruiz');
  });

  it('accepts a single token ONLY when the operator labeled it', () => {
    expect(extractSellerIdentity('Seller: Davan')?.name).toBe('Davan');
    expect(extractSellerIdentity('Davan - 4713 Sinking Creek Rd')).toBeNull();
  });

  it('never promotes an address, a road, or a locality to a seller', () => {
    expect(extractSellerIdentity('4713 sinking creek rd, London Kentucky')).toBeNull();
    expect(extractSellerIdentity('TALLEY RD, Newport, TN 37843')).toBeNull();
    expect(extractSellerIdentity('Old Ridge Rd, Kingston TN')).toBeNull();
    expect(extractSellerIdentity('Mary St, Pickens SC')).toBeNull();
    expect(extractSellerIdentity('Parcel 073090 04200 in Roane County TN')).toBeNull();
    expect(extractSellerIdentity('London, Kentucky')).toBeNull();
    expect(extractSellerIdentity('Called about the property at 123 Main St')).toBeNull();
  });

  it('returns null for empty or unusable input rather than inventing a contact', () => {
    expect(extractSellerIdentity('')).toBeNull();
    expect(extractSellerIdentity('   ')).toBeNull();
    expect(extractSellerIdentity('no idea who owns it')).toBeNull();
  });
});

describe('formatAddressLabel', () => {
  it('canonicalizes operator casing without changing the address', () => {
    expect(formatAddressLabel('4713 sinking creek rd, London Kentucky '))
      .toBe('4713 Sinking Creek Rd, London Kentucky');
    expect(formatAddressLabel('200 SID EDENS RD,  PICKENS,  SC 29671'))
      .toBe('200 Sid Edens Rd, Pickens, SC 29671');
  });

  it('keeps directionals and state codes upper case', () => {
    expect(formatAddressLabel('7868 w debra ln, homosassa fl')).toBe('7868 W Debra Ln, Homosassa FL');
  });

  it('returns an empty label for empty input', () => {
    expect(formatAddressLabel('   ')).toBe('');
  });
});

describe('looksLikeStreetAddress / streetReferenceFrom', () => {
  it('accepts house-numbered addresses and named roads', () => {
    expect(looksLikeStreetAddress('4713 Sinking Creek Rd, London, KY')).toBe(true);
    expect(looksLikeStreetAddress('OLD RIDGE RD')).toBe(true);
    expect(streetReferenceFrom('4713 Sinking Creek Rd, London, KY')).toBe('Sinking Creek Rd');
    expect(streetReferenceFrom('OLD RIDGE RD')).toBe('OLD RIDGE RD');
  });

  it('rejects a composed Deal Card label so it can never be quoted as a road', () => {
    expect(looksLikeStreetAddress('Unidentified seller — 4713 sinking creek rd')).toBe(false);
    expect(streetReferenceFrom('Unidentified seller — 4713 sinking creek rd')).toBeNull();
    expect(streetReferenceFrom('Smart Intake screenshot acceptance 2026-07-23')).toBeNull();
  });

  it('rejects a bare locality and empty values', () => {
    expect(streetReferenceFrom('London')).toBeNull();
    expect(streetReferenceFrom('')).toBeNull();
    expect(streetReferenceFrom(null)).toBeNull();
  });
});

describe('sanitizeLocalityCandidate', () => {
  it('keeps real locality names', () => {
    expect(sanitizeLocalityCandidate('London')).toBe('London');
    expect(sanitizeLocalityCandidate('Saint Helena Island')).toBe('Saint Helena Island');
  });

  it('drops parser fragments, digits and bare states', () => {
    expect(sanitizeLocalityCandidate('NC. APN may')).toBeNull();
    expect(sanitizeLocalityCandidate('London 40741')).toBeNull();
    expect(sanitizeLocalityCandidate('Kentucky')).toBeNull();
    expect(sanitizeLocalityCandidate('  ')).toBeNull();
  });
});

describe('buildLeadCardTitle', () => {
  it('is property-first and never contains a seller or an "Unidentified" label', () => {
    const title = buildLeadCardTitle({ address: '4713 Sinking Creek Rd', city: 'London', state: 'KY' });
    expect(title).toBe('4713 Sinking Creek Rd, London, KY');
    expect(title).not.toMatch(/unidentified/i);
    expect(title).not.toContain('—');
  });

  it('falls back to the parcel number with its jurisdiction', () => {
    expect(buildLeadCardTitle({ apn: '073090 04200', county: 'Roane County', state: 'TN' }))
      .toBe('Parcel 073090 04200, Roane County, TN');
  });

  it('stays honest when nothing identifies the property', () => {
    expect(buildLeadCardTitle({ city: 'London', state: 'KY' })).toBe('Unresolved parcel, London, KY');
    expect(buildLeadCardTitle({})).toBe('Unresolved property lead');
  });

  it('never produces a title that a street-reference reader would quote as a road', () => {
    for (const parts of [{ city: 'London', state: 'KY' }, {}, { apn: 'X-1', state: 'KY' }]) {
      expect(streetReferenceFrom(buildLeadCardTitle(parts))).toBeNull();
    }
  });
});

describe('labeled vs inferred vocabulary', () => {
  it('trusts an explicit label enough to accept a domain-word surname', () => {
    expect(extractSellerIdentity('Seller: Conversational QA Seller\nPhone: 704-555-0119')?.name)
      .toBe('Conversational QA Seller');
    expect(extractSellerIdentity('Seller: Bo Land')?.name).toBe('Bo Land');
  });

  it('still rejects a placeholder or a road even when labeled', () => {
    expect(extractSellerIdentity('Seller: Unknown caller')).toBeNull();
    expect(extractSellerIdentity('Seller: none')).toBeNull();
    expect(extractSellerIdentity('Seller: Old Ridge Rd')).toBeNull();
  });

  it('does not apply the permissive vocabulary to an unlabeled paste', () => {
    expect(extractSellerIdentity('Vacant land - 4713 Sinking Creek Rd')).toBeNull();
  });
});

describe('subject-verb paste shape', () => {
  it('reads a name that opens the paste as the subject of a verb', () => {
    expect(extractSellerIdentity('Gerald Pate called about selling. APN 073009G B 03600, Roane County, Tennessee.')?.name)
      .toBe('Gerald Pate');
    expect(extractSellerIdentity('Anita Ruiz owns 40 acres in Laurel County KY')?.name).toBe('Anita Ruiz');
    expect(extractSellerIdentity('Bo Jenkins inherited the tract from his father')?.name).toBe('Bo Jenkins');
  });

  it('does not turn a sentence opener or a road into a subject', () => {
    expect(extractSellerIdentity('The property has road frontage')).toBeNull();
    expect(extractSellerIdentity('Old Ridge Rd has 1086 ft of frontage')).toBeNull();
    expect(extractSellerIdentity('Vacant land was listed last year')).toBeNull();
  });
});

describe('unresolved-lead placeholder labels', () => {
  it('generates a unique storage handle per unidentified lead', () => {
    const a = unresolvedLeadStorageLabel(1);
    const b = unresolvedLeadStorageLabel(2);
    expect(a).not.toBe(b);
    expect(isPlaceholderPropertyLabel(a)).toBe(true);
    expect(isPlaceholderPropertyLabel(b)).toBe(true);
  });

  it('recognizes every placeholder shape and nothing else', () => {
    expect(isPlaceholderPropertyLabel('Unresolved parcel, London, KY')).toBe(true);
    expect(isPlaceholderPropertyLabel(UNRESOLVED_LEAD_LABEL)).toBe(true);
    expect(isPlaceholderPropertyLabel('4713 Sinking Creek Rd')).toBe(false);
    expect(isPlaceholderPropertyLabel('Parcel 073009G B 03600')).toBe(false);
    expect(isPlaceholderPropertyLabel(null)).toBe(false);
  });

  it('never lets a placeholder be quoted as a road', () => {
    expect(streetReferenceFrom(unresolvedLeadStorageLabel(Date.parse('2026-07-26')))).toBeNull();
  });
});
