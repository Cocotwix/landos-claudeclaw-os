// LandOS — Captured LandPortal Drill Deep table (Georgia), replay artifact.
//
// This is a REPRESENTATIVE captured Drill Deep table (Status=Sold, Data=Land,
// Time=1 Year, Acreage=2–5 Acres) for ONE state (Georgia), expanded
// State → County → ZIP. It is the replay source for Browser Playbook #1 so the
// full pipeline (navigation plan → extraction → normalization → validation →
// ingestion → Market Matrix) is provable WITHOUT a live authenticated visual
// session. Values are representative, not live market data. It flows through the
// IDENTICAL playbook + ingestion path a live extraction would.
//
// The `cells` are keyed by the DISCOVERED HEADER text exactly as the Drill Deep
// table presents them; the playbook maps headers → metrics dynamically. A blank
// cell (see Richmond "Growth") stays Unknown downstream — never guessed, never 0.

import type { RawMarketTable } from '../browser-playbook-landportal-market.js';

export const DRILL_DEEP_PERIOD = '2026-Q2';

// Visual header order as read off the Drill Deep table. "# Counties" / "# Zipcodes"
// are structural row-shape counts (skipped by metric extraction); the rest map to
// market metrics via the playbook's dynamic header alias map.
const HEADERS = ['# Counties', '# Zipcodes', 'Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'];

export const DRILL_DEEP_GA_TABLE: RawMarketTable = {
  headers: HEADERS,
  period: DRILL_DEEP_PERIOD,
  side: 'sold',
  acreageBand: '2-5',
  state: 'GA',
  sourcePage: 'LandPortal › Market Research › Drill Deep (Sold · Land · 1 Year · 2–5 Acres · GA) — replay capture',
  scopeVisited: ['Market Research', 'Drill Deep'],
  screenshots: ['landportal_market_research_drill_deep_ga'],
  rows: [
    {
      level: 'state', state: 'GA', confidence: 'medium',
      cells: { '# Counties': '159', '# Zipcodes': '3', Count: '118', DOM: '82', STR: '39', AR: '12', MoS: '6.9', Population: '10,900,000', Density: '190', Growth: '3.3', MP: '$285,000', PPA: '$95,000' },
    },
    {
      level: 'county', state: 'GA', county: 'DeKalb', fips: '13089', confidence: 'high',
      cells: { '# Zipcodes': '2', Count: '42', DOM: '78', STR: '41', AR: '14', MoS: '5.7', Population: '764,300', Density: '2,718', Growth: '3.1', MP: '$345,000', PPA: '$121,500' },
    },
    {
      level: 'zip', state: 'GA', county: 'DeKalb', fips: '13089', zip: '30030', confidence: 'medium',
      cells: { Count: '11', DOM: '73', STR: '44', AR: '15', MoS: '5.2', Population: '24,800', Density: '3,010', Growth: '3.4', MP: '$362,000', PPA: '$128,000' },
    },
    {
      level: 'zip', state: 'GA', county: 'DeKalb', fips: '13089', zip: '30032', confidence: 'medium',
      cells: { Count: '9', DOM: '84', STR: '38', AR: '12', MoS: '6.1', Population: '41,200', Density: '2,540', Growth: '2.8', MP: '$318,000', PPA: '$112,500' },
    },
    {
      level: 'county', state: 'GA', county: 'Fulton', fips: '13121', confidence: 'high',
      cells: { '# Zipcodes': '1', Count: '55', DOM: '66', STR: '38', AR: '13', MoS: '6.9', Population: '1,074,000', Density: '1,990', Growth: '2.4', MP: '$512,000', PPA: '$205,000' },
    },
    {
      level: 'zip', state: 'GA', county: 'Fulton', fips: '13121', zip: '30349', confidence: 'medium',
      cells: { Count: '18', DOM: '61', STR: '40', AR: '14', MoS: '6.2', Population: '76,400', Density: '1,610', Growth: '2.7', MP: '$389,000', PPA: '$158,000' },
    },
    {
      // Richmond: population Growth intentionally BLANK — proves Unknown (null),
      // never guessed, never zero, all the way to the Market Matrix.
      level: 'county', state: 'GA', county: 'Richmond', fips: '13245', confidence: 'medium',
      cells: { '# Zipcodes': '0', Count: '21', DOM: '103', STR: '38', AR: '9', MoS: '8.1', Population: '207,000', Density: '640', Growth: '', MP: '$96,000', PPA: '$28,500' },
    },
  ],
};

/** Replay lookup: the captured Drill Deep table for a state, or null if none was
 *  captured for that state (honest empty — not fabricated, not an auth failure). */
export function drillDeepTableForState(state: string): RawMarketTable | null {
  return state.toUpperCase() === 'GA' ? DRILL_DEEP_GA_TABLE : null;
}
