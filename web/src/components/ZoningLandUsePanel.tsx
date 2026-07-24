export type ZoningDomainView =
  | 'jurisdiction_authority'
  | 'zoning_district'
  | 'zoning_ordinance'
  | 'permitted_uses'
  | 'dimensional_standards';

interface ZoningCitationView {
  ordinanceTitle?: string | null;
  adoptedOrEffectiveDate?: string | null;
  article?: string | null;
  section?: string | null;
  table?: string | null;
  page?: string | null;
  mapReference?: string | null;
}

interface ZoningUseFindingView {
  useName: string;
  category: string;
  exactWording: string;
  citation: ZoningCitationView | null;
  sourceName: string;
  sourceUrl: string | null;
  evidenceId: number;
}

export interface ZoningLandUseReadModelView {
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
      domains: Record<ZoningDomainView, string>;
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
      jurisdiction: {
        determination: string;
        incorporationStatus: string;
        controllingAuthorityName: string | null;
        controllingAuthorityLevel: string;
        officialBoundaryEvidence: boolean;
        mailingCityDiffersFromAuthority: boolean;
        candidateAuthoritiesConsidered: string[];
        basis: string;
      };
      baseZoning: {
        status: string;
        districtCode: string | null;
        districtName: string | null;
        officialMapConfirmed: boolean;
        thirdPartyReportsOnly: boolean;
        interpretationAllowed: boolean;
        conflicts: string[];
      };
      overlays: Array<{ name: string; kind: string; officiallyConfirmed: boolean; sourceName: string; evidenceId: number }>;
      ordinance: {
        status: string;
        title: string | null;
        adoptedOrEffectiveDate: string | null;
        sourceUrl: string | null;
      };
      usesByRight: ZoningUseFindingView[];
      conditionalOrSpecialUses: ZoningUseFindingView[];
      accessoryUses: ZoningUseFindingView[];
      prohibitedUses: ZoningUseFindingView[];
      usesNotLocated: ZoningUseFindingView[];
      uncertainUses: ZoningUseFindingView[];
      dimensionalStandards: Array<{
        standardName: string;
        value: string;
        districtCode: string | null;
        citation: ZoningCitationView | null;
        sourceName: string;
        sourceUrl: string | null;
        evidenceId: number;
      }>;
      subdivisionAndDevelopmentImplications: string[];
      likelyUsePathsSupportedByZoning: string[];
      materialConflicts: string[];
      risks: string[];
      missingInformation: string[];
      followUpQuestions: string[];
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
    collectorKey: ZoningDomainView;
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
  domainStates: Record<ZoningDomainView, string>;
  artifacts: Array<{
    id: number;
    domain: ZoningDomainView;
    sourceJurisdiction: string;
    authorityName: string | null;
    sourceName: string;
    sourceUrl: string | null;
    portalReference: string | null;
    ordinanceTitle: string | null;
    ordinanceEffectiveDate: string | null;
    sectionReference: string | null;
    districtReference: string | null;
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
    domain: ZoningDomainView;
    reason: string;
    requestedBy: string;
    declaredInvalidations: string[];
  }>;
}

const DOMAIN_LABEL: Record<ZoningDomainView, string> = {
  jurisdiction_authority: 'Jurisdiction & authority',
  zoning_district: 'District & overlays',
  zoning_ordinance: 'Governing ordinance',
  permitted_uses: 'Use permissions',
  dimensional_standards: 'Dimensional standards',
};

const pretty = (value: string): string => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function citationText(citation: ZoningCitationView | null | undefined): string {
  if (!citation) return '';
  return [citation.ordinanceTitle, citation.article, citation.section, citation.table, citation.page ? `p. ${citation.page}` : null]
    .filter(Boolean)
    .join(' · ');
}

function UseList({ title, testId, uses, empty, tone }: {
  title: string;
  testId: string;
  uses: ZoningUseFindingView[];
  empty: string;
  tone?: 'accent' | 'warn';
}) {
  return (
    <div data-testid={testId} class="rounded-md border border-[var(--color-border)] p-3">
      <div class={`text-[11px] font-semibold ${tone === 'warn' ? 'text-[var(--color-status-warn,var(--color-text))]' : ''}`}>{title}</div>
      {uses.length ? (
        <ul class="mt-1.5 space-y-1.5">
          {uses.map((use, index) => (
            <li key={`${testId}-${index}`} class="text-[11px] leading-relaxed">
              <span class="text-[var(--color-text)]">{use.useName}</span>
              {citationText(use.citation) && (
                <span class="ml-1 text-[10px] text-[var(--color-text-faint)]">({citationText(use.citation)})</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">{empty}</div>
      )}
    </div>
  );
}

function BulletList({ title, rows, empty }: { title: string; rows: string[]; empty: string }) {
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

export function ZoningLandUsePanel(props: {
  dealId: number;
  token: string;
  value: ZoningLandUseReadModelView | null;
  loading: boolean;
  rebuilding: boolean;
  error: string | null;
  onRebuild: () => void;
}) {
  const snapshot = props.value?.snapshot ?? null;
  const analysis = snapshot?.analysis ?? null;
  const jurisdiction = analysis?.jurisdiction ?? null;
  const baseZoning = analysis?.baseZoning ?? null;
  return (
    <section data-testid="zoning-land-use-panel" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-4">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
              Zoning & Land Use
            </h3>
            {snapshot && (
              <>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">Snapshot v{snapshot.version}</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">Identity v{snapshot.versions.propertyIdentityVersion}</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">{snapshot.completeness.percent}% researched</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">Confidence: {analysis?.confidence}</span>
                <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]" data-testid="zoning-last-researched">
                  Researched {new Date(snapshot.createdAt * 1000).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
          <p class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            {props.loading
              ? 'Loading the saved zoning and land-use snapshot...'
              : analysis?.scopeStatement ?? 'No zoning and land-use research has been persisted yet. Research runs only on your explicit command; opening this card never triggers it.'}
          </p>
        </div>
        <button
          type="button"
          data-testid="zoning-rebuild"
          onClick={props.onRebuild}
          disabled={props.loading || props.rebuilding}
          class="shrink-0 rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {props.rebuilding ? 'Researching...' : snapshot ? 'Refresh zoning research' : 'Research zoning'}
        </button>
      </div>

      {props.error && (
        <div class="rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[11px] text-[var(--color-status-failed)]">{props.error}</div>
      )}

      {snapshot && (
        <>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {(Object.keys(DOMAIN_LABEL) as ZoningDomainView[]).map((domain) => {
              const job = props.value?.jobs.find((candidate) => candidate.collectorKey === domain);
              const state = snapshot.completeness.domains[domain] ?? 'queued';
              return (
                <div key={domain} class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
                  <div class="text-[10px] font-semibold">{DOMAIN_LABEL[domain]}</div>
                  <div class="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{pretty(state)}</div>
                  <div class="mt-1 text-[9px] text-[var(--color-text-faint)]">
                    {job ? `${job.attemptCount} attempt${job.attemptCount === 1 ? '' : 's'}` : 'No job'}
                    {job?.cleanupStatus === 'succeeded' ? ' · browser cleaned' : ''}
                  </div>
                  {job?.lastError && <div class="mt-1 text-[9px] leading-snug text-[var(--color-text-muted)]">{job.lastError}</div>}
                </div>
              );
            })}
          </div>

          {jurisdiction && (
            <div data-testid="zoning-jurisdiction" class="rounded-md border border-[var(--color-border)] p-3 space-y-1.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-[11px] font-semibold">Controlling zoning authority</div>
                <span class="text-[10px] text-[var(--color-text-muted)]">{pretty(jurisdiction.determination)}</span>
              </div>
              <div class="text-[12px]">
                {jurisdiction.controllingAuthorityName ?? 'Not yet determined'}
                {jurisdiction.controllingAuthorityName && (
                  <span class="ml-1 text-[10px] text-[var(--color-text-muted)]">({pretty(jurisdiction.controllingAuthorityLevel)})</span>
                )}
              </div>
              <div class="text-[11px] text-[var(--color-text-muted)]">{pretty(jurisdiction.incorporationStatus)}</div>
              {jurisdiction.mailingCityDiffersFromAuthority && (
                <div data-testid="zoning-mailing-city-differs" class="text-[10px] text-[var(--color-text-muted)]">
                  The mailing city differs from the governing zoning authority; the mailing label was never used in this determination.
                </div>
              )}
              <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">{jurisdiction.basis}</div>
            </div>
          )}

          {baseZoning && (
            <div data-testid="zoning-base-district" class="rounded-md border border-[var(--color-border)] p-3 space-y-1.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-[11px] font-semibold">Base zoning district</div>
                <span class="text-[10px] text-[var(--color-text-muted)]">{pretty(baseZoning.status)}</span>
              </div>
              <div class="text-[12px]">
                {baseZoning.districtCode ?? 'Not yet determined'}
                {baseZoning.districtName && <span class="ml-1 text-[11px] text-[var(--color-text-muted)]">— {baseZoning.districtName}</span>}
              </div>
              <div class="flex flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]">
                {baseZoning.officialMapConfirmed && <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5">Official map confirmed</span>}
                {baseZoning.thirdPartyReportsOnly && <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5">Third-party report only — not official</span>}
                {!baseZoning.interpretationAllowed && (baseZoning.districtCode || baseZoning.districtName) && (
                  <span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5">Label not interpreted until jurisdiction + ordinance are confirmed</span>
                )}
              </div>
              <div data-testid="zoning-overlays" class="mt-1 space-y-1">
                <div class="text-[10px] font-semibold">Overlay & special districts</div>
                {(analysis?.overlays.length ?? 0) > 0 ? (
                  analysis!.overlays.map((overlay, index) => (
                    <div key={index} class="text-[11px] text-[var(--color-text-muted)]">
                      {overlay.name}
                      <span class="ml-1 text-[10px] text-[var(--color-text-faint)]">
                        ({overlay.officiallyConfirmed ? 'official' : 'unconfirmed'} · {overlay.sourceName})
                      </span>
                    </div>
                  ))
                ) : (
                  <div class="text-[11px] text-[var(--color-text-faint)]">
                    No overlay or special district was located on the official overlay layers searched. This reflects only the sources searched, not a guarantee that no overlay exists.
                  </div>
                )}
              </div>
            </div>
          )}

          {analysis && (
            <div data-testid="zoning-ordinance" class="rounded-md border border-[var(--color-border)] p-3 space-y-1">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-[11px] font-semibold">Governing ordinance</div>
                <span class="text-[10px] text-[var(--color-text-muted)]">{pretty(analysis.ordinance.status)}</span>
              </div>
              <div class="text-[11px]">
                {analysis.ordinance.title ?? 'Not yet identified'}
                {analysis.ordinance.adoptedOrEffectiveDate && (
                  <span class="ml-1 text-[10px] text-[var(--color-text-muted)]">(adopted/effective {analysis.ordinance.adoptedOrEffectiveDate})</span>
                )}
              </div>
              {analysis.ordinance.sourceUrl && (
                <a href={analysis.ordinance.sourceUrl} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">Official ordinance source</a>
              )}
            </div>
          )}

          {analysis && (
            <div class="grid gap-2 md:grid-cols-2">
              <UseList
                title="Uses permitted by right"
                testId="zoning-uses-by-right"
                uses={analysis.usesByRight}
                empty="No by-right use has been extracted from the retrieved governing ordinance yet. Absence here is never a statement that a use is allowed or prohibited."
              />
              <UseList
                title="Conditional / special-approval uses"
                testId="zoning-uses-conditional"
                uses={analysis.conditionalOrSpecialUses}
                empty="No conditional or special-exception use has been extracted from the retrieved governing ordinance yet."
              />
              <UseList
                title="Prohibited uses"
                testId="zoning-uses-prohibited"
                uses={analysis.prohibitedUses}
                empty="No prohibited use has been extracted. A use missing from this list is not thereby allowed."
                tone="warn"
              />
              <UseList
                title="Uncertain / provision unavailable"
                testId="zoning-uses-uncertain"
                uses={[...analysis.uncertainUses, ...analysis.usesNotLocated]}
                empty="No use is currently in an uncertain state."
              />
            </div>
          )}

          {analysis && (
            <div data-testid="zoning-dimensional" class="rounded-md border border-[var(--color-border)] p-3">
              <div class="text-[11px] font-semibold">Key dimensional & development standards</div>
              {analysis.dimensionalStandards.length ? (
                <table class="mt-1.5 w-full text-[11px]">
                  <tbody>
                    {analysis.dimensionalStandards.map((standard, index) => (
                      <tr key={index} class="border-t border-[var(--color-border)] first:border-t-0">
                        <td class="py-1 pr-2 text-[var(--color-text-muted)]">{standard.standardName}</td>
                        <td class="py-1 pr-2">{standard.value}</td>
                        <td class="py-1 text-[10px] text-[var(--color-text-faint)]">{citationText(standard.citation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">
                  No dimensional standard has been extracted from the governing ordinance's district table yet.
                </div>
              )}
            </div>
          )}

          {analysis && (
            <div class="grid gap-2 md:grid-cols-2">
              <BulletList title="Development implications" rows={[...analysis.subdivisionAndDevelopmentImplications, ...analysis.likelyUsePathsSupportedByZoning]} empty="No development implication is supported by the persisted evidence yet." />
              <BulletList title="Risks & conflicts" rows={[...analysis.risks, ...analysis.materialConflicts]} empty="No zoning risk or source conflict is present in the persisted evidence." />
              <BulletList title="Missing evidence" rows={analysis.missingInformation} empty="No missing item is recorded." />
              <BulletList title="Follow-up questions" rows={analysis.followUpQuestions} empty="No follow-up question was generated." />
            </div>
          )}

          {(props.value?.artifacts.length ?? 0) > 0 && (
            <div class="space-y-2">
              <div class="text-[11px] font-semibold">Official sources & retained evidence</div>
              <div class="grid gap-3 md:grid-cols-2">
                {props.value!.artifacts.map((artifact) => {
                  const firstPage = `/api/landos/deal-cards/${props.dealId}/zoning-land-use/artifacts/${artifact.id}/page/1?token=${encodeURIComponent(props.token)}`;
                  return (
                    <div key={artifact.id} data-testid="zoning-artifact" class="rounded-md border border-[var(--color-border)] p-3">
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
                            {artifact.ordinanceTitle ? `${artifact.ordinanceTitle} · ` : ''}
                            {artifact.sectionReference ? `${artifact.sectionReference} · ` : ''}
                            SHA-256 {artifact.artifactHash.slice(0, 12)}...
                          </div>
                          <div class="mt-2 flex flex-wrap gap-2">
                            {artifact.captureCount > 0 && <a href={firstPage} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">Open retained capture</a>}
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
