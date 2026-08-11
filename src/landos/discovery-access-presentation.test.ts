// Discovery-stage access presentation contract: road abutment evidence
// displays legal access as present; apparent entrance is a separate visual
// read that is never fabricated; stale unresolved-access phrasing never
// survives the projection; metric parsers keep working on the new headline.

import { describe, expect, it } from 'vitest';

import {
  apparentEntranceAttribution,
  apparentEntranceFromObservations,
  establishedAccessFollowUps,
  filterResolvedAccessLanguage,
  normalizeDiscoveryAccessItems,
  presentBuyerAnalysisAccessLanguage,
  presentDiscoveryAccessEvidence,
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

  // The observation text here describes only what a retained panorama shows.
  // An earlier fixture asserted a gated entrance that no capture ever supported;
  // a visual finding now exists only where its image does (see the artifact gate
  // in hermes-landportal-import and google-visual-capture).
  it('carries the observation record\'s own evidence label and confidence', () => {
    const read = apparentEntranceFromObservations([{
      label: 'Entrances and barriers',
      detail: 'A gravel drive meeting the road is visible in the captured Street View panorama; whether it serves the subject is unconfirmed from this view alone.',
      evidence: 'Street View — unconfirmed',
      confidence: 'low',
    }], 'Elk Lake Road');
    expect(read.confirmed).toBe(true);
    expect(read.evidenceLabel).toBe('Street View — unconfirmed');
    expect(read.confidence).toBe('low');
  });
});

describe('apparent entrance attribution (never credited to a provider that reported no coverage)', () => {
  it('names the observation evidence instead of a provider, and hedges an unconfirmed read', () => {
    const attribution = apparentEntranceAttribution({ evidenceLabel: 'Street View — unconfirmed', confidence: 'low' });
    expect(attribution.sourceLabel).toBe('Retained visual observation — Street View — unconfirmed');
    expect(attribution.sourceLabel).not.toMatch(/LandPortal/i);
    expect(attribution.weight).toBe('likely');
  });

  it('keeps a directly observed, non-hedged read at well_supported', () => {
    const attribution = apparentEntranceAttribution({ evidenceLabel: 'Street View — direct observation', confidence: 'medium' });
    expect(attribution.weight).toBe('well_supported');
  });

  it('falls back to a neutral label when the record states no evidence wording', () => {
    const attribution = apparentEntranceAttribution({ evidenceLabel: null, confidence: null });
    expect(attribution.sourceLabel).toBe('Retained visual observation');
    expect(attribution.weight).toBe('well_supported');
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

describe('four-tier access evidence projection', () => {
  // Every visual item names the capture it was read from: the presentation
  // path always demands the artifact, so an unbacked scene cannot render.
  const parcelFlag = {
    tier: 'parcel_flag', statement: 'Land Locked: Yes', sourceLabel: 'LandPortal',
    sourceKind: 'landportal_parcel_flag', basis: 'source_stated', weight: 'likely',
  } as const;
  const aerial = {
    tier: 'apparent_physical', statement: 'Apparent gravel drive', sourceLabel: 'Satellite',
    sourceKind: 'satellite_imagery', basis: 'direct_observation', weight: 'well_supported',
    artifactRef: 'inspection-aerial',
  } as const;

  it('delegates to the evidence ladder without collapsing listing or imagery evidence into verified legal access', () => {
    const result = presentDiscoveryAccessEvidence([
      parcelFlag,
      aerial,
      { tier: 'reported_legal', statement: 'Listing reports an easement', sourceLabel: 'Prior listing', sourceKind: 'listing', basis: 'source_stated', weight: 'likely' },
    ], { retainedArtifacts: ['inspection-aerial'] });
    expect(result).toMatchObject({ parcelFlagged: true, apparentPhysicalAccess: true, reportedLegalAccess: true, verifiedLegalAccess: false });
    expect(result.items).toHaveLength(3);
    expect(result.outstanding.join(' ')).toMatch(/recorded instrument/i);
  });

  it('projects exactly four rungs so a surface renders each concept once', () => {
    const result = presentDiscoveryAccessEvidence([parcelFlag, aerial], { retainedArtifacts: ['inspection-aerial'] });
    expect(result.rungs.map((rung) => rung.tier)).toEqual(['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal']);
    expect(result.rungs.filter((rung) => rung.status === 'not_evidenced').map((rung) => rung.tier))
      .toEqual(['reported_legal', 'verified_legal']);
    // Each rung's sentence appears once, and the conclusion is assembled from
    // them rather than repeated per source.
    for (const rung of result.rungs) {
      if (rung.status === 'not_evidenced') continue;
      const occurrences = result.operatorConclusion.split(rung.statement).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('keeps the parcel source\'s own stated condition rather than a canned one', () => {
    const result = presentDiscoveryAccessEvidence([{
      ...parcelFlag,
      statement: 'Land Locked: No. LandPortal reports 264 ft of frontage on Elk Lake Road',
    }]);
    expect(result.rungs[0].statement).toMatch(/Land Locked: No\. LandPortal reports 264 ft of frontage on Elk Lake Road\./);
    expect(result.rungs[0].statement).not.toMatch(/flags this parcel as land locked/i);
  });

  it('drops a stored Street View statement whose capture was never retained', () => {
    const stored = [{
      tier: 'apparent_physical' as const,
      statement: 'A fenced/gated gravel entrance is visible in the Street View scene.',
      sourceLabel: 'Retained visual observation — Street View',
      sourceKind: 'street_view' as const,
      basis: 'direct_observation' as const,
      weight: 'well_supported' as const,
      artifactRef: 'street-view-capture-1',
    }];
    const orphaned = presentDiscoveryAccessEvidence(stored, { retainedArtifacts: ['inspection-aerial'] });
    expect(orphaned.apparentPhysicalAccess).toBe(false);
    expect(orphaned.operatorConclusion).not.toMatch(/gated gravel entrance/i);
    expect(orphaned.rejected[0].reason).toMatch(/orphaned/i);
    // No artifact reference at all is refused the same way.
    expect(presentDiscoveryAccessEvidence([{ ...stored[0], artifactRef: null }]).items).toHaveLength(0);
    // With the capture actually retained, the same observation is admissible.
    const backed = presentDiscoveryAccessEvidence(stored, { retainedArtifacts: ['street-view-capture-1'] });
    expect(backed.apparentPhysicalAccess).toBe(true);
  });

  it('accepts listing-derived tier-2 support and never promotes it to a legal rung', () => {
    const result = presentDiscoveryAccessEvidence([
      { tier: 'apparent_physical', statement: 'Listing directions: turn left onto the dirt drive.', sourceLabel: 'Listing', sourceKind: 'listing', basis: 'source_stated', weight: 'likely' },
      { tier: 'reported_legal', statement: 'Driveway: Dirt', sourceLabel: 'Listing', sourceKind: 'listing', basis: 'source_stated', weight: 'likely' },
    ]);
    expect(result.apparentPhysicalAccess).toBe(true);
    expect(result.reportedLegalAccess).toBe(false);
    expect(result.verifiedLegalAccess).toBe(false);
    expect(result.demoted[0].fromTier).toBe('reported_legal');
    expect(result.rungs[2].status).toBe('not_evidenced');
  });
});
