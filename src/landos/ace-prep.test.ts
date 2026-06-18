// Tests: Ace seller discovery prep (questions, never facts).
import { describe, it, expect } from 'vitest';
import { buildAcePrep } from './ace-prep.js';

describe('buildAcePrep', () => {
  it('always returns the base seller-discovery question bank', () => {
    const a = buildAcePrep({ parcelVerified: true });
    const cats = a.questions.map((q) => q.category.toLowerCase()).join(' ');
    for (const must of ['access', 'utilities', 'easements', 'title', 'survey', 'timeline', 'price']) {
      expect(cats.includes(must), must).toBe(true);
    }
    expect(a.status).toBe('ready');
  });

  it('adds deal-specific questions from red/anomaly flags', () => {
    const a = buildAcePrep({
      parcelVerified: true,
      redFlags: ['Landlocked per source — confirm legal/recorded access.', 'Significant FEMA floodplain (~40%).'],
      anomalyFlags: ['Some wetlands (~3%).'],
    });
    const blob = a.questions.map((q) => q.question.toLowerCase()).join(' | ');
    expect(blob).toMatch(/access/);
    expect(blob).toMatch(/flood/);
    expect(blob).toMatch(/wetland/);
  });

  it('is preliminary (still useful) when the parcel is unverified', () => {
    const a = buildAcePrep({ parcelVerified: false });
    expect(a.status).toBe('preliminary');
    expect(a.questions.length).toBeGreaterThan(0);
  });

  it('labels output as questions, never facts', () => {
    const a = buildAcePrep({ parcelVerified: true });
    expect(a.note.toLowerCase()).toContain('questions');
    expect(a.note.toLowerCase()).toContain('not');
  });
});
