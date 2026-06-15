// Tests for the Forge engagement workflow.
//
// Focus: prove the lane gate classifies SAFE vs STOP correctly across every
// red-lane category, and that the engagement artifact is well-formed,
// deterministic, and universal (no business- or domain-specific leakage into
// Forge Core).

import { describe, it, expect } from 'vitest';

import {
  classifyLane,
  startForgeEngagement,
  renderEngagementMarkdown,
  type RedLaneCategory,
  type ForgeEngagementRequest,
} from './engagement.js';

describe('classifyLane — safe requests', () => {
  const safeRequests = [
    'Add a helper function to format dates in src/utils with a unit test.',
    'Refactor the duplicated validation logic in the routes module into one function.',
    'Write documentation explaining how the scheduler retries failed jobs.',
    'Fix the off-by-one bug in the pagination loop and add a regression test.',
    'Create a small markdown report template for weekly status.',
  ];

  for (const req of safeRequests) {
    it(`classifies SAFE: "${req.slice(0, 40)}..."`, () => {
      const gate = classifyLane(req);
      expect(gate.verdict).toBe('SAFE');
      expect(gate.hits).toHaveLength(0);
      expect(gate.categories).toHaveLength(0);
    });
  }
});

describe('classifyLane — stop-gated requests', () => {
  const cases: Array<{ category: RedLaneCategory; request: string }> = [
    { category: 'secrets_credentials', request: 'Add the Stripe API key to the config so we can authenticate.' },
    { category: 'secrets_credentials', request: 'Read the .env file and wire up the bot token.' },
    { category: 'paid_tools_apis', request: 'Route the hard reasoning through a paid API for better quality.' },
    { category: 'paid_tools_apis', request: 'Integrate OpenRouter so we can pick models.' },
    { category: 'subscriptions_billing', request: 'Set up a subscription and handle the monthly billing.' },
    { category: 'account_connection', request: 'Connect my Google account so Forge can read calendar events.' },
    { category: 'destructive_or_deletion', request: 'Delete the old logs directory and all stale files.' },
    { category: 'destructive_or_deletion', request: 'Drop the table and rebuild the schema from scratch.' },
    { category: 'broad_repo_rewrite', request: 'Rewrite the entire codebase to use a new framework.' },
    { category: 'git_push_or_deploy', request: 'Make the change then git push to origin main.' },
    { category: 'git_push_or_deploy', request: 'Deploy the app once the build is green.' },
    { category: 'git_push_or_deploy', request: 'Deploy to staging so QA can test it.' },
    { category: 'git_push_or_deploy', request: 'Deploy this branch to the preview environment.' },
    { category: 'git_push_or_deploy', request: 'Release this to production after review.' },
    { category: 'git_push_or_deploy', request: 'Push to GitHub when it passes.' },
    { category: 'financial_legal_platform', request: 'Wire money to the vendor through the payment processor.' },
    { category: 'dependency_install', request: 'Run npm install for a new charting library.' },
  ];

  for (const { category, request } of cases) {
    it(`classifies STOP (${category}): "${request.slice(0, 40)}..."`, () => {
      const gate = classifyLane(request);
      expect(gate.verdict).toBe('STOP');
      expect(gate.hits.length).toBeGreaterThan(0);
      expect(gate.categories).toContain(category);
    });
  }

  it('detects multiple categories in one request', () => {
    const gate = classifyLane('Add the API key, then git push to production and delete the backups.');
    expect(gate.verdict).toBe('STOP');
    expect(gate.categories).toEqual(
      expect.arrayContaining(['secrets_credentials', 'git_push_or_deploy', 'destructive_or_deletion']),
    );
  });

  it('reports the matched text so the owner sees why it stopped', () => {
    const gate = classifyLane('Please connect my Slack account.');
    const hit = gate.hits.find((h) => h.category === 'account_connection');
    expect(hit).toBeDefined();
    expect(hit!.matchedText.toLowerCase()).toContain('account');
  });
});

describe('startForgeEngagement', () => {
  const baseReq = (rawRequest: string): ForgeEngagementRequest => ({
    rawRequest,
    host: 'your operating system',
    createdAt: '2026-06-15T00:00:00.000Z',
  });

  it('produces a full artifact for a safe request', () => {
    const e = startForgeEngagement(baseReq('Add a date helper to src/utils with a test.'));
    expect(e.gate.verdict).toBe('SAFE');
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.host).toBe('your operating system');
    expect(e.requestedBy).toBe('owner');
    expect(e.assumptionSummary.objective.length).toBeGreaterThan(0);
    expect(e.buildPlan.steps.length).toBeGreaterThan(0);
    expect(e.buildPlan.guardrails.join(' ')).toContain('approval spam');
    expect(e.buildPlan.guardrails.join(' ')).toContain('business-direction');
  });

  it('surfaces owner decisions and risk gates for a stop request', () => {
    const e = startForgeEngagement(baseReq('Add the API key and git push to main.'));
    expect(e.gate.verdict).toBe('STOP');
    expect(e.assumptionSummary.riskGates.join(' ')).toContain('owner-owned');
    expect(e.assumptionSummary.ownerDecisions.length).toBeGreaterThan(0);
    expect(e.buildPlan.steps[0]).toContain('STOP');
  });

  it('is deterministic for the same input', () => {
    const a = renderEngagementMarkdown(startForgeEngagement(baseReq('Add a small util and a test.')));
    const b = renderEngagementMarkdown(startForgeEngagement(baseReq('Add a small util and a test.')));
    expect(a).toBe(b);
  });
});

describe('renderEngagementMarkdown', () => {
  it('renders every rhythm section and the verdict', () => {
    const e = startForgeEngagement({
      rawRequest: 'Add a date helper to src/utils with a test.',
      createdAt: '2026-06-15T00:00:00.000Z',
    });
    const md = renderEngagementMarkdown(e);
    expect(md).toContain('# Forge Engagement');
    expect(md).toContain('## Lane Gate');
    expect(md).toContain('## 1. Interview');
    expect(md).toContain('## 2. Assumption Summary');
    expect(md).toContain('## 3. Milestone Build Plan');
    expect(md).toContain('## 4. Review Packet');
    expect(md).toContain('## 5. Owner Direction Review');
    expect(md).toContain('## 6. Next Milestone');
    expect(md).toContain('**Lane verdict:** SAFE');
  });

  it('stays universal — uses neutral owner language, not a specific owner name', () => {
    const md = renderEngagementMarkdown(
      startForgeEngagement({ rawRequest: 'Add a logging helper and a test.', createdAt: 'x' }),
    );
    expect(md).toContain('Owner Direction Review');
    // No specific person/business/domain name should leak into the artifact.
    expect(md).not.toContain('Tyler');
  });
});
