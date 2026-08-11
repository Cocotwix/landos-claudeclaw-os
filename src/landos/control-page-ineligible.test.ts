// The permanent control page is infrastructure, not a research surface.
//
// The automation Chrome exits with its last page, so one inert about:blank is
// kept to hold the process open. Research was navigating that retained target
// IN PLACE — same CDP target id, page count unchanged — so nothing leaked, no
// reaper could see it, and the operator was left with a LandPortal page as the
// browser's only tab. Every page-acquisition path must now refuse it.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/landos/browser-session.ts'),
  'utf8',
);

describe('control page identity', () => {
  it('is tracked by page reference, not by URL', () => {
    // A freshly created research tab is also about:blank for its first moments,
    // so URL matching would make real research pages ineligible.
    expect(SOURCE).toMatch(/const controlPages = new WeakSet<PageLike>\(\);/);
    expect(SOURCE).toMatch(/function isControlPage\(page: PageLike \| null \| undefined\): boolean \{/);
  });

  it('adopts the launcher\'s existing lone about:blank on connect', () => {
    expect(SOURCE).toMatch(/async function adoptExistingControlPage\(browser: BrowserLike\): Promise<boolean>/);
    expect(SOURCE).toMatch(/if \(pages\.length !== 1\) return false;/);
    expect(SOURCE).toMatch(/markControlPage\(only\);/);
    expect(SOURCE).toMatch(/await adoptExistingControlPage\(browser\);/);
  });

  it('adoption is re-runnable, not connect-time only', () => {
    // The control page is also minted after this module is attached — by the
    // launcher and by the reap that replaces the last tab — so a connect-only
    // adoption leaves every replacement unprotected until the next reconnect.
    expect(SOURCE).toMatch(/export async function adoptAutomationControlPage\(\): Promise<boolean> \{/);
    expect(SOURCE).toMatch(/return adoptExistingControlPage\(state\.browser\);/);
  });

  it('refuses to guess when more than one page is open', () => {
    expect(SOURCE).toMatch(/if \(pages\.length !== 1\) return false;/);
    expect(SOURCE).toMatch(/if \(url !== 'about:blank'\) return false;/);
  });

  it('marks the page the final sweep retains', () => {
    expect(SOURCE).toMatch(/markControlPage\(page\);/);
  });
});

describe('research-page acquisition refuses the control page', () => {
  it('the shared working page drops it and allocates instead', () => {
    expect(SOURCE).toMatch(/if \(isControlPage\(state\.workingPage\)\) state\.workingPage = null;/);
  });

  it('a cached lane page that became the control page is not reused', () => {
    expect(SOURCE).toMatch(/&& !isControlPage\(lanePage\)/);
  });

  it('the one place research pages are born asserts the guarantee', () => {
    expect(SOURCE).toMatch(/if \(background && !isControlPage\(background\)\) return background;/);
  });
});

describe('cleanup never destroys the process keeper', () => {
  it('owned-scope close skips the control page', () => {
    expect(SOURCE).toMatch(/\/\/ Never close the process-keeper, whatever the registry says\.\s*\n\s*if \(isControlPage\(page\)\) continue;/);
  });

  it('the working-tab release skips it and only drops the reference', () => {
    expect(SOURCE).toMatch(/if \(state\.workingPage && !isControlPage\(state\.workingPage\)\) \{/);
    expect(SOURCE).toMatch(/\} else if \(state\.workingPage\) \{[\s\S]{0,240}state\.workingPage = null;/);
  });

  it('still keeps exactly one page so Chrome survives', () => {
    expect(SOURCE).toMatch(/let kept = false;/);
    expect(SOURCE).toContain('The browser itself was never closed.');
  });
});
