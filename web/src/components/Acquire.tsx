import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { ModelControl } from '@/components/ModelControl';

// Acquire — ONE normal action: Run Property Analysis. A single click runs the
// full approved chain server-side (LandPortal v2 exact verify -> DD facts ->
// Local Market Pulse -> Live Comps readiness -> Redfin sold comps -> strategy /
// underwriting -> verified Deal Card -> Markdown + local PDF) and returns one
// structured result. The old two-step Verify/Create controls are demoted to a
// collapsed developer fallback. Parcel identity is verified only from named
// sources, never imagery/coordinates. No fake data.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

interface PAIdentity { situsAddress?: string; apn?: string; county?: string; state?: string; fips?: string; owner?: string; }
interface PASignal { signal: string; status: string; sourceName?: string; sourceUrl?: string; note: string; }
interface PAComp { price: number; saleDateIso: string; acres: number | null; pricePerAcre: number | null; sourceUrl: string; sourceLabel: string; }
interface PAStrategy { strategy: string; label: string; feasible: boolean; offerLowUsd: number | null; offerHighUsd: number | null; outputLabel: string; reasons: string[]; }
interface PASourceRow { category: string; source: string; status: string; timestamp: string; confidence: string; note: string; }
interface PAProviderCall { source: string; kind: string; rows: number; spendUsd: number; }
interface PropertyAnalysisResult {
  input: string; reportTimestamp: string;
  verified: 'Verified' | 'Not Verified';
  verdict: 'Pursue' | 'Pursue With Caution' | 'Pass' | 'Not Ready';
  offerReadiness: 'Offer Ready' | 'Needs Confirmation' | 'Blocked';
  statuses: string[];
  parcelVerification: { status: string; parcelVerified: boolean; verificationSource?: string; lpApiVersion: string; identity?: PAIdentity; summary: string; nextAction?: string };
  ddFacts: Record<string, unknown> | null;
  dataGaps: string[]; riskFlags: string[];
  marketPulse: { eligible: boolean; localArea: { descriptor: string }; label: string; signals: PASignal[]; disclaimer: string };
  redfinComps: { ran: boolean; readiness: { ready: boolean; reason: string }; comps: PAComp[]; note: string; terminalState?: string };
  compInclusionExclusionNotes: string[];
  strategyMatrix: PAStrategy[];
  underwriting: { expectedValueUsd: number | null; evBasis: string; offerReadiness: string; blockerNote?: string };
  mostViableStrategy: { strategy: string; label: string; reason: string } | null;
  discoveryQuestions: string[];
  sourceTable: PASourceRow[];
  providerCalls: PAProviderCall[]; providerCallCount: number; actualSpendUsd: number;
  dealCard: { created: boolean; dealCardId?: number; reason: string };
}
interface PAResponse { result: PropertyAnalysisResult; report: { markdownPath: string; pdfPath: string | null; pdfReason: string }; }

const PROGRESS_STAGES = [
  'Checking parcel identity', 'Collecting verified property facts', 'Running Local Market Pulse',
  'Checking Live Comps readiness', 'Collecting Redfin sold comps', 'Analyzing strategy lanes',
  'Preparing report', 'Complete',
];

function entityLabel(e: EntityFilter): string {
  if (e === 'LAND_ALLY') return 'Land Ally';
  if (e === 'TY_LAND_BIZ') return 'Solo Biz';
  return 'all entities';
}
function badgeTone(kind: 'verified' | 'verdict' | 'offer', v: string): string {
  if (v === 'Verified' || v === 'Pursue' || v === 'Offer Ready') return 'border-[var(--color-accent)] text-[var(--color-accent)]';
  if (v === 'Not Verified' || v === 'Pass' || v === 'Blocked') return 'border-[var(--color-status-failed)] text-[var(--color-status-failed)]';
  return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
}

export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<PAResponse | null>(null);

  // ── The single normal action ───────────────────────────────────────────────
  async function runPropertyAnalysis() {
    if (!text.trim()) return;
    setRunning(true);
    setError(null);
    setResp(null);
    try {
      const body: Record<string, unknown> = { text };
      if (entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ') body.entity = entity;
      const res = await apiPost<PAResponse>('/api/landos/property-analysis', body);
      setResp(res);
      if (res.result.dealCard.created && res.result.dealCard.dealCardId && onOpenDealCard) {
        onOpenDealCard(res.result.dealCard.dealCardId);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  const r = resp?.result;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Acquire — Property Analysis</div>
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="routing" orientation="task_oriented" label="Intake model" size="sm" />
        </div>
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="Enter a full address, APN, or owner + county. One click runs the whole analysis — county/FIPS is resolved internally. Identity is verified from named sources, never imagery or coordinates."
          class="w-full h-20 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void runPropertyAnalysis()}
            disabled={running || !text.trim()}
            class="px-4 py-2 rounded-md text-[13px] font-semibold border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40"
          >
            {running ? 'Running Property Analysis…' : 'Run Property Analysis'}
          </button>
          <span class="text-[10px] text-[var(--color-text-faint)]">
            Tagging: <span class="text-[var(--color-text-muted)]">{entityLabel(entity)}</span>. A verified Deal Card is created automatically on success.
          </span>
        </div>
      </div>

      {running && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Working…</div>
          <ul class="space-y-1">
            {PROGRESS_STAGES.slice(0, -1).map((s) => (
              <li key={s} class="text-[12px] text-[var(--color-text-muted)] flex items-center gap-2">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-pulse" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">{error}</div>}

      {r && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-4">
          {/* Top badges */}
          <div class="flex items-center gap-2 flex-wrap">
            <span class={`text-[11px] px-2 py-0.5 rounded-full border ${badgeTone('verified', r.verified)}`}>{r.verified}</span>
            <span class={`text-[11px] px-2 py-0.5 rounded-full border ${badgeTone('verdict', r.verdict)}`}>{r.verdict}</span>
            <span class={`text-[11px] px-2 py-0.5 rounded-full border ${badgeTone('offer', r.offerReadiness)}`}>{r.offerReadiness}</span>
            <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">{r.reportTimestamp}</span>
          </div>

          {/* Actual stages reached */}
          <div class="text-[10px] text-[var(--color-text-faint)]">{r.statuses.join(' → ')}</div>

          {/* Parcel Verification */}
          <Section title="Parcel Verification">
            {r.parcelVerification.parcelVerified ? (
              <div class="text-[12px] text-[var(--color-text)]">
                {r.parcelVerification.identity?.situsAddress || r.parcelVerification.identity?.apn} · {[r.parcelVerification.identity?.county, r.parcelVerification.identity?.state].filter(Boolean).join(', ')}
                <span class="text-[10px] text-[var(--color-text-faint)]"> · via {r.parcelVerification.verificationSource} ({r.parcelVerification.lpApiVersion})</span>
              </div>
            ) : (
              <div class="rounded-md border border-dashed border-[var(--color-border)] p-2">
                <div class="text-[12px] font-medium text-[var(--color-text-muted)]">Local Area Context, Not Parcel Verified</div>
                {r.parcelVerification.nextAction && <div class="text-[11px] text-[var(--color-text-faint)] mt-1">{r.parcelVerification.nextAction}</div>}
              </div>
            )}
          </Section>

          {/* DD facts + gaps/risks */}
          {r.ddFacts && (
            <Section title="Property / DD Facts">
              <pre class="text-[10px] text-[var(--color-text-muted)] overflow-x-auto">{JSON.stringify(r.ddFacts, null, 2)}</pre>
            </Section>
          )}
          {(r.dataGaps.length > 0 || r.riskFlags.length > 0) && (
            <Section title="Data Gaps and Risk Flags">
              {r.dataGaps.length > 0 && <div class="text-[11px] text-[var(--color-text-faint)]">Gaps: {r.dataGaps.join(', ')}</div>}
              {r.riskFlags.map((f) => <div key={f} class="text-[11px] text-[var(--color-status-failed)]">⚑ {f}</div>)}
            </Section>
          )}

          {/* Market Pulse */}
          <Section title={`Local Market Pulse — ${r.marketPulse.localArea.descriptor}`}>
            <div class="text-[10px] text-[var(--color-text-faint)] mb-1">{r.marketPulse.label}</div>
            {r.marketPulse.signals.map((s) => (
              <div key={s.signal} class="text-[11px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{s.signal}</span> · <span class="text-[var(--color-text-faint)]">{s.status}</span>
                {s.sourceUrl ? <> · <a href={s.sourceUrl} target="_blank" class="text-[var(--color-accent)] underline">source</a></> : null} — {s.note}
              </div>
            ))}
          </Section>

          {/* Redfin comps */}
          <Section title="Redfin Sold Comps">
            <div class="text-[10px] text-[var(--color-text-faint)] mb-1">readiness: {String(r.redfinComps.readiness.ready)} — {r.redfinComps.readiness.reason}</div>
            {r.redfinComps.comps.length > 0 ? r.redfinComps.comps.map((c) => (
              <div key={c.sourceUrl} class="text-[11px] text-[var(--color-text-muted)]">${c.price.toLocaleString()} · {c.saleDateIso.slice(0, 10)} · {c.acres ?? '—'} ac · <a href={c.sourceUrl} target="_blank" class="text-[var(--color-accent)] underline">{c.sourceLabel}</a></div>
            )) : <div class="text-[12px] text-[var(--color-text-muted)]">{r.redfinComps.terminalState || r.redfinComps.note}</div>}
            {r.compInclusionExclusionNotes.map((n, i) => <div key={i} class="text-[10px] text-[var(--color-text-faint)]">· {n}</div>)}
          </Section>

          {/* Strategy + underwriting */}
          <Section title="Strategy Matrix / Underwriting">
            {r.strategyMatrix.length > 0 ? r.strategyMatrix.map((s) => (
              <div key={s.strategy} class="text-[11px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{s.label}</span>: {s.feasible ? 'feasible' : 'not feasible'} · {s.offerLowUsd != null ? `$${s.offerLowUsd.toLocaleString()}–$${(s.offerHighUsd ?? 0).toLocaleString()}` : 'no band'} · <span class="text-[var(--color-text-faint)]">{s.outputLabel}</span>
              </div>
            )) : <div class="text-[12px] text-[var(--color-text-muted)]">{r.underwriting.blockerNote || 'Strategy blocked: insufficient verified evidence.'}</div>}
            <div class="text-[11px] text-[var(--color-text-faint)] mt-1">EV: {r.underwriting.expectedValueUsd != null ? `$${r.underwriting.expectedValueUsd.toLocaleString()}` : 'not ready'} ({r.underwriting.evBasis})</div>
            {r.mostViableStrategy && <div class="text-[11px] text-[var(--color-accent)] mt-1">Most viable: {r.mostViableStrategy.label} — {r.mostViableStrategy.reason}</div>}
          </Section>

          {/* Discovery questions */}
          {r.discoveryQuestions.length > 0 && (
            <Section title="Discovery Questions">
              {r.discoveryQuestions.map((q, i) => <div key={i} class="text-[11px] text-[var(--color-text-muted)]">• {q}</div>)}
            </Section>
          )}

          {/* Calls + spend + report */}
          <Section title="Provider Calls · Spend · Report">
            <div class="text-[11px] text-[var(--color-text-muted)]">Calls: {r.providerCallCount} · Spend: ${r.actualSpendUsd.toFixed(2)}</div>
            {resp?.report.markdownPath && <div class="text-[10px] text-[var(--color-text-faint)] break-all">Markdown: {resp.report.markdownPath}</div>}
            <div class="text-[10px] text-[var(--color-text-faint)] break-all">PDF: {resp?.report.pdfPath || resp?.report.pdfReason}</div>
          </Section>

          {r.dealCard.created && <div class="text-[11px] text-[var(--color-accent)]">Deal Card #{r.dealCard.dealCardId} created and opened.</div>}
        </div>
      )}

      {/* Demoted developer fallback — the OLD two-step Verify/Create flow. */}
      <details class="rounded-lg border border-dashed border-[var(--color-border)] p-2">
        <summary class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] cursor-pointer">Developer fallback — manual Verify / Create (not the normal flow)</summary>
        <DeveloperFallback entity={entity} onOpenDealCard={onOpenDealCard} />
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] p-3">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{title}</div>
      {children}
    </div>
  );
}

// The previous two-button workflow, retained only as an explicit developer tool.
function DeveloperFallback({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canCreate = entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ';
  async function verifyOnly() {
    if (!text.trim()) return; setBusy(true); setMsg(null);
    try { const res = await apiPost<{ verification: { parcelVerified: boolean; status: string } }>('/api/landos/intake/duke-verification', { text }); setMsg(`verify: ${res.verification.status}`); }
    catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  }
  async function createOnly() {
    if (!canCreate || !text.trim()) return; setBusy(true); setMsg(null);
    try { const res = await apiPost<{ created: boolean; dealCardId?: number }>('/api/landos/deal-cards/from-verification', { text, entity }); setMsg(res.created ? `created #${res.dealCardId}` : 'not created (unverified)'); if (res.created && res.dealCardId && onOpenDealCard) onOpenDealCard(res.dealCardId); }
    catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  }
  return (
    <div class="mt-2 space-y-2">
      <textarea value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="address / APN (developer)" class="w-full h-12 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1 text-[11px]" />
      <div class="flex items-center gap-2">
        <button type="button" onClick={() => void verifyOnly()} disabled={busy} class="px-2 py-1 rounded-md text-[11px] border border-[var(--color-border)] disabled:opacity-40">Verify only</button>
        <button type="button" onClick={() => void createOnly()} disabled={busy || !canCreate} class="px-2 py-1 rounded-md text-[11px] border border-[var(--color-border)] disabled:opacity-40">Create only</button>
        {msg && <span class="text-[10px] text-[var(--color-text-faint)]">{msg}</span>}
      </div>
    </div>
  );
}
