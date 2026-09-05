import { describe, expect, it } from 'vitest';

import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import { buildPropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import type { SubjectUnderstandingResult } from './subject-understanding.js';

// The Property Story has to be useful on a THIN file — that is the whole point
// of producing it when research settles rather than when everything is answered.
// It also has to be safe on a thin file: an unestablished topic must read as an
// unestablished topic, never as a quiet assertion.

const now = () => new Date('2026-09-01T00:00:00.000Z');

function file(overrides: Partial<PropertyFileSource> = {}): PropertyFileSource {
  return {
    dealCardId: 501,
    propertyCardId: 401,
    now,
    canonicalIdentity: { status: 'confirmed', confirmed: true },
    propertyIntelligence: {
      snapshot: {
        identity: {
          state: 'confirmed',
          displayAddress: '19 Sample Rd, Example, ZZ 00000',
          apn: 'AAA-111-000',
          county: 'Example',
          city: 'Example',
          state_: 'ZZ',
          owner: 'SAMPLE HOLDINGS LLC',
          acres: 1.5,
          acreageBasis: 'operator_accepted',
          hasParcelGeometry: true,
          discoveryBasis: 'Reconciled from the operator-supplied identifier.',
        },
      },
      landPortalFacts: {
        acres: 1.5,
        buildability: { pct: '88%', acres: '1.32 ac' },
        terrain: { slopeAvgPct: '3%', slopeUnder10Pct: '96%' },
        environment: { femaFloodZone: 'X', femaCoveragePct: '0%', wetlandsPct: '4%' },
        access: { landLocked: 'No', roadFrontageFt: 150 },
        soils: { label: 'Blanton fine sand, 0 to 5 percent slopes' },
        parcelContext: { label: 'Rectangular interior lot' },
      },
      access: { established: true, frontageFt: 150, road: 'Sample Ln', evidence: { rungs: [{ label: 'Mapped frontage', status: 'evidenced' }], outstanding: [] } },
      landUseIntelligence: {
        currentZoning: { established: false, statement: 'Current zoning is unresolved.', authorityName: 'Example County', references: [] },
        subdivision: { authorityName: 'Example County', likelyPathLabel: 'unknown', rules: [] },
      },
      compsValuation: { summary: { statusLabel: 'Not priceable', workingAcres: 1.5, acceptedCount: 0 }, counts: {} },
      canonicalState: { blockers: ['Current zoning unresolved'], missingInformation: ['Recorded access instrument'] },
    },
    dealCard: { people: [], asking_price: null },
    visuals: [
      { key: 'close_parcel_aerial', label: 'close parcel aerial', purpose: 'Full-boundary aerial', capturedAt: '2026-08-20T00:00:00.000Z', filePath: 'C:/store/close.png' },
    ],
    visualObservations: [
      {
        category: 'access', observation: 'A cleared drive reaches the road along the north boundary.',
        signal: 'positive', confidence: 'medium', sourceImage: 'close parcel aerial',
        model: 'vision-model', analyzedAt: '2026-08-20T01:00:00.000Z', capturedAt: '2026-08-20T00:00:00.000Z',
        pixelGrounded: true,
      },
    ],
    ...overrides,
  };
}

const understanding = (
  overrides: Partial<SubjectUnderstandingResult> = {},
): Pick<SubjectUnderstandingResult, 'subject' | 'excludedParcels'> => ({
  subject: {
    apn: 'AAA-111-000',
    apnNormalized: 'aaa111000',
    apnDisplayVariants: ['AAA-111-000', 'AAA111000'],
    address: '19 Sample Rd',
    city: 'Example',
    county: 'Example',
    state: 'ZZ',
    zip: '00000',
    fips: null,
    owner: null,
    lpPropertyId: null,
    lpUrl: null,
    legalDescription: null,
    acres: 1.5,
    interest: {
      form: 'proposed_split',
      statement: 'A proposed split out of the seller\'s larger holding.',
      excluded: [{ identifier: 'manufactured home lot', reason: 'The seller retains the improved lot.' }],
    },
    provenance: {},
    verification: {
      researchGrade: true,
      officiallyVerified: false,
      officialVerificationSource: null,
      outstanding: ['Official county parcel record'],
    },
  } as unknown as SubjectUnderstandingResult['subject'],
  excludedParcels: [
    { identifier: 'AAA-111-001', relationship: 'related_parcel', reason: 'Adjoining lot retained by the seller.', factIds: ['retained:200:apn'] },
  ],
  ...overrides,
});

const build = (source = file(), reading = understanding()) =>
  buildPropertyEvidenceSynthesis({
    dealCardId: 501,
    dossier: buildAcquisitionDossier(source),
    understanding: reading,
    now,
  });

describe('the transaction subject and its boundaries', () => {
  it('carries the exact subject with its interest form and its research-grade boundary', () => {
    const synthesis = build();
    expect(synthesis.subject).toMatchObject({ apn: 'AAA-111-000', acres: 1.5, county: 'Example', state: 'ZZ' });
    expect(synthesis.subject.interest.form).toBe('proposed_split');
    expect(synthesis.subject.verification.officiallyVerified).toBe(false);
    expect(synthesis.subject.verification.statement).toContain('research-grade');
  });

  it('keeps retained and related property OUT of the subject and names it separately', () => {
    const synthesis = build();
    const identifiers = synthesis.relatedBoundaries.map((entry) => entry.identifier);
    expect(identifiers).toContain('AAA-111-001');
    expect(identifiers).toContain('manufactured home lot');
    // Invariant 4: none of it becomes a subject fact.
    expect(synthesis.recordFacts.some((entry) => entry.value === 'AAA-111-001')).toBe(false);
    expect(synthesis.story.risks.join(' ')).toContain('excluded from it');
  });
});

describe('canonical identity outranks the derived reading', () => {
  it('takes identity from the accepted subject, not from a retained understanding', () => {
    const synthesis = buildPropertyEvidenceSynthesis({
      dealCardId: 501,
      dossier: buildAcquisitionDossier(file()),
      // A reading left over from a parcel this Deal Card is no longer about.
      understanding: understanding({
        subject: {
          ...(understanding().subject as unknown as Record<string, unknown>),
          apn: 'STALE-999', address: '1 Old Rd', county: 'Elsewhere', state: 'YY',
        } as unknown as SubjectUnderstandingResult['subject'],
      }),
      now,
    });
    expect(synthesis.subject.apn).toBe('AAA-111-000');
    expect(synthesis.subject.county).toBe('Example');
    expect(synthesis.subject.state).toBe('ZZ');
  });

  it('withholds a stale reading transaction scope instead of inheriting it', () => {
    const synthesis = buildPropertyEvidenceSynthesis({
      dealCardId: 501,
      dossier: buildAcquisitionDossier(file()),
      understanding: understanding(),
      understandingIsCurrent: false,
      now,
    });
    expect(synthesis.subject.interest.form).toBe('undetermined');
    expect(synthesis.subject.interest.statement).toContain('different parcel version');
    // A prior parcel's neighbours are not this parcel's neighbours.
    expect(synthesis.relatedBoundaries).toHaveLength(0);
  });
});

describe('diligence topics', () => {
  it('covers every Stage 3 topic and states a gap for each unresolved one', () => {
    const synthesis = build();
    expect(synthesis.diligence.map((entry) => entry.key)).toEqual([
      'access', 'frontage', 'utilities', 'well_septic', 'taxes',
      'zoning', 'development_status', 'flood', 'wetlands', 'soils', 'site_conditions',
    ]);
    for (const topic of synthesis.diligence) {
      if (topic.status === 'established') expect(topic.gap).toBeNull();
      else expect(topic.gap).toBeTruthy();
    }
  });

  it('does not call mapped frontage legal access', () => {
    const synthesis = build();
    const access = synthesis.diligence.find((entry) => entry.key === 'access');
    expect(access?.status).not.toBe('established');
    expect(access?.headline).toContain('no recorded legal access');
    expect(access?.verificationNeeded.join(' ')).toContain('recorded legal access');
  });

  it('promotes access to established only on a recorded instrument', () => {
    const source = file();
    (source.propertyIntelligence as Record<string, any>).access.recordedLegalAccess =
      'Access easement recorded at Book 412 Page 88.';
    const synthesis = build(source);
    const access = synthesis.diligence.find((entry) => entry.key === 'access');
    expect(access?.status).toBe('established');
    expect(access?.claims.some((entry) => entry.standing === 'official_legal_fact')).toBe(true);
  });
});

describe('taxes and assessment', () => {
  it('is unresolved when nothing at all is retained', () => {
    const taxes = build().diligence.find((entry) => entry.key === 'taxes');
    expect(taxes?.status).toBe('unresolved');
    expect(taxes?.headline).toContain('No assessment or tax record is retained');
  });

  it('carries the provider figures rather than reporting no record beside them', () => {
    const synthesis = buildPropertyEvidenceSynthesis({
      dealCardId: 501,
      dossier: buildAcquisitionDossier(file()),
      understanding: understanding(),
      providerAssessment: {
        assessedValue: '$35,000.00', totalMarketValue: '$35,000.00',
        taxAmount: '$478.66', sourceName: 'LandPortal parcel record',
      },
      now,
    });
    const taxes = synthesis.diligence.find((entry) => entry.key === 'taxes');
    // Real evidence, honestly ranked: retained, but not the county's own roll.
    expect(taxes?.status).toBe('partial');
    expect(taxes?.headline).toContain('LandPortal parcel record');
    expect(taxes?.headline).toContain('stronger official source');
    expect(taxes?.claims.map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['$478.66', '$35,000.00']),
    );
    for (const entry of taxes?.claims ?? []) expect(entry.standing).toBe('record_fact');
    expect(taxes?.gap).toContain('No official county assessment or tax record');
  });
});

describe('statement formatting', () => {
  it('never doubles a full stop on a value that already ends in one', () => {
    const source = file();
    (source.propertyIntelligence as Record<string, any>).landUse = {
      septicWell: { perLotApprovalRequired: { value: 'Not researched.' } },
    };
    const statements = build(source).diligence.flatMap((topic) => topic.claims.map((entry) => entry.statement));
    for (const statement of statements) expect(statement).not.toMatch(/\.\.$/);
  });

  it('gives the wetlands acreage its unit', () => {
    const wetlands = build().diligence.find((entry) => entry.key === 'wetlands');
    expect(wetlands?.claims[0].statement).toContain('acres)');
  });
});

describe('standing separation', () => {
  it('keeps official fact, record fact, visual observation and hypothesis apart', () => {
    const synthesis = build();
    expect(synthesis.separation.counts.record_fact).toBeGreaterThan(0);
    expect(synthesis.separation.counts.analytical_hypothesis).toBeGreaterThan(0);
    expect(synthesis.separation.counts.verification_need).toBeGreaterThan(0);
    // A visual observation is reviewed, never admitted as a record fact.
    expect(synthesis.visualReview[0]).toMatchObject({
      capture: 'close parcel aerial',
      standing: 'visual_observation',
      model: 'vision-model',
    });
    expect(synthesis.recordFacts.some((entry) => entry.standing === 'visual_observation')).toBe(false);
  });

  it('lists a retained capture that was never analyzed without inventing an observation', () => {
    const source = file({ visualObservations: [] });
    const synthesis = build(source);
    expect(synthesis.visualReview).toHaveLength(1);
    expect(synthesis.visualReview[0].observation).toBeNull();
  });
});

describe('guardrails', () => {
  it('withholds FMV, title, legal access, entitlement, utilities and environmental clearance without evidence', () => {
    const synthesis = build();
    const kinds = synthesis.guardrails.map((entry) => entry.claimKind);
    expect(kinds).toEqual(expect.arrayContaining([
      'Fair market value', 'Title', 'Legal access', 'Entitlement approval',
      'Utility availability', 'Environmental clearance',
    ]));
    for (const guard of synthesis.guardrails) expect(guard.unlockedBy).toBeTruthy();
    // Each withheld assertion is visible in the evidence list as a need.
    expect(synthesis.separation.verificationNeedIds.length).toBeGreaterThanOrEqual(kinds.length);
  });

  it('drops the legal-access guardrail once a recorded instrument exists', () => {
    const source = file();
    (source.propertyIntelligence as Record<string, any>).access.recordedLegalAccess =
      'Access easement recorded at Book 412 Page 88.';
    const synthesis = build(source);
    expect(synthesis.guardrails.map((entry) => entry.claimKind)).not.toContain('Legal access');
  });
});

describe('the accepted subject settles what it has settled', () => {
  const subjectState = (overrides: Record<string, unknown> = {}) => ({
    subjectResolved: true, officiallyVerified: false, officialVerificationSource: null,
    apn: 'AAA-111-000', address: '19 Sample Rd', city: 'Example', county: 'Example',
    state: 'ZZ', zip: '00000', fips: null, subjectVersion: 'iv:1:v1',
    governingAcreage: {
      value: 1.5, kind: 'operator_accepted',
      source: 'Operator-accepted governing acreage', disputed: false, observedAt: null,
    },
    ...overrides,
  }) as never;

  it('prints the accepted governing basis rather than the dossier label', () => {
    const synthesis = buildPropertyEvidenceSynthesis({
      dealCardId: 501,
      dossier: buildAcquisitionDossier(file()),
      subject: subjectState(),
      understanding: understanding(),
      now,
    });
    expect(synthesis.subject.acreageBasis).toBe('Operator-accepted governing acreage');
  });

  it('records an acreage conflict the operator already settled as resolved', () => {
    const dossier = buildAcquisitionDossier(file());
    dossier.conflicts = [{
      subject: 'acreage',
      statement: 'Acreage bases disagree: assessed 1.5 ac vs mapped 1.846 ac.',
      values: [{ value: '1.5', source: 'assessed' }, { value: '1.846', source: 'mapped' }],
      resolution: 'unresolved',
      reason: 'The governing acreage is unresolved.',
      decisionAtRisk: 'Price per acre.',
    }] as unknown as typeof dossier.conflicts;

    const settled = buildPropertyEvidenceSynthesis({
      dealCardId: 501, dossier, subject: subjectState(), understanding: understanding(), now,
    });
    const conflict = settled.conflicts.find((entry) => entry.topic === 'dossier.acreage');
    expect(conflict?.resolution).toBe('resolved');
    expect(conflict?.reason).toContain('Settled by the accepted governing acreage');
    // And it stops being reported as an open risk beside the header.
    expect(settled.story.risks.join(' ')).not.toContain('Acreage bases disagree');
  });

  it('settles the same disagreement when the dossier files it under identity', () => {
    const dossier = buildAcquisitionDossier(file());
    dossier.conflicts = [{
      subject: 'identity',
      statement: 'Acreage bases disagree: assessed 1.5 ac vs mapped 1.846 ac. The governing acreage is unresolved.',
      values: [{ value: '1.5 ac', source: 'assessed' }, { value: '1.846 ac', source: 'mapped' }],
      resolution: 'unresolved',
      reason: 'Parcel identity is a hard gate.',
      decisionAtRisk: 'Price per acre.',
    }] as unknown as typeof dossier.conflicts;

    const settled = buildPropertyEvidenceSynthesis({
      dealCardId: 501, dossier, subject: subjectState(), understanding: understanding(), now,
    });
    expect(settled.conflicts.find((entry) => entry.topic === 'dossier.identity')?.resolution).toBe('resolved');
    expect(settled.story.risks.join(' ')).not.toContain('Acreage bases disagree');
  });

  it('settles it when the whole disagreement arrives as one prose value', () => {
    const dossier = buildAcquisitionDossier(file());
    dossier.conflicts = [{
      subject: 'identity',
      statement: 'Acreage bases disagree: assessed 1.5 ac vs mapped 1.846 ac. The governing acreage is unresolved.',
      // The live dossier packs the whole sentence into a single side value.
      values: [{ value: 'Acreage bases disagree: assessed 1.5 ac vs mapped 1.846 ac. The governing acreage is unresolved.', source: 'reconciliation' }],
      resolution: 'unresolved',
      reason: 'Parcel identity is a hard gate.',
      decisionAtRisk: 'Price per acre.',
    }] as unknown as typeof dossier.conflicts;

    const settled = buildPropertyEvidenceSynthesis({
      dealCardId: 501, dossier, subject: subjectState(), understanding: understanding(), now,
    });
    expect(settled.conflicts.find((entry) => entry.topic === 'dossier.identity')?.resolution).toBe('resolved');
    expect(settled.story.risks.join(' ')).not.toContain('Acreage bases disagree');
  });

  it('leaves an identity conflict that is not about the accepted acreage open', () => {
    const dossier = buildAcquisitionDossier(file());
    dossier.conflicts = [{
      subject: 'identity',
      statement: 'Two parcel identifiers are in play: AAA-111-000 vs AAA-111-009.',
      values: [{ value: 'AAA-111-000', source: 'intake' }, { value: 'AAA-111-009', source: 'provider' }],
      resolution: 'unresolved',
      reason: 'Parcel identity is a hard gate.',
      decisionAtRisk: 'Which parcel is being bought.',
    }] as unknown as typeof dossier.conflicts;

    const open = buildPropertyEvidenceSynthesis({
      dealCardId: 501, dossier, subject: subjectState(), understanding: understanding(), now,
    });
    expect(open.conflicts.find((entry) => entry.topic === 'dossier.identity')?.resolution).toBe('unresolved');
  });

  it('leaves a genuinely disputed acreage conflict open', () => {
    const dossier = buildAcquisitionDossier(file());
    dossier.conflicts = [{
      subject: 'acreage',
      statement: 'Acreage bases disagree: assessed 1.5 ac vs mapped 1.846 ac.',
      values: [{ value: '1.5', source: 'assessed' }, { value: '1.846', source: 'mapped' }],
      resolution: 'unresolved',
      reason: 'The governing acreage is unresolved.',
      decisionAtRisk: 'Price per acre.',
    }] as unknown as typeof dossier.conflicts;

    const disputed = buildPropertyEvidenceSynthesis({
      dealCardId: 501,
      dossier,
      subject: subjectState({
        governingAcreage: { value: 1.5, kind: 'assessed', source: 'Assessor roll', disputed: true, observedAt: null },
      }),
      understanding: understanding(),
      now,
    });
    const conflict = disputed.conflicts.find((entry) => entry.topic === 'dossier.acreage');
    expect(conflict?.resolution).toBe('unresolved');
    expect(disputed.story.risks.join(' ')).toContain('Acreage bases disagree');
  });
});

describe('the Property Story', () => {
  it('leads with a concise operator outcome and never asserts an unsupported value', () => {
    const synthesis = build();
    expect(synthesis.story.headline).toContain('1.5 acre');
    expect(synthesis.story.headline).toContain('diligence topics established');
    expect(synthesis.story.economicsDrivers.map((entry) => entry.fact).join(' '))
      .toContain('No supported fair market value is established');
    expect(synthesis.story.risks.length).toBeGreaterThan(0);
  });

  it('names the facts most likely to move acquisition economics', () => {
    const synthesis = build();
    const facts = synthesis.story.economicsDrivers.map((entry) => entry.fact).join(' | ');
    expect(facts).toContain('Governing acreage 1.5');
    expect(facts).toContain('Buildable share 88%');
  });
});

describe('stability of the reading', () => {
  it('produces the same fingerprint for the same evidence', () => {
    expect(build().inputFingerprint).toBe(build().inputFingerprint);
  });

  it('moves the fingerprint when the evidence genuinely changes', () => {
    const source = file();
    (source.propertyIntelligence as Record<string, any>).landPortalFacts.environment.femaFloodZone = 'AE';
    expect(build(source).inputFingerprint).not.toBe(build().inputFingerprint);
  });
});

describe('recorded easements and restrictions the screening actually read', () => {
  it('carries the instrument finding verbatim as an official record fact', () => {
    const source = file();
    const pi = source.propertyIntelligence as Record<string, unknown>;
    (pi.snapshot as Record<string, unknown>).governmentRecords = [{
      key: 'easements', label: 'Recorded easements and restrictions', grade: 'likely_indication',
      value: 'Subject to River Oak Plantation Restrictions and Covenants (OR 535 pp 59-68); conveyed with and subject to an ingress/egress easement over all roadways shown on Misc Map Book 1 Page 18',
      source: 'County recorded government records', sourceUrl: null, retrievedAt: '2026-09-05T00:00:00.000Z', note: null,
    }];
    const dossier = buildAcquisitionDossier(source);
    expect(dossier.recordedEncumbrances).toHaveLength(1);
    const synthesis = buildPropertyEvidenceSynthesis({ dealCardId: 501, dossier, understanding: understanding(), now });
    const fact = synthesis.recordFacts.find((entry) => entry.topic === 'record.encumbrances');
    expect(fact?.standing).toBe('official_legal_fact');
    expect(fact?.statement).toContain('ingress/egress easement over all roadways shown on Misc Map Book 1 Page 18');
    expect(fact?.statement).toContain('River Oak Plantation Restrictions');
  });

  it('asserts no encumbrance fact when the screening retained none', () => {
    const synthesis = buildPropertyEvidenceSynthesis({ dealCardId: 501, dossier: buildAcquisitionDossier(file()), understanding: understanding(), now });
    expect(synthesis.recordFacts.some((entry) => entry.topic === 'record.encumbrances')).toBe(false);
  });
});
