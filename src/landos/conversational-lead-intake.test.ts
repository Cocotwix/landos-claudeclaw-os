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
