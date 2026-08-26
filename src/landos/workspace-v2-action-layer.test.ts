// Deal Workspace Action Layer V1 — wiring contract. Source-scan style (repo
// idiom, node-safe); the executor itself is unit-tested in
// web/src/lib/deal-workspace-actions.test.ts and proven live in the operator
// browser walkthrough.
//
// One navigation truth: sidebar clicks and programmatic actions must both
// resolve through the same canonical navigateToPage, and the bridge must
// expose only the whitelisted read/execute surface — no fetch, no DB, no
// arbitrary code execution, no model or research calls.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

function read(rel: string): string {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
}

const ACTIONS = read('../../web/src/lib/deal-workspace-actions.ts');
const V2 = read('../../web/src/pages/AcquisitionWorkspaceV2.tsx');

describe('action contract stays minimal and canonical', () => {
  it('whitelists exactly the V1 action type', () => {
    expect(ACTIONS).toMatch(/DEAL_WORKSPACE_ACTION_TYPES = \['navigate_deal_page'\] as const/);
  });

  it('derives valid pages from the one canonical sidebar definition', () => {
    expect(ACTIONS).toMatch(/DEAL_PAGES\.map\(\(p\) => p\.slug\)/);
    expect(ACTIONS).toMatch(/from '\.\/workspace-v2-nav'/);
  });

  it('is UI control only: no fetch, DB, model, or research surface', () => {
    expect(ACTIONS).not.toMatch(/fetch\(|apiGet|apiPost|sqlite|\/api\//);
  });
});

describe('one navigation truth', () => {
  it('sidebar clicks delegate to the shared canonical navigateToPage', () => {
    expect(V2).toMatch(/const navigateToPage = \(slug: string\) => \{/);
    expect(V2).toMatch(/e\.preventDefault\(\);\s*navigateToPage\(slug\);/);
  });

  it('the executor navigates through the same navigateToPage', () => {
    expect(V2).toMatch(/createDealWorkspaceExecutor\(\{\s*getContext,\s*navigateToPage: \(page\) => navigateToPage\(page\)/);
  });

  it('navigation stays client-side pushState (no reload path)', () => {
    expect(V2).toMatch(/window\.history\.pushState\(null, '', href\)/);
  });
});

describe('agent control bridge', () => {
  it('the workspace registers and cleans up the LandOS-namespaced bridge', () => {
    expect(V2).toMatch(/registerDealWorkspaceBridge\(bridge\)/);
    expect(V2).toMatch(/unregisterDealWorkspaceBridge\(bridge\)/);
    expect(ACTIONS).toMatch(/LandOS\?: \{ dealWorkspace\?: DealWorkspaceBridge \}/);
  });

  it('context is derived from the live URL, not cached component state', () => {
    expect(V2).toMatch(/getContext = \(\) => \(\{ dealId, currentPage: readPage\(window\.location\.search\) \}\)/);
  });

  it('the bridge exposes only getContext + executeAction', () => {
    expect(ACTIONS).toMatch(/interface DealWorkspaceBridge \{\s*getContext: [^}]*executeAction: [^}]*\}/);
  });
});
