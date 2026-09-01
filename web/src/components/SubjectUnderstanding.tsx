// Subject Understanding — what LandOS understands this lead to be about.
//
// The front door has exactly three honest answers and this panel shows which
// one is current: a supported Working Acquisition Subject, a ranked candidate
// set, or one precise question. There is no fourth state meaning "the parser
// did not recognise this", so this panel never renders empty on a lead that
// carries any evidence at all.
//
// Two separations are load-bearing and are drawn on screen, not left implied:
// research-grade identity is not official/title verification, and a quoted
// page statement is not the same thing as a LandOS inference.

export type SubjectUnderstandingOutcome = 'research_ready' | 'candidate_set' | 'needs_targeted_input';

export interface SubjectUnderstandingView {
  outcome: SubjectUnderstandingOutcome;
  subject: {
    apn: string | null;
    apnDisplayVariants: string[];
    address: string | null;
    county: string | null;
    state: string | null;
    fips: string | null;
    lpPropertyId: string | null;
    legalDescription: string | null;
    acres: number | null;
    interest: { form: string; statement: string; excluded: Array<{ identifier: string; reason: string }> };
    provenance: Record<string, { factId: string; source: string; weight: string; inferred: boolean; locator: string | null }>;
    verification: {
      researchGrade: boolean;
      officiallyVerified: boolean;
      officialRecord: {
        factId: string;
        source: string;
        sourceType: string;
        recordIdentifier: string | null;
        fieldsMatched: string[];
        observedAt: string | null;
        qualifies: string;
      } | null;
      outstanding: string[];
    };
    confidence: number;
  } | null;
  candidates: Array<{
    candidateId: string;
    rank: number;
    distinguishedBy: string;
    subject: { apn: string | null; lpPropertyId: string | null; county: string | null; state: string | null; confidence: number };
  }>;
  conflicts: Array<{
    field: string;
    material: boolean;
    resolution: string;
    reason: string;
    statements: Array<{ value: string; source: string; weight: string }>;
  }>;
  question: { question: string; why: string; unblocks: string; acceptableAnswers: string[] } | null;
  excludedParcels: Array<{ identifier: string; relationship: string; reason: string }>;
  evidence: Array<{
    factId: string;
    field: string;
    label: string;
    value: string;
    quoted: string | null;
    inferred: boolean;
    weight: string;
    parcelRelationship: string;
    source: { kind: string; label: string; locator: string | null };
  }>;
  confidence: number;
  persistable: boolean;
  audit: { actionLimit: number; actionsUsed: number; plannerInvocations: number; stopReason: string };
}

const OUTCOME_LABEL: Record<SubjectUnderstandingOutcome, string> = {
  research_ready: 'Research ready',
  candidate_set: 'Candidate set',
  needs_targeted_input: 'Needs one answer',
};

const INTEREST_LABEL: Record<string, string> = {
  whole_parcel: 'Whole parcel',
  recorded_lot: 'Recorded lot',
  assemblage: 'Assemblage',
  proposed_split: 'Proposed split',
  survey_defined_area: 'Survey-defined area',
  undetermined: 'Not yet determined',
};

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span class="inline-flex flex-col rounded-md border border-[var(--color-border)] px-2 py-1">
      <i class="text-[10px] uppercase tracking-wide not-italic text-[var(--color-muted)]">{label}</i>
      <b class="text-[12px] font-semibold text-[var(--color-text)]">{value}</b>
    </span>
  );
}

export function SubjectUnderstandingPanel({
  view,
  running,
  error,
  onRun,
}: {
  view: SubjectUnderstandingView | null;
  running?: boolean;
  error?: string | null;
  onRun?: () => void;
}) {
  if (!view) return null;
  const subject = view.subject;
  const quoted = view.evidence.filter((fact) => !fact.inferred).length;
  const inferred = view.evidence.length - quoted;
  const acreageProvenance = subject?.provenance?.acres ?? null;

  return (
    <section
      data-testid="subject-understanding"
      data-outcome={view.outcome}
      class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3"
    >
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="text-sm font-semibold text-[var(--color-text)]">Subject understanding</h3>
        <span
          data-testid="subject-understanding-outcome"
          class="rounded-full border border-[var(--color-accent)] px-2 py-[1px] text-[11px] font-semibold text-[var(--color-accent)]"
        >
          {OUTCOME_LABEL[view.outcome]}
        </span>
        <span class="text-[11px] text-[var(--color-muted)]">
          What acquisition interest this lead is about, from the evidence it carries.
        </span>
        {onRun && (
          <button
            type="button"
            data-testid="subject-understanding-run"
            class="ml-auto rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] disabled:opacity-50"
            disabled={running}
            onClick={onRun}
          >
            {running ? 'Reading the lead…' : 'Re-read this lead'}
          </button>
        )}
      </div>

      {error && <p data-testid="subject-understanding-error" class="text-[12px] text-[var(--color-danger,#b91c1c)]">{error}</p>}

      {subject && (
        <div data-testid="subject-understanding-subject" class="rounded-lg border border-[var(--color-accent)] p-3 space-y-2">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            Working acquisition subject · {INTEREST_LABEL[subject.interest.form] ?? subject.interest.form}
          </div>
          <p data-testid="subject-understanding-interest" class="text-[13px] text-[var(--color-text)]">
            {subject.interest.statement}
          </p>
          <div class="flex flex-wrap gap-2">
            <Chip label="Parcel" value={subject.apn ?? subject.lpPropertyId ?? 'not identified'} />
            {subject.acres != null && <Chip label="Acreage" value={`${subject.acres} AC`} />}
            {(subject.county || subject.state) && (
              <Chip label="Jurisdiction" value={[subject.county, subject.state].filter(Boolean).join(', ')} />
            )}
            <Chip label="Confidence" value={`${Math.round(subject.confidence * 100)}%`} />
          </div>
          {subject.apnDisplayVariants.length > 1 && (
            <p data-testid="subject-understanding-apn-variants" class="text-[11px] text-[var(--color-muted)]">
              Written as {subject.apnDisplayVariants.join(' and ')} across the sources. One parcel, not two.
            </p>
          )}
          {acreageProvenance && (
            <p class="text-[11px] text-[var(--color-muted)]">
              Acreage from {acreageProvenance.source}
              {acreageProvenance.locator ? ` · ${acreageProvenance.locator}` : ''}
              {acreageProvenance.inferred ? ' · LandOS reading, not a quoted figure' : ''}
            </p>
          )}
          <div data-testid="subject-understanding-verification" class="rounded-md border border-dashed border-[var(--color-border)] p-2">
            {/* "An official record confirms it" is a claim about a document.
                It is printed only beside the document it can name; otherwise
                the panel says what is actually true — the identity is
                research-grade and official confirmation is still pending. */}
            <div class="text-[11px] font-semibold text-[var(--color-text)]">
              {subject.verification.researchGrade ? 'Research-grade identity established' : 'Identity not yet established'}
              {' · '}
              {subject.verification.officialRecord
                ? `confirmed by ${subject.verification.officialRecord.source}`
                : 'from corroborating operator-supplied and provider evidence. Official parcel-record confirmation remains pending.'}
            </div>
            {subject.verification.officialRecord && (
              <div data-testid="subject-understanding-official-record" class="mt-1 space-y-[2px]">
                <p class="text-[11px] text-[var(--color-muted)]">
                  {subject.verification.officialRecord.source}
                  {' · '}
                  {subject.verification.officialRecord.sourceType.replace(/_/g, ' ')}
                  {subject.verification.officialRecord.recordIdentifier
                    ? ` · ${subject.verification.officialRecord.recordIdentifier}`
                    : ''}
                  {subject.verification.officialRecord.observedAt
                    ? ` · observed ${subject.verification.officialRecord.observedAt}`
                    : ' · observation date not recorded'}
                </p>
                <p class="text-[11px] text-[var(--color-muted)]">
                  Matched {subject.verification.officialRecord.fieldsMatched.join(', ')}.
                  {' '}
                  {subject.verification.officialRecord.qualifies}
                </p>
              </div>
            )}
            <ul class="mt-1 space-y-[2px]">
              {subject.verification.outstanding.map((item) => (
                <li key={item} class="text-[11px] text-[var(--color-muted)]">Still unverified: {item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {view.outcome === 'candidate_set' && view.candidates.length > 0 && (
        <div data-testid="subject-understanding-candidates" class="rounded-lg border border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            {view.candidates.length} credible parcels — none selected
          </div>
          <ol class="mt-1 space-y-1">
            {view.candidates.map((candidate) => (
              <li key={candidate.candidateId} class="text-[12px] text-[var(--color-text)]">
                <span class="font-semibold">{candidate.subject.apn ?? candidate.subject.lpPropertyId ?? 'unnamed record'}</span>
                {' · '}
                <span class="text-[var(--color-muted)]">{candidate.distinguishedBy}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {view.question && (
        <div data-testid="subject-understanding-question" class="rounded-lg border border-[var(--color-accent)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">One answer unblocks this</div>
          <p class="mt-1 text-[13px] font-semibold text-[var(--color-text)]">{view.question.question}</p>
          <p class="mt-1 text-[12px] text-[var(--color-muted)]">{view.question.why}</p>
          <p class="mt-1 text-[12px] text-[var(--color-text)]">{view.question.unblocks}</p>
          {view.question.acceptableAnswers.length > 0 && (
            <ul class="mt-1 space-y-[2px]">
              {view.question.acceptableAnswers.map((answer) => (
                <li key={answer} class="text-[11px] text-[var(--color-muted)]">· {answer}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.conflicts.length > 0 && (
        <div data-testid="subject-understanding-conflicts" class="rounded-lg border border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Disagreements in the evidence</div>
          <ul class="mt-1 space-y-1">
            {view.conflicts.map((conflict) => (
              <li key={conflict.field} class="text-[12px] text-[var(--color-text)]">
                <span class="font-semibold">{conflict.field}</span>
                {' — '}
                {conflict.statements.map((statement) => `${statement.value} (${statement.source})`).join(' vs ')}
                <div class="text-[11px] text-[var(--color-muted)]">
                  {conflict.resolution === 'unresolved' ? 'Unresolved' : 'Resolved by precedence'}
                  {conflict.material ? ' · material to which parcel this is' : ''} · {conflict.reason}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.excludedParcels.length > 0 && (
        <div data-testid="subject-understanding-excluded" class="rounded-lg border border-dashed border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Named by the evidence, not part of this transaction</div>
          <ul class="mt-1 space-y-1">
            {view.excludedParcels.map((parcel) => (
              <li key={parcel.identifier} class="text-[12px] text-[var(--color-text)]">
                <span class="font-semibold">{parcel.identifier}</span>
                <div class="text-[11px] text-[var(--color-muted)]">{parcel.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div data-testid="subject-understanding-audit" class="text-[11px] text-[var(--color-muted)]">
        {view.evidence.length} retained statement{view.evidence.length === 1 ? '' : 's'} read
        {' · '}{quoted} quoted from a source, {inferred} read by LandOS
        {' · '}{view.audit.actionsUsed} of {view.audit.actionLimit} evidence checks used
        {' · '}{view.audit.plannerInvocations} reasoning turn{view.audit.plannerInvocations === 1 ? '' : 's'}
        {' · '}stopped: {view.audit.stopReason.replace(/_/g, ' ')}
        {!view.persistable && ' · the accepted subject changed during this read, so it was not written'}
      </div>
    </section>
  );
}
