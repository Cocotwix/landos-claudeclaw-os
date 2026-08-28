import { describe, it, expect } from 'vitest';
import { readBoundarySegments, reconcileBoundaryFrontage } from './deal-evidence-claims.js';

// The exact legal description retained on the Deal 90 subject survey page.
const SUBJECT_SURVEY = `Commence at a concrete monument found at the Northwest corner of said SE1/4 and run North 89 degrees, 24 minutes and 06 seconds East, along the Northerly boundary thereof, 932.98 feet to a set iron rod; thence South 13 degrees, 13 minutes and 09 seconds West, 322.41 feet for the Point of Beginning. From Point of Beginning thus described continue South 13 degrees, 13 minutes and 09 seconds West, 129.45 feet to a set iron rod; thence North 76 degrees, 45 minutes and 51 seconds West, 459.67 feet to the centerline of NW 137th Lane; thence along said centerline following 4 courses along said centerline: 1) North 08 degrees, 58 minutes and 56 seconds West, 5.03 feet; 2) North 44 degrees, 06 minutes and 10 seconds East, 29.93 feet; 3) North 78 degrees, 49 minutes and 55 seconds East, 69.20 feet; 4) North 28 degrees, 53 minutes and 58 seconds East, 73.26 feet; thence leaving said centerline run South 76 degrees, 46 minutes and 51 seconds East, 437.70 feet to the Point of Beginning. Containing 1.50 acres, more or less.`;

describe('survey boundary segments are read spatially, not by adjacency', () => {
  const segments = readBoundarySegments(SUBJECT_SURVEY);

  it('classifies the 459.67 ft course as a side/depth line, never as frontage', () => {
    const line = segments.find((s) => s.distanceFeet === 459.67);
    expect(line).toBeDefined();
    // The defect this guards: the road's name sits beside the number, but the
    // course RUNS TO the centerline, so it crosses the parcel toward the road.
    expect(line!.role).toBe('side_depth');
    expect(line!.feature).toMatch(/137th Lane/i);
    expect(segments.some((s) => s.distanceFeet === 459.67 && s.role === 'road_facing')).toBe(false);
  });

  it('reads the road-facing boundary as the courses run ALONG the centerline', () => {
    const roadFacing = segments.filter((s) => s.role === 'road_facing');
    expect(roadFacing.map((s) => s.distanceFeet)).toEqual([5.03, 29.93, 69.20, 73.26]);
    for (const s of roadFacing) expect(s.feature).toMatch(/137th Lane/i);
  });

  it('keeps the surveyed road-facing run separate from provider frontage', () => {
    const reconciled = reconcileBoundaryFrontage({
      segments,
      providerFrontageFeet: 157.40,
      providerFrontageLabel: 'LandPortal parcel record',
    });
    expect(reconciled).not.toBeNull();
    expect(reconciled!.surveyedRoadFacingFeet).toBe(177.42);
    expect(reconciled!.providerFrontageFeet).toBe(157.40);
    // Neither figure is allowed to stand in for the other, and the longest
    // side/depth line is named as such so it cannot be reported as frontage.
    expect(reconciled!.longestSideDepthFeet).toBe(459.67);
    expect(reconciled!.reason).toMatch(/not frontage along it/i);
  });

  it('does not call a watercourse a road', () => {
    const river = readBoundarySegments(
      'thence North 76 degrees, 45 minutes and 51 seconds West, 562.85 feet to the centerline of New River; '
      + 'thence run the following 4 courses along said centerline; 1) North 08 degrees, 58 minutes and 56 seconds West, 5.03 feet;',
    );
    expect(river.find((s) => s.distanceFeet === 562.85)!.role).toBe('side_depth');
    expect(river.find((s) => s.distanceFeet === 5.03)!.role).toBe('water_facing');
    expect(river.some((s) => s.role === 'road_facing')).toBe(false);
  });

  it('claims nothing from a page that carries no metes-and-bounds description', () => {
    expect(readBoundarySegments('Official Records Receipt. Amount tendered $27.00.')).toEqual([]);
  });
});

describe('tie lines are not parcel boundaries', () => {
  const segments = readBoundarySegments(SUBJECT_SURVEY);

  it('excludes the commencement tie from the parcel boundary', () => {
    const tie = segments.filter((s) => s.role === 'tie_line').map((s) => s.distanceFeet);
    expect(tie).toEqual([932.98, 322.41]);
  });

  it('keeps the rear boundary the tie line used to displace', () => {
    // 129.45 ft is the first course out of the Point of Beginning. Merging it
    // with the 322.41 ft tie bound the tie's distance to the boundary and lost
    // this one entirely.
    const rear = segments.find((s) => s.distanceFeet === 129.45);
    expect(rear).toBeDefined();
    expect(rear!.role).toBe('side_depth');
    expect(segments.filter((s) => s.role !== 'tie_line').map((s) => s.distanceFeet))
      .toEqual([129.45, 459.67, 5.03, 29.93, 69.20, 73.26, 437.70]);
  });
});
