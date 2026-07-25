// Parcel-specific research vs department homepages.
//
// Opening an assessor, GIS, recorder, tax, or county departmental homepage is not
// parcel-specific research. A collector may report a source as retrieved only
// when it obtained parcel-specific facts, records, documents, a completed search
// outcome, or a precise source limitation.

import { describe, it, expect } from 'vitest';

import {
  classifyParcelResearchAttempt, collectorStatusForDepths, isDepartmentLandingUrl,
} from './parcel-research-depth.js';

describe('county department homepages are not counted as parcel-specific facts', () => {
  it('a reached assessor homepage is a source lead, never a public-record fact', () => {
    const v = classifyParcelResearchAttempt({
      sourceName: 'Roane County Assessor of Property',
      url: 'https://www.roanecountytn.gov/',
      pageKind: 'landing_page',
    });
    expect(v.depth).toBe('general_link_only');
    expect(v.parcelSpecific).toBe(false);
    expect(v.statement).toMatch(/source lead, not a public-record fact/i);
  });

  it('a GIS or recorder landing page is treated the same way', () => {
    for (const url of [
      'https://gis.roanecountytn.gov/',
      'https://roanecountytn.gov/departments',
      'https://roane.tn.gov/index.html',
      'https://recorder.roanecountytn.gov/home',
    ]) {
      expect(isDepartmentLandingUrl(url), url).toBe(true);
      expect(classifyParcelResearchAttempt({ sourceName: 'Roane County', url }).parcelSpecific).toBe(false);
    }
  });

  it('a parcel-scoped URL is not a landing page', () => {
    expect(isDepartmentLandingUrl('https://gis.roanecountytn.gov/parcel?apn=073090+04200')).toBe(false);
    expect(isDepartmentLandingUrl('https://assessor.roanecountytn.gov/property/073090-04200')).toBe(false);
  });

  it('a retrieved parcel fact IS parcel-specific research', () => {
    const v = classifyParcelResearchAttempt({
      sourceName: 'Tennessee Comptroller public parcel layer',
      url: 'https://tnmap.tn.gov/assessment/?apn=073090+04200',
      parcelFactCount: 6, retainedDocumentCount: 0, pageKind: 'record_detail',
    });
    expect(v.depth).toBe('parcel_fact_retrieved');
    expect(v.parcelSpecific).toBe(true);
    expect(v.statement).toMatch(/retrieved 6 parcel-specific fact\(s\)/);
  });

  it('a retained document is parcel-specific research even without extracted fields', () => {
    const v = classifyParcelResearchAttempt({
      sourceName: 'Roane County Register of Deeds', retainedDocumentCount: 7, pageKind: 'record_detail',
    });
    expect(v.parcelSpecific).toBe(true);
    expect(v.statement).toMatch(/7 retained document\(s\)/);
  });

  it('a completed parcel search with no matching record is an honest completed search', () => {
    const v = classifyParcelResearchAttempt({
      sourceName: 'Roane County Clerk & Master', parcelSearchExecuted: true, parcelFactCount: 0,
    });
    expect(v.depth).toBe('parcel_search_no_record');
    expect(v.parcelSpecific).toBe(false);
    expect(v.statement).toMatch(/completed search, not a missing one/i);
  });

  it('a blocked or paywalled source is unavailable, not a negative result', () => {
    const v = classifyParcelResearchAttempt({
      sourceName: 'Roane County Deeds Portal', blocked: true, blockedReason: 'subscription required',
    });
    expect(v.depth).toBe('source_unavailable');
    expect(v.statement).toMatch(/subscription required/);
  });

  it('a source error page is unavailable even when it rendered', () => {
    expect(classifyParcelResearchAttempt({ sourceName: 'County GIS', pageKind: 'error' }).depth).toBe('source_unavailable');
  });

  it('a blocked source stays unavailable even if it also showed facts', () => {
    const v = classifyParcelResearchAttempt({ sourceName: 'Portal', blocked: true, parcelFactCount: 3 });
    expect(v.depth).toBe('source_unavailable');
  });
});

describe('a collector cannot claim success on department navigation alone', () => {
  it('department pages only never reach succeeded', () => {
    const r = collectorStatusForDepths(['general_link_only', 'general_link_only']);
    expect(r.status).toBe('partial');
    expect(r.reason).toMatch(/nothing here is a public-record fact/i);
  });

  it('parcel-specific retrieval across every source reaches succeeded', () => {
    expect(collectorStatusForDepths(['parcel_fact_retrieved', 'parcel_fact_retrieved']).status).toBe('succeeded');
  });

  it('retrieval mixed with incomplete sources is partial, not succeeded', () => {
    expect(collectorStatusForDepths(['parcel_fact_retrieved', 'general_link_only']).status).toBe('partial');
  });

  it('completed searches with no record are partial, and say so precisely', () => {
    const r = collectorStatusForDepths(['parcel_search_no_record', 'parcel_search_no_record']);
    expect(r.status).toBe('partial');
    expect(r.reason).toMatch(/completed a parcel search with no matching record/i);
  });

  it('every source unavailable is blocked', () => {
    expect(collectorStatusForDepths(['source_unavailable', 'source_unavailable']).status).toBe('blocked');
  });

  it('attempting nothing is a failure, never a quiet success', () => {
    expect(collectorStatusForDepths([]).status).toBe('failed');
  });
});
