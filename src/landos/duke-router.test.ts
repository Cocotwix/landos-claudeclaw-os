import { describe, it, expect } from 'vitest';

import { routeDukeRequest } from './duke-router.js';

describe('routeDukeRequest', () => {
  it('routes a bare address to Fast Default', () => {
    expect(routeDukeRequest('83 Bub Wise Rd, Swansea SC').route).toBe('parcel_fast_default');
  });

  it('routes verification/timeout/zero-candidate language to recovery', () => {
    expect(routeDukeRequest('the parcel is not verified, lookup timed out').route).toBe('parcel_verification_recovery');
    expect(routeDukeRequest('zero candidates / address mismatch, recover this').route).toBe('parcel_verification_recovery');
  });

  it('routes comps, manufactured home comps, zoning, subdivision, ordinance, utilities', () => {
    expect(routeDukeRequest('pull land comps by ZIP 29160, 5-10 acres').route).toBe('land_comps');
    expect(routeDukeRequest('manufactured home listings and comps in Lexington county').route).toBe('manufactured_home_comps');
    expect(routeDukeRequest('what is the zoning and allowed use here').route).toBe('zoning_research');
    expect(routeDukeRequest('can this be subdivided by-right into 1ac lots').route).toBe('subdivision_by_right_research');
    expect(routeDukeRequest('what does the county ordinance / municipal code require').route).toBe('ordinance_research');
    expect(routeDukeRequest('check utilities, septic, access and buildability').route).toBe('utility_access_buildability');
  });

  it('routes improved/land-home, discovery, and property memory', () => {
    expect(routeDukeRequest('improved property land-home value-add review').route).toBe('improved_property_land_home_review');
    expect(routeDukeRequest('generate discovery questions / seller call checklist').route).toBe('discovery_questions');
    expect(routeDukeRequest('what do we know about this property card already').route).toBe('property_memory_lookup');
  });

  it('routes multiple leads to batch intake', () => {
    const r = routeDukeRequest('83 Bub Wise Rd, Swansea SC\n221 Main St, Lexington SC\n14 Oak Dr, Gilbert SC');
    expect(r.route).toBe('batch_lead_intake');
    expect(r.matched.join(' ')).toContain('address lines');
  });

  it('defaults to general due diligence for vague non-address questions', () => {
    expect(routeDukeRequest('what should I watch out for with rural land').route).toBe('general_due_diligence');
  });

  it('is deterministic', () => {
    const a = routeDukeRequest('pull comps for 5 acres');
    const b = routeDukeRequest('pull comps for 5 acres');
    expect(a).toEqual(b);
  });
});
