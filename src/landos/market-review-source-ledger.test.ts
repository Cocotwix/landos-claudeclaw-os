// A market review that omits its SOURCE LEDGER must not destroy the run.
//
// The defect this pins: the executor threw when the free expert market review
// contained no `SOURCE LEDGER` section. That killed the whole intelligence run
// for controlled QA Card 128, and with it the Deal Brain decision artifact that
// depends on the run completing — over a heading the analyst simply did not
// print. The ledger's actual purpose is to CONSTRAIN citations: downstream, any
// web citation whose URL is absent from the ledger is rejected.
//
// So an absent ledger is an EMPTY ledger. Nothing is fabricated: every citation
// from that review is rejected exactly as before, and the omission is disclosed
// as a warning rather than silently tolerated.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/landos/specialist-intelligence-executor.ts'), 'utf8');

describe('a market review without a SOURCE LEDGER', () => {
  it('no longer throws the run away', () => {
    expect(SRC).not.toContain('returned no SOURCE LEDGER for the free expert review');
  });

  it('records the ledger as explicitly empty rather than inventing one', () => {
    expect(SRC).toContain('SOURCE LEDGER\\n- NONE');
    // The empty ledger is only substituted when one is genuinely absent; a
    // review that printed its own ledger is passed through untouched.
    expect(SRC).toMatch(/const ledgerMissing = !\/\\nSOURCE LEDGER/);
    expect(SRC).toMatch(/marketExpertReview = ledgerMissing[\s\S]{0,120}: review;/);
  });

  it('discloses the omission instead of hiding it', () => {
    expect(SRC).toContain('ledgerOmissions.push(');
    expect(SRC).toContain('no web citation from that review can be admitted');
    // The omissions reach the caller through the existing warnings channel.
    expect(SRC).toMatch(/warnings: ledgerOmissions\.length \? \[\.\.\.warnings, \.\.\.ledgerOmissions\] : warnings/);
  });

  it('keeps the substantive-review guard, which is a different check', () => {
    // A review that is empty or trivially short is still a failed read: that
    // guard protects against no reasoning at all, not a missing heading.
    expect(SRC).toContain('returned no substantive free expert review');
  });
});
