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
    // Preservation now covers links and files as well as the typed words,
    // because those are supplied evidence too and are retained the same way.
    expect(SRC).toContain('keeps your original words and every link and file exactly as supplied');
    expect(SRC).toContain('No paid action, seller contact, offer, or contract is sent.');
  });

  it('accepts attachments alongside the paste, without requiring either one', () => {
    for (const hook of ['manual-lead-attach', 'manual-lead-attachments']) {
      expect(SRC.includes(`data-testid="${hook}"`), `missing ${hook}`).toBe(true);
    }
    // Drag/drop and clipboard files reach the same handler as the file picker.
    expect(SRC).toMatch(/onDrop=/);
    expect(SRC).toMatch(/onPaste=/);
    // An attachment-only lead is valid: the operator sent a survey and nothing
    // else, and refusing it would discard the one thing they had.
    expect(SRC).toMatch(/!rawInput\.trim\(\) && attachments\.length === 0/);
  });

  it('never discards the created lead when an attachment fails to save', () => {
    // The Lead Card is the point. A failed upload is reported against the deal
    // that exists, not turned into "the lead could not be created".
    expect(SRC).toMatch(/The Lead Card was created, but/);
    expect(SRC).toMatch(/data-testid="manual-lead-error"/);
  });

  it('says plainly that an unreadable format is still kept', () => {
    expect(SRC).toContain('A file it has no reader for is still kept and says so');
  });

  it('does not revive API-first LandPortal or direct Deal Card creation paths', () => {
    expect(SRC).not.toMatch(/intake\/conversation|acquire\/run|duke-verification|lp_comp_report|LandPortal/i);
  });
});
