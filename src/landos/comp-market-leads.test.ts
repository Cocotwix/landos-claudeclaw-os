import { describe, it, expect } from 'vitest';
import { collectMarketLeads, extractCompMarketLeads } from './comp-market-leads.js';

const source = (description: string, over: Partial<Parameters<typeof extractCompMarketLeads>[0]> = {}) => ({
  compKey: 'comp-1',
  compLabel: '11892 Cabin Ln, Rapid City, MI 49676',
  provider: 'Realtor.com',
  sourceUrl: 'https://www.realtor.com/realestateandhomes-detail/11892-Cabin-Ln',
  description,
  ...over,
});

describe('extractCompMarketLeads', () => {
  it('reads a utility expansion out of a listing write-up, verbatim and attributed', () => {
    const leads = extractCompMarketLeads(source(
      'Beautiful rolling acreage. County sewer expansion is scheduled to reach this road next year. Bring your builder.',
    ));
    const sewer = leads.find((lead) => lead.topic === 'utilities_expansion')!;
    expect(sewer.excerpt).toBe('County sewer expansion is scheduled to reach this road next year.');
    expect(sewer.provider).toBe('Realtor.com');
    expect(sewer.compLabel).toBe('11892 Cabin Ln, Rapid City, MI 49676');
    expect(sewer.sourceUrl).toContain('realtor.com');
  });

  it('never states a lead as a fact about the subject', () => {
    const leads = extractCompMarketLeads(source('Public water and sewer are available at the street.'));
    expect(leads.length).toBeGreaterThan(0);
    for (const lead of leads) {
      expect(lead.status).toBe('unverified_area_lead');
      expect(lead.note).toMatch(/not an established fact about the subject/i);
    }
  });

  it('picks up restrictions, roads, nearby development and demand', () => {
    const topics = (text: string) => extractCompMarketLeads(source(text)).map((lead) => lead.topic);
    expect(topics('The parcel is deed restricted with no mobile homes permitted.')).toContain('restrictions');
    expect(topics('Access is via a seasonal gravel road maintained by the county.')).toContain('road_access');
    expect(topics('A new subdivision is being developed directly to the north.')).toContain('nearby_development');
    expect(topics('Lots in this area are selling fast and inventory is limited.')).toContain('buyer_demand');
    expect(topics('A new highway interchange is proposed two miles east.')).toContain('planned_infrastructure');
  });

  it('returns nothing for generic marketing copy with no area signal', () => {
    expect(extractCompMarketLeads(source('Beautiful peaceful setting with stunning views. A rare find!'))).toEqual([]);
    expect(extractCompMarketLeads(source(''))).toEqual([]);
  });

  it('states one lead per topic even when the write-up repeats itself', () => {
    const leads = extractCompMarketLeads(source(
      'Gravel road frontage. The gravel road is county maintained. Deeded access via easement.',
    ));
    expect(leads.filter((lead) => lead.topic === 'road_access')).toHaveLength(1);
  });
});

describe('collectMarketLeads', () => {
  it('collapses one syndicated description republished by two providers into one lead', () => {
    const text = 'County sewer expansion is scheduled to reach this road next year.';
    const leads = collectMarketLeads([
      source(text, { provider: 'Realtor.com' }),
      source(text, { provider: 'Zillow', compKey: 'comp-2' }),
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].provider).toBe('Realtor.com + Zillow');
  });

  it('keeps two independently worded observations of the same topic apart', () => {
    const leads = collectMarketLeads([
      source('County sewer expansion is scheduled for this corridor.', { provider: 'Realtor.com' }),
      source('Municipal water is being extended along the highway.', { provider: 'Zillow', compKey: 'comp-2' }),
    ]);
    expect(leads.filter((lead) => lead.topic === 'utilities_expansion')).toHaveLength(2);
  });

  it('orders the highest-value area signals first', () => {
    const leads = collectMarketLeads([
      source('Lots in this area are selling fast.', { compKey: 'a' }),
      source('County sewer expansion is planned for this road.', { compKey: 'b' }),
    ]);
    expect(leads[0].topic).toBe('utilities_expansion');
  });
});
