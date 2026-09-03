// Stage 4 presentation and trigger-map contract: the Deal Brain decision and
// the seller discovery reach the operator's real surfaces, the workspace read
// stays a SELECT, and every write site is a genuine completion or seller-record
// event — never a page load.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const BRAIN_SRC = read('web/src/components/AcquisitionWorkspaceV2DealBrain.tsx');
const OVERVIEW_SRC = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');
const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const CSS_SRC = read('web/src/styles/workspace-v2-deal-brain.css');
const ROUTES_SRC = read('src/landos/routes.ts');

describe('the decision and the discovery brief reach the operator', () => {
  it('renders the Deal Brain decision on the Overview and the discovery brief on the Seller page', () => {
    expect(OVERVIEW_SRC).toContain('<DealBrainDecisionPanel');
    expect(OVERVIEW_SRC).toContain("show('overview') && dealDecision");
    expect(PAGE_SRC).toContain('dealDecision={{ decision: dealDecision, history: dealDecisionHistory, stability: researchStability, stage3: stage3Status, sellerReadStatus }}');
    expect(PAGE_SRC).toContain('<SellerDiscoveryPanel discovery={sellerDiscovery} stability={researchStability} readStatus={sellerReadStatus} />');
    expect(PAGE_SRC).toContain('setDealDecision(i?.dealDecision ?? null);');
    expect(PAGE_SRC).toContain('setSellerDiscovery(i?.sellerDiscovery ?? null);');
    expect(CSS_SRC).toContain('.awv2-brain-recommendation');
  });

  it('leads with the recommendation and both next actions, and explains an absent price', () => {
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-recommendation"');
    expect(BRAIN_SRC).toContain('testId="deal-decision-landos-action"');
    expect(BRAIN_SRC).toContain('testId="deal-decision-operator-action"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-no-price"');
    expect(BRAIN_SRC).toContain('No offer range yet');
  });

  it('shows what new evidence caused an update, and keeps prior decisions as history', () => {
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-refresh"');
    expect(BRAIN_SRC).toContain('material dimension(s) moved');
    expect(BRAIN_SRC).toContain('{change.before ?? \'unknown\'} → {change.after}');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-history"');
  });

  it('never renders a blank Deal Brain: an absent decision explains itself', () => {
    expect(BRAIN_SRC).toContain('data-testid={`${what}-not-yet`}');
    expect(BRAIN_SRC).toContain('The Deal Brain forms its first posture the moment the Property Story settles.');
  });

  it('labels seller claims by the retained communication that carried them and shows refusals', () => {
    expect(BRAIN_SRC).toContain('from retained communications only');
    expect(BRAIN_SRC).toContain('{claim.speaker?.label ?? claim.source?.attribution}');
    expect(BRAIN_SRC).toContain('refused as claim sources');
    expect(BRAIN_SRC).toContain('Operator profile notes (not seller claims)');
  });

  it('shows each claim\'s speaker, communication id, date, value, confidence and modality, and keeps superseded statements as history', () => {
    expect(BRAIN_SRC).toContain('data-claim-id={claim.claimId}');
    expect(BRAIN_SRC).toContain("{claim.source?.id ? ` · ${claim.source.id}` : ''}");
    expect(BRAIN_SRC).toContain('confidence');
    expect(BRAIN_SRC).toContain('data-polarity={claim.polarity}');
    expect(BRAIN_SRC).toContain('data-testid="seller-discovery-history"');
    expect(BRAIN_SRC).toContain('Earlier seller statements, superseded');
    expect(BRAIN_SRC).toContain('data-testid="seller-discovery-conflicts"');
    expect(BRAIN_SRC).toContain('data-testid="seller-discovery-refusals"');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-seller-history"');
    expect(BRAIN_SRC).toContain("reads only the seller's current positions");
  });
});

describe('one Stage 3 status, one seller read, one identity lineage on screen', () => {
  const STACK_SRC = read('web/src/components/AcquisitionWorkspaceV2IntelligenceStack.tsx');

  it('the Property and Market score cards render the shared Stage 3 status, never "Unknown" when a status exists', () => {
    expect(STACK_SRC).toContain("stage3?.label ?? sub ?? (score == null ? 'Unknown' : '')");
    expect(STACK_SRC).toContain('data-stage3-status={stage3?.status ?? undefined}');
    expect(STACK_SRC).toContain('data-snapshot-id={stage3?.snapshotId ?? undefined}');
    expect(STACK_SRC).toContain('Open {label} output');
    expect(OVERVIEW_SRC).toContain('stage3={dealDecision?.stage3 ?? null}');
    expect(OVERVIEW_SRC).toContain('sellerStatusLabel={dealDecision?.sellerReadStatus?.label ?? null}');
    expect(STACK_SRC).toContain("sub={sellerStatusLabel ?? (scores?.seller?.state === 'established' ? 'Workability' : 'Pending · pre-contact')}");
    expect(PAGE_SRC).toContain('stage3: stage3Status, sellerReadStatus');
    expect(PAGE_SRC).toContain('setStage3Status(i?.stage3Status ?? null);');
  });

  it('the Deal Brain reads the same status objects and names a pending or historical story as pending', () => {
    expect(BRAIN_SRC).toContain('const propertyInput = stage3?.property ?? decision?.inputs?.property ?? null;');
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-property-story" data-stage3-status={propertyInput?.status ?? undefined} data-snapshot-id={propertyInput?.snapshotId ?? undefined}');
    expect(BRAIN_SRC).toContain('The full current Property Story is pending; the posture above is a limited evidence-sufficiency read.');
    expect(BRAIN_SRC).toContain('The full current Market Story is pending; market liquidity and the subject band are not decision inputs yet.');
    expect(BRAIN_SRC).toContain("input.consumedByDealBrain ? ' · consumed by this decision' : ''");
  });

  it('the Seller page renders the shared seller read status with speaker, source, date, standing and caveat per position', () => {
    expect(PAGE_SRC).not.toContain('Current Seller Read: Pending — no meaningful seller communication yet.');
    expect(PAGE_SRC).toContain('<SellerReadStatusLine status={sellerReadStatus} discovery={sellerDiscovery} />');
    expect(BRAIN_SRC).toContain('data-testid="seller-read-status"');
    expect(BRAIN_SRC).toContain('Current Seller Read: {label}.');
    expect(BRAIN_SRC).toContain("' · seller-reported, not independently verified'");
    expect(BRAIN_SRC).toContain('supersedes ${moved.earlier?.value');
    expect(BRAIN_SRC).toContain("sellerReadStatus?.label ?? words(seller?.status)");
  });

  it('the identity block renders exact source lineage and never a generic official-record phrase', () => {
    expect(BRAIN_SRC).toContain('data-testid="deal-decision-identity-lineage"');
    expect(BRAIN_SRC).toContain('<li>Observed: {subject.verification.lineage.observedAtStatement}</li>');
    expect(BRAIN_SRC).toContain('<li>Accepted subject: ');
    expect(BRAIN_SRC).not.toContain('An official parcel record confirms');
    const SYNTH_SRC = read('src/landos/deal-decision-synthesis.ts');
    expect(SYNTH_SRC).not.toContain("'An official parcel record confirms this identity.'");
    expect(SYNTH_SRC).toContain("observedAtStatement: record?.accessedAt ? `retrieved ${record.accessedAt.slice(0, 10)}` : 'observation date not recorded'");
  });
});

describe('the trigger map', () => {
  it('forms the decision behind the Stage 3 completion boundary with the readings just formed', () => {
    const producer = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf('const produceResearchStableIntelligence = ('),
      ROUTES_SRC.indexOf('const produceDealBrainDecision = ('),
    );
    expect(producer).toContain('produceDealBrainDecision(dealCardId, actor, runId, {');
    expect(producer).toContain('propertySnapshotId: stories.persistence.property.snapshotId');
  });

  it('refreshes on every seller-record event, and on nothing else', () => {
    // A communication event names the exact record in its cause
    // (`seller:communication_added:<commId>`), so the refreshed decision says
    // which communication moved it.
    const causes = [...ROUTES_SRC.matchAll(/produceDealBrainDecision\(id, ['`](seller:[a-z_]+)/g)].map((match) => match[1]);
    expect(ROUTES_SRC).toContain('`seller:communication_added:${added.commLog[0]?.id');
    expect(ROUTES_SRC).toContain('`seller:communication_updated:${commId}`');
    expect(ROUTES_SRC).toContain('`seller:communication_deleted:${commId}`');
    expect(causes.sort()).toEqual([
      'seller:communication_added',
      'seller:communication_deleted',
      'seller:communication_updated',
      'seller:discovery_notes_added',
      'seller:profile_updated',
      'seller:stage_changed',
      'seller:stated_fact_recorded',
    ]);
    // The completion boundary, the start-up reconcile of already-settled
    // intelligence, the seven seller events, and (Stage 5) the land-use
    // capability rerun that re-applies the Development Path: exactly ten call
    // sites. The definition reads `= (` and does not match.
    expect(ROUTES_SRC).toContain("produceDealBrainDecision(dealCardId, 'startup:settled_intelligence')");
    expect(ROUTES_SRC).toContain("produceDealBrainDecision(id, 'capability:zoning-subdivision', null, null, developmentPath)");
    // Ten prior write sites plus the three valuation-package mutations
    // (comp selection, location resolution, capability run) that must refresh
    // the decision when the comp and valuation package changes.
    expect([...ROUTES_SRC.matchAll(/produceDealBrainDecision\(/g)]).toHaveLength(13);
    for (const cause of ['valuation:comp_selection', 'valuation:locations_resolved', 'valuation:capability_run']) {
      expect(ROUTES_SRC).toContain(`produceDealBrainDecision(id, '${cause}')`);
    }
  });

  it('answers the workspace read with SELECTs only', () => {
    const workspaceBlock = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf('// Stage 3: the Property Story and the Market Story.'),
      ROUTES_SRC.indexOf('subject: canonicalSubjectProjection(id),'),
    );
    expect(workspaceBlock).toContain('readDealBrainDecision(id)');
    expect(workspaceBlock).toContain('readSellerDiscovery(id)');
    expect(workspaceBlock).toContain('readDealBrainDecisionHistory(id, 6)');
    expect(workspaceBlock).not.toContain('produceDealBrainDecision');
    expect(workspaceBlock).not.toContain('ensureDealBrainDecision');
  });

  it('keeps the Stage 3 write sites unchanged', () => {
    expect([...ROUTES_SRC.matchAll(/produceResearchStableIntelligence\(/g)]).toHaveLength(3);
  });
});
