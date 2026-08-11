// Every path that can create or REPLACE the automation browser's control page
// must register it immediately.
//
// Adoption used to run only inside the connect branch. The reap mints a fresh
// about:blank whenever closing the last orphan would take Chrome down with it,
// and that page is born at the CDP level with no PageLike handle for the
// session module to mark — so it stayed unprotected until the next reconnect,
// which is exactly the window research needs to claim it as a working tab.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const SESSION = read('src/landos/browser-session.ts');
const ROUTES = read('src/landos/routes.ts');
const AUTOMATION = read('src/landos/automation-browser.ts');

describe('control-page adoption covers every creator', () => {
  it('connect adopts the launcher\'s page', () => {
    expect(SESSION).toMatch(/await adoptExistingControlPage\(browser\);/);
  });

  it('the post-run reap adopts the page it may have minted', () => {
    // The reaper creates a control page when it would otherwise close the last
    // tab; that branch is why re-adoption is required here.
    expect(AUTOMATION).toMatch(/json\/new\?\$\{encodeURIComponent\(CONTROL_PAGE_URL\)\}/);
    const reapBlock = ROUTES.slice(
      ROUTES.indexOf('const reaped = await reapOrphanAutomationTabs('),
      ROUTES.indexOf('deal_intelligence_post_run_tab_reap') + 60,
    );
    expect(reapBlock).toMatch(/const adopted = await adoptAutomationControlPage\(\);/);
    expect(reapBlock).toMatch(/controlPageAdopted: adopted,/);
  });

  it('a run adopts before any lane can allocate a tab', () => {
    const runRoute = ROUTES.slice(
      ROUTES.indexOf("app.post('/api/landos/deal-cards/:id/property-intelligence/run'"),
      ROUTES.indexOf('const { launch, completion } = launchDealIntelligenceMission('),
    );
    expect(runRoute).toMatch(/await adoptAutomationControlPage\(\);/);
  });

  it('the final sweep marks the page it retains', () => {
    expect(SESSION).toMatch(/markControlPage\(page\);/);
  });

  it('adoption is exported so replace-paths can call it without a reconnect', () => {
    expect(SESSION).toMatch(/export async function adoptAutomationControlPage\(\)/);
    expect(SESSION).toMatch(/if \(!state\.browser \|\| !safeConnected\(state\.browser\)\) return false;/);
  });

  it('does not introduce a second tracking system', () => {
    // One WeakSet, one predicate — the reap path reuses them rather than
    // keeping its own notion of which target is the control page.
    expect([...SESSION.matchAll(/new WeakSet<PageLike>\(\)/g)]).toHaveLength(1);
    expect(AUTOMATION).not.toMatch(/controlPages|isControlPage/);
  });
});
