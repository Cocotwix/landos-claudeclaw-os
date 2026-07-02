import { describe, it, expect } from 'vitest';
import { buildPublicRecordsResearchPlan, researchPlanNextActions } from './public-records-research.js';

describe('public records research plan', () => {
  it('builds prioritized official county targets for a county+state lead', () => {
    const plan = buildPublicRecordsResearchPlan({ county: 'Runnels', state: 'TX', address: '2510 State Highway 153, Winters, TX' });
    expect(plan.eligible).toBe(true);
    const kinds = plan.targets.map((t) => t.kind);
    expect(kinds).toContain('netr');
    expect(kinds).toContain('appraisal_district'); // TX uses CAD
    expect(kinds).toContain('gis');
    expect(kinds).toContain('tax');
    // NETR direct county hub URL when state is 2-letter.
    expect(plan.targets.find((t) => t.kind === 'netr')!.url).toContain('publicrecords.netronline.com/state/TX/county/Runnels');
    // Every target is official and carries a real URL.
    expect(plan.targets.every((t) => t.official && /^https?:\/\//.test(t.url))).toBe(true);
  });

  it('names the state-specific record office (FL = Property Appraiser, default = Assessor)', () => {
    expect(buildPublicRecordsResearchPlan({ county: 'Polk', state: 'FL' }).targets.some((t) => t.kind === 'property_appraiser')).toBe(true);
    expect(buildPublicRecordsResearchPlan({ county: 'Lexington', state: 'SC' }).targets.some((t) => t.kind === 'assessor')).toBe(true);
  });

  it('normalizes a full state name to build the NETR path', () => {
    const plan = buildPublicRecordsResearchPlan({ county: 'Runnels', state: 'Texas' });
    expect(plan.targets.find((t) => t.kind === 'netr')!.url).toContain('/state/TX/county/Runnels');
  });

  it('lists missing critical facts and a concrete next verification action', () => {
    const plan = buildPublicRecordsResearchPlan({ county: 'Runnels', state: 'TX', apn: 'R11223' });
    expect(plan.missingCriticalFacts).toEqual(expect.arrayContaining(['Owner', 'Acreage', 'Verified parcel identity']));
    expect(plan.nextVerificationAction).toContain('APN R11223');
    // Search-by uses the exact identifier, never coordinates.
    const office = plan.targets.find((t) => t.kind === 'appraisal_district')!;
    expect(office.searchBy.join(' ')).toContain('R11223');
  });

  it('is honest when there is no location', () => {
    const plan = buildPublicRecordsResearchPlan({});
    expect(plan.eligible).toBe(false);
    expect(plan.targets).toEqual([]);
    expect(plan.nextVerificationAction).toContain('county + state');
  });

  it('research targets are sources to CHECK, never facts', () => {
    const plan = buildPublicRecordsResearchPlan({ county: 'Runnels', state: 'TX' });
    expect(plan.disclaimer).toContain('not facts');
    const actions = researchPlanNextActions(plan);
    expect(actions.length).toBeGreaterThan(1);
    expect(actions.some((a) => a.includes('publicrecords.netronline.com'))).toBe(true);
  });
});
