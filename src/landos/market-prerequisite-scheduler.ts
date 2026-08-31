// County/ZIP market work is geography-scoped, not parcel-scoped. This small
// scheduler starts every eligible run/reuse task in the same microtask wave and
// returns explicit skipped/returned/failed outcomes for Market Intelligence.

export interface MarketPrerequisiteSubject {
  county: string | null;
  state: string | null;
  zip: string | null;
}

export type MarketPrerequisiteTaskId = 'county_market_research' | 'county_market_pulse' | 'zip_market_research';

export interface MarketPrerequisiteTaskResult<T = unknown> {
  id: MarketPrerequisiteTaskId;
  geography: string | null;
  status: 'returned' | 'unresolved' | 'failed' | 'waiting_prerequisite';
  value: T | null;
  reason: string;
}

export interface MarketPrerequisiteDeps {
  countyResearch: (subject: Required<Pick<MarketPrerequisiteSubject, 'county' | 'state'>>) => Promise<unknown>;
  countyPulse: (subject: Required<Pick<MarketPrerequisiteSubject, 'county' | 'state'>>) => Promise<unknown>;
  zipResearch: (subject: Required<Pick<MarketPrerequisiteSubject, 'zip'>> & Pick<MarketPrerequisiteSubject, 'state' | 'county'>) => Promise<unknown>;
}

const settle = async (id: MarketPrerequisiteTaskId, geography: string, work: () => Promise<unknown>): Promise<MarketPrerequisiteTaskResult> => {
  try {
    const value = await work();
    return value == null
      ? { id, geography, status: 'unresolved', value: null, reason: `${id.replaceAll('_', ' ')} ran or reused retained state but no current output was available.` }
      : { id, geography, status: 'returned', value, reason: `${id.replaceAll('_', ' ')} returned current output.` };
  } catch (error) {
    return { id, geography, status: 'failed', value: null, reason: error instanceof Error ? error.message : String(error) };
  }
};

export async function runMarketPrerequisiteWork(
  subject: MarketPrerequisiteSubject,
  deps: MarketPrerequisiteDeps,
): Promise<Record<MarketPrerequisiteTaskId, MarketPrerequisiteTaskResult>> {
  const countyReady = !!(subject.county?.trim() && subject.state?.trim());
  const zipReady = !!subject.zip?.trim();
  const waiting = (id: MarketPrerequisiteTaskId, reason: string): Promise<MarketPrerequisiteTaskResult> => Promise.resolve({
    id, geography: null, status: 'waiting_prerequisite', value: null, reason,
  });
  // Construct every promise before awaiting any of them. County research,
  // County Pulse, and ZIP research therefore never serialize behind each other.
  const countySubject = { county: subject.county!, state: subject.state! };
  const zipSubject = { zip: subject.zip!, county: subject.county, state: subject.state };
  const [countyResearch, countyPulse, zipResearch] = await Promise.all([
    countyReady
      ? settle('county_market_research', `${subject.county}, ${subject.state}`, () => deps.countyResearch(countySubject))
      : waiting('county_market_research', 'Waiting for county and state.'),
    countyReady
      ? settle('county_market_pulse', `${subject.county}, ${subject.state}`, () => deps.countyPulse(countySubject))
      : waiting('county_market_pulse', 'Waiting for county and state.'),
    zipReady
      ? settle('zip_market_research', subject.zip!, () => deps.zipResearch(zipSubject))
      : waiting('zip_market_research', 'Waiting for ZIP.'),
  ]);
  return { county_market_research: countyResearch, county_market_pulse: countyPulse, zip_market_research: zipResearch };
}
