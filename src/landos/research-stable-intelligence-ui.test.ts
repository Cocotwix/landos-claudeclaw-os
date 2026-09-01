// Stage 3 presentation contract: the Property Story and the Market Story are on
// the operator's real surfaces, the market slots are bound by ROLE rather than
// by position, the four evidence standings stay visibly apart, and an absent
// reading explains itself instead of rendering a blank panel.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const STORIES_SRC = read('web/src/components/AcquisitionWorkspaceV2Stories.tsx');
const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const CSS_SRC = read('web/src/styles/workspace-v2-stories.css');
const ROUTES_SRC = read('src/landos/routes.ts');

describe('the stories reach the operator', () => {
  it('renders the Property Story on the property page and the Market Story on the market page', () => {
    expect(PAGE_SRC).toContain('<PropertyStoryPanel story={propertyStory} stability={researchStability} />');
    expect(PAGE_SRC).toContain('<MarketStoryPanel story={marketStory} stability={researchStability} />');
    expect(PAGE_SRC).toContain('setPropertyStory(i?.propertyStory ?? null);');
    expect(PAGE_SRC).toContain('setMarketStory(i?.marketStory ?? null);');
  });

  it('serves both readings and the stability reason from the workspace read', () => {
    expect(ROUTES_SRC).toContain('propertyStory: property');
    expect(ROUTES_SRC).toContain('marketStory: market');
    expect(ROUTES_SRC).toContain('researchStability: stability');
    expect(ROUTES_SRC).toContain('sellerIntelligence: stability?.sellerIntelligence ?? null');
  });

  it('produces the readings from the research completion lifecycle, never from a read', () => {
    // The one lifecycle seam: the coverage cycle's close, which every existing
    // trigger already reaches — operator re-run, research mission completion,
    // evidence upload, intake and subject promotion.
    expect(ROUTES_SRC).toContain('const stories = produceResearchStableIntelligence(id, `coverage:${trigger}`, runId);');
    // The two legitimate state transitions, both behind the stability gate.
    expect(ROUTES_SRC).toContain("produceResearchStableIntelligence(id, 'operator:subject-understanding')");
    expect(ROUTES_SRC).toContain('produceResearchStableIntelligence(id, `mission:subject-understanding:${resolutionCaller}`)');
    // And nothing else. A workspace read must never appear as a write site.
    // Exactly three CALL sites; the definition reads `= (` and does not match.
    const writeSites = [...ROUTES_SRC.matchAll(/produceResearchStableIntelligence\(/g)];
    expect(writeSites).toHaveLength(3);
    expect(ROUTES_SRC).not.toContain("produceResearchStableIntelligence(id, 'workspace:property-intelligence')");
  });

  it('answers the workspace read with SELECTs only', () => {
    const workspaceBlock = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf('// Stage 3: the Property Story and the Market Story.'),
      ROUTES_SRC.indexOf('subject: canonicalSubjectProjection(id),'),
    );
    expect(workspaceBlock).toContain('readPropertyEvidenceSynthesis(id)');
    expect(workspaceBlock).toContain('readMarketResearchAndPulse(id)');
    expect(workspaceBlock).toContain('researchStabilityFor(id)');
    expect(workspaceBlock).not.toContain('produceResearchStableIntelligence');
    expect(workspaceBlock).toContain('READ ONLY');
  });
});

describe('market slots are bound by role', () => {
  it('gives every market record its own named slot instead of a filtered array position', () => {
    expect(STORIES_SRC).toContain('<MarketRecordCard heading="Subject band" role="subject_band" record={story.subjectBand} />');
    expect(STORIES_SRC).toContain('heading="Most liquid band (not the subject\'s)" role="most_liquid_band"');
    // No filter-then-index anywhere in this surface.
    expect(STORIES_SRC).not.toMatch(/\.filter\([^)]*available[^)]*\)\s*\.map\(\([^)]*index/);
  });

  it('renders an unavailable record with its reason rather than dropping the slot', () => {
    expect(STORIES_SRC).toContain('<b class="awv2-dx-band-none">Not available</b>');
    expect(STORIES_SRC).toContain('No retained market record answered for this slot.');
  });

  it('shows the sample, dates, price basis and limitations beside every figure', () => {
    expect(STORIES_SRC).toContain('<dt>Sample</dt>');
    expect(STORIES_SRC).toContain('<dt>Months supply</dt>');
    expect(STORIES_SRC).toContain('record.pricePerAcreBasis');
    expect(STORIES_SRC).toContain('record.limitations');
    expect(STORIES_SRC).toContain('{record.period ?? \'period not stated\'}');
  });
});

describe('evidence standings stay apart', () => {
  it('labels each claim with its standing and its source', () => {
    for (const standing of [
      'official_legal_fact', 'record_fact', 'visual_observation',
      'analytical_hypothesis', 'verification_need',
    ]) {
      expect(STORIES_SRC).toContain(standing);
    }
    expect(STORIES_SRC).toContain('class="awv2-story-claim-standing"');
    expect(STORIES_SRC).toContain('class="awv2-story-claim-source"');
    expect(CSS_SRC).toContain(".awv2-story-claim[data-standing='visual_observation']");
  });

  it('presents visual review as observation, never as a record fact', () => {
    expect(STORIES_SRC).toContain('Visual and neighbourhood review — observation, never record fact');
    expect(STORIES_SRC).toContain('Retained capture; no vision analysis was run on it.');
  });

  it('shows what LandOS declined to claim and what would unlock it', () => {
    expect(STORIES_SRC).toContain('Not claimed, and what would change that');
    expect(STORIES_SRC).toContain('Unlocked by: {guard.unlockedBy}');
  });

  it('carries conflicts open rather than resolving them into one number', () => {
    expect(STORIES_SRC).toContain('Source conflicts, carried rather than resolved away');
    expect(STORIES_SRC).toContain("data-resolution={conflict.resolution ?? 'unresolved'}");
  });
});

describe('the Market Pulse plan is visible and bounded', () => {
  it('shows each planned question with its geography, action bound and sources', () => {
    expect(STORIES_SRC).toContain('Market Pulse research plan — bounded, authorized, not yet run unless marked answered');
    expect(STORIES_SRC).toContain('up to {question.boundedActions} evidence action(s)');
    expect(STORIES_SRC).toContain("source.kind === 'fallback' ? ' (fallback)' : ''");
  });

  it('shows refused pulse claims instead of hiding them', () => {
    expect(STORIES_SRC).toContain('Refused pulse claims');
  });
});

describe('an absent reading explains itself', () => {
  it('renders the stability reason instead of a blank panel', () => {
    expect(STORIES_SRC).toContain('function NotYet(');
    expect(STORIES_SRC).toContain('stability?.reason ??');
    expect(STORIES_SRC).toContain('research has not reached a stable state for this lead.');
  });

  it('marks a reading formed about another parcel version as history, not current truth', () => {
    expect(STORIES_SRC).toContain("story.correlation && story.correlation !== 'equivalent'");
    expect(STORIES_SRC).toContain('shown as history, not as current truth');
  });
});
