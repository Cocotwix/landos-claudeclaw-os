// Smart Intake artifact retention — the regression this sprint had to repair.
//
// THE LIVE FAILURE (Deal 32, Roane County TN): the operator's original screenshot
// — filename codex-clipboard-e6d98905-…png, 2,949,777 bytes, SHA-256
// df2e1d2c…09f3 — was retained end to end in the database and on disk, and had
// stopped being visible on the Deal Card.
//
// The bytes never moved. Two UI-layer causes did it:
//
//   1. Confirming the canonical parcel identity swaps the resolution view (where
//      Smart Intake evidence is always on the card) for the tabbed workspace. The
//      tabbed workspace had moved the whole Smart Intake panel INSIDE the
//      tabpanel, gated on a tab that is never selected by default — so the act of
//      confirming the parcel took the retained screenshot off the card.
//   2. Because the panel lived inside the tabpanel, every tab change unmounted it
//      and refetched, and a failed refetch silently blanked the retained evidence
//      to an empty panel, indistinguishable from "there never was a screenshot".
//
// The contract asserted here: retained originals are Deal Card EVIDENCE. No
// canonical-identity write, no tab navigation, no refresh and no restart may
// hide, detach, duplicate or lose them.

import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { isCanonicalIdentityConfirmed, resolveCanonicalIdentity } from './canonical-identity.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { listLeadCardIntake, persistLeadCardIntake, type IntakeImageArtifactInput } from './lead-card-intake.js';
import { writeParcelIdentity } from './parcel-identity.js';
import { upsertPropertyCard } from './property-card.js';
import { reconcileAllPendingCanonicalIdentities, reconcileCanonicalIdentity } from './property-summary-legacy-adapter.js';
import { smartIntakeImageSha256 } from './smart-intake-image.js';

const DEAL_CARD_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/DealCard.tsx'), 'utf8');
const INTAKE_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/LeadCardIntake.tsx'), 'utf8');

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SHA = smartIntakeImageSha256(pngBytes);
const FILE_NAME = 'codex-clipboard-e6d98905-ea3e-40be-af4c-836ccbdd550c.png';

beforeEach(() => _initTestLandosDb());

/** A Deal Card with one retained Smart Intake screenshot and its candidates —
 *  the shape of Deal 32 before its parcel identity was confirmed. */
async function seedCardWithRetainedScreenshot() {
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'OLD RIDGE RD',
    city: 'KINGSTON',
    county: 'Roane',
    state: 'TN',
    apn: '073090 04200',
    owner: 'SACHAN DILEEP S',
    acres: 12.28,
    verified: true,
    verificationSource: 'Tennessee Comptroller public parcel layer',
  }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Smart Intake screenshot retention' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });

  const artifact: IntakeImageArtifactInput = {
    documentUploadId: 7,
    originalFileName: FILE_NAME,
    fileUrl: `/api/landos/deal-cards/${deal.id}/documents/upload-file/${FILE_NAME}`,
    mimeType: 'image/png',
    byteSize: 2949777,
    sha256: SHA,
    sourceMethod: 'upload',
    extraction: {
      status: 'complete',
      exactText: 'Owner: SACHAN DILEEP S\nOLD RIDGE RD\nKINGSTON, TN 37763\nRoane County\n073090 04200',
      candidates: {
        owner: 'SACHAN DILEEP S', road: 'OLD RIDGE RD', city: 'KINGSTON',
        state: 'TN', zip: '37763', county: 'Roane County', apn: '073090 04200',
      },
      uncertainFields: [], missingFields: [], notes: [], otherFacts: [],
      model: 'test-vision-model',
    },
  };
  await persistLeadCardIntake({
    dealCardId: deal.id, text: 'Original acceptance screenshot.', imageArtifacts: [artifact], idempotencyKey: 'retention-1',
  });
  return { card, deal };
}

/** The retained originals exactly as the Deal Card reads them. */
function retainedArtifacts(dealCardId: number): Array<Record<string, unknown>> {
  return listLeadCardIntake(dealCardId).flatMap((s) => (s.artifacts as Array<Record<string, unknown>>) ?? []);
}

/** Confirm the canonical parcel identity the way the approved path does. */
function confirmCanonicalIdentity(dealCardId: number, subjectCardId: number) {
  writeParcelIdentity(dealCardId, {
    subjectCardId,
    state: 'confirmed',
    basis: 'Official Tennessee Comptroller parcel record.',
    confidence: 1,
    evidenceRefs: ['tn-comptroller:073090 04200'],
  });
  return reconcileCanonicalIdentity({
    dealCardId,
    actor: 'parcel-confirmation',
    changeReason: 'Canonical parcel identity confirmed.',
  });
}

describe('canonical identity backfill cannot hide or detach Smart Intake artifacts', () => {
  it('the retained original survives confirmation and reconciliation byte for byte', async () => {
    const { deal, card } = await seedCardWithRetainedScreenshot();
    const before = retainedArtifacts(deal.id);
    expect(before).toHaveLength(1);

    const result = confirmCanonicalIdentity(deal.id, card.id);
    expect(result.reconciled).toBe(true);
    expect(isCanonicalIdentityConfirmed(deal.id)).toBe(true);

    const after = retainedArtifacts(deal.id);
    expect(after).toHaveLength(1);
    // Same row, same bytes, same provenance, same submission, same candidates.
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].sha256).toBe(SHA);
    expect(after[0].originalFileName).toBe(FILE_NAME);
    expect(after[0].mimeType).toBe('image/png');
    expect(after[0].byteSize).toBe(2949777);
    expect(after[0].capturedAt).toBe(before[0].capturedAt);
    expect((after[0].candidates as unknown[]).length).toBe((before[0].candidates as unknown[]).length);
  });

  it('startup reconciliation of every pending card leaves artifacts attached to their deal and submission', async () => {
    const { deal, card } = await seedCardWithRetainedScreenshot();
    writeParcelIdentity(deal.id, {
      subjectCardId: card.id, state: 'confirmed',
      basis: 'Confirmed by an older code path that never built the version.',
      confidence: 1, evidenceRefs: ['tn-comptroller:073090 04200'],
    });
    // The recovery sweep that runs at startup.
    reconcileAllPendingCanonicalIdentities('test-recovery');
    expect(resolveCanonicalIdentity(deal.id).confirmed).toBe(true);

    const rows = getLandosDb()
      .prepare('SELECT deal_card_id, submission_id, sha256 FROM landos_intake_artifact WHERE deal_card_id=?')
      .all(deal.id) as Array<{ deal_card_id: number; submission_id: number; sha256: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].deal_card_id).toBe(deal.id);
    expect(rows[0].sha256).toBe(SHA);
    // Still owned by its original submission — never orphaned or re-parented.
    const submissionIds = listLeadCardIntake(deal.id).map((s) => s.id);
    expect(submissionIds).toContain(rows[0].submission_id);
  });

  it('reconciliation is idempotent and never multiplies retained evidence', async () => {
    const { deal, card } = await seedCardWithRetainedScreenshot();
    confirmCanonicalIdentity(deal.id, card.id);
    const second = reconcileCanonicalIdentity({ dealCardId: deal.id, actor: 'test', changeReason: 'again' });
    expect(second.reconciled).toBe(false); // nothing owed
    expect(retainedArtifacts(deal.id)).toHaveLength(1);
    expect(listLeadCardIntake(deal.id)).toHaveLength(1);
  });
});

describe('confirmed Deal Cards still display prior Smart Intake evidence', () => {
  it('a confirmed card still reads its retained screenshot, thumbnail URL and SHA-256', async () => {
    const { deal, card } = await seedCardWithRetainedScreenshot();
    confirmCanonicalIdentity(deal.id, card.id);
    const [artifact] = retainedArtifacts(deal.id);
    expect(artifact.sha256).toBe(SHA);
    expect(String(artifact.fileUrl)).toContain(FILE_NAME);
    expect(artifact.extractionStatus).toBe('complete');
    expect((artifact.candidates as unknown[]).length).toBeGreaterThan(0);
  });

  it('the confirmed (tabbed) Deal Card keeps retained Smart Intake evidence on its dedicated tab', () => {
    // The dock lives in the `!showResolution` branch — the workspace a card gets
    // ONLY once its parcel is confirmed — so confirmation can never be what
    // removes retained evidence from the card.
    const tabbed = DEAL_CARD_SRC.indexOf("!showResolution && (");
    const dock = DEAL_CARD_SRC.indexOf('data-testid="smart-intake-dock"');
    expect(tabbed).toBeGreaterThan(-1);
    expect(dock).toBeGreaterThan(tabbed);
    expect(DEAL_CARD_SRC).toMatch(/activeTab === 'intake' && \(\s*<div data-testid="smart-intake-dock"[^>]*>\s*<SmartIntakePanel/);
  });
});

describe('tab navigation keeps Smart Intake artifacts in their dedicated workspace', () => {
  it('the confirmed workspace mounts one panel only on the Smart Intake tab', () => {
    // Exactly one SmartIntakePanel in the tabbed workspace, and it is never
    // rendered behind `activeTab === 'intake' && …` — that gate is what took the
    // retained screenshot off every other tab and remounted it on each switch.
    expect(DEAL_CARD_SRC).toMatch(/activeTab === 'intake' && \(\s*<div data-testid="smart-intake-dock"[^>]*>\s*<SmartIntakePanel/);
    const mounts = DEAL_CARD_SRC.match(/<SmartIntakePanel\b/g) ?? [];
    // One mount on the resolution view, one docked on the tabbed workspace: a
    // card is in exactly one of those states, so only one is ever live.
    expect(mounts).toHaveLength(2);
  });

  it('the pinned action selects Smart Intake instead of leaving it docked under every tab', () => {
    expect(DEAL_CARD_SRC).toMatch(/data-testid="open-smart-intake"/);
    expect(DEAL_CARD_SRC).toMatch(/selectTab\('intake'\)/);
    expect(DEAL_CARD_SRC).not.toMatch(/class=\{activeTab === 'intake' \? 'order-first' : ''\}/);
  });

  it('a failed reload never blanks retained evidence', () => {
    // The old handler was `.catch(() => setSubmissions([]))`: any transient
    // failure erased the retained originals from view and looked exactly like a
    // Deal Card that never had a screenshot.
    expect(INTAKE_SRC).not.toMatch(/catch\(\(\) => setSubmissions\(\[\]\)\)/);
    expect(INTAKE_SRC).toMatch(/setLoadError\(`Retained Smart Intake evidence could not be reloaded/);
    expect(INTAKE_SRC).toMatch(/data-testid="smart-intake-load-error"/);
  });

  it('the retained original is rendered above the compose form, not below it', () => {
    // Visible on opening the workspace rather than under a full-height form.
    expect(INTAKE_SRC).toMatch(/<div class="order-last flex flex-col gap-3">/);
    expect(INTAKE_SRC).toMatch(/data-testid="smart-intake-artifact-preview"/);
    expect(INTAKE_SRC).toMatch(/aria-label=\{`Open full-resolution original image/);
  });
});

describe('refresh and restart do not duplicate or lose the artifact', () => {
  it('repeated reads (refresh) return the same single artifact', async () => {
    const { deal, card } = await seedCardWithRetainedScreenshot();
    confirmCanonicalIdentity(deal.id, card.id);
    for (let refresh = 0; refresh < 3; refresh++) {
      const artifacts = retainedArtifacts(deal.id);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].sha256).toBe(SHA);
    }
  });

  it('a resubmission of the same image cannot create a second artifact row', async () => {
    const { deal } = await seedCardWithRetainedScreenshot();
    const rows = () => getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_intake_artifact WHERE deal_card_id=?').get(deal.id) as { n: number };
    expect(rows().n).toBe(1);
    await persistLeadCardIntake({
      dealCardId: deal.id, text: 'Original acceptance screenshot.', imageArtifacts: [], idempotencyKey: 'retention-1',
    });
    expect(rows().n).toBe(1);
    expect(listLeadCardIntake(deal.id)).toHaveLength(1);
  });

  it('the artifact row is immutable, so no code path can silently delete or rewrite it', async () => {
    const { deal } = await seedCardWithRetainedScreenshot();
    const id = (getLandosDb().prepare('SELECT id FROM landos_intake_artifact WHERE deal_card_id=?').get(deal.id) as { id: number }).id;
    expect(() => getLandosDb().prepare('DELETE FROM landos_intake_artifact WHERE id=?').run(id)).toThrow(/immutable/);
    expect(() => getLandosDb().prepare('UPDATE landos_intake_artifact SET deal_card_id=999 WHERE id=?').run(id)).toThrow(/immutable/);
  });
});
