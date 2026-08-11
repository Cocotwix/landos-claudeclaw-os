// LandOS — official STATEWIDE parcel services.
//
// This is state-level, not county-level, and that distinction is the reason it
// is allowed to exist in a platform-first design: one entry covers every county
// in a state from a single official endpoint. Adding a state here helps dozens
// of counties at once; adding a county would help exactly one, which is the
// brittleness this sprint exists to avoid.
//
// These are the highest-leverage fallback in the whole system. When a county
// publishes nothing usable, or blocks automation, or simply has no GIS, the
// state's own parcel service frequently still answers — and it is an official
// government source, not a broker.
//
// Coverage is honest: a state is listed only when its endpoint has been reached
// and its parcel layer read. An unlisted state means LandOS has not verified
// one, not that none exists.

import type { GisSearchMethod } from './gis-platform-types.js';

export interface StatewideParcelService {
  /** Two-letter state code. */
  state: string;
  /** Agency that publishes it, for the operator-facing source label. */
  publisher: string;
  /** Queryable ArcGIS layer URL. */
  layerUrl: string;
  /** Human-facing page for the programme, when one exists. */
  programUrl?: string;
  searchMethods: GisSearchMethod[];
  /**
   * Stated coverage limits. A statewide layer is frequently partial or a season
   * behind the county, and the operator must be told rather than left to assume
   * the state and the county agree.
   */
  coverageCaveat: string;
}

export const STATEWIDE_PARCEL_SERVICES: StatewideParcelService[] = [
  {
    state: 'NY',
    publisher: 'NYS ITS Geospatial Services',
    layerUrl: 'https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1',
    programUrl: 'https://gis.ny.gov/parcels',
    searchMethods: ['apn', 'address', 'owner', 'coordinate'],
    coverageCaveat:
      'Covers only the counties that granted the state permission to republish their parcels, and carries the prior assessment roll year.',
  },
  {
    state: 'TN',
    publisher: 'Tennessee Comptroller of the Treasury',
    layerUrl: 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0',
    searchMethods: ['apn', 'address', 'owner', 'coordinate'],
    coverageCaveat: 'Statewide public-use boundaries; the parcel key is prefixed with the county number.',
  },
  {
    state: 'FL',
    publisher: 'Florida Department of Environmental Protection (statewide cadastral view)',
    layerUrl: 'https://ca.dep.state.fl.us/arcgis/rest/services/Map_Direct/Boundaries/MapServer/16',
    searchMethods: ['apn', 'address', 'coordinate'],
    coverageCaveat:
      'A dated state view of county property-appraiser submissions; ownership is a dated record and must not replace a newer accepted owner.',
  },
  {
    state: 'SC',
    publisher: 'South Carolina Department of Transportation (statewide parcel mirror)',
    layerUrl: 'https://smpesri.scdot.org/arcgis/rest/services/GISMapping/SC_Parcels/MapServer',
    searchMethods: ['apn', 'address', 'coordinate'],
    coverageCaveat:
      'One sublayer per county with schemas that differ between them; a mirror can lag the county assessor.',
  },
];

export function statewideParcelServiceFor(state: string | undefined): StatewideParcelService | null {
  const code = (state ?? '').trim().toUpperCase();
  if (!code) return null;
  return STATEWIDE_PARCEL_SERVICES.find((service) => service.state === code) ?? null;
}
