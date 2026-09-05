import { describe, expect, it } from 'vitest';

import { mergeCanonicalPropertyResearch } from './property-research-store.js';
import { recordedInstrumentAccessFindings, recordedInstrumentAccessResult } from './recorded-instrument-access.js';

const DEED_OUTCOME = {
  category: 'deed_ownership',
  title: 'Recorded vesting deed: OR Book 1124 Page 39, Instrument 2005189911',
  authority: 'Bradford County Clerk of Court, Official Records (myfloridacounty.com ORI, county 04)',
  retrieval_status: 'retrieved_yes',
  summary: 'Warranty Deed executed 12 November 2003, recorded 22 November 2005 as Instrument 2005189911.',
  facts: {
    instrumentType: 'Warranty Deed',
    instrumentNumber: '2005189911',
    bookPage: '1124/39',
    recordingDate: '2005-11-22',
    easementsAndRestrictions: 'Subject to River Oak Plantation Restrictions and Covenants (OR 535 pp 59-68); conveyed with and subject to an ingress/egress easement over all roadways shown on Misc Map Book 1 Page 18; other covenants, restrictions, reservations and easements of record are referenced but not itemized in this instrument',
  },
  source_url: 'https://www.myfloridacounty.com/orisearch/s/search?q1=x',
  document_url: 'https://www.myfloridacounty.com/orisearch/s/image?q1=x&q2=y',
  searched_at: '2026-09-04T23:36:00.000Z',
};

const INPUT = {
  propertyCardId: 80, dealCardId: 90, normalizedAddress: '19554 nw 137th ln', address: '19554 NW 137th Ln',
  city: 'Lake Butler', county: 'Bradford', state: 'FL', zip: '32054', apn: '00083A03400', fips: null, landPortalPropertyId: null,
};

describe('legal access from a recorded instrument LandOS read', () => {
  it('carries the retrieved deed\'s own ingress/egress statement as verified-legal access', () => {
    const findings = recordedInstrumentAccessFindings([DEED_OUTCOME]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ instrumentNumber: '2005189911', bookPage: '1124/39', recordingDate: '2005-11-22' });
    const result = recordedInstrumentAccessResult(INPUT, findings, '2026-09-05T00:00:00.000Z');
    expect(result?.status).toBe('verified');
    expect(result?.evidence).toHaveLength(1);
    const item = result!.evidence[0];
    expect(item.field).toBe('access_evidence.verified_legal.recorded_instrument_2005189911');
    expect(item.value).toMatchObject({
      tier: 'verified_legal', source_kind: 'official_record', basis: 'recorded_instrument', weight: 'confirmed',
      statement: DEED_OUTCOME.facts.easementsAndRestrictions, observed_at: '2005-11-22',
      source_url: DEED_OUTCOME.document_url,
    });
    expect(String((item.value as Record<string, unknown>).source_label)).toMatch(/Instrument 2005189911/);
  });

  it('asserts nothing from an index-only outcome or an instrument that names no access right', () => {
    expect(recordedInstrumentAccessFindings([{ ...DEED_OUTCOME, retrieval_status: 'retrieved_no' }])).toEqual([]);
    expect(recordedInstrumentAccessFindings([{ ...DEED_OUTCOME, facts: { ...DEED_OUTCOME.facts, easementsAndRestrictions: 'Subject to restrictions of record.' } }])).toEqual([]);
    expect(recordedInstrumentAccessResult(INPUT, [], '2026-09-05T00:00:00.000Z')).toBeNull();
  });

  it('re-asserts the same instrument without a duplicate evidence row', () => {
    const findings = recordedInstrumentAccessFindings([DEED_OUTCOME]);
    const first = mergeCanonicalPropertyResearch(null, recordedInstrumentAccessResult(INPUT, findings, '2026-09-05T00:00:00.000Z')!);
    const second = mergeCanonicalPropertyResearch(first.record, recordedInstrumentAccessResult(INPUT, findings, '2026-09-05T01:00:00.000Z')!);
    expect(second.accepted).toBe(true);
    expect(second.record.evidence.filter((item) => item.field.startsWith('access_evidence.verified_legal.'))).toHaveLength(1);
  });
});
