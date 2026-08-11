// Two ownership/retention bugs that let a LandPortal property tab outlive its
// run, asserted on the source contract because both are lifecycle rules rather
// than return values.
//
//   1. A driver built once at route setup and reused across runs captured the
//      FIRST scope it ever served. Every later run's page was registered to an
//      already-released scope, so cleanup read it as "operator or
//      other-workflow" and preserved it.
//   2. The final sweep retained `remaining[0]` and blanked it. When a research
//      tab sorted first, the real about:blank control page was closed as
//      surplus and the research tab became the survivor.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/landos/browser-session.ts'),
  'utf8',
);

describe('lane page ownership follows the live run', () => {
  it('adopts the currently active workflow scope at page acquisition', () => {
    expect(SOURCE).toMatch(/const liveScope = browserWorkflowContext\.getStore\(\) \?\? null;/);
    expect(SOURCE).toMatch(/if \(liveScope\) workflowOwner = liveScope;/);
  });

  it('no longer pins ownership to the first scope the driver ever saw', () => {
    // The old form captured once and never refreshed.
    expect(SOURCE).not.toMatch(
      /\/\/ A driver normally originates inside its mission context[\s\S]{0,200}workflowOwner \?\?= browserWorkflowContext\.getStore\(\) \?\? null;/,
    );
  });

  it('still falls back to the captured owner when the async store is lost', () => {
    expect(SOURCE).toMatch(/else workflowOwner \?\?= null;/);
  });
});

describe('temp session tabs are owned, never orphaned', () => {
  it('accepts the creating driver as the fallback owner', () => {
    expect(SOURCE).toMatch(
      /function trackTempSessionPage\(page: PageLike, fallbackOwner: BrowserWorkflowScope \| null = null\): void \{/,
    );
    expect(SOURCE).toMatch(/const workflow = browserWorkflowContext\.getStore\(\) \?\? fallbackOwner;/);
  });

  it('every temp-tab call site passes that owner', () => {
    const calls = [...SOURCE.matchAll(/trackTempSessionPage\((?!page: PageLike)([^)]*)\)/g)]
      .map((match) => match[1].trim())
      .filter((args) => args.length > 0);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const args of calls) expect(args).toMatch(/,\s*workflowOwner$/);
  });

  it('temp tabs are still released in a finally', () => {
    expect(SOURCE).toMatch(/\} finally \{[\s\S]{0,400}releaseTempSessionPage/);
  });
});

describe('the final sweep retains the inert control page', () => {
  it('prefers an existing about:blank over whichever tab sorts first', () => {
    expect(SOURCE).toMatch(
      /const controlPage = remaining\.find\(\(page\) => urlOf\(page\) === 'about:blank'\) \?\? remaining\[0\];/,
    );
    expect(SOURCE).toMatch(/if \(!kept && page === controlPage\)/);
  });

  it('does not retain by array position alone', () => {
    expect(SOURCE).not.toMatch(/if \(!kept\) \{\s*\n\s*kept = true;/);
  });

  it('never closes the browser: exactly one page is always kept', () => {
    expect(SOURCE).toMatch(/let kept = false;/);
    expect(SOURCE).toContain('The browser itself was never closed.');
  });
});
