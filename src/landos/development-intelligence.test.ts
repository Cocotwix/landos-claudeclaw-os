import { describe, expect, it } from 'vitest';
import { buildDevelopmentIntelligence } from './development-intelligence.js';

describe('buildDevelopmentIntelligence', () => {
  it('selects deep development from material tract evidence and preserves unknowns', () => {
    const view = buildDevelopmentIntelligence({
      acres: 51.11,
      providerAccessSignal: 'Mapped frontage; not flagged landlocked',
      records: [
        {
          category: 'assessor', title: 'Current holding', authority: 'County assessor',
          retrieval_status: 'retrieved_yes', summary: 'Current record.', source_url: 'https://example.test/current',
          facts: {
            kind: 'current_holding', owner: 'Example LLC', acreage: 51.11,
            improvementStatus: 'no_current_building_on_assessor_record',
            acquisitionEvent: { date: '2024-03-08', event: 'Acquisition', owner: 'Example LLC', acreage: 75.91, instrument: 'DB 1/P2', consideration: 'Assessor price field $0; consideration unresolved', confidence: 'confirmed' },
            unknowns: ['Recorded legal access.'],
          },
        },
        {
          category: 'split deed', title: 'Partial conveyance', authority: 'County assessor',
          retrieval_status: 'retrieved_yes', summary: 'Acreage split.',
          facts: { kind: 'partial_conveyance', instrument: 'DB 3/P4', acquisitionEvent: { date: '2025-06-23', event: 'Partial conveyance', acreage: 24.8, instrument: 'DB 3/P4', confidence: 'confirmed' } },
        },
      ],
    });
    expect(view?.researchDepth).toBe('DEEP_DEVELOPMENT');
    expect(view?.currentTruth.acreage).toBe(51.11);
    expect(view?.researchStatus.underwriting).toBe('material_items_unresolved');
    expect(view?.acquisitionHistory).toHaveLength(2);
    expect(view?.documents[1].imageStatus).toBe('not_publicly_available');
  });

  it('does not infer current zoning, legal access, or document imagery', () => {
    const view = buildDevelopmentIntelligence({
      records: [{
        category: 'zoning', title: 'Historical zoning', authority: 'City', summary: 'Historical designation.', retrieval_status: 'retrieved_yes',
        facts: { kind: 'zoning', currentStatus: 'Unresolved', lastConfirmed: 'Historical R district' },
      }],
    });
    expect(view?.zoning?.currentStatus).toBe('Unresolved');
    expect(view?.currentTruth.recordedLegalAccess).toBe('Not verified');
    expect(view?.documents[0].imageStatus).toBe('not_applicable');
  });

  it('projects current official zoning and screening access over superseded retained conclusions', () => {
    const view = buildDevelopmentIntelligence({
      accessEstablished: true,
      currentZoning: {
        established: true,
        districtCode: 'CD-3L',
        statement: 'Current parcel-specific district established.',
        authorityName: 'Official city zoning map',
        confidence: 'confirmed',
      },
      records: [{
        category: 'zoning', title: 'Historical zoning', authority: 'City', summary: 'Historical designation.', retrieval_status: 'retrieved_yes',
        facts: { kind: 'zoning', currentStatus: 'Unresolved', unknowns: ['Current zoning for this APN.', 'Recorded legal access for the parcel.'] },
      }],
    });
    expect(view?.zoning?.currentStatus).toMatch(/^CD-3L/);
    expect(view?.currentTruth.accessStatus).toMatch(/^Established for acquisition screening/);
    expect(view?.unknowns).not.toContain('Current zoning for this APN.');
    expect(view?.unknowns[0]).toMatch(/^Recorded-instrument\/title access confirmation/);
  });
});
