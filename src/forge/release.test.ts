import { describe, it, expect } from 'vitest';

import {
  classifySecurityGates,
  generateSetupChecklist,
  generateDemoRunbook,
  generateCompletionReport,
} from './release.js';

describe('classifySecurityGates', () => {
  const cases: Array<{ id: string; request: string }> = [
    { id: 'api_key', request: 'Wire up the provider using an API key.' },
    { id: 'billing_subscription', request: 'Set up the subscription and monthly billing.' },
    { id: 'oauth', request: 'Add OAuth login with a redirect URL.' },
    { id: 'production_deploy', request: 'Deploy to production once it is ready.' },
    { id: 'domain_dns', request: 'Point the custom domain and configure DNS.' },
    { id: 'database_credentials', request: 'Connect to the database connection string.' },
    { id: 'account_connection', request: 'Connect my Google account for calendar.' },
    { id: 'paid_api_tool', request: 'Use a paid API for the heavy reasoning.' },
  ];

  for (const { id, request } of cases) {
    it(`detects ${id}`, () => {
      const res = classifySecurityGates(request);
      expect(res.categories).toContain(id);
      expect(res.gates.length).toBeGreaterThan(0);
      expect(res.needsOwner).toBe(true);
    });
  }

  it('returns forge_safe with no gates for a plain local build', () => {
    const res = classifySecurityGates('Add a date helper to src/utils with a unit test.');
    expect(res.lane).toBe('forge_safe');
    expect(res.gates).toHaveLength(0);
    expect(res.forgeCanProceed).toBe(true);
    expect(res.needsOwner).toBe(false);
  });

  it('takes the most restrictive lane and blocks never-automate', () => {
    const res = classifySecurityGates('Add the API key, then delete the old production data.');
    // real_customer_data + destructive are never_automate; that wins.
    expect(res.lane).toBe('never_automate');
    expect(res.forgeCanProceed).toBe(false);
  });

  it('is deterministic', () => {
    const a = classifySecurityGates('Add OAuth and deploy to production.');
    const b = classifySecurityGates('Add OAuth and deploy to production.');
    expect(a).toEqual(b);
  });

  // Regression: GitHub/GitLab/Bitbucket push destinations are owner-owned
  // release approval, not just origin/main/remote.
  it('classifies "push to GitHub" as push_release_approval', () => {
    const res = classifySecurityGates('When done, push to GitHub.');
    expect(res.categories).toContain('push_release_approval');
    expect(res.lane).toBe('release_approval_required');
  });

  it('classifies "push changes to GitHub" as push_release_approval', () => {
    const res = classifySecurityGates('Build it then push changes to GitHub.');
    expect(res.categories).toContain('push_release_approval');
    expect(res.lane).toBe('release_approval_required');
  });

  const pushPhrases = [
    'push to GitHub',
    'push to GitLab',
    'push to Bitbucket',
    'push to GitHub repo',
    'push to GitHub repository',
    'push to GitHub main',
    'push changes to GitHub',
    'publish to GitHub',
  ];
  for (const phrase of pushPhrases) {
    it(`treats "${phrase}" as owner-owned release approval`, () => {
      const res = classifySecurityGates(phrase);
      expect(res.categories).toContain('push_release_approval');
    });
  }

  // Regression: the exact phrase "database credentials" (plural) must hit the
  // database_credentials gate, not fall through to generic secret_handling.
  it('classifies "database credentials" as database_credentials', () => {
    const res = classifySecurityGates('Supply the database credentials.');
    expect(res.categories).toContain('database_credentials');
    expect(res.lane).toBe('blocked_until_credentials');
  });

  it('classifies "db credentials" as database_credentials', () => {
    const res = classifySecurityGates('Add the db credentials to .env.');
    expect(res.categories).toContain('database_credentials');
  });

  const dbPhrases = [
    'database credential',
    'database credentials',
    'db credential',
    'db credentials',
    'database password',
    'database username',
    'database connection string',
    'DATABASE_URL',
    'POSTGRES_URL',
    'MYSQL_URL',
  ];
  for (const phrase of dbPhrases) {
    it(`treats "${phrase}" as database_credentials`, () => {
      const res = classifySecurityGates(`Set the ${phrase} value.`);
      expect(res.categories).toContain('database_credentials');
    });
  }
});

describe('generateSetupChecklist', () => {
  it('includes placeholders and standard owner steps, never real secrets', () => {
    const security = classifySecurityGates('Wire up the provider using an API key.');
    const out = generateSetupChecklist({ title: 'Provider', gates: security.gates });
    expect(out).toContain('# Owner Setup Checklist');
    expect(out).toContain('.env');
    expect(out).toContain('PROVIDER_API_KEY=<your-');
    expect(out).toContain('approve, tweak, reject, or hold');
    // never emits a concrete-looking secret value
    expect(out).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(out).not.toMatch(/eyJ[A-Za-z0-9_-]{12,}\./);
  });

  it('still renders standard steps when no gates were supplied', () => {
    const out = generateSetupChecklist({ title: 'bare' });
    expect(out).toContain('Standard owner setup');
    expect(out).toContain('Run the local demo command');
  });
});

describe('generateDemoRunbook', () => {
  it('includes local proof steps and safe / not-safe boundaries', () => {
    const out = generateDemoRunbook({ title: 'demo', startCommand: 'npm run dev', openUrl: 'http://localhost:3141' });
    expect(out).toContain('## How to start');
    expect(out).toContain('npm run dev');
    expect(out).toContain('## Where to open');
    expect(out).toContain('## Expected result');
    expect(out).toContain('## If you see an error');
    expect(out).toContain('## Safe to test locally');
    expect(out).toContain('## Do NOT test without owner approval');
  });

  it('uses placeholders when start info is missing', () => {
    const out = generateDemoRunbook({});
    expect(out).toContain('<fill in>');
  });
});

describe('generateCompletionReport', () => {
  it('includes every required section', () => {
    const security = classifySecurityGates('Add OAuth and deploy to production.');
    const out = generateCompletionReport({
      title: 'My build',
      whatWasBuilt: ['A widget'],
      workingCapabilities: ['It widgets'],
      filesChanged: ['src/widget.ts'],
      testsRun: ['npm test'],
      security,
      knownLimitations: ['No retries yet'],
    });
    expect(out).toContain('# Forge Completion Report');
    expect(out).toContain('## 1. What was built');
    expect(out).toContain('## 2. Working capabilities');
    expect(out).toContain('## 3. Files / areas changed');
    expect(out).toContain('## 4. Tests / builds run');
    expect(out).toContain('## 5. Security / release gates found');
    expect(out).toContain('## 6. Owner setup needed');
    expect(out).toContain('## 7. Demo / trial steps');
    expect(out).toContain('## 8. Known limitations');
    expect(out).toContain('## 9. Release readiness');
    expect(out).toContain('## 10. Owner decision');
    expect(out).toContain('approve, tweak, reject, or hold');
  });

  it('reports release readiness from the security lane', () => {
    const safe = generateCompletionReport({ title: 't' });
    expect(safe).toContain('Ready for local use and review.');
  });
});
