import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb } from './db.js';
import {
  artifactsAndClaimsFromPublicOutcomes,
  synchronizeGovernmentRecordsForDeal,
} from './government-records-legacy-adapter.js';
import { resolveGovernmentRecordArtifactPage } from './government-records-operator.js';
import { upsertPublicRecordOutcome } from './lead-card-intake.js';
import { collectGovernmentRecords } from './property-intelligence-live.js';
import { upsertPropertyCard } from './property-card.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';
import { landosArtifactPath } from './storage-profile.js';

let retainedFiles: string[] = [];

beforeEach(() => {
  _initTestLandosDb();
});

afterEach(() => {
  for (const file of retainedFiles) {
    const absolute = path.resolve(file);
    const browserShotRoot = path.resolve(landosArtifactPath('browser-shots'));
    if (absolute.startsWith(`${browserShotRoot}${path.sep}`) && fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
    }
  }
  retainedFiles = [];
});

function provisionalDeal(): number {
  const deal = createDealCard({
    entity: 'TY_LAND_BIZ',
    title: '6940 Highway 11',
    leadType: 'test',
  });
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '6940 Highway 11',
    city: 'Sunset',
    county: 'Pickens',
    state: 'SC',
    apn: '4165-00-51-3961',
    owner: 'NATURALAND TRUST',
    acres: 52.84,
    verified: true,
    verificationSource: 'Pickens County official parcel record',
    agentId: 'government-projection-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  createPropertyIdentityVersion({
    dealCardId: deal.id,
    propertyCardId: property.id,
    status: 'unresolved',
    address: '6940 Highway 11',
    city: 'Sunset',
    county: 'Pickens',
    state: 'SC',
    zip: '29685',
    apn: null,
    owner: null,
    acreage: null,
    geometry: null,
    basis: 'The discovery identity is useful, but canonical confirmation is pending.',
    confidence: 0.7,
    sourceRefs: [],
    changeReason: 'Established the unresolved test subject identity.',
    createdBy: 'government-projection-test',
  });
  return deal.id;
}

function retainRecorderCapture(): string {
  const directory = landosArtifactPath('browser-shots');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `government-projection-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(file, Buffer.from('retained official recorder viewer capture'));
  retainedFiles.push(file);
  return file;
}

describe('official outcome to Deal Intelligence government projection', () => {
  it('persists Deal 64-shaped deed facts and honest page-viewer metadata', async () => {
    const dealCardId = provisionalDeal();
    const screenshotUrl = retainRecorderCapture();
    const documentUrl = 'https://www.pickensscrod.us/AcclaimWeb/Image/DocumentImage1/1433732';
    upsertPublicRecordOutcome({
      dealCardId,
      category: 'deed_ownership',
      title: 'Recorded deed 202518326',
      jurisdiction: 'Pickens County, SC',
      authority: 'Pickens County Recorder / Register of Deeds',
      retrievalStatus: 'retrieved_yes',
      summary: 'Exact subject-APN deed retrieved from the official recorder.',
      facts: {
        apn: '4165-00-51-3961',
        currentDeed: 'DEED - DEED',
        instrumentNumber: '202518326',
        recordBookPage: '2895/123',
        recordingDate: '12/10/2025',
        recordedPageCount: '3',
        grantor: 'BRADLEY L STROTHER REVOCABLE TRUST THE',
        grantee: 'NATURALAND TRUST',
        consideration: '$490,000.00',
        legalDescription: '(13.21)AC TRACT B ET AL',
      },
      sourceUrl: 'https://www.pickensscrod.us/AcclaimWeb',
      screenshotUrl,
      documentUrl,
      searchedAt: '2026-07-29T15:19:24.088Z',
    });

    const model = synchronizeGovernmentRecordsForDeal({
      dealCardId,
      actor: 'government-projection-test',
      changeReason: 'Projected an exact-APN recorder outcome.',
    });

    expect(model.artifacts).toHaveLength(1);
    expect(model.artifacts[0]).toMatchObject({
      domain: 'deed_ownership',
      sourceUrl: documentUrl,
      instrumentNumber: '202518326',
      bookPage: '2895/123',
      parcelReference: '4165-00-51-3961',
      recordingFilingDate: '12/10/2025',
      pageCount: 3,
      captureCount: 1,
      mimeType: 'image/png',
      displayName: 'Recorded deed 202518326',
    });
    expect(resolveGovernmentRecordArtifactPage({
      dealCardId,
      artifactId: model.artifacts[0].id,
      pageNumber: 1,
    })?.path).toBe(path.resolve(screenshotUrl));
    expect(resolveGovernmentRecordArtifactPage({
      dealCardId,
      artifactId: model.artifacts[0].id,
      pageNumber: 2,
    })).toBeNull();

    const contribution = await collectGovernmentRecords({
      dealCardId,
      runId: 'government-projection-run',
      identity: null,
      comparables: null,
    });
    expect(contribution.data?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Instrument number', value: '202518326', grade: 'confirmed_fact' }),
      expect.objectContaining({ label: 'Recorded book / page', value: '2895/123', grade: 'confirmed_fact' }),
      expect.objectContaining({ label: 'Recorded consideration', value: '$490,000.00', grade: 'confirmed_fact' }),
    ]));
    expect(contribution.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'document',
        sourceUrl: documentUrl,
        pageCount: 3,
        capturedPageCount: 1,
        pageViewUrls: [
          `/api/landos/deal-cards/${dealCardId}/government-records/artifacts/${model.artifacts[0].id}/page/1`,
        ],
      }),
    ]));
  });

  it('never turns an arbitrary path outside the LandOS artifact root into a viewer route', () => {
    const projection = artifactsAndClaimsFromPublicOutcomes([{
      id: 99,
      category: 'deed_ownership',
      authority: 'Example Recorder',
      jurisdiction: 'Example County, SC',
      retrieval_status: 'retrieved_yes',
      summary: 'A record was retrieved.',
      screenshot_url: path.join(process.cwd(), 'package.json'),
      source_url: 'https://records.example.gov',
      facts: { instrumentNumber: '123' },
    }]);
    expect(projection.artifacts).toEqual([]);
    expect(projection.claims).not.toHaveLength(0);
    expect(projection.claims.every((claim) => claim.artifactKey == null)).toBe(true);
  });

  it('rejects a retained official artifact when its parcel reference does not match the Deal APN', () => {
    const dealCardId = provisionalDeal();
    const screenshotUrl = retainRecorderCapture();
    upsertPublicRecordOutcome({
      dealCardId,
      category: 'deed_ownership',
      title: 'Different parcel deed',
      jurisdiction: 'Pickens County, SC',
      authority: 'Pickens County Recorder / Register of Deeds',
      retrievalStatus: 'retrieved_yes',
      summary: 'The official result belongs to a different parcel.',
      facts: {
        apn: '9999-99-99-9999',
        instrumentNumber: 'WRONG-123',
        recordedPageCount: '2',
      },
      sourceUrl: 'https://www.pickensscrod.us/AcclaimWeb',
      screenshotUrl,
      documentUrl: 'https://www.pickensscrod.us/AcclaimWeb/Image/DocumentImage1/wrong',
      searchedAt: '2026-07-29T15:19:24.088Z',
    });

    const model = synchronizeGovernmentRecordsForDeal({
      dealCardId,
      actor: 'government-projection-test',
      changeReason: 'Rejected a different-parcel recorder outcome.',
    });
    expect(model.identity.status).toBe('unresolved');
    expect(model.artifacts).toEqual([]);
    expect(model.evidenceCount).toBe(0);
    expect(model.jobs.find((job) => job.collectorKey === 'deed_ownership')?.status).toBe('blocked');
  });
});
