// The claims adaptive research is NOT allowed to make.
//
// Each of these encodes a specific way a research answer can be true about the
// evidence and wrong about the deal.

import { describe, expect, it } from 'vitest';

import {
  UTILITY_ENTITLEMENTS_NOT_ESTABLISHED,
  buildUtilityInfrastructureFinding,
  establishesServiceEntitlement,
  lineIsMapped,
  relationshipStatement,
  type UtilityLineRelationship,
} from './utility-infrastructure-relationship.js';
import {
  buildRecordedDocumentRecovery,
  documentReturned,
  mayClaimAbsent,
  mayClaimRestricted,
  pointerEstablishesDocument,
} from './recorded-document-recovery.js';

const ALL_RELATIONSHIPS: UtilityLineRelationship[] = [
  'AT_SUBJECT', 'ADJACENT', 'NEARBY', 'NOT_SHOWN', 'UNKNOWN',
];

describe('a mapped utility line is geometry, not service', () => {
  // Spec test 8.
  it('never lets a mapped water line imply capacity', () => {
    for (const relationship of ALL_RELATIONSHIPS) {
      expect(establishesServiceEntitlement(relationship)).toBe(false);
    }
    const finding = buildUtilityInfrastructureFinding({
      kind: 'water',
      relationship: 'AT_SUBJECT',
      sourceLabel: 'City of Fairview utility GIS — water layer',
      retrievedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(finding.doesNotEstablish).toEqual([...UTILITY_ENTITLEMENTS_NOT_ESTABLISHED]);
    expect(finding.statement).toMatch(/does not establish capacity/i);
    expect(finding.nextStep).toMatch(/availability and capacity determination/i);
  });

  // Spec test 9.
  it('never lets a mapped sewer line imply connection or capacity', () => {
    const finding = buildUtilityInfrastructureFinding({
      kind: 'sewer',
      relationship: 'ADJACENT',
      sourceLabel: 'Williamson County GIS — sewer layer',
      retrievedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(finding.doesNotEstablish).toContain('connection approval');
    expect(finding.doesNotEstablish).toContain('available capacity');
    expect(finding.statement).toMatch(/Proximity is not service/i);
  });

  it('states the limits even for the strongest reading, which is the tempting one', () => {
    const at = relationshipStatement('water', 'AT_SUBJECT');
    expect(at).toMatch(/infrastructure geometry only/i);
    expect(at).toMatch(/tap availability|connection approval/i);
  });

  it('treats an absent line as a statement about the map, not about service', () => {
    expect(relationshipStatement('sewer', 'NOT_SHOWN'))
      .toMatch(/Absence on a map is not proof that service is unavailable/i);
    // NOT_SHOWN and UNKNOWN are different claims and must not collapse.
    expect(relationshipStatement('sewer', 'UNKNOWN'))
      .toMatch(/no usable official utility layer was read/i);
  });

  it('separates "a line is drawn here" from "this parcel can be served"', () => {
    expect(lineIsMapped('AT_SUBJECT')).toBe(true);
    expect(lineIsMapped('ADJACENT')).toBe(true);
    expect(lineIsMapped('NEARBY')).toBe(false);
    expect(lineIsMapped('NOT_SHOWN')).toBe(false);
    expect(lineIsMapped('UNKNOWN')).toBe(false);
    // Even where the line IS mapped, entitlement stays unestablished.
    expect(establishesServiceEntitlement('AT_SUBJECT')).toBe(false);
  });

  it('carries the layer and source that produced the reading', () => {
    const finding = buildUtilityInfrastructureFinding({
      kind: 'water',
      relationship: 'NEARBY',
      sourceLabel: 'City of Fairview utility GIS',
      sourceUrl: 'https://gis.fairview-tn.org/water',
      layerName: 'Water Mains',
      screenshotPath: 'store/browser-shots/fairview-water.png',
      retrievedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(finding.layerName).toBe('Water Mains');
    expect(finding.screenshotPath).toContain('fairview-water.png');
    expect(finding.sourceUrl).toContain('gis.fairview-tn.org');
  });
});

describe('a recorded-document pointer is not a document', () => {
  // Spec test 11.
  it('never counts a book/page reference as a returned deed', () => {
    expect(pointerEstablishesDocument()).toBe(false);
    const recovery = buildRecordedDocumentRecovery({
      reference: '9433/325',
      state: 'POINTER_ONLY',
    });
    expect(documentReturned(recovery.state)).toBe(false);
    expect(recovery.statement).toMatch(/has not been opened/i);
    expect(recovery.statement).toMatch(/unread and unknown/i);
    expect(recovery.nextStep).toMatch(/register of deeds/i);
  });

  it('refuses to construct a retrieved document with no document behind it', () => {
    const recovery = buildRecordedDocumentRecovery({
      reference: '9762/355',
      state: 'FOUND_AND_RETRIEVED',
      documentPath: null,
    });
    // The state is downgraded rather than the claim being published.
    expect(recovery.state).toBe('POINTER_ONLY');
    expect(documentReturned(recovery.state)).toBe(false);
  });

  it('counts a genuinely retrieved instrument as returned', () => {
    const recovery = buildRecordedDocumentRecovery({
      reference: '9433/325',
      state: 'FOUND_AND_RETRIEVED',
      documentPath: 'store/landos-government-records/deed-9433-325.png',
      sourceLabel: 'Williamson County Register of Deeds',
      retrievedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(documentReturned(recovery.state)).toBe(true);
    expect(recovery.documentPath).toContain('deed-9433-325');
  });

  // Spec test 12.
  it('never declares a document restricted when no wall was actually observed', () => {
    expect(mayClaimRestricted(null)).toBe(false);
    const recovery = buildRecordedDocumentRecovery({
      reference: '9433/325',
      state: 'FOUND_BUT_IMAGE_RESTRICTED',
      observedWall: null,
      routesAttempted: ['county recorder API returned 404'],
    });
    // A failed route is not a restriction.
    expect(recovery.state).toBe('SEARCH_NOT_EXHAUSTED');
    expect(recovery.statement).toMatch(/not a finding that the record is unavailable/i);
  });

  it('allows a restriction claim once a real wall was seen, and retains the proof', () => {
    const recovery = buildRecordedDocumentRecovery({
      reference: '9433/325',
      state: 'FOUND_BUT_IMAGE_RESTRICTED',
      observedWall: 'payment_required',
      wallEvidence: 'Purchase this document — $2.00 per page',
      sourceUrl: 'https://records.williamsoncounty-tn.gov/',
    });
    expect(mayClaimRestricted(recovery.observedWall)).toBe(true);
    expect(recovery.state).toBe('FOUND_BUT_IMAGE_RESTRICTED');
    expect(recovery.wallEvidence).toContain('$2.00 per page');
    expect(recovery.statement).toMatch(/terms are therefore unread/i);
  });

  it('never declares absence from an unexhausted search', () => {
    expect(mayClaimAbsent('SEARCH_NOT_EXHAUSTED')).toBe(false);
    expect(mayClaimAbsent('POINTER_ONLY')).toBe(false);
    expect(mayClaimAbsent('FOUND_BUT_IMAGE_RESTRICTED')).toBe(false);
    expect(mayClaimAbsent('NO_APPLICABLE_RECORD_FOUND')).toBe(true);
  });

  it('retains the routes already tried so a later attempt does not repeat them', () => {
    const recovery = buildRecordedDocumentRecovery({
      reference: '9762/355',
      state: 'SEARCH_NOT_EXHAUSTED',
      routesAttempted: ['deterministic recorder collector', 'county records browser workflow'],
    });
    expect(recovery.routesAttempted).toHaveLength(2);
    expect(recovery.routesAttempted[0]).toMatch(/deterministic recorder collector/);
  });
});
