import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  insertClipboardPlainText,
  validatePendingIntakeImage,
} from './smart-intake-clipboard.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  findLeadCardIntakeBySubmissionKey,
  listLeadCardIntake,
  persistLeadCardIntake,
  updateLeadCardIntakeCandidates,
  type IntakeImageArtifactInput,
} from './lead-card-intake.js';
import { upsertPropertyCard } from './property-card.js';
import {
  extractSmartIntakeImage,
  normalizeSmartIntakeImageExtraction,
  smartIntakeImageSha256,
  validateSmartIntakeImage,
} from './smart-intake-image.js';

beforeEach(() => _initTestLandosDb());

function seedDeal() {
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'EXISTING RD',
    city: 'Kingston',
    county: 'Roane',
    state: 'TN',
    apn: 'accepted-apn',
    owner: 'Existing Record Owner',
    acres: 4,
    verified: true,
    verificationSource: 'approved test source',
  }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Smart Intake regression lead' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { card, deal };
}

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function artifact(
  sourceMethod: IntakeImageArtifactInput['sourceMethod'] = 'clipboard',
  overrides: Partial<IntakeImageArtifactInput['extraction']> = {},
  fileName = 'property.png',
): IntakeImageArtifactInput {
  return {
    documentUploadId: 1,
    originalFileName: fileName,
    fileUrl: `/api/test/${encodeURIComponent(fileName)}`,
    mimeType: 'image/png',
    byteSize: pngBytes.length,
    sha256: smartIntakeImageSha256(pngBytes),
    sourceMethod,
    extraction: {
      status: 'complete',
      exactText: 'Owner: Screenshot Owner\nRoad: Old Ridge Road\nCity: Kingston\nCounty: Roane',
      candidates: {
        owner: 'Screenshot Owner',
        road: 'Old Ridge Road',
        city: 'Kingston',
        state: 'TN',
        county: 'Roane',
      },
      otherFacts: [],
      uncertainFields: [],
      missingFields: ['zip', 'apn', 'acreage', 'latitude', 'longitude'],
      notes: ['Parcel outline is visual intake evidence only.'],
      model: 'test-vision',
      ...overrides,
    },
  };
}

const componentSource = () => readFileSync(new URL('../../web/src/components/LeadCardIntake.tsx', import.meta.url), 'utf8');

describe('Smart Intake clipboard, image, and immutable-evidence regression matrix', () => {
  it('1. inserts a single-line text paste at the caret', () => {
    expect(insertClipboardPlainText('Old  Road', 'Ridge', 4, 4)).toEqual({ value: 'Old Ridge Road', caret: 9 });
  });

  it('2. preserves meaningful line breaks in a multiline text paste', () => {
    const pasted = 'Owner: Jane Doe\r\nAPN: 123-45\nNotes: call Friday';
    expect(insertClipboardPlainText('', pasted, 0, 0).value).toBe(pasted);
  });

  it('3. does not truncate a large unstructured text paste', () => {
    const pasted = Array.from({ length: 30_000 }, (_, index) => `lead-${index}`).join('\n');
    expect(insertClipboardPlainText('prefix\n', pasted, 7, 7).value).toBe(`prefix\n${pasted}`);
  });

  it('4. supports paste followed by manual editing and selection replacement', () => {
    const pasted = insertClipboardPlainText('Road: OLD ROAD', 'Old Ridge Road', 6, 14);
    expect(`${pasted.value}\nEdited by operator`).toBe('Road: Old Ridge Road\nEdited by operator');
  });

  it('5. never submits from paste and leaves text-only paste to native browser behavior', () => {
    const source = componentSource();
    expect(source).toContain('if (images.length === 0) return;');
    expect(source).toMatch(/type="button" data-testid="smart-intake-submit"/);
    expect(source).not.toMatch(/onPaste=\{[^}]*submit/);
  });

  it('6. preserves normal typed intake exactly, including leading/trailing whitespace', async () => {
    const { deal } = seedDeal();
    const typed = '  Owner note\nSecond line\n';
    await persistLeadCardIntake({ dealCardId: deal.id, text: typed, idempotencyKey: 'typed-1' });
    expect(listLeadCardIntake(deal.id)[0].originalText).toBe(typed);
  });

  it('7. records clipboard image source method', async () => {
    const { deal } = seedDeal();
    await persistLeadCardIntake({ dealCardId: deal.id, text: '', imageArtifacts: [artifact('clipboard')], idempotencyKey: 'clipboard-1' });
    expect(((listLeadCardIntake(deal.id)[0].artifacts as Array<Record<string, unknown>>)[0]).sourceMethod).toBe('clipboard');
  });

  it('8. supports multi-select image file input and records upload source method', async () => {
    expect(componentSource()).toMatch(/type="file" multiple accept=/);
    const { deal } = seedDeal();
    await persistLeadCardIntake({ dealCardId: deal.id, text: '', imageArtifacts: [artifact('upload')], idempotencyKey: 'upload-1' });
    expect(((listLeadCardIntake(deal.id)[0].artifacts as Array<Record<string, unknown>>)[0]).sourceMethod).toBe('upload');
  });

  it('9. supports image drag and drop and records drop source method', async () => {
    expect(componentSource()).toMatch(/data-testid="smart-intake-drop-zone"/);
    expect(componentSource()).toMatch(/appendImages\(Array\.from\(event\.dataTransfer\?\.files \?\? \[\]\), 'drop'\)/);
    const { deal } = seedDeal();
    await persistLeadCardIntake({ dealCardId: deal.id, text: '', imageArtifacts: [artifact('drop')], idempotencyKey: 'drop-1' });
    expect(((listLeadCardIntake(deal.id)[0].artifacts as Array<Record<string, unknown>>)[0]).sourceMethod).toBe('drop');
  });

  it('10. accepts exact text and multiple images in one submission', async () => {
    const { deal } = seedDeal();
    const second = artifact('upload', { candidates: { apn: 'candidate-apn' } }, 'second.png');
    second.sha256 = smartIntakeImageSha256(Buffer.concat([pngBytes, Buffer.from([1])]));
    await persistLeadCardIntake({ dealCardId: deal.id, text: 'Wholesaler: Alex\nCall tomorrow', imageArtifacts: [artifact(), second], idempotencyKey: 'mixed-1' });
    const saved = listLeadCardIntake(deal.id)[0];
    expect(saved.originalText).toBe('Wholesaler: Alex\nCall tomorrow');
    expect(saved.artifacts).toHaveLength(2);
  });

  it('11. provides image previews and removal before submission', () => {
    const source = componentSource();
    expect(source).toMatch(/smart-intake-image-previews/);
    expect(source).toMatch(/Pasted property image preview/);
    expect(source).toMatch(/smart-intake-remove-image/);
    expect(source).toMatch(/filter\(\(item\) => item\.id !== pending\.id\)/);
  });

  it('12. retains the original artifact immutably after submission', async () => {
    const { deal } = seedDeal();
    await persistLeadCardIntake({ dealCardId: deal.id, text: '', imageArtifacts: [artifact()], idempotencyKey: 'immutable-1' });
    const stored = getLandosDb().prepare('SELECT id,sha256,exact_extracted_text FROM landos_intake_artifact').get() as { id: number; sha256: string; exact_extracted_text: string };
    expect(stored.sha256).toBe(smartIntakeImageSha256(pngBytes));
    expect(stored.exact_extracted_text).toContain('Old Ridge Road');
    expect(() => getLandosDb().prepare(`UPDATE landos_intake_artifact SET sha256='changed' WHERE id=?`).run(stored.id)).toThrow(/immutable/);
    expect(() => getLandosDb().prepare('DELETE FROM landos_intake_artifact WHERE id=?').run(stored.id)).toThrow(/immutable/);
  });

  it('13. extracts exact visible text and normalized screenshot candidate fields through one multimodal call', async () => {
    let calls = 0;
    const extracted = await extractSmartIntakeImage(pngBytes, 'image/png', async (_prompt, image, model) => {
      calls += 1;
      expect(image.data).toBe(pngBytes.toString('base64'));
      expect(model).toBe('test-model');
      return {
        status: 'complete',
        exactText: 'Owner: Jane Doe\nAPN: 123-45\nOld Ridge Road',
        candidates: { owner: 'Jane Doe', road: 'Old Ridge Road', city: 'Kingston', state: 'TN', county: 'Roane', apn: '123-45' },
        missingFields: ['zip'],
      };
    }, 'test-model');
    expect(calls).toBe(1);
    expect(extracted.exactText).toBe('Owner: Jane Doe\nAPN: 123-45\nOld Ridge Road');
    expect(extracted.candidates).toMatchObject({ owner: 'Jane Doe', county: 'Roane', apn: '123-45' });
  });

  it('14. preserves honest partial extraction without fabricating absent fields', () => {
    const extracted = normalizeSmartIntakeImageExtraction({
      status: 'complete',
      exactText: 'Road: Old Ridge Roa?',
      candidates: { road: 'Old Ridge Roa?' },
      uncertainFields: ['road'],
      missingFields: ['owner', 'apn', 'acreage'],
    }, 'test');
    expect(extracted.status).toBe('partial');
    expect(extracted.candidates).toEqual({ road: 'Old Ridge Roa?' });
    expect(extracted.candidates).not.toHaveProperty('owner');
    expect(extracted.missingFields).toContain('apn');
  });

  it('15. keeps screenshot fields editable candidates until official resolution', async () => {
    const { card, deal } = seedDeal();
    const saved = await persistLeadCardIntake({ dealCardId: deal.id, text: '', imageArtifacts: [artifact()], idempotencyKey: 'candidate-1' });
    const facts = saved.facts as Array<{ key: string; status: string }>;
    expect(facts.find((fact) => fact.key === 'road')?.status).toBe('candidate');
    updateLeadCardIntakeCandidates({ dealCardId: deal.id, submissionId: Number(saved.id), values: { road: 'Old Ridge Road corrected' } });
    const candidate = ((listLeadCardIntake(deal.id)[0].artifacts as Array<{ candidates: Array<{ key: string; value: string; confidence: string }> }>)[0].candidates).find((row) => row.key === 'road');
    expect(candidate).toMatchObject({ value: 'Old Ridge Road corrected', confidence: 'candidate' });
    expect(getLandosDb().prepare('SELECT active_input_address FROM landos_property_card WHERE id=?').get(card.id)).toEqual({ active_input_address: 'EXISTING RD' });
  });

  it('16. does not block or downgrade research when lead contact and screenshot owner differ', async () => {
    const { deal } = seedDeal();
    const saved = await persistLeadCardIntake({
      dealCardId: deal.id,
      text: 'Wholesaler: Alex Smith\nSeller contact: Pat Jones',
      imageArtifacts: [artifact('clipboard', { candidates: { owner: 'Unrelated Record Owner', road: 'Old Ridge Road', county: 'Roane', state: 'TN' } })],
      idempotencyKey: 'owner-mismatch-1',
    });
    expect(saved.status).toBe('complete');
    const owner = (saved.facts as Array<{ key: string; status: string; conflictNote: string }>).find((fact) => fact.key === 'owner');
    expect(owner?.status).toBe('candidate');
    expect(owner?.conflictNote).toMatch(/was not changed.*remains available for resolution/i);
  });

  it('17. projects the same attachment metadata through repeated refresh reads', async () => {
    const { deal } = seedDeal();
    await persistLeadCardIntake({ dealCardId: deal.id, text: '', imageArtifacts: [artifact()], idempotencyKey: 'persist-1' });
    const first = listLeadCardIntake(deal.id);
    getLandosDb().prepare('SELECT 1').get();
    const refreshed = listLeadCardIntake(deal.id);
    expect(refreshed).toEqual(first);
    expect(JSON.stringify(refreshed)).toContain('/api/test/property.png');
  });

  it('18. rejects unsupported, oversized, extension-mismatched, and spoofed images cleanly', () => {
    expect(validatePendingIntakeImage({ name: 'script.svg', type: 'image/svg+xml', size: 100 })).toMatch(/accepts PNG/);
    expect(validatePendingIntakeImage({ name: 'huge.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
    expect(validatePendingIntakeImage({ name: 'wrong.jpg', type: 'image/png', size: 100 })).toMatch(/does not match/);
    expect(() => validateSmartIntakeImage(Buffer.from('not a png'), 'image/png', 'fake.png')).toThrow(/contents do not match/);
  });

  it('19. prevents duplicate lead submissions and artifacts from one idempotent paste', async () => {
    const { deal } = seedDeal();
    const first = await persistLeadCardIntake({ dealCardId: deal.id, text: 'one paste', imageArtifacts: [artifact()], idempotencyKey: 'same-paste' });
    const second = await persistLeadCardIntake({ dealCardId: deal.id, text: 'one paste', imageArtifacts: [artifact()], idempotencyKey: 'same-paste' });
    expect(second.id).toBe(first.id);
    expect(findLeadCardIntakeBySubmissionKey(deal.id, 'same-paste')?.id).toBe(first.id);
    expect((getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_intake_submission').get() as { n: number }).n).toBe(1);
    expect((getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_intake_artifact').get() as { n: number }).n).toBe(1);
  });

  it('20. remains backward-compatible with existing text-only Smart Intake routing', async () => {
    const { deal } = seedDeal();
    const saved = await persistLeadCardIntake({
      dealCardId: deal.id,
      text: 'APN: accepted-apn\n5 acres\nFollow-up: call planning.',
      submissionType: 'general',
      source: 'legacy-compatible',
    });
    expect(saved.sections).toEqual(expect.arrayContaining(['property', 'activity']));
    expect(saved.followUps).toContain('call planning.');
    expect(saved.artifacts).toEqual([]);
  });

  it('21. exposes a labeled thumbnail, full-resolution viewer, and complete immutable-artifact provenance', () => {
    const source = componentSource();
    const preview = source.slice(
      source.indexOf('data-testid="smart-intake-artifact-preview"'),
      source.indexOf('data-testid="smart-intake-artifact-provenance"'),
    );
    expect(source).toMatch(/data-testid="smart-intake-artifact-preview"/);
    expect(source).toContain('Open full-resolution original image');
    expect(source).toMatch(/role="dialog"[\s\S]*data-testid="smart-intake-artifact-viewer"/);
    expect(source).toMatch(/data-testid="smart-intake-artifact-full-image"/);
    expect(source).toContain("viewerActualSize ? 'mx-auto h-auto max-w-none'");
    expect(source).toMatch(/Original filename|originalFileName/);
    expect(source).toMatch(/artifact\.mimeType/);
    expect(source).toMatch(/artifact\.byteSize\.toLocaleString\(\)/);
    expect(source).toMatch(/artifact\.sourceMethod/);
    expect(source).toMatch(/formatArtifactTimestamp\(artifact\.capturedAt\)/);
    expect(source).toMatch(/Deal Card #\{dealId\} · Smart Intake submission #\{latest\.id\}/);
    expect(source).toMatch(/artifact\.sha256/);
    expect(preview).not.toContain('target="_blank"');
  });
});
