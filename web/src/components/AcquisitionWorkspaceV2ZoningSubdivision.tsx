// Acquisition Workspace V2 — Deal Card → Zoning & Subdivision Capability.
//
// The same LandOS Capability that Tools and New Lead invoke, run against the
// subject this Deal Card ALREADY has. It answers the LOCATION question: which
// government controls this parcel, what district it is in, what the
// jurisdiction's zoning and subdivision rules require, and what the
// deterministic subdivision-by-right result is. It never resolves, replaces or
// reassigns property identity.
//
// Two rendering rules carry the panel's honesty:
//   1. The by-right result renders its STATUS, never a bare lot count. A number
//      with no status beside it reads as an entitlement, and it is not one.
//   2. Every rule row renders either the rule or the named unresolved reason,
//      and the official source stays one click away.
import { useState } from 'preact/hooks';

import { apiPost } from '@/lib/api';

interface ZoningSubdivisionRunResult {
  invocationId: string;
  subjectResolution: string;
  facts: {
    lane?: string;
    outcome?: string;
    summary?: string;
    jurisdiction?: {
      county?: string | null; state?: string | null; municipality?: string | null;
      incorporationStatus?: string | null;
      authorities?: Array<{ role: string; name: string | null; level: string | null; determination: string; basis: string | null }>;
      rulePackageKey?: string | null;
      rulePackageReused?: boolean;
      retainedJurisdictionDocuments?: Array<{ label: string; url: string }>;
    };
    zoning?: {
      established?: boolean; districtCode?: string | null; districtName?: string | null;
      statement?: string; confidence?: string; governingAuthority?: string | null;
      nonZoningClassification?: { code: string; description: string | null; sourceUrl: string | null } | null;
      historicalReferences?: Array<{ kind: string; value: string | null; asOf: string | null; sourceUrl: string | null }>;
    };
    rules?: {
      count?: number; documentCount?: number; ordinanceLabel?: string | null; ordinanceUrl?: string | null;
      package?: Array<{ key: string; label: string; value: string | null; unresolved: string | null; section: string | null; sourceUrl: string | null; confidence: string }>;
    };
    subdivisionByRight?: {
      status?: string; statusLabel?: string; maximumLots?: number | null;
      path?: string | null; reviewBody?: string | null; basis?: string;
      calculation?: string | null; reason?: string;
      constraintsApplied?: Array<{ constraint: string; value: string; source: string }>;
      missingInputs?: string[];
      approvedYield?: boolean;
    };
    zoningAllowances?: Array<{ label: string; detail: string; sourceUrl: string | null }>;
    zoningRestrictions?: Array<{ label: string; detail: string; sourceUrl: string | null }>;
    manufacturedHousing?: {
      established?: boolean;
      overallStatus?: string | null;
      overallStatement?: string;
      byType?: Array<{
        structureType: string; label: string; status: string; statusLabel: string; established: boolean;
        reasoning: string; unresolvedReason: string | null;
        conditions: Array<{ kind: string; label: string; requirement: string; sourceUrl: string | null; section: string | null }>;
        statePreemption: { effect: string; statement: string; interaction: string } | null;
        sourceUrl: string | null;
      }>;
    };
    frontageScreening?: {
      status?: string;
      subjectFrontageFt?: number | null; subjectFrontageSource?: string | null;
      minimumFrontageFt?: number | null; minimumFrontageSource?: string | null;
      directFrontageLots?: number | null; legalMaximumLots?: number | null;
      frontageIsLimiting?: boolean; statement?: string;
    };
    privateRoadScreening?: {
      applicable?: boolean; statement?: string;
      rules?: Array<{ key: string; label: string; value: string | null; unresolved: string | null; sourceUrl: string | null }>;
    };
    sources?: Array<{ title: string; sourceType: string; url: string | null; jurisdiction: string | null; date: string | null; section: string | null }>;
    limitations?: string[];
  };
  warnings: string[];
  missingInformation: string[];
  execution: { mode: string; reused: boolean; durationMs: number };
}

const ZS_OUTCOME_LABEL: Record<string, string> = {
  rules_returned: 'Land-use rules returned',
  lane_completed: 'Research lane completed',
  retained_only: 'Retained land-use record only',
  not_available: 'No land-use rules established',
};

function ZsRow({ k, v }: { k: string; v: string | null }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">Not established</span>}
    </>
  );
}

export function ZoningSubdivisionCapabilityRun({ dealId }: { dealId?: number }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ZoningSubdivisionRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!dealId) return null;

  const invoke = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: ZoningSubdivisionRunResult }>(
        `/api/landos/deal-cards/${dealId}/zoning-subdivision/capability`,
        { refresh: true },
      );
      setResult(response.result);
    } catch (caught) {
      setError((caught as Error)?.message ?? 'Zoning & Subdivision could not run.');
    } finally {
      setRunning(false);
    }
  };

  const facts = result?.facts ?? {};
  const jurisdiction = facts.jurisdiction ?? {};
  const zoning = facts.zoning ?? {};
  const rules = facts.rules ?? {};
  const byRight = facts.subdivisionByRight ?? {};
  const allowances = facts.zoningAllowances ?? [];
  const restrictions = facts.zoningRestrictions ?? [];
  const manufactured = facts.manufacturedHousing ?? {};
  const frontage = facts.frontageScreening ?? {};
  const privateRoad = facts.privateRoadScreening ?? {};

  return (
    <div class="awv2-pi-note awv2-zoning-subdivision-run" data-testid="awv2-zoning-subdivision-run">
      <button
        type="button"
        data-testid="awv2-zoning-subdivision-run-button"
        disabled={running}
        onClick={() => { void invoke(); }}
      >
        {running ? 'Researching the land-use rules…' : 'Run Zoning & Subdivision'}
      </button>
      {' '}Establishes the controlling jurisdiction and reads its zoning and subdivision rules for this
      Deal Card&apos;s existing canonical parcel through the shared LandOS Capability, then applies those
      rules to the parcel. It never changes which parcel this card is about.
      {error && <div class="awv2-pi-note" role="alert">{error}</div>}
      {result && (
        <div class="awv2-zoning-subdivision-run-result" data-testid="awv2-zoning-subdivision-run-result">
          <div>
            <b>{ZS_OUTCOME_LABEL[String(facts.outcome)] ?? String(facts.outcome ?? 'No result')}</b>
            {' '}· subject {result.subjectResolution}
          </div>
          <div class="awv2-kv">
            <ZsRow k="Zoning district" v={zoning.established ? zoning.districtCode ?? null : null} />
            <ZsRow k="Zoning authority" v={zoning.governingAuthority ?? null} />
            <ZsRow k="Jurisdiction" v={[jurisdiction.municipality, jurisdiction.county, jurisdiction.state].filter(Boolean).join(', ') || null} />
            <ZsRow k="Rules retained" v={rules.count ? `${rules.count} rule(s) from ${rules.documentCount ?? 0} official document(s)` : null} />
          </div>
          {/* The by-right STATUS leads. A lot count never appears without it. */}
          <div data-testid="awv2-zoning-subdivision-run-by-right">
            <b>Subdivision by right: {byRight.statusLabel ?? byRight.status ?? 'Unresolved'}</b>
            {byRight.maximumLots != null && ` — up to ${byRight.maximumLots} lot(s)`}
            {byRight.path ? ` · path ${String(byRight.path).replace(/_/g, ' ')}` : ''}
            {byRight.reviewBody ? ` · reviewed by ${byRight.reviewBody}` : ''}
            {byRight.reason && <div>{byRight.reason}</div>}
            {byRight.calculation && <div>{byRight.calculation}</div>}
            {!!byRight.constraintsApplied?.length && (
              <div>
                <b>Constraints applied:</b>{' '}
                {byRight.constraintsApplied.map((row) => `${row.constraint} = ${row.value}`).join('; ')}
              </div>
            )}
            {!!byRight.missingInputs?.length && (
              <div data-testid="awv2-zoning-subdivision-run-missing">
                <b>Missing for a firm result:</b> {byRight.missingInputs.join('; ')}
              </div>
            )}
          </div>
          {/* Existing frontage is evaluated BEFORE any private-road concept. */}
          {frontage.status && (
            <div data-testid="awv2-zoning-subdivision-run-frontage">
              <b>Direct-frontage lot potential:</b>{' '}
              {frontage.status === 'evaluated'
                ? `${frontage.directFrontageLots} lot(s) from ${frontage.subjectFrontageFt} ft of existing frontage ÷ ${frontage.minimumFrontageFt} ft minimum`
                : 'Not screened'}
              <div>{frontage.statement}</div>
            </div>
          )}
          {/* Private road / private drive is secondary upside only, and only
              rendered when frontage is actually the limiting factor. */}
          {privateRoad.applicable && (
            <div data-testid="awv2-zoning-subdivision-run-private-road">
              <b>Private road / private drive (secondary upside only):</b>
              <div>{privateRoad.statement}</div>
              {!!privateRoad.rules?.length && (
                <ul>
                  {privateRoad.rules.map((rule) => (
                    <li>
                      {rule.label}: {rule.value ?? rule.unresolved ?? 'Not established'}
                      {rule.sourceUrl && <> — <a href={rule.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* Manufactured homes, read from the same zoning review — never a
              separate research mission. */}
          <div data-testid="awv2-zoning-subdivision-run-manufactured">
            <b>Manufactured homes:</b> {manufactured.overallStatement ?? 'Not screened.'}
            {!!manufactured.byType?.length && manufactured.established && (
              <ul>
                {manufactured.byType.filter((row) => row.established).map((row) => (
                  <li>
                    {row.label}: {row.statusLabel}
                    {row.sourceUrl && <> — <a href={row.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                    {!!row.conditions.length && (
                      <ul>
                        {row.conditions.map((condition) => (
                          <li>
                            {condition.label}: {condition.requirement}
                            {condition.sourceUrl && <> — <a href={condition.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* What the current zoning allows and its material restrictions,
              distinct sections so neither reads as the other. */}
          {!!allowances.length && (
            <div data-testid="awv2-zoning-subdivision-run-allowances">
              <b>What current zoning allows:</b>
              <ul>
                {allowances.map((row) => (
                  <li>
                    {row.label}: {row.detail}
                    {row.sourceUrl && <> — <a href={row.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!restrictions.length && (
            <div data-testid="awv2-zoning-subdivision-run-restrictions">
              <b>Material zoning restrictions:</b>
              <ul>
                {restrictions.map((row) => (
                  <li>
                    {row.label}: {row.detail}
                    {row.sourceUrl && <> — <a href={row.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* A classification that is not adopted zoning is shown and labelled,
              never promoted into the zoning slot. */}
          {zoning.nonZoningClassification && (
            <div data-testid="awv2-zoning-subdivision-run-non-zoning">
              <b>Not adopted zoning:</b> {zoning.nonZoningClassification.code}
              {zoning.nonZoningClassification.description ? ` — ${zoning.nonZoningClassification.description}` : ''}
              . This is a classification the source published; it is not this parcel&apos;s zoning district.
            </div>
          )}
          {!!zoning.historicalReferences?.length && (
            <div data-testid="awv2-zoning-subdivision-run-historical">
              <b>Historical or requested districts (never the district in force today):</b>
              <ul>
                {zoning.historicalReferences.map((row) => (
                  <li>
                    {row.kind.replace(/_/g, ' ')}: {row.value ?? 'not stated'}
                    {row.asOf ? ` (as of ${row.asOf})` : ''}
                    {row.sourceUrl && <> — <a href={row.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!rules.package?.length && (
            <div data-testid="awv2-zoning-subdivision-run-rules">
              <b>Jurisdiction rule package{jurisdiction.rulePackageReused ? ' (reused for this jurisdiction)' : ''}:</b>
              <ul>
                {rules.package.slice(0, 12).map((rule) => (
                  <li>
                    {rule.label}: {rule.value ?? rule.unresolved ?? 'Not established'}
                    {rule.section ? ` (${rule.section})` : ''}
                    {rule.sourceUrl && <> — <a href={rule.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!facts.sources?.length && (
            <div data-testid="awv2-zoning-subdivision-run-sources">
              <b>Authoritative sources:</b>
              <ul>
                {facts.sources.slice(0, 10).map((source) => (
                  <li>
                    {source.url
                      ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
                      : source.title}
                    {source.jurisdiction ? ` — ${source.jurisdiction}` : ''}
                    {source.date ? ` (${source.date})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facts.summary && <div>{facts.summary}</div>}
          {!!result.warnings.length && <div><b>Reported:</b> {result.warnings.join('; ')}</div>}
          {!!result.missingInformation.length && (
            <div><b>Not established:</b> {result.missingInformation.join('; ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
