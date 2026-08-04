// Discovery-stage access presentation contract: road abutment evidence
// displays legal access as present; apparent entrance is a separate visual
// read that is never fabricated; stale unresolved-access phrasing never
// survives the projection; metric parsers keep working on the new headline.

import { describe, expect, it } from 'vitest';

import {
  apparentEntranceFromObservations,
  establishedAccessFollowUps,
  filterResolvedAccessLanguage,
  normalizeDiscoveryAccessItems,
  presentBuyerAnalysisAccessLanguage,
  readDiscoveryAccess,
  roadNameFromSitus,
} from './discovery-access-presentation.js';
import type { SnapshotDueDiligenceItem } from './property-intelligence-snapshot.js';

const accessItem = (overrides: Partial<SnapshotDueDiligenceItem> = {}): SnapshotDueDiligenceItem => ({
  key: 'access',
  label: 'Road frontage and apparent access',
  verdict: 'caution',
  headline: '693.29 ft frontage shown; landlocked flag: No',
  grade: 'likely_indication',
  detail: 'LandPortal parcel-panel indication only. Legal access still requires recorded-instrument review.',
  sourceUrl: null,
  missing: [
    'Recorded legal access has not been established.',
    'Public right-of-way contact unresolved',
    'Physical / driveway access unresolved',
  ],
  ...overrides,
});

describe('road name derivation', () => {
  it('expands the situs street suffix', () => {
    expect(roadNameFromSitus('1487 Onionville Rd, Sterling, NY 13156')).toBe('Onionville Road');
    expect(roadNameFromSitus('12 Main St, Anytown, NY 10000')).toBe('Main Street');
    expect(roadNameFromSitus(null)).toBeNull();
  });
});

describe('discovery-stage legal access rule', () => {
  it('establishes legal access from mapped frontage plus no landlocked flag', () => {
    const read = readDiscoveryAccess([accessItem()], '1487 Onionville Rd, Sterling, NY 13156');
    expect(read.established).toBe(true);
    expect(read.display).toBe('Yes, via Onionville Road');
    expect(read.frontageFt).toBeCloseTo(693.29);
  });

  it('does NOT establish access when the parcel is flagged landlocked', () => {
    const read = readDiscoveryAccess(
      [accessItem({ headline: '120 ft frontage shown; landlocked flag: Yes' })],
      '1 Elm Rd, Town, NY 10000',
    );
    expect(read.established).toBe(false);
    expect(read.display).toBeNull();
  });

  it('rewrites the access item with the approved display and only genuine follow-ups', () => {
    const [item] = normalizeDiscoveryAccessItems([accessItem()], '1487 Onionville Rd, Sterling, NY 13156');
    expect(item.headline).toMatch(/^Legal access: Yes, via Onionville Road — /);
    expect(item.verdict).toBe('good');
    expect(item.missing).toEqual(establishedAccessFollowUps());
    const text = JSON.stringify(item);
    expect(text).not.toMatch(/driveway (?:approval|permit)/i);
    expect(text).not.toMatch(/right[- ]of[- ]way contact/i);
    expect(text).not.toMatch(/recorded legal access has not been established/i);
    expect(text).not.toMatch(/legal access unresolved/i);
  });

  it('keeps the frontage and landlocked metrics parseable in the new headline', () => {
    const [item] = normalizeDiscoveryAccessItems([accessItem()], '1487 Onionville Rd, Sterling, NY 13156');
    expect(item.headline).toMatch(/(\d+(?:\.\d+)?)\s*ft frontage/);
    expect(item.headline).toMatch(/landlocked flag:\s*No/);
  });

  it('leaves non-qualifying items untouched', () => {
    const original = accessItem({ headline: 'landlocked flag: Yes' });
    const items = normalizeDiscoveryAccessItems([original], '1 Elm Rd, Town, NY 10000');
    expect(items[0]).toBe(original);
  });
});

describe('apparent entrance (separate from legal access, never fabricated)', () => {
  it('reports Not confirmed when retained imagery shows no entrance', () => {
    const read = apparentEntranceFromObservations([
      { label: 'Entrances and driveways', detail: 'No improved driveway or cut visible at the subject frontage in the June 2023 imagery.' },
    ], 'Onionville Road');
    expect(read.confirmed).toBe(false);
    expect(read.display).toBe('Not confirmed from retained imagery');
    expect(read.observation).toMatch(/No improved driveway/);
  });

  it('reports a visible entrance only when the evidence supports one', () => {
    const read = apparentEntranceFromObservations([
      { label: 'Entrances and driveways', detail: 'A cleared grass path enters the parcel at the east end of the frontage.' },
    ], 'Onionville Road');
    expect(read.confirmed).toBe(true);
    expect(read.display).toMatch(/^Cleared grass path visible from Onionville Road$/);
  });

  it('reports Not confirmed when no entrance observation is retained', () => {
    const read = apparentEntranceFromObservations([], 'Onionville Road');
    expect(read.confirmed).toBe(false);
    expect(read.display).toBe('Not confirmed from retained imagery');
  });
});

describe('buyer-analysis display language (persisted record untouched)', () => {
  const analysis = () => ({
    observedFeatures: [{ label: 'Road frontage', detail: 'The parcel meets paved Onionville Rd; Street View shows the frontage vegetated.' }],
    buyerInterpretation: [{ label: 'Access considerations', detail: 'Physical frontage on a paved public road with no visible barrier to forming an entrance; recorded legal access still requires instrument review.' }],
    unresolvedDiligence: ['Recorded legal access (instrument review)', 'Ownership and rights of the Ontario Branch corridor'],
    buyerPerspective: {
      importantConcerns: ['Corridor bisects the parcel and its rights are unresolved', 'Legal access not yet established by recorded instrument'],
      weakerFitBuyers: ['Commercial users', 'Buyers requiring immediate documented legal access'],
      materialToValueOrStrategy: ['Official zoning and legal-access confirmation'],
    },
  });

  it('strips unresolved-access lines and instrument-review clauses for display', () => {
    const presented = presentBuyerAnalysisAccessLanguage(analysis(), true)!;
    expect(presented.unresolvedDiligence).toEqual(['Ownership and rights of the Ontario Branch corridor']);
    expect(presented.buyerPerspective?.importantConcerns).toEqual(['Corridor bisects the parcel and its rights are unresolved']);
    expect(presented.buyerPerspective?.weakerFitBuyers).toEqual(['Commercial users']);
    expect(presented.buyerPerspective?.materialToValueOrStrategy).toEqual(['Official zoning confirmation']);
    expect(presented.buyerInterpretation?.[0].detail).toBe('Physical frontage on a paved public road with no visible barrier to forming an entrance.');
  });

  it('returns the analysis untouched when access is not established', () => {
    const original = analysis();
    expect(presentBuyerAnalysisAccessLanguage(original, false)).toBe(original);
  });
});

describe('stale access language filter', () => {
  it('drops stale lines only when access is established', () => {
    const entries = [
      'Recorded legal access has not been established.',
      'Ownership and rights of the corridor remain unconfirmed.',
      'Physical / driveway access unresolved',
    ];
    expect(filterResolvedAccessLanguage(entries, true)).toEqual([
      'Ownership and rights of the corridor remain unconfirmed.',
    ]);
    expect(filterResolvedAccessLanguage(entries, false)).toEqual(entries);
  });
});
