// Stage 2 acceptance fixtures — Deal Manager / Subject Understanding.
//
// Five lead shapes LandOS must handle without a generic parser failure. Every
// fixture is synthetic: no control-case parcel, owner, APN or address appears
// here, because a front door that only works on the deal it was debugged
// against has not been built.
//
// The assertions are about the mechanism:
//   • raw evidence survives every path;
//   • the answer is a supported subject, a ranked candidate set, or exactly one
//     targeted question — never nothing;
//   • a retained neighbouring lot and its improvements never become the
//     subject's;
//   • the model-led loop is bounded, audited, schema-checked and stale-safe.

import { describe, expect, it, vi } from 'vitest';

import {
  SUBJECT_UNDERSTANDING_ACTION_LIMIT,
  SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
  deriveSubjectCandidates,
  parseSubjectUnderstandingPlan,
  understandSubject,
  type SubjectEvidenceFact,
  type SubjectEvidenceField,
  type SubjectEvidenceKind,
  type SubjectEvidenceWeight,
  type SubjectUnderstandingResult,
} from './subject-understanding.js';
import type { ClaimParcelRelationship } from './deal-evidence-claims.js';

// ── Fixture builders ────────────────────────────────────────────────────────

let factSeq = 0;

function fact(input: {
  field: SubjectEvidenceField;
  value: string;
  quoted?: string | null;
  inferred?: boolean;
  kind: SubjectEvidenceKind;
  label: string;
  locator?: string | null;
  url?: string | null;
  officiality?: 'official' | 'officially_linked' | 'unverified';
  weight?: SubjectEvidenceWeight;
  parcelRelationship?: ClaimParcelRelationship;
}): SubjectEvidenceFact {
  factSeq += 1;
  return {
    factId: `f${factSeq}`,
    field: input.field,
    label: input.label,
    value: input.value,
    quoted: input.quoted === undefined ? input.value : input.quoted,
    inferred: input.inferred ?? false,
    source: {
      kind: input.kind,
      label: input.label,
      url: input.url ?? null,
      locator: input.locator ?? null,
      retrievedAt: '2026-09-01T00:00:00.000Z',
      officiality: input.officiality ?? 'unverified',
    },
    weight: input.weight ?? 'well_supported',
    parcelRelationship: input.parcelRelationship ?? 'subject',
  };
}

/** Fixture 1 — a direct provider link plus an address, and nothing else. */
function directLinkFixture(): SubjectEvidenceFact[] {
  const link = 'https://landportal.example/property/13097-4471200015';
  return [
    fact({ field: 'lp_url', value: link, url: link, kind: 'landportal_link', label: 'Operator-supplied LandPortal link', officiality: 'officially_linked', weight: 'well_supported' }),
    fact({ field: 'lp_property_id', value: '4471200015', url: link, kind: 'landportal_link', label: 'LandPortal property id', officiality: 'officially_linked' }),
    fact({ field: 'fips', value: '13097', url: link, kind: 'landportal_link', label: 'County FIPS in the supplied link', officiality: 'officially_linked' }),
    fact({ field: 'address', value: '4118 Sandy Ridge Rd, Villa Rica, GA 30180', kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1' }),
    fact({ field: 'county', value: 'Douglas', kind: 'landportal_link', label: 'LandPortal parcel record', officiality: 'officially_linked' }),
    fact({ field: 'state', value: 'GA', kind: 'landportal_link', label: 'LandPortal parcel record', officiality: 'officially_linked' }),
  ];
}

/**
 * Fixture 2 — the hard one. A survey, three contiguous seller lots, an APN the
 * form and the survey punctuate differently, and a retained lot carrying a
 * manufactured home. Exactly one lot is offered.
 */
function surveyClusterFixture(): SubjectEvidenceFact[] {
  return [
    fact({ field: 'apn', value: '0451-00-021', quoted: '0451-00-021', kind: 'form_field', label: 'Lead form — parcel number' }),
    // The survey writes the same parcel without punctuation. A formatting
    // variant is not a second parcel.
    fact({
      field: 'apn', value: '045100021', quoted: 'PARCEL NO. 045100021',
      kind: 'document', label: 'Seller Survey', locator: 'Seller Survey — page 1 of 3',
      weight: 'well_supported',
    }),
    fact({
      field: 'acreage', value: '4.62', quoted: 'CONTAINING 4.62 ACRES MORE OR LESS',
      kind: 'document', label: 'Seller Survey', locator: 'Seller Survey — page 2 of 3',
    }),
    fact({
      field: 'legal_description', value: 'Lot 3, Cedar Hollow Estates, Plat Book 14 Page 88',
      quoted: 'LOT 3, CEDAR HOLLOW ESTATES, AS RECORDED IN PLAT BOOK 14, PAGE 88',
      kind: 'document', label: 'Seller Survey', locator: 'Seller Survey — page 1 of 3',
    }),
    fact({ field: 'county', value: 'Cherokee', kind: 'form_field', label: 'Lead form — county' }),
    fact({ field: 'state', value: 'SC', kind: 'form_field', label: 'Lead form — state' }),
    // The operator's own spatial narrative: three lots, one offered.
    fact({
      field: 'other', value: 'Seller owns Lots 2, 3 and 4 and is selling only Lot 3.',
      quoted: 'they own three lots in a row, only lot 3 is for sale, the doublewide stays with them',
      kind: 'operator_narrative', label: 'Operator note', locator: 'Deal note 2026-08-30',
    }),
    // The retained neighbouring lot and its improvement. This must never reach
    // the subject: it is a different parcel in the same ownership.
    fact({
      field: 'apn', value: '045100022', kind: 'provider_record', label: 'Provider parcel sweep',
      parcelRelationship: 'related_parcel',
    }),
    fact({
      field: 'improvement', value: 'Manufactured home, 1,568 sq ft', kind: 'provider_record',
      label: 'Provider parcel sweep', parcelRelationship: 'related_parcel',
    }),
    fact({
      field: 'acreage', value: '5.10', kind: 'provider_record', label: 'Provider parcel sweep',
      parcelRelationship: 'related_parcel',
    }),
  ];
}

/** Fixture 3 — an address and nothing that identifies a parcel. */
function addressOnlyFixture(): SubjectEvidenceFact[] {
  return [
    fact({ field: 'address', value: '812 Quarry Loop, Marion, NC 28752', kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1' }),
    // A geocode is provenance, never identity (invariant 3).
    fact({
      field: 'geometry', value: '35.6841,-82.0093', inferred: true, quoted: null,
      kind: 'geometry', label: 'Address geocode', weight: 'likely',
    }),
  ];
}

/** Fixture 4 — two credible, materially different parcel identities. */
function conflictedFixture(): SubjectEvidenceFact[] {
  return [
    fact({ field: 'address', value: '77 Ridge Fork Rd, Sparta, TN 38583', kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1' }),
    fact({ field: 'county', value: 'White', kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1' }),
    fact({ field: 'state', value: 'TN', kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1' }),
    fact({
      field: 'apn', value: '073-014.00', kind: 'form_field', label: 'Lead form — parcel number',
      weight: 'well_supported',
    }),
    // A different parcel entirely, not a formatting variant, from a source of
    // comparable weight. Nothing in the evidence decides between them.
    fact({
      field: 'apn', value: '081-226.03', kind: 'document', label: 'Seller Deed',
      locator: 'Seller Deed — page 1 of 2', weight: 'well_supported',
    }),
  ];
}

/** Fixture 5 — barely anything. */
function lowInformationFixture(): SubjectEvidenceFact[] {
  return [
    fact({
      field: 'other', value: 'Seller has acreage in south Georgia, size not stated.',
      quoted: 'got some land down in south georgia, wanting to see what its worth',
      kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1', weight: 'likely',
    }),
    fact({ field: 'state', value: 'GA', inferred: true, quoted: null, kind: 'seller_text', label: 'Seller message', locator: 'Intake line 1', weight: 'likely' }),
  ];
}

const NEVER_PLANNED = vi.fn(async () => {
  throw new Error('the planner must not be reached');
});

async function understand(
  evidence: SubjectEvidenceFact[],
  overrides: Partial<Parameters<typeof understandSubject>[0]> = {},
): Promise<SubjectUnderstandingResult> {
  return understandSubject({
    dealCardId: 9001,
    evidence,
    subjectVersionAtStart: 'unresolved:9001:pending#ac:none',
    ...overrides,
  });
}

// ── Fixture 1: direct link + address ────────────────────────────────────────

describe('fixture 1 — direct provider link plus address', () => {
  it('establishes a research-ready subject from the link the operator supplied', async () => {
    const result = await understand(directLinkFixture(), { planner: NEVER_PLANNED });

    expect(result.outcome).toBe('research_ready');
    expect(result.subject).not.toBeNull();
    expect(result.subject!.lpPropertyId).toBe('4471200015');
    expect(result.subject!.fips).toBe('13097');
    expect(result.subject!.verification.researchGrade).toBe(true);
    // Research-grade is not official verification, and the difference is stated.
    expect(result.subject!.verification.officiallyVerified).toBe(false);
    expect(result.subject!.verification.outstanding.join(' ')).toMatch(/official|assessor|county/i);
    expect(result.question).toBeNull();
  });

  // Stage 2.1: the LLM Deal Manager reviews EVERY fresh subject decision. A
  // settled reading changes what the review may COST, not whether it happens —
  // one turn, and no evidence check is authorized.
  it('is reviewed in exactly one reasoning turn and spends no action', async () => {
    const concur = vi.fn(async () => JSON.stringify({
      reading: 'The supplied provider link plus FIPS establishes this subject.',
      nextCheck: null,
      proposedOutcome: 'research_ready',
      question: null,
    }));
    const result = await understand(directLinkFixture(), {
      planner: concur,
      executor: async () => { throw new Error('no evidence check may run on a settled reading'); },
    });
    expect(result.audit.plannerInvocations).toBe(1);
    expect(result.audit.actionsUsed).toBe(0);
    expect(result.audit.stopReason).toBe('research_ready');
    expect(result.outcome).toBe('research_ready');
  });

  it('still settles when no planner is bound at all', async () => {
    const result = await understand(directLinkFixture(), {});
    expect(result.audit.plannerInvocations).toBe(0);
    expect(result.audit.actionsUsed).toBe(0);
    expect(result.outcome).toBe('research_ready');
    expect(result.audit.reasoning.bound).toBe(false);
  });

  it('keeps every raw statement retrievable with its source', async () => {
    const result = await understand(directLinkFixture(), { planner: NEVER_PLANNED });
    expect(result.evidence).toHaveLength(6);
    const address = result.evidence.find((e) => e.field === 'address')!;
    expect(address.quoted).toBe('4118 Sandy Ridge Rd, Villa Rica, GA 30180');
    expect(address.source.locator).toBe('Intake line 1');
  });
});

// ── Fixture 2: survey + contiguous lots + APN variant + retained home ───────

describe('fixture 2 — survey-led lot out of a contiguous seller cluster', () => {
  it('treats an APN formatting variant as the same parcel, not a candidate set', async () => {
    const result = await understand(surveyClusterFixture(), { planner: NEVER_PLANNED });

    expect(result.outcome).toBe('research_ready');
    expect(result.candidates).toHaveLength(1);
    expect(result.subject!.apnNormalized).toBe('045100021');
    // The source's own punctuation is preserved, both ways it was written.
    expect(result.subject!.apnDisplayVariants).toEqual(
      expect.arrayContaining(['0451-00-021', '045100021']),
    );
  });

  it('names the acquisition interest as the offered lot, not the whole holding', async () => {
    const result = await understand(surveyClusterFixture(), { planner: NEVER_PLANNED });
    expect(result.subject!.interest.form).toBe('recorded_lot');
    expect(result.subject!.interest.statement).toMatch(/Lot 3/i);
    expect(result.subject!.interest.excluded.length).toBeGreaterThan(0);
  });

  it('never merges the retained lot or its manufactured home into the subject', async () => {
    const result = await understand(surveyClusterFixture(), { planner: NEVER_PLANNED });

    // The subject carries the surveyed acreage of the offered lot only.
    expect(result.subject!.acres).toBe(4.62);
    // Not the cluster total, and not the neighbour's figure.
    expect(result.subject!.acres).not.toBe(9.72);
    expect(result.subject!.apnNormalized).not.toBe('045100022');

    const subjectFactIds = new Set(Object.values(result.subject!.provenance).map((p) => p.factId));
    const retained = result.evidence.filter((e) => e.parcelRelationship === 'related_parcel');
    expect(retained.length).toBeGreaterThan(0);
    for (const item of retained) expect(subjectFactIds.has(item.factId)).toBe(false);

    // And the retained parcel is still visible, labelled, rather than dropped.
    expect(result.excludedParcels.map((p) => p.identifier)).toContain('045100022');
    expect(result.excludedParcels[0].reason).toMatch(/related|retained|different parcel/i);
  });

  it('sources the acreage from the survey and says so', async () => {
    const result = await understand(surveyClusterFixture(), { planner: NEVER_PLANNED });
    expect(result.subject!.provenance.acres.source).toMatch(/survey/i);
    expect(result.subject!.provenance.acres.inferred).toBe(false);
  });
});

// ── Fixture 3: address only ─────────────────────────────────────────────────

describe('fixture 3 — address only', () => {
  it('asks exactly one precise question rather than inventing a parcel', async () => {
    const result = await understand(addressOnlyFixture());

    expect(result.outcome).toBe('needs_targeted_input');
    expect(result.subject).toBeNull();
    expect(result.question).not.toBeNull();
    expect(result.question!.question).toMatch(/\?$/);
    expect(result.question!.unblocks).toBeTruthy();
  });

  it('refuses to let a geocode stand in for parcel identity', async () => {
    const result = await understand(addressOnlyFixture());
    expect(result.candidates).toHaveLength(0);
    // The address is still retained and still shown.
    expect(result.evidence.some((e) => e.field === 'address')).toBe(true);
    expect(result.audit.stopReason).toBe('targeted_input_required');
  });
});

// ── Fixture 4: materially conflicting evidence ──────────────────────────────

describe('fixture 4 — two credible parcel identities', () => {
  it('returns a ranked candidate set instead of silently picking one', async () => {
    const result = await understand(conflictedFixture());

    expect(result.outcome).toBe('candidate_set');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.subject.apnNormalized).sort())
      .toEqual(['07301400', '08122603']);
    expect(result.subject).toBeNull();
    for (const candidate of result.candidates) expect(candidate.distinguishedBy).toBeTruthy();
  });

  it('surfaces the conflict with both statements and their sources', async () => {
    const result = await understand(conflictedFixture());
    const conflict = result.conflicts.find((c) => c.field === 'apn');
    expect(conflict).toBeDefined();
    expect(conflict!.material).toBe(true);
    expect(conflict!.resolution).toBe('unresolved');
    expect(conflict!.statements.map((s) => s.source).sort())
      .toEqual(['Lead form — parcel number', 'Seller Deed']);
  });
});

// ── Fixture 5: low information ──────────────────────────────────────────────

describe('fixture 5 — low-information lead', () => {
  it('produces a useful question instead of a parser failure', async () => {
    const result = await understand(lowInformationFixture());

    expect(result.outcome).toBe('needs_targeted_input');
    expect(result.question).not.toBeNull();
    expect(result.question!.acceptableAnswers.length).toBeGreaterThan(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('keeps the seller words verbatim and marks what LandOS inferred', async () => {
    const result = await understand(lowInformationFixture());
    const raw = result.evidence.find((e) => e.quoted?.includes('south georgia'));
    expect(raw).toBeDefined();
    const inferredState = result.evidence.find((e) => e.field === 'state');
    expect(inferredState!.inferred).toBe(true);
    expect(inferredState!.quoted).toBeNull();
  });
});

// ── Acquisition interest: the verb the operator actually wrote ─────────────

describe('acquisition interest', () => {
  it('reads an operator "splitting off" narrative as a proposed split, not a whole parcel', async () => {
    // Regression: the live control lead reads "Seller is splitting off the left
    // lot next to his manufactured home" and rendered as WHOLE PARCEL, because
    // the trigger matched the noun "split" and not the verb form operators use.
    // A carve-out presented as the whole parcel silently attaches the seller's
    // retained improvements to the subject.
    const result = await understand([
      fact({ field: 'apn', value: '00083-A-03400', kind: 'form_field', label: 'Lead form — parcel number' }),
      fact({ field: 'county', value: 'Bradford', kind: 'form_field', label: 'Lead form — county' }),
      fact({ field: 'state', value: 'FL', kind: 'form_field', label: 'Lead form — state' }),
      fact({
        field: 'other',
        value: 'Seller is splitting off the left lot next to his manufactured home.',
        quoted: 'Seller is splitting off the left lot next to his manufactured home.',
        kind: 'seller_text', label: 'Lead intake text', locator: 'Retained raw intake', weight: 'likely',
      }),
    ]);

    expect(result.outcome).toBe('research_ready');
    expect(result.subject!.interest.form).toBe('proposed_split');
    expect(result.subject!.interest.statement).toMatch(/retains stays outside/i);
  });

  it('still reads a plain single-parcel lead as a whole parcel', async () => {
    const result = await understand(directLinkFixture(), { planner: NEVER_PLANNED });
    expect(result.subject!.interest.form).toBe('whole_parcel');
  });
});

// ── The bounded tool loop ───────────────────────────────────────────────────

describe('bounded evidence loop', () => {
  const plan = (body: Record<string, unknown>) => async () => JSON.stringify(body);

  it('spends at most the declared action limit', async () => {
    const executor = vi.fn(async () => [] as SubjectEvidenceFact[]);
    const planner = vi.fn(plan({
      reading: 'the address needs an official parcel record',
      nextCheck: { capabilityId: 'property-resolution', reason: 'find the parcel record for the address' },
      proposedOutcome: null,
      question: null,
    }));

    const result = await understand(addressOnlyFixture(), { planner, executor });

    expect(result.audit.actionsUsed).toBe(SUBJECT_UNDERSTANDING_ACTION_LIMIT);
    expect(executor).toHaveBeenCalledTimes(SUBJECT_UNDERSTANDING_ACTION_LIMIT);
    expect(result.audit.stopReason).toBe('action_limit_reached');
    // A spent budget still returns an answer, never nothing.
    expect(result.outcome).toBe('needs_targeted_input');
    expect(result.question).not.toBeNull();
  });

  it('refuses a capability outside the authorized set and records the refusal', async () => {
    const executor = vi.fn(async () => [] as SubjectEvidenceFact[]);
    const planner = vi.fn(plan({
      reading: 'try the comp engine',
      nextCheck: { capabilityId: 'comps-valuation', reason: 'price it' },
      proposedOutcome: null,
      question: null,
    }));

    const result = await understand(addressOnlyFixture(), { planner, executor });

    expect(executor).not.toHaveBeenCalled();
    expect(result.audit.stopReason).toBe('no_further_check_available');
    const refusal = result.audit.steps.find((s) => s.accepted === false);
    expect(refusal).toBeDefined();
    expect(refusal!.rejectionReason).toMatch(/not authorized|comps-valuation/i);
    expect(SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES).not.toContain('comps-valuation');
  });

  it('rejects malformed model output and still answers deterministically', async () => {
    const planner = vi.fn(async () => 'I think you should look at the county site.');
    const result = await understand(addressOnlyFixture(), { planner, executor: vi.fn() });

    expect(result.audit.stopReason).toBe('planner_output_invalid');
    expect(result.outcome).toBe('needs_targeted_input');
    expect(result.question).not.toBeNull();
  });

  it('stops the moment an evidence check makes the subject research-ready', async () => {
    const found: SubjectEvidenceFact[] = [
      fact({ field: 'apn', value: '0982-11-004', kind: 'official_record', label: 'McDowell County assessor parcel record', officiality: 'official', weight: 'confirmed' }),
      fact({ field: 'county', value: 'McDowell', kind: 'official_record', label: 'McDowell County assessor parcel record', officiality: 'official', weight: 'confirmed' }),
      fact({ field: 'state', value: 'NC', kind: 'official_record', label: 'McDowell County assessor parcel record', officiality: 'official', weight: 'confirmed' }),
    ];
    const executor = vi.fn(async () => found);
    const planner = vi.fn(plan({
      reading: 'an official parcel record would settle this',
      nextCheck: { capabilityId: 'property-resolution', reason: 'resolve the address to a parcel record' },
      proposedOutcome: null,
      question: null,
    }));

    const result = await understand(addressOnlyFixture(), { planner, executor });

    expect(result.audit.actionsUsed).toBe(1);
    expect(result.outcome).toBe('research_ready');
    expect(result.subject!.verification.officiallyVerified).toBe(true);
    expect(result.audit.stopReason).toBe('research_ready');
  });

  it('records every turn in an audit trail a reviewer can follow', async () => {
    const executor = vi.fn(async () => [] as SubjectEvidenceFact[]);
    const planner = vi.fn(plan({
      reading: 'no parcel identifier yet',
      nextCheck: { capabilityId: 'property-resolution', reason: 'resolve the address' },
      proposedOutcome: null,
      question: null,
    }));

    const result = await understand(addressOnlyFixture(), { planner, executor });

    expect(result.audit.steps[0].kind).toBe('deterministic_assembly');
    expect(result.audit.steps.some((s) => s.kind === 'planner_turn')).toBe(true);
    expect(result.audit.steps.some((s) => s.kind === 'evidence_check' && s.capabilityId === 'property-resolution')).toBe(true);
    expect(result.audit.steps.at(-1)!.kind).toBe('stop');
    expect(result.audit.actionLimit).toBe(SUBJECT_UNDERSTANDING_ACTION_LIMIT);
  });

  it('refuses to write when the subject moved underneath the run', async () => {
    const result = await understand(directLinkFixture(), {
      planner: NEVER_PLANNED,
      currentSubjectVersion: () => 'iv:44:v2#ac:4.62:survey',
    });

    expect(result.persistable).toBe(false);
    expect(result.audit.stopReason).toBe('subject_changed_underneath');
    // The reading is still returned; it is simply not authoritative.
    expect(result.subject).not.toBeNull();
  });
});

// ── Plan schema validation ──────────────────────────────────────────────────

describe('plan schema', () => {
  it('accepts a well-formed plan naming an authorized capability', () => {
    const { plan, error } = parseSubjectUnderstandingPlan(
      JSON.stringify({
        reading: 'the link identifies the parcel',
        nextCheck: { capabilityId: 'property-resolution', reason: 'confirm the record' },
        proposedOutcome: 'research_ready',
        question: null,
      }),
      SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
    );
    expect(error).toBeNull();
    expect(plan!.nextCheck!.capabilityId).toBe('property-resolution');
    expect(plan!.proposedOutcome).toBe('research_ready');
  });

  it('rejects an unknown outcome value', () => {
    const { plan, error } = parseSubjectUnderstandingPlan(
      JSON.stringify({ reading: 'x', nextCheck: null, proposedOutcome: 'looks_good', question: null }),
      SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
    );
    expect(plan).toBeNull();
    expect(error).toMatch(/proposedOutcome/);
  });

  it('rejects more than one question', () => {
    const { error } = parseSubjectUnderstandingPlan(
      JSON.stringify({
        reading: 'x',
        nextCheck: null,
        proposedOutcome: 'needs_targeted_input',
        question: { question: 'Which parcel? And also what is the price?', why: 'y', unblocks: 'z', acceptableAnswers: ['an APN'] },
      }),
      SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
    );
    expect(error).toMatch(/one question/i);
  });
});

// ── Candidate derivation is pure and reusable ───────────────────────────────

describe('deriveSubjectCandidates', () => {
  it('is a pure read over evidence and never mutates its input', () => {
    const evidence = surveyClusterFixture();
    const before = JSON.stringify(evidence);
    deriveSubjectCandidates(evidence);
    expect(JSON.stringify(evidence)).toBe(before);
  });

  it('builds no candidate from a related parcel alone', () => {
    const evidence = surveyClusterFixture().filter((e) => e.parcelRelationship === 'related_parcel');
    const { candidates } = deriveSubjectCandidates(evidence);
    expect(candidates).toHaveLength(0);
  });
});
