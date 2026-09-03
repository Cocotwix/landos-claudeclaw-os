// Stage 5 presentation and trigger-map contract: the Development Path and the
// strategy comparison reach the operator's Deal Brain, the workspace read stays
// a SELECT, and every write site is a genuine completion, land-use or start-up
// reconcile event — never a page load.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const BRAIN_SRC = read('web/src/components/AcquisitionWorkspaceV2DealBrain.tsx');
const OVERVIEW_SRC = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');
const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const CSS_SRC = read('web/src/styles/workspace-v2-deal-brain.css');
const ROUTES_SRC = read('src/landos/routes.ts');
const SKILL_SRC = read('config/hermes/landos-profile/skills/landos-zoning-subdivision-entitlement/SKILL.md');

describe('the Development Path and the strategy comparison reach the operator', () => {
  it('renders inside the Deal Brain panel on the Overview, fed from the workspace read', () => {
    expect(OVERVIEW_SRC).toContain('developmentPath={developmentPath ?? null}');
    expect(PAGE_SRC).toContain('developmentPath={{ path: developmentPath, status: developmentPathStatus, history: developmentPathHistory }}');
    expect(PAGE_SRC).toContain('setDevelopmentPath(i?.developmentPath ?? null);');
    expect(PAGE_SRC).toContain('setDevelopmentPathStatus(i?.developmentPathStatus ?? null);');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-development-path"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-strategy-comparison"');
    expect(CSS_SRC).toContain('.awv2-dev-conflict');
    expect(CSS_SRC).toContain('.awv2-dev-sensitivity');
  });

  it('shows governing authority with its conflict, the district with its source, uses, standards and paths in the jurisdiction\'s words', () => {
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-governing-authority"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-authority-conflict"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-authority-non-qualifying"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-postal-locality"');
    // No display-side text correction: the persisted payload is the text.
    expect(BRAIN_SRC).not.toContain('fromCodePoint');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-current-zoning"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-uses"');
    expect(BRAIN_SRC).toContain('by right, conditional, prohibited, or not established');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-standards"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-paths"');
    expect(BRAIN_SRC).toContain('<i>Local definition (');
    expect(BRAIN_SRC).toContain('Not sourced: no retained source or operator figure states cost or time for this path.');
    expect(BRAIN_SRC).toContain('<i>Smallest decisive verification:</i>');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-critical-gates"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-source-lineage"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-development-path-refresh"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-development-path-history"');
  });

  it('compares every scenario side by side, treats the seller price as a sensitivity, and withholds a return until every input is visible', () => {
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-price-sensitivity"');
    expect(BRAIN_SRC).toContain('Seller price as a sensitivity:');
    expect(BRAIN_SRC).toContain('<th>Still plausible</th><th>Exceeded</th><th>No capacity yet</th>');
    expect(BRAIN_SRC).toContain('data-testid={`deal-decision-scenario-return-${scenario.id}`}');
    expect(BRAIN_SRC).toContain("`withheld: ${scenario.missingInputs?.length ?? 0} input(s) not visible.`");
    expect(BRAIN_SRC).toContain('nothing is auto-selected');
    expect(BRAIN_SRC).toContain('<i>Purchase-price capacity:</i>');
    expect(BRAIN_SRC).toContain('<i>Capital at risk:</i>');
    expect(BRAIN_SRC).toContain('<i>Time to exit:</i>');
    expect(BRAIN_SRC).toContain('<i>Key approvals:</i>');
  });

  it('never renders a blank Development Path: an absent or historical read explains itself', () => {
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-development-path-pending"');
    expect(BRAIN_SRC).toContain('The Development Path is pending: LandOS applies the local zoning and subdivision rules the moment the Property Story settles.');
    expect(BRAIN_SRC).toContain('answered about another parcel version; it is history');
  });
});

describe('the Stage 5 trigger map', () => {
  it('forms the path at the Stage 3 completion boundary, ahead of the decision, with the story just formed', () => {
    const producer = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf('const produceResearchStableIntelligence = ('),
      ROUTES_SRC.indexOf('const produceDealBrainDecision = ('),
    );
    expect(producer.indexOf('produceDevelopmentPath(dealCardId, actor, runId, { property: stories.property')).toBeLessThan(producer.indexOf('produceDealBrainDecision(dealCardId, actor, runId, {'));
    expect(producer).toContain('}, developmentPath);');
  });

  it('refreshes on a land-use capability rerun and on the start-up reconcile, and on nothing else', () => {
    expect(ROUTES_SRC).toContain("produceDevelopmentPath(id, 'capability:zoning-subdivision')");
    expect(ROUTES_SRC).toContain("produceDealBrainDecision(id, 'capability:zoning-subdivision', null, null, developmentPath)");
    expect(ROUTES_SRC).toContain("produceDevelopmentPath(dealCardId, 'startup:settled_intelligence')");
    expect(ROUTES_SRC).toContain('listDealsAwaitingDevelopmentPath()');
    // The completion boundary, the start-up reconcile and the land-use rerun:
    // exactly three call sites. The definition reads `= (` and does not match.
    expect([...ROUTES_SRC.matchAll(/produceDevelopmentPath\(/g)]).toHaveLength(3);
  });

  it('answers the workspace read with SELECTs only', () => {
    const workspaceBlock = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf('// Stage 3: the Property Story and the Market Story.'),
      ROUTES_SRC.indexOf('subject: canonicalSubjectProjection(id),'),
    );
    expect(workspaceBlock).toContain('readDevelopmentPath(id)');
    expect(workspaceBlock).toContain('readDevelopmentPathHistory(id, 6)');
    expect(workspaceBlock).toContain("developmentPathStatus(developmentPath, { dealCardId: id, consumedSnapshotId: consumed?.developmentPathSnapshotId ?? null");
    expect(workspaceBlock).not.toContain('produceDevelopmentPath');
    expect(workspaceBlock).not.toContain('ensureDevelopmentPath');
  });

  it('keeps the Stage 3 and Stage 4 write sites unchanged apart from the land-use rerun', () => {
    expect([...ROUTES_SRC.matchAll(/produceResearchStableIntelligence\(/g)]).toHaveLength(3);
    // Ten prior write sites plus the three valuation-package refresh sites.
    expect([...ROUTES_SRC.matchAll(/produceDealBrainDecision\(/g)]).toHaveLength(13);
  });
});

describe('the skill', () => {
  it('is registered under the profile with its invocation gate and hard rules', () => {
    expect(SKILL_SRC).toContain('name: landos-zoning-subdivision-entitlement');
    expect(SKILL_SRC).toContain('Never hard-code a nationwide definition of "minor" or "major" subdivision');
    expect(SKILL_SRC).toContain('Cost and time appear only when a retained source states them');
    expect(SKILL_SRC).toContain('Official boundary geography outranks');
  });
});
