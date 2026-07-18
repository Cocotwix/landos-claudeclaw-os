import { describe, expect, it } from 'vitest';
import { findCountyGis } from './county-gis-capabilities.js';

describe('Fayette County GIS capability', () => {
  it('provides the public parcel and official aerial services for every Fayette GA lead', () => {
    const capability = findCountyGis('Fayette County', 'GA');
    expect(capability?.layers.parcels).toMatch(/fayettecountyga\.gov.*parcelsRO/i);
    expect(capability?.layers.aerialImage).toMatch(/fayettecountyga\.gov.*2018_Imagery_Dynamic/i);
    expect(capability?.mapViewerUrl).toMatch(/qpublic/i);
  });
});
