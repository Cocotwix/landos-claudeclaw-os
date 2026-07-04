// LandOS — Market Matrix county reference (FIPS identity).
//
// County NAME is display-only; the 5-digit FIPS is identity. This is a SEEDED
// reference subset (not the full 3,143-county universe) covering the states
// LandOS is actively working. It exists so the heatmap can render counties with
// no data as GREY (Unknown, never zero) and so exclusion reporting knows the
// county universe within a scoped state. The set is data-driven and extensible:
// more counties/states populate as the Browser Agent ingests them or as the
// reference is expanded. FIPS codes below are official Census county FIPS.

export interface CountyRef {
  fips: string;
  state: string;
  countyName: string;
}

export const SEED_COUNTY_REF: readonly CountyRef[] = [
  // ── Georgia (13) ──
  { fips: '13015', state: 'GA', countyName: 'Bartow' },
  { fips: '13045', state: 'GA', countyName: 'Carroll' },
  { fips: '13057', state: 'GA', countyName: 'Cherokee' },
  { fips: '13067', state: 'GA', countyName: 'Cobb' },
  { fips: '13077', state: 'GA', countyName: 'Coweta' },
  { fips: '13089', state: 'GA', countyName: 'DeKalb' },
  { fips: '13113', state: 'GA', countyName: 'Fayette' },
  { fips: '13117', state: 'GA', countyName: 'Forsyth' },
  { fips: '13121', state: 'GA', countyName: 'Fulton' },
  { fips: '13135', state: 'GA', countyName: 'Gwinnett' },
  { fips: '13139', state: 'GA', countyName: 'Hall' },
  { fips: '13151', state: 'GA', countyName: 'Henry' },
  { fips: '13217', state: 'GA', countyName: 'Newton' },
  { fips: '13245', state: 'GA', countyName: 'Richmond' },
  { fips: '13297', state: 'GA', countyName: 'Walton' },
  { fips: '13311', state: 'GA', countyName: 'White' },

  // ── South Carolina (45) ──
  { fips: '45003', state: 'SC', countyName: 'Aiken' },
  { fips: '45007', state: 'SC', countyName: 'Anderson' },
  { fips: '45021', state: 'SC', countyName: 'Cherokee' },
  { fips: '45045', state: 'SC', countyName: 'Greenville' },
  { fips: '45063', state: 'SC', countyName: 'Lexington' },
  { fips: '45073', state: 'SC', countyName: 'Oconee' },
  { fips: '45077', state: 'SC', countyName: 'Pickens' },
  { fips: '45079', state: 'SC', countyName: 'Richland' },
  { fips: '45083', state: 'SC', countyName: 'Spartanburg' },
  { fips: '45091', state: 'SC', countyName: 'York' },

  // ── Tennessee (47) ──
  { fips: '47009', state: 'TN', countyName: 'Blount' },
  { fips: '47011', state: 'TN', countyName: 'Bradley' },
  { fips: '47037', state: 'TN', countyName: 'Davidson' },
  { fips: '47065', state: 'TN', countyName: 'Hamilton' },
  { fips: '47093', state: 'TN', countyName: 'Knox' },
  { fips: '47149', state: 'TN', countyName: 'Rutherford' },
  { fips: '47155', state: 'TN', countyName: 'Sevier' },
  { fips: '47165', state: 'TN', countyName: 'Sumner' },
  { fips: '47187', state: 'TN', countyName: 'Williamson' },
  { fips: '47189', state: 'TN', countyName: 'Wilson' },
];

/** States with seeded county reference coverage (for honest coverage reporting). */
export const SEEDED_REF_STATES: readonly string[] = [...new Set(SEED_COUNTY_REF.map((c) => c.state))];
