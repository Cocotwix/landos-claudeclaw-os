export type GovernmentRecordDomainView =
  | 'deed_ownership'
  | 'surveys_plats'
  | 'recorded_encumbrances'
  | 'property_tax'
  | 'lien_judgment';

export interface GovernmentRecordReadModelView {
  identity: {
    id: number;
    version: number;
    status: string;
    address: string | null;
    county: string | null;
    state: string | null;
    apn: string | null;
  };
  snapshot: {
    id: number;
    version: number;
    identityVersionId: number;
    completeness: {
      identity: 'complete' | 'needs_resolution';
      domains: Record<GovernmentRecordDomainView, 'complete' | 'partial' | 'blocked' | 'missing'>;
      percent: number;
      missing: string[];
    };
    versions: {
      propertyIdentityVersion: number;
      normalizedEvidenceSchema: string;
      artifactSchema: string;
      analystEngine: string;
      snapshotSchema: string;
    };
    analysis: {
      scopeStatement: string;
      recordedOwnershipState: {
        exactVestingLanguage: string[];
        namedOwnershipParties: string[];
        multipleOwners: boolean;
        estateTrustOrEntity: boolean;
        contactOwnerMismatch: boolean;
        contactMismatchEffect: 'research_continues';
      };
      ownershipEvidenceConsistency: string;
      documentCompleteness: {
        status: string;
        retainedArtifactCount: number;
        unavailableReferences: string[];
      };
      surveyPlatAvailability: { status: string; findings: string[] };
      recordedEasementRestrictionFindings: string[];
      titleRiskIndicators: string[];
      taxDelinquencyIndicators: string[];
      lienJudgmentScreeningIndicators: string[];
      materialConflicts: string[];
      missingInstruments: string[];
      propertyResearchQuestions: string[];
      evidenceReferences: Array<{
        evidenceId: number;
        artifactId: number | null;
        artifactPage: number | null;
        sourceName: string;
        sourceUrl: string | null;
        claimKey: string;
      }>;
      limitations: string[];
      confidence: string;
    };
    changeReason: string;
    createdAt: number;
  } | null;
  jobs: Array<{
    id: number;
    collectorKey: GovernmentRecordDomainView;
    status: string;
    attemptCount: number;
    lastError: string | null;
    sourceJurisdiction: string;
    platform: string;
    adapterKey: string;
    cleanupStatus: string | null;
    cleanupError: string | null;
    ownedResourceCount: number;
    openResourceCountAfter: number;
  }>;
  artifacts: Array<{
    id: number;
    domain: GovernmentRecordDomainView;
    sourceJurisdiction: string;
    sourceName: string;
    sourceUrl: string | null;
    portalReference: string | null;
    instrumentNumber: string | null;
    bookPage: string | null;
    parcelReference: string | null;
    accountReference: string | null;
    recordingFilingDate: string | null;
    documentType: string;
    pageCount: number;
    captureCount: number;
    artifactHash: string;
    mimeType: string;
    displayName: string;
    retrievedAt: string;
  }>;
  evidenceCount: number;
  corrections: Array<{
    id: number;
    status: string;
    reason: string;
    approvalId: number;
    priorIdentityVersionId: number;
    replacementIdentityVersionId: number | null;
    declaredInvalidations: string[];
  }>;
}

const DOMAIN_LABEL: Record<GovernmentRecordDomainView, string> = {
  deed_ownership: 'Deed & ownership',
  surveys_plats: 'Surveys & plats',
  recorded_encumbrances: 'Recorded encumbrances',
  property_tax: 'Property tax',
  lien_judgment: 'Liens & judgments',
};

const pretty = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function FindingList({ title, rows, empty }: { title: string; rows: string[]; empty: string }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] p-3">
      <div class="text-[11px] font-semibold">{title}</div>
      {rows.length ? (
        <ul class="mt-1.5 space-y-1">
          {rows.map((row, index) => (
            <li key={`${title}-${index}`} class="pl-3 relative text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              <span class="absolute left-0 top-[7px] h-1 w-1 rounded-full bg-[var(--color-text-faint)]" />
              {row}
            </li>
          ))}
        </ul>
      ) : (
        <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">{empty}</div>
      )}
    </div>
  );
}

export function GovernmentRecordsSnapshotPanel(props: {
  dealId: number;
  token: string;
  value: GovernmentRecordReadModelView | null;
  loading: boolean;
  rebuilding: boolean;
  error: string | null;
  onRebuild: () => void;
}) {
  const snapshot = props.value?.snapshot ?? null;
  const analysis = snapshot?.analysis ?? null;
  return (
    <section data-testid="government-records-snapshot" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-4">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
              Recorded Government Evidence
            </h3>
            {snapshot && (
              <>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">Snapshot v{snapshot.version}</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">Identity v{snapshot.versions.propertyIdentityVersion}</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">{snapshot.completeness.percent}% screened</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">Confidence: {analysis?.confidence}</span>
              </>
            )}
          </div>
          <p class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            {props.loading
              ? 'Loading the saved government-record snapshot...'
              : analysis?.scopeStatement ?? 'No versioned government-record screening snapshot exists yet. Build it from official outcomes and retained documents already saved for this property.'}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onRebuild}
          disabled={props.loading || props.rebuilding}
          class="shrink-0 rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {props.rebuilding ? 'Building...' : snapshot ? 'Refresh screening' : 'Build screening'}
        </button>
      </div>

      {props.error && (
        <div class="rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[11px] text-[var(--color-status-failed)]">{props.error}</div>
      )}

      {snapshot && (
        <>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(Object.keys(DOMAIN_LABEL) as GovernmentRecordDomainView[]).map((domain) => {
              const job = props.value?.jobs.find((candidate) => candidate.collectorKey === domain);
              const state = snapshot.completeness.domains[domain];
              return (
                <div key={domain} class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
                  <div class="text-[10px] font-semibold">{DOMAIN_LABEL[domain]}</div>
                  <div class="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{pretty(state)}</div>
                  <div class="mt-1 text-[9px] text-[var(--color-text-faint)]">
                    {job ? `${job.attemptCount} attempt${job.attemptCount === 1 ? '' : 's'}` : 'No job'}
                    {job?.cleanupStatus === 'succeeded' ? ' · browser cleaned' : ''}
                  </div>
                  {job?.lastError && <div class="mt-1 text-[9px] leading-snug text-[var(--color-status-warn,var(--color-text-muted))]">{job.lastError}</div>}
                </div>
              );
            })}
          </div>

          {analysis && (
            <>
              <div class="rounded-md border border-[var(--color-border)] p-3 space-y-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-[11px] font-semibold">Recorded ownership</div>
                  <span class="text-[10px] text-[var(--color-text-muted)]">{pretty(analysis.ownershipEvidenceConsistency)}</span>
                </div>
                <div class="text-[11px] text-[var(--color-text-muted)]">
                  {analysis.recordedOwnershipState.namedOwnershipParties.length
                    ? analysis.recordedOwnershipState.namedOwnershipParties.join('; ')
                    : 'No named recorded ownership party has been normalized yet.'}
                </div>
                {analysis.recordedOwnershipState.exactVestingLanguage.map((vesting, index) => (
                  <div key={index} class="rounded bg-[var(--color-elevated)] px-2 py-1.5 text-[10px] leading-relaxed">{vesting}</div>
                ))}
                {analysis.recordedOwnershipState.contactOwnerMismatch && (
                  <div data-testid="contact-owner-mismatch-continues" class="text-[10px] text-[var(--color-text-muted)]">
                    Lead/contact name differs from the recorded owner. Property research continued normally; seller authority is handled outside this screening.
                  </div>
                )}
              </div>

              <div class="grid gap-2 md:grid-cols-2">
                <FindingList title="Survey & plat availability" rows={analysis.surveyPlatAvailability.findings} empty={`Status: ${pretty(analysis.surveyPlatAvailability.status)}. This does not prove a survey or plat does not exist.`} />
                <FindingList title="Recorded easements & restrictions" rows={analysis.recordedEasementRestrictionFindings} empty="No matching instrument was normalized from the official sources searched. This is not a statement that no encumbrance exists." />
                <FindingList title="Title-risk indicators" rows={analysis.titleRiskIndicators} empty="No title-risk indicator was directly located in the normalized evidence." />
                <FindingList title="Tax delinquency indicators" rows={analysis.taxDelinquencyIndicators} empty="No delinquency indicator was directly located in the normalized tax evidence." />
                <FindingList title="Lien & judgment screening" rows={analysis.lienJudgmentScreeningIndicators} empty="No matching lien or judgment result was normalized from the official sources searched." />
                <FindingList title="Material conflicts" rows={analysis.materialConflicts} empty="No material conflict is present in the saved normalized evidence." />
                <FindingList title="Missing instruments" rows={analysis.missingInstruments} empty="No referenced-but-unavailable instrument is recorded in this snapshot." />
                <FindingList title="Property research questions" rows={analysis.propertyResearchQuestions} empty="No additional question was generated from the saved evidence." />
              </div>
            </>
          )}

          {(props.value?.artifacts.length ?? 0) > 0 && (
            <div class="space-y-2">
              <div class="text-[11px] font-semibold">Retained official documents and page captures</div>
              <div class="grid gap-3 md:grid-cols-2">
                {props.value!.artifacts.map((artifact) => {
                  const firstPage = `/api/landos/deal-cards/${props.dealId}/government-records/artifacts/${artifact.id}/page/1?token=${encodeURIComponent(props.token)}`;
                  return (
                    <div key={artifact.id} data-testid="government-record-artifact" class="rounded-md border border-[var(--color-border)] p-3">
                      <div class="flex items-start gap-3">
                        {artifact.captureCount > 0 && artifact.mimeType.startsWith('image/') && (
                          <a href={firstPage} target="_blank" rel="noreferrer" class="shrink-0">
                            <img src={firstPage} alt={`First page of ${artifact.displayName}`} class="h-24 w-20 rounded border border-[var(--color-border)] object-cover object-top" />
                          </a>
                        )}
                        <div class="min-w-0">
                          <div class="text-[11px] font-semibold">{artifact.displayName}</div>
                          <div class="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{artifact.documentType} · {DOMAIN_LABEL[artifact.domain]}</div>
                          <div class="mt-1 text-[9px] text-[var(--color-text-faint)]">
                            {artifact.instrumentNumber ? `Instrument ${artifact.instrumentNumber} · ` : ''}
                            {artifact.bookPage ? `${artifact.bookPage} · ` : ''}
                            {artifact.pageCount} page{artifact.pageCount === 1 ? '' : 's'} · SHA-256 {artifact.artifactHash.slice(0, 12)}...
                          </div>
                          <div class="mt-2 flex flex-wrap gap-2">
                            {artifact.captureCount > 0 && <a href={firstPage} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">Open retained pages</a>}
                            {artifact.sourceUrl && <a href={artifact.sourceUrl} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">Official source</a>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <div class="text-[10px] font-semibold">Limitations</div>
            <ul class="mt-1 space-y-1">
              {(analysis?.limitations ?? []).map((limitation, index) => (
                <li key={index} class="text-[10px] leading-relaxed text-[var(--color-text-muted)]">{limitation}</li>
              ))}
            </ul>
            <div class="mt-2 text-[9px] text-[var(--color-text-faint)]">
              {props.value?.evidenceCount ?? 0} append-only evidence items · {props.value?.artifacts.length ?? 0} retained artifacts · Analyst {snapshot.versions.analystEngine}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
