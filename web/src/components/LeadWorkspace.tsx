import { useEffect, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import {
  acreageEntries,
  asArray,
  asRecord,
  asString,
  compCountsLine,
  compsShowingLine,
  dedupeLines,
  fmtAcres,
  fmtMoney,
  readinessRows,
  resolutionChip,
  strategyRows,
  topComps,
  type RecordValue,
  type Tone,
} from '@/lib/lead-workspace-view';

// The Acquisitions Lead Workspace — the primary operator surface for one lead.
// It renders the versioned read-model payload (canonical shared services,
// composed server-side) and NEVER derives WS1-WS3 conclusions itself.
// Honesty taxonomy: confirmed facts, screening results, observed signals,
// unavailable data, and unresolved questions are visually distinct; unknown
// is always presented as unknown, never invented.

interface LeadWorkspacePayload {
  contract: { version: string; generatedAt?: string };
  lead: RecordValue;
  property: RecordValue;
  seller: RecordValue;
  market: RecordValue;
  strategies: { entries?: unknown[]; summary?: unknown; pricingAllowed?: boolean; pricingBlockers?: unknown[] };
  offerAndNegotiation?: RecordValue;
  evidence: RecordValue;
  work: RecordValue;
  readiness: RecordValue;
  freshness?: RecordValue;
}

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  caution: 'text-amber-700 dark:text-amber-400',
  risk: 'text-red-700 dark:text-red-400',
  unknown: 'text-[var(--color-text-muted)]',
};

const TONE_BORDER: Record<Tone, string> = {
  good: 'border-emerald-600/40',
  caution: 'border-amber-600/40',
  risk: 'border-red-600/50',
  unknown: 'border-[var(--color-border)]',
};

function Chip({ tone, children, testId }: { tone: Tone; children: any; testId?: string }) {
  return (
    <span
      data-testid={testId}
      class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE_BORDER[tone]} ${TONE_TEXT[tone]}`}
    >
      {children}
    </span>
  );
}

function Unavailable({ label = 'Unavailable' }: { label?: string }) {
  return <span class="text-[var(--color-text-faint)] italic">{label}</span>;
}

function Field({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  const text = value === null || value === undefined || value === '' ? null : String(value);
  return (
    <div class="min-w-0">
      <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</div>
      <div class={`text-[12px] text-[var(--color-text)] break-words ${mono ? 'font-mono' : ''}`}>
        {text ?? <Unavailable />}
      </div>
    </div>
  );
}

function Section({ title, subtitle, open = false, children, testId }: { title: string; subtitle?: string | null; open?: boolean; children: any; testId?: string }) {
  return (
    <details open={open} data-testid={testId} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <summary class="cursor-pointer px-4 py-3">
        <span class="text-[14px] font-semibold text-[var(--color-text)]">{title}</span>
        {subtitle ? <span class="ml-2 text-[11px] text-[var(--color-text-muted)]">{subtitle}</span> : null}
      </summary>
      <div class="border-t border-[var(--color-border)] px-4 py-3 text-[12px] leading-relaxed text-[var(--color-text-muted)] space-y-3">
        {children}
      </div>
    </details>
  );
}

function Lines({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p><Unavailable label={empty} /></p>;
  return (
    <ul class="space-y-1">
      {items.map((line, i) => (
        <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)]">{line}</li>
      ))}
    </ul>
  );
}

export function LeadWorkspace({ dealCardId }: { dealCardId: number }) {
  const [workspace, setWorkspace] = useState<LeadWorkspacePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setWorkspace(null);
    setError('');
    apiGet<LeadWorkspacePayload>(`/api/landos/lead-workspace/${dealCardId}`)
      .then((payload) => { if (active) setWorkspace(payload); })
      .catch(() => { if (active) setError('The Lead Workspace could not be loaded.'); });
    return () => { active = false; };
  }, [dealCardId]);

  if (error) return <div class="flex-1 p-6 text-[13px] text-red-600">{error}</div>;
  if (!workspace) return <div class="flex-1 p-6 text-[13px] text-[var(--color-text-muted)]">Loading Lead Workspace{'…'}</div>;

  const property = asRecord(workspace.property);
  const identity = asRecord(property.identity);
  const resolution = asRecord(property.resolution);
  const conflict = asRecord(resolution.identityConflict);
  const hasConflict = Boolean(asString(conflict.requestedApn) || asString(conflict.resolvedApn));
  const chip = resolutionChip(property);
  const basis = asRecord(property.canonicalAcreage);
  const basisRows = acreageEntries(basis);
  const disputed = basis.disputed === true;
  const intelligence = asRecord(property.intelligence);
  const seller = asRecord(workspace.seller);
  const market = asRecord(workspace.market);
  const matrix = asRecord(market.matrix);
  const valuation = asRecord(market.valuation);
  const comparables = asRecord(market.comparables);
  const compRows = topComps(comparables, 6);
  const strategies = strategyRows(workspace.strategies.entries);
  const pricingBlockers = dedupeLines(workspace.strategies.pricingBlockers);
  const readiness = readinessRows(asRecord(workspace.readiness));
  const work = asRecord(workspace.work);
  const nextAction = asRecord(work.recommendedNextAction);
  const blockers = dedupeLines(work.blockers);
  const decisions = dedupeLines(work.decisions);
  const evidence = asRecord(workspace.evidence);
  const visuals = asRecord(evidence.visuals);
  const documents = asRecord(evidence.documents);
  const researchTasks = asArray(documents.researchTasks).map(asRecord);
  const sources = asArray(evidence.sources).map(asRecord);
  const activity = asArray(work.activity).map(asRecord);
  const agentWork = asArray(work.agentWork).map(asRecord);
  const tasks = asArray(work.tasks).map(asRecord);
  const people = asArray(seller.people).map(asRecord);
  const communications = asArray(seller.communications).map(asRecord);
  const ownerWarnings = dedupeLines(identity.ownerWarnings);
  const missing = dedupeLines(resolution.missing);
  const gaps = dedupeLines(intelligence.gaps);
  const matrixFields = asArray(matrix.fields).map(asRecord);
  const supporting = asArray(valuation.supporting).map(asRecord);
  const primaryValue = asRecord(valuation.primary);
  const displayAcres = fmtAcres(identity.assessedAcres) ?? fmtAcres(identity.mappedAcres);

  return (
    <div data-testid="lead-workspace-root" class="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
      <div class="mx-auto max-w-7xl space-y-3">
        {/* Lead identity header */}
        <header class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Lead Workspace {'·'} v{workspace.contract.version}</p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <h2 class="text-[20px] font-semibold text-[var(--color-text)] break-words">{asString(workspace.lead.title) ?? 'Untitled lead'}</h2>
            <Chip tone={chip.tone} testId="lead-workspace-resolution-chip">{chip.label}</Chip>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="APN" value={identity.apn} mono />
            <Field label="County" value={identity.county} />
            <Field label="State" value={identity.state} />
            <Field label="Acreage" value={disputed ? `${displayAcres ?? 'disputed'} (disputed)` : displayAcres} />
            <Field label="Owner" value={identity.owner} />
            <Field label="Lifecycle" value={workspace.lead.lifecycle} />
          </div>
          {asString(nextAction.label) ? (
            <div class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2">
              <span class="text-[11px] font-semibold text-[var(--color-text)]">Next action: </span>
              <span class="text-[12px] text-[var(--color-text)]">{asString(nextAction.label)}</span>
              {asString(nextAction.reason) ? <span class="text-[11px] text-[var(--color-text-muted)]"> {'—'} {asString(nextAction.reason)}</span> : null}
            </div>
          ) : null}
        </header>

        {/* HARD STOP: genuine requested-vs-resolved parcel conflict. Nothing downstream ran. */}
        {hasConflict ? (
          <div data-testid="lead-workspace-conflict" class="rounded-xl border-2 border-red-600/60 bg-red-600/10 p-4">
            <div class="text-[13px] font-bold text-red-700 dark:text-red-400">WRONG PARCEL {'—'} HARD STOP</div>
            <div class="mt-1.5 text-[12px] text-[var(--color-text)]">
              You asked for APN <span class="font-mono font-semibold">{asString(conflict.requestedApn) ?? 'unknown'}</span>, but {asString(conflict.source) ?? 'a parcel-level source'} resolved a different parcel {'—'} APN <span class="font-mono font-semibold">{asString(conflict.resolvedApn) ?? 'unknown'}</span>
              {asString(conflict.resolvedContext) ? <span class="text-[var(--color-text-muted)]"> ({asString(conflict.resolvedContext)})</span> : null}.
            </div>
            <div class="mt-1.5 border-t border-red-600/30 pt-2 text-[11px] text-[var(--color-text-muted)]">
              The resolved parcel was NOT accepted as the subject. This record is blocked: no property intelligence, Land Score, valuation, offer range, strategies, or seller brief ran, and none will until the correct parcel is confirmed.
            </div>
          </div>
        ) : null}

        {/* Blockers and Tyler decisions — always visible when present */}
        {(blockers.length > 0 || decisions.length > 0) && (
          <Section title="Blockers & decisions" subtitle={`${blockers.length} blocker(s)`} open testId="lead-workspace-blockers">
            <Lines items={blockers} empty="No blockers published." />
            {decisions.length > 0 && (
              <div>
                <p class="mb-1 font-semibold text-[var(--color-text)]">Decisions only Tyler can make</p>
                <Lines items={decisions} empty="None." />
              </div>
            )}
          </Section>
        )}

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Identity & resolution */}
          <Section title="Identity & resolution" open testId="lead-workspace-identity">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Situs address" value={identity.situsAddress} />
              <Field label="Locality" value={identity.locality} />
              <Field label="ZIP" value={identity.zip} />
              <Field label="APN" value={identity.apn} mono />
              <Field label="Owner (recorded)" value={identity.owner} />
              <Field label="Owner mailing" value={identity.ownerMailing} />
              <Field label="Tax area" value={identity.taxArea} />
              <Field label="Land use class" value={identity.landUseClass} />
              <Field label="Appraised value" value={fmtMoney(identity.appraisedValue)} />
            </div>
            {ownerWarnings.length > 0 && (
              <div>
                <p class="mb-1 font-semibold text-amber-700 dark:text-amber-400">Owner-record warnings</p>
                <Lines items={ownerWarnings} empty="None." />
              </div>
            )}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-[var(--color-text)]">Resolution</span>
                <Chip tone={chip.tone}>{chip.label}</Chip>
                {typeof resolution.confidence === 'number' && resolution.historical !== true ? (
                  <span class="text-[10px] text-[var(--color-text-faint)]">confidence {Math.round((resolution.confidence as number) * 100)}%</span>
                ) : null}
              </div>
              {asString(resolution.verifiedStatus) ? (
                <p class="mt-1.5 text-[12px] text-[var(--color-text)]">{asString(resolution.verifiedStatus)}</p>
              ) : null}
              {resolution.attempted === true && resolution.historical === true ? (
                <div class="mt-1.5 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Earlier resolution attempt (before verification {'—'} historical, superseded)</p>
                  {asString(resolution.basis) ? <p class="mt-0.5 text-[11px]">{asString(resolution.basis)}</p> : null}
                </div>
              ) : resolution.attempted === true ? (
                <div class="mt-1.5 space-y-1">
                  {asString(resolution.basis) ? <p>{asString(resolution.basis)}</p> : null}
                  {asString(resolution.matchedReason) ? <p class="text-[11px]">{asString(resolution.matchedReason)}</p> : null}
                  {missing.length > 0 ? <p class="text-[11px]">Still unknown: {missing.join(', ')}</p> : null}
                  {asString(resolution.smallestNextIdentifier) ? (
                    <p class="text-[11px]">Smallest next identifier: <span class="font-semibold text-[var(--color-text)]">{asString(resolution.smallestNextIdentifier)}</span></p>
                  ) : null}
                </div>
              ) : asString(resolution.verifiedStatus) ? null : (
                <p class="mt-1.5"><Unavailable label="No resolution attempt has been recorded for this lead." /></p>
              )}
            </div>
          </Section>

          {/* Canonical acreage & spatial basis */}
          <Section title="Acreage & spatial basis" subtitle={disputed ? 'DISPUTED' : null} open={disputed} testId="lead-workspace-acreage">
            {disputed && (
              <div class="rounded-lg border border-amber-600/40 bg-amber-600/10 p-3">
                <p class="font-semibold text-amber-800 dark:text-amber-300">Acreage conflict {'—'} Tyler decision required</p>
                {asString(basis.decision) ? <p class="mt-1 text-[12px] text-[var(--color-text)]">{asString(basis.decision)}</p> : null}
                {asString(basis.explanation) ? <p class="mt-1 text-[11px]">{asString(basis.explanation)}</p> : null}
              </div>
            )}
            {basisRows.length ? (
              <div class="overflow-x-auto">
                <table class="w-full min-w-[480px] text-left text-[11.5px]">
                  <thead>
                    <tr class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
                      <th class="py-1 pr-3">Basis</th><th class="py-1 pr-3">Value</th><th class="py-1 pr-3">Source</th><th class="py-1 pr-3">Confidence</th><th class="py-1">Limitation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {basisRows.map((row) => (
                      <tr key={row.kind} class="border-t border-[var(--color-border)] align-top">
                        <td class="py-1.5 pr-3 font-semibold text-[var(--color-text)]">{row.kind}{row.disputed ? <span class="ml-1 text-amber-700 dark:text-amber-400">(disputed)</span> : null}</td>
                        <td class="py-1.5 pr-3 text-[var(--color-text)]">{row.value}</td>
                        <td class="py-1.5 pr-3">{row.source}</td>
                        <td class="py-1.5 pr-3">{row.confidence ?? <Unavailable />}</td>
                        <td class="py-1.5">{row.limitation ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p><Unavailable label="No canonical acreage basis has been established." /></p>
            )}
          </Section>

          {/* Research completeness & unresolved evidence */}
          <Section title="Research & evidence status" testId="lead-workspace-research">
            {readiness.filter((r) => r.key === 'research').map((r) => (
              <div key={r.key} class="flex flex-wrap items-center gap-2">
                <Chip tone={r.tone}>{r.stateLabel}</Chip>
                {r.why ? <span>{r.why}</span> : null}
              </div>
            ))}
            {researchTasks.length > 0 && (
              <div>
                <p class="mb-1 font-semibold text-[var(--color-text)]">Open evidence requirements</p>
                <ul class="space-y-1">
                  {researchTasks.map((t, i) => (
                    <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5">
                      <span class="text-[12px] font-medium text-[var(--color-text)]">{asString(t.title) ?? 'Research task'}</span>
                      <span class="ml-2 text-[10px] uppercase text-[var(--color-text-faint)]">{asString(t.state) ?? 'open'}</span>
                      {asString(t.why) ? <div class="text-[11px]">{asString(t.why)}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {gaps.length > 0 && (
              <div>
                <p class="mb-1 font-semibold text-[var(--color-text)]">Known data gaps</p>
                <Lines items={gaps} empty="None." />
              </div>
            )}
            {researchTasks.length === 0 && gaps.length === 0 && readiness.every((r) => r.key !== 'research') && (
              <p><Unavailable label="No research status has been published for this lead." /></p>
            )}
          </Section>

          {/* Unified readiness */}
          <Section title="Readiness" subtitle="one shared record, every lane" testId="lead-workspace-readiness">
            {readiness.length ? (
              <div class="space-y-2">
                {readiness.map((row) => (
                  <div key={row.key} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-[12px] font-semibold text-[var(--color-text)]">{row.label}</span>
                      <Chip tone={row.tone}>{row.stateLabel}</Chip>
                    </div>
                    {row.why ? <p class="mt-1 text-[11px]">{row.why}</p> : null}
                    {row.blockers.length > 0 ? <p class="mt-1 text-[11px]">Blockers: {row.blockers.join(' · ')}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p><Unavailable label="No readiness record has been published." /></p>
            )}
          </Section>
        </div>

        {/* Market, valuation & comparables — full width */}
        <Section title="Market, valuation & comparables" subtitle={compCountsLine(comparables)} testId="lead-workspace-market">
          {asString(market.summary) ? <p class="text-[12px] text-[var(--color-text)]">{asString(market.summary)}</p> : null}
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <p class="mb-1 font-semibold text-[var(--color-text)]">Valuation</p>
              {fmtMoney(primaryValue.value) ? (
                <p class="text-[13px] font-semibold text-[var(--color-text)]">{fmtMoney(primaryValue.value)} <span class="text-[10px] font-normal text-[var(--color-text-faint)]">({asString(valuation.confidence) ?? 'unknown'} confidence)</span></p>
              ) : (
                <p><Unavailable label="No defensible primary value is available." /></p>
              )}
              {asString(valuation.nextAction) ? <p class="mt-1 text-[11px]">{asString(valuation.nextAction)}</p> : null}
              {supporting.length > 0 && (
                <ul class="mt-2 space-y-1">
                  {supporting.map((s, i) => (
                    <li key={i} class="text-[11px]">
                      <span class="font-medium text-[var(--color-text)]">{asString(s.label) ?? 'Observation'}:</span> {asString(s.note) ?? <Unavailable />}
                      <span class="ml-1 text-[10px] text-[var(--color-text-faint)]">(screening observation, not a confirmed value)</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <p class="mb-1 font-semibold text-[var(--color-text)]">Market matrix</p>
              {matrix.available === true ? (
                <div class="space-y-1">
                  <p class="text-[11px]">{asString(matrix.coverageLabel) ?? ''} {'·'} {asString(matrix.staleness) ?? ''} {'·'} confidence {asString(matrix.confidence) ?? 'unknown'}</p>
                  <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                    {matrixFields.map((f, i) => (
                      <div key={i} class="text-[11px]">
                        <span class="text-[var(--color-text-faint)]">{asString(f.label) ?? 'Field'}: </span>
                        {f.unknown === true ? <Unavailable label="unknown" /> : <span class="text-[var(--color-text)]">{asString(f.value) ?? String(f.value ?? '')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p><Unavailable label="Market matrix unavailable for this area." /></p>
              )}
            </div>
          </div>
          {compRows.length ? (
            <div class="overflow-x-auto">
              <table class="w-full min-w-[560px] text-left text-[11.5px]" data-testid="lead-workspace-comps">
                <thead>
                  <tr class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
                    <th class="py-1 pr-3">Comparable</th><th class="py-1 pr-3">Type</th><th class="py-1 pr-3">Acres</th><th class="py-1 pr-3">Price</th><th class="py-1 pr-3">$/acre</th><th class="py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {compRows.map((row, i) => (
                    <tr key={i} class="border-t border-[var(--color-border)] align-top">
                      <td class="py-1.5 pr-3 text-[var(--color-text)]">{row.address}{row.comparability ? <div class="text-[10px] text-[var(--color-text-faint)]">{row.comparability}</div> : null}</td>
                      <td class="py-1.5 pr-3">{row.kind}</td>
                      <td class="py-1.5 pr-3">{row.acres ?? <Unavailable />}</td>
                      <td class="py-1.5 pr-3">{row.price ?? <Unavailable />}</td>
                      <td class="py-1.5 pr-3 font-medium text-[var(--color-text)]">{row.ppa ?? <Unavailable />}</td>
                      <td class="py-1.5 text-[10.5px]">{row.providers}{row.confidence ? ` (${row.confidence})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p class="mt-1 text-[10px] text-[var(--color-text-faint)]">{compsShowingLine(comparables, compRows.length)} Comparables are screening evidence; they never replace an appraisal or survey.</p>
            </div>
          ) : (
            <p><Unavailable label="No validated comparables are available for this lead." /></p>
          )}
        </Section>

        {/* The five approved strategies */}
        <Section title={`Strategies (${strategies.length} of 5 approved)`} open testId="lead-workspace-strategies">
          {asString(workspace.strategies.summary) ? <p class="text-[12px] text-[var(--color-text)]">{asString(workspace.strategies.summary)}</p> : null}
          {workspace.strategies.pricingAllowed !== true && (
            <div class="rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2">
              <p class="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Pricing gate closed {'—'} no offer or value range may display.</p>
              {pricingBlockers.length > 0 ? <p class="mt-0.5 text-[11px]">{pricingBlockers.join(' · ')}</p> : null}
            </div>
          )}
          {strategies.length ? (
            <div class="space-y-2">
              {strategies.map((row) => (
                <div key={row.strategy} data-testid="lead-workspace-strategy" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[12.5px] font-semibold text-[var(--color-text)]">{row.strategy}</span>
                    <Chip tone={row.tone}>{row.status}</Chip>
                  </div>
                  {row.why ? <p class="mt-1 text-[11px]">{row.why}</p> : null}
                  {row.blockers.length > 0 ? <p class="mt-1 text-[11px]">Blocked by: {row.blockers.join(' · ')}</p> : null}
                  {row.requiredEvidence.length > 0 ? <p class="mt-1 text-[10.5px] text-[var(--color-text-faint)]">Required evidence: {row.requiredEvidence.join(' · ')}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p><Unavailable label="No canonical strategy record was returned." /></p>
          )}
        </Section>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Seller */}
          <Section title="Seller & communications" testId="lead-workspace-seller">
            <div>
              <p class="mb-1 font-semibold text-[var(--color-text)]">Contacts</p>
              {people.length ? (
                <ul class="space-y-1">
                  {people.map((p, i) => (
                    <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)]">
                      {asString(p.name) ?? 'Unnamed contact'}{asString(p.role) ? ` (${asString(p.role)})` : ''}{asString(p.phone) ? ` · ${asString(p.phone)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p><Unavailable label="No seller contacts recorded." /></p>
              )}
            </div>
            <div>
              <p class="mb-1 font-semibold text-[var(--color-text)]">Communications</p>
              {communications.length ? (
                <ul class="space-y-1">
                  {communications.map((c, i) => (
                    <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)]">{asString(c.summary) ?? asString(c.note) ?? 'Recorded communication'}</li>
                  ))}
                </ul>
              ) : (
                <p><Unavailable label="No communications recorded." /></p>
              )}
            </div>
          </Section>

          {/* Evidence & documents */}
          <Section title="Evidence, documents & visuals" testId="lead-workspace-evidence">
            {asString(visuals.label) ? (
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2">
                <p class="text-[11px] font-semibold text-[var(--color-text)]">{asString(visuals.label)}</p>
                {asString(visuals.note) ? <p class="mt-0.5 text-[10.5px]">{asString(visuals.note)}</p> : null}
                <p class="mt-1 text-[11px]">
                  {asString(asRecord(visuals.links).maps) ? <a class="text-[var(--color-accent)] underline" href={asString(asRecord(visuals.links).maps)!} target="_blank" rel="noreferrer">Map</a> : null}
                  {asString(asRecord(visuals.links).streetView) ? <a class="ml-3 text-[var(--color-accent)] underline" href={asString(asRecord(visuals.links).streetView)!} target="_blank" rel="noreferrer">Street View</a> : null}
                  {asString(asRecord(visuals.links).earth) ? <a class="ml-3 text-[var(--color-accent)] underline" href={asString(asRecord(visuals.links).earth)!} target="_blank" rel="noreferrer">Earth</a> : null}
                </p>
              </div>
            ) : (
              <p><Unavailable label="No visual context captured." /></p>
            )}
            <div>
              <p class="mb-1 font-semibold text-[var(--color-text)]">Documents</p>
              <p>{asString(documents.summaryLine) ?? <Unavailable label="No document registry published." />}</p>
            </div>
            {sources.length > 0 && (
              <div>
                <p class="mb-1 font-semibold text-[var(--color-text)]">Sources used</p>
                <ul class="space-y-1">
                  {sources.map((s, i) => (
                    <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[11px]">
                      <span class="font-medium text-[var(--color-text)]">{asString(s.source) ?? 'Source'}</span>
                      {asString(s.status) ? <span class="ml-2 text-[10px] uppercase text-[var(--color-text-faint)]">{asString(s.status)}</span> : null}
                      {asString(s.detail) ? <div class="text-[10.5px]">{asString(s.detail)}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* Work */}
          <Section title="Open work" subtitle={`${tasks.length} task(s)`} testId="lead-workspace-work">
            {tasks.length ? (
              <ul class="space-y-1">
                {tasks.map((t, i) => (
                  <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)]">
                    {asString(t.action) ?? 'Task'}
                    <span class="ml-2 text-[10px] uppercase text-[var(--color-text-faint)]">{asString(t.status) ?? ''}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p><Unavailable label="No open tasks." /></p>
            )}
            {agentWork.length > 0 && (
              <div>
                <p class="mb-1 font-semibold text-[var(--color-text)]">Agent work</p>
                <ul class="space-y-1">
                  {agentWork.map((w, i) => (
                    <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[11px]">
                      <span class="font-medium text-[var(--color-text)]">{asString(w.title) ?? 'Work item'}</span>
                      <span class="ml-2 text-[10px] uppercase text-[var(--color-text-faint)]">{asString(w.state) ?? ''}</span>
                      {asString(w.note) ? <div class="text-[10.5px]">{asString(w.note)}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          {/* Activity */}
          <Section title="Activity" subtitle={`${activity.length} event(s)`} testId="lead-workspace-activity">
            {activity.length ? (
              <ul class="space-y-1">
                {activity.slice(0, 20).map((a, i) => (
                  <li key={i} class="rounded bg-[var(--color-elevated)] px-2.5 py-1.5 text-[11px]">
                    <span class="text-[var(--color-text)]">{asString(a.summary) ?? asString(a.kind) ?? 'Activity'}</span>
                    <span class="ml-2 text-[10px] text-[var(--color-text-faint)]">{formatRelativeTime(a.createdAt as never)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p><Unavailable label="No Activity recorded." /></p>
            )}
          </Section>
        </div>

        <footer class="px-1 pb-2 text-[10px] text-[var(--color-text-faint)]">
          Read model v{workspace.contract.version}
          {asString(workspace.contract.generatedAt) ? ` · generated ${formatRelativeTime(workspace.contract.generatedAt as never)}` : ''}
          {' · '}Composed from canonical LandOS records; unknown values are shown as unavailable, never invented.
        </footer>
      </div>
    </div>
  );
}
