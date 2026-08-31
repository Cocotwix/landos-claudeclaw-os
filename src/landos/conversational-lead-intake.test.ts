import { describe, expect, it } from 'vitest';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';

describe('conversational lead intake', () => {
  it('preserves the exact dump while extracting only defensible clues', () => {
    const raw = 'Seller: Maria Hernandez\nPhone 704-555-0182\nAPN: 123-45-678, Rowan County, NC\nAbout 7.5 acres. Lead source: Google PPC\nShe says there may be an easement.';
    const intake = parseConversationalLeadIntake(raw);
    expect(intake.rawInput).toBe(raw);
    expect(intake).toMatchObject({ sellerName: 'Maria Hernandez', phone: '704-555-0182', acreage: 7.5, leadSource: 'Google PPC' });
    expect(intake.apn).toBeTruthy();
    expect(intake.dealIntelligence.length).toBeGreaterThan(0);
  });

  // Operator acceptance regression: this exact paste produced no seller at all,
  // a raw lower-cased property label, and a Deal Card titled "Unidentified
  // seller — 4713 sinking creek rd".
  it('reads an unlabeled seller and canonicalizes the address the operator typed', () => {
    const raw = 'Davan Smith - 4713 sinking creek rd, London Kentucky ';
    const intake = parseConversationalLeadIntake(raw);
    expect(intake.rawInput).toBe(raw);
    expect(intake.sellerName).toBe('Davan Smith');
    expect(intake.sellerNameBasis).toBeTruthy();
    expect(intake.address).toBe('4713 Sinking Creek Rd');
    expect(intake.propertyLabel).toBe('4713 Sinking Creek Rd');
    expect(intake.city).toBe('London');
    expect(intake.state).toBe('KY');
    expect(intake.smartIntake.hasParcelIdentity).toBe(true);
  });

  it('keeps title-case state abbreviations from a normal lead paste', () => {
    const intake = parseConversationalLeadIntake('Ronni Summers - 240 golden view lane, Hampshire Tn ');
    expect(intake.address).toBe('240 Golden View Lane');
    expect(intake.city).toBe('Hampshire');
    expect(intake.state).toBe('TN');
    expect(intake.smartIntake.hasParcelIdentity).toBe(true);
  });

  // Fresh-lead rescue regression: the operator-typed ZIP was dropped, leaving
  // landos_property_card.zip empty and starving the ZIP-level market lookup.
  it('extracts the ZIP the operator typed after a state abbreviation', () => {
    const intake = parseConversationalLeadIntake(
      'New seller lead: 1487 Onionville Rd, Sterling, NY 13156. Vacant land, approximately 11.46 acres, Cayuga County, New York. Listed asking price $49,900.',
    );
    expect(intake.zip).toBe('13156');
    expect(intake.acreage).toBe(11.46);
  });

  it('never reads a price or bare number as the ZIP', () => {
    const intake = parseConversationalLeadIntake(
      'Seller wants 50000 for the parcel near Rowan County, NC. About 7 acres.',
    );
    expect(intake.zip).toBeNull();
  });

  it('normalizes a county abbreviation and locality qualifier in messy seller notes', () => {
    const intake = parseConversationalLeadIntake(
      'Talked with Jamie — might sell the forty-ish acre place off Hwy sixty near Birchwood TN, Hamilton Co. Parcel notation looks like 023.003-02.',
    );
    expect(intake).toMatchObject({
      apn: '023.003-02', city: 'Birchwood', county: 'Hamilton', state: 'TN',
    });
  });

  it('keeps an undotted county abbreviation ahead of the trailing state', () => {
    const intake = parseConversationalLeadIntake(
      'Spoke with Casey about the tract near Highway 60 outside Birchwood, Hamilton Co TN. Parcel note says 023.003-02.',
    );
    expect(intake).toMatchObject({
      apn: '023.003-02', city: 'Birchwood', county: 'Hamilton', state: 'TN',
    });
  });

  it('never keeps a parser fragment as the city', () => {
    const intake = parseConversationalLeadIntake(
      'Seller is Maria Hernandez, 704-555-0182. She inherited about 7 acres near 1180 Old Mill Road in Rowan County, NC. APN may be 123-45-678.',
    );
    expect(intake.sellerName).toBe('Maria Hernandez');
    expect(intake.county).toBe('Rowan');
    expect(intake.city).toBeNull();
  });

  it('keeps missing identity unknown instead of blocking lead creation', () => {
    const raw = 'A caller inherited some land and wants me to call back next Thursday.';
    const intake = parseConversationalLeadIntake(raw);
    expect(intake.rawInput).toBe(raw);
    expect(intake.sellerName).toBeNull();
    expect(intake.propertyLabel).toBe('Unresolved property');
    expect(intake.smartIntake.hasParcelIdentity).toBe(false);
  });
});
