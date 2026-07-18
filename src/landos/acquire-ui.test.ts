import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/Acquire.tsx', import.meta.url)), 'utf-8');

describe('Acquire — conversational manual lead intake', () => {
  it('creates one durable Lead Card through the manual-lead endpoint', () => {
    expect(SRC).toMatch(/apiPost<ManualLeadResponse>\('\/api\/landos\/leads\/manual'/);
    expect(SRC).toMatch(/onOpenDealCard\?\.\(result\.dealCardId\)/);
    expect(SRC).toContain('Create Lead Card & start research');
  });

  it('publishes one free-form front door with optional voice dictation', () => {
    for (const hook of ['manual-lead-form', 'manual-lead-raw-input', 'manual-lead-microphone', 'manual-lead-create']) {
      expect(SRC.includes(`data-testid="${hook}"`), `missing ${hook}`).toBe(true);
    }
    expect(SRC).toContain('SpeechRecognition');
    expect(SRC).not.toContain('manual-lead-seller-name');
    expect(SRC).not.toContain('manual-lead-address');
  });

  it('requires only a nonempty data dump, not a name or parcel clue', () => {
    expect(SRC).toMatch(/!rawInput\.trim\(\)/);
    expect(SRC).toMatch(/rawInput,/);
    expect(SRC).not.toMatch(/sellerName.*required|hasPropertyClue/);
    expect(SRC).not.toMatch(/parcelVerified|matched === true/);
  });

  it('states preservation and prohibited side effects clearly', () => {
    expect(SRC).toContain('saves your original words');
    expect(SRC).toContain('No paid action, seller contact, offer, or contract is sent.');
  });

  it('does not revive API-first LandPortal or direct Deal Card creation paths', () => {
    expect(SRC).not.toMatch(/intake\/conversation|acquire\/run|duke-verification|lp_comp_report|LandPortal/i);
  });
});
