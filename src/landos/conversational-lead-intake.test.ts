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

  it('keeps missing identity unknown instead of blocking lead creation', () => {
    const raw = 'A caller inherited some land and wants me to call back next Thursday.';
    const intake = parseConversationalLeadIntake(raw);
    expect(intake.rawInput).toBe(raw);
    expect(intake.sellerName).toBeNull();
    expect(intake.propertyLabel).toBe('Unresolved property');
    expect(intake.smartIntake.hasParcelIdentity).toBe(false);
  });
});
