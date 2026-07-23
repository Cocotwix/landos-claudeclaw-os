export interface PropertySummaryReadModelView {
  identity: {
    id: number;
    version: number;
    status: 'unresolved' | 'candidate' | 'confirmed' | 'disputed' | 'rejected' | 'archived';
    basis: string;
    confidence: number;
  };
  assessorGisJob: {
    id: number;
    status: 'queued' | 'running' | 'succeeded' | 'partial' | 'blocked' | 'failed';
    attemptCount: number;
    lastError: string | null;
  } | null;
  snapshot: {
    id: number;
    version: number;
    identityVersionId: number;
    completeness: {
      identity: 'complete' | 'needs_resolution';
      assessorGis: 'complete' | 'partial' | 'missing' | 'blocked';
      percent: number;
      missing: string[];
    };
    summary: {
      state: 'ready' | 'partial' | 'resolution_required';
      parcelSpecificAllowed: boolean;
      areaContext: {
        address: string | null;
        city: string | null;
        county: string | null;
        state: string | null;
        zip: string | null;
      };
      property: {
        address: string | null;
        city: string | null;
        county: string | null;
        state: string | null;
        zip: string | null;
        apn: string | null;
        owner: string | null;
        acreage: number | null;
      } | null;
      facts: Array<{
        key: string;
        value: unknown;
        evidenceId: number;
        sourceName: string;
        sourceUrl: string | null;
        verificationStatus: string;
        retrievedAt: string;
      }>;
      evidenceCount: number;
      message: string;
    };
    changeReason: string;
    createdAt: number;
  } | null;
  evidenceCount: number;
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  return value == null ? 'Not captured' : JSON.stringify(value);
}

function contextLine(context: NonNullable<PropertySummaryReadModelView['snapshot']>['summary']['areaContext']): string {
  return [context.address, context.city, context.county, context.state, context.zip].filter(Boolean).join(', ');
}

export function PropertySummarySnapshotPanel(props: {
  value: PropertySummaryReadModelView | null;
  loading: boolean;
  rebuilding: boolean;
  error: string | null;
  onRebuild: () => void;
}) {
  const snapshot = props.value?.snapshot ?? null;
  const unresolved = snapshot?.summary.parcelSpecificAllowed === false;
  const property = snapshot?.summary.property ?? null;
  const statusTone = unresolved
    ? 'border-[var(--color-status-warn,var(--color-border))]'
    : snapshot?.summary.state === 'ready'
      ? 'border-[var(--color-status-done,var(--color-border))]'
      : 'border-[var(--color-border)]';

  return (
    <section data-testid="property-summary-snapshot" class={`rounded-lg border ${statusTone} bg-[var(--color-card)] p-4 space-y-3`}>
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
              Versioned Property Summary
            </h3>
            {snapshot && (
              <>
                <span class="text-[10px] rounded-full border border-[var(--color-border)] px-1.5 py-0.5">
                  Snapshot v{snapshot.version}
                </span>
                <span class="text-[10px] rounded-full border border-[var(--color-border)] px-1.5 py-0.5">
                  Identity v{props.value?.identity.version}
                </span>
                <span class="text-[10px] rounded-full border border-[var(--color-border)] px-1.5 py-0.5">
                  {snapshot.completeness.percent}% complete
                </span>
              </>
            )}
          </div>
          <p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            {props.loading
              ? 'Loading the saved Property Summary…'
              : snapshot?.summary.message ?? 'No versioned Property Summary exists yet. Build it from the identity and evidence already saved on this Deal Card.'}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onRebuild}
          disabled={props.loading || props.rebuilding}
          class="shrink-0 rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {props.rebuilding ? 'Building…' : snapshot ? 'Refresh summary' : 'Build summary'}
        </button>
      </div>

      {props.error && (
        <div class="rounded-md border border-[var(--color-status-failed)] px-3 py-2 text-[11px] text-[var(--color-status-failed)]">
          {props.error}
        </div>
      )}

      {snapshot && unresolved && (
        <div data-testid="property-summary-resolution-required" class="rounded-md border border-[var(--color-status-warn,var(--color-border))] bg-[var(--color-elevated)] p-3 space-y-1">
          <div class="text-[12px] font-semibold">Resolution required</div>
          <div class="text-[11px] text-[var(--color-text-muted)]">
            {contextLine(snapshot.summary.areaContext) || 'The intake location is retained, but the parcel has not been established.'}
          </div>
          <div class="text-[11px] text-[var(--color-text-muted)]">
            Parcel-specific aerials, ranked comparables, value, and strategy remain withheld.
          </div>
          {props.value?.identity.status === 'disputed' && (
            <div class="text-[11px] text-[var(--color-status-failed)]">
              Conflicting identity records require operator review.
            </div>
          )}
        </div>
      )}

      {snapshot && !unresolved && property && (
        <>
          <div data-testid="property-summary-confirmed" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Address', property.address],
              ['APN / Parcel ID', property.apn],
              ['Owner', property.owner],
              ['Acreage', property.acreage == null ? null : `${property.acreage.toLocaleString()} ac`],
            ].map(([title, value]) => (
              <div key={title} class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
                <div class="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{title}</div>
                <div class="mt-0.5 break-words text-[11px] font-medium">{value || 'Not captured'}</div>
              </div>
            ))}
          </div>
          <div class="flex flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]">
            <span>Assessor/GIS: {label(snapshot.completeness.assessorGis)}</span>
            <span>•</span>
            <span>{snapshot.summary.evidenceCount} immutable evidence item{snapshot.summary.evidenceCount === 1 ? '' : 's'}</span>
            <span>•</span>
            <span>Collector attempts: {props.value?.assessorGisJob?.attemptCount ?? 0}</span>
          </div>
          {snapshot.summary.facts.length > 0 && (
            <div class="grid gap-2 md:grid-cols-2">
              {snapshot.summary.facts.slice(0, 6).map((fact) => (
                <div key={fact.evidenceId} class="rounded-md border border-[var(--color-border)] px-2.5 py-2">
                  <div class="text-[10px] font-semibold">{fact.key}</div>
                  <div class="text-[11px] text-[var(--color-text-muted)]">{displayValue(fact.value)}</div>
                  <div class="mt-1 text-[9px] text-[var(--color-text-faint)]">
                    Evidence #{fact.evidenceId} ·{' '}
                    {fact.sourceUrl ? (
                      <a
                        href={fact.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        class="text-[var(--color-accent)] hover:underline"
                      >
                        {fact.sourceName}
                      </a>
                    ) : fact.sourceName}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {snapshot && snapshot.completeness.missing.length > 0 && !unresolved && (
        <div class="text-[10px] text-[var(--color-text-muted)]">
          Missing: {snapshot.completeness.missing.join('; ')}
        </div>
      )}
    </section>
  );
}
