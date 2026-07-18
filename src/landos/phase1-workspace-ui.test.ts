import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const WORKSPACE = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/LeadWorkspace.tsx', import.meta.url)), 'utf-8');
const MISSION = fs.readFileSync(fileURLToPath(new URL('../../web/src/pages/MissionControl.tsx', import.meta.url)), 'utf-8');

describe('Phase 1 actionable Lead Workspace', () => {
  it('polls progressive research and exposes stable research, pursuit, disposition, and glow hooks', () => {
    expect(WORKSPACE).toMatch(/setInterval\([\s\S]*3_000/);
    for (const hook of ['research-retry-action', 'pursue-opportunity-action', 'disposition-action', 'deal-card-highlight']) {
      expect(WORKSPACE).toContain(hook);
    }
  });

  it('targets opportunity IDs for research and owner decisions', () => {
    expect(WORKSPACE).toMatch(/opportunities\/\$\{opportunityId\}\/research/);
    expect(WORKSPACE).toMatch(/opportunities\/\$\{opportunityId\}\/decision/);
    expect(WORKSPACE).toContain("{ decision, disposition }");
  });

  it('keeps discovery callable while preserving parcel and offer gates', () => {
    expect(WORKSPACE).toContain('Discovery calls are never blocked.');
    expect(WORKSPACE).toContain('Unresolved identity still blocks unsupported parcel conclusions');
    expect(WORKSPACE).toContain('The discovery call can still proceed using identity-confirmation questions.');
  });

  it('renders one truthful PDF-backed report with qualified comps and unranked hypotheses when incomplete', () => {
    for (const hook of ['discovery-package-entry', 'discovery-package', 'discovery-package-run', 'discovery-package-pdf', 'unresolved-call-brief', 'discovery-package-readiness', 'discovery-package-visuals', 'discovery-package-comps', 'discovery-package-deed', 'discovery-package-sources', 'discovery-package-strategy-hypothesis']) {
      expect(WORKSPACE).toContain(hook);
    }
    expect(WORKSPACE).toMatch(/packageStrategies\.slice\(0, 2\)/);
    expect(WORKSPACE).toContain('Research is not yet decision-useful');
    expect(WORKSPACE).toContain('Strategy validation hypotheses — not recommendations');
    expect(WORKSPACE).toContain('Withheld — threshold not met');
    expect(WORKSPACE).toContain('Deed retrieval gap: obtain the vesting deed');
    expect(WORKSPACE).toContain('Open document provenance');
    expect(WORKSPACE).toContain('40–60% owner-review range');
    expect(WORKSPACE).toContain('active/pending/listed row(s) retained as market context only');
  });

  it('supports transcript paste and text upload with attributed reconciliation and no outbound action', () => {
    for (const hook of ['transcript-reconciliation', 'transcript-paste-input', 'transcript-paste-submit', 'transcript-file-input', 'transcript-reconciliation-output', 'transcript-original', 'transcript-next-action']) {
      expect(WORKSPACE).toContain(hook);
    }
    expect(WORKSPACE).toContain('Seller statements (unverified)');
    expect(WORKSPACE).toContain('Verified facts kept separate');
    expect(WORKSPACE).toContain('No offer, contract, paid action, or seller outbound action is available here.');
    expect(WORKSPACE).toContain('The transcript does not replace property research.');
    expect(WORKSPACE).toMatch(/apiPostForm\(`\/api\/landos\/opportunities\/\$\{workspace\.opportunity\.id\}\/transcripts`/);
  });
});

describe('Mission Control opportunity metrics', () => {
  it('uses the reconciled opportunityMetrics contract and links every queue to Acquisitions', () => {
    expect(MISSION).toContain('opportunityMetrics');
    for (const key of [
      'newLeads', 'researchRunning', 'researchFailed', 'researchIncomplete',
      'discoveryNeedsPreparation', 'callsAwaitingTranscript', 'transcriptsAwaitingReconciliation',
      'ownerDecisions', 'followUpsDue', 'followUpsOverdue', 'pursuedDeals',
      'browserProviderFailures', 'approvalRequired',
    ]) expect(MISSION).toContain(key);
    expect(MISSION).toMatch(/href=\{`\/dept\/acquisitions\?section=library&queue=\$\{queue\}`\}/);
  });
});
