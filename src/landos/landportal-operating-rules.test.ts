import { describe, expect, it } from 'vitest';
import {
  evaluateThreeDCaptureEligibility,
  sameLandPortalParcel,
  validateLandPortalSubjectUrl,
} from './landportal-operating-rules.js';

const url = 'https://landportal.com/?property=Zmlwcz0zNjAxMSZhcG49MDUzODg5Kzc1LjAwLTEtMjQuMTEmcHJvcGVydHlpZD04OTUwNTM4NQ%3D%3D';
const otherUrl = 'https://landportal.com/?property=Zmlwcz00NzEyOSZhcG49MDk1KysrKzAyNDA1JnByb3BlcnR5aWQ9MTIzODY1Njg0';

describe('LandPortal permanent operating rules', () => {
  it('applies the exact 3D threshold boundaries', () => {
    expect(evaluateThreeDCaptureEligibility({ 'Slope Avg': '10%' }).decision).toBe('eligible');
    expect(evaluateThreeDCaptureEligibility({ 'Slope Avg': '9.99%', 'Under 10% Slope': '90%' }).decision).toBe('not_applicable');
    expect(evaluateThreeDCaptureEligibility({ 'Slope Avg': '4%', 'Under 10% Slope': '89.99%' }).decision).toBe('eligible');
    expect(evaluateThreeDCaptureEligibility({ 'Slope Avg': '4%', 'Under 10% Slope': '90.00%' }).decision).toBe('not_applicable');
  });

  it('recognizes retained 10-15 and 15-plus bands as area above ten', () => {
    const result = evaluateThreeDCaptureEligibility({ 'Heavy Slope (10-15%)': '3.68%', 'Extreme Slope (15%+)': '1.10%' });
    expect(result.areaAboveTenSlopePercent).toBeCloseTo(4.78, 2);
    expect(result.decision).toBe('not_applicable');
    expect(evaluateThreeDCaptureEligibility({ 'Heavy Slope (10-15%)': '8%', 'Extreme Slope (15%+)': '2.01%' }).decision).toBe('eligible');
  });

  it('leaves missing slope data explicitly unknown and does not block not-applicable output', () => {
    expect(evaluateThreeDCaptureEligibility({}).decision).toBe('unknown');
    expect(evaluateThreeDCaptureEligibility({ 'Slope Avg': '4.08%', 'Under 10% Slope': '95.22%' }).decision).toBe('not_applicable');
  });

  it('accepts only a decodable LandPortal subject parcel URL', () => {
    const valid = validateLandPortalSubjectUrl(url);
    expect(valid.valid).toBe(true);
    expect(valid.identity?.propertyId).toBe('89505385');
    expect(validateLandPortalSubjectUrl('https://landportal.com/').valid).toBe(false);
    expect(validateLandPortalSubjectUrl('https://landportal.com/?market_comps=abc').valid).toBe(false);
    expect(validateLandPortalSubjectUrl('https://example.com/?property=abc').valid).toBe(false);
    expect(validateLandPortalSubjectUrl('not a url').valid).toBe(false);
  });

  it('uses property ID for cross-deal parcel isolation', () => {
    const a = validateLandPortalSubjectUrl(url).identity;
    const b = validateLandPortalSubjectUrl(otherUrl).identity;
    expect(sameLandPortalParcel(a, a)).toBe(true);
    expect(sameLandPortalParcel(a, b)).toBe(false);
  });
});
