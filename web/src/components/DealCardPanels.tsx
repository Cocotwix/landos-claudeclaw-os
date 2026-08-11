// Shared operator panels — canonical-record consumers only.
//
// The legacy Seller Call Brief (underwriting values, one-point market bands,
// percentage offer formulas, "maybe" strategy verdicts, provider diagnostics)
// was REMOVED from the Seller tab: these panels consume the same pricing and
// strategy gates Strategy/Market read, so no stale dollar figure can leak
// into a call, and DD status separates provider execution from business
// completeness from evidence strength.

import { useEffect, useState } from 'preact/hooks';
import type { StrategyReadinessView, DocumentRegistryView, UnifiedReadinessView } from './CanonicalPanels';
import type { OperatorRecordView } from './OperatorRecordView';

// ── Due Diligence business status (three separate axes) ───────────────────────

export interface DdBusinessStatusRow {
  key: string;
  label: string;
  providerExecution: string;
  businessCompleteness: string;
  evidenceStrength: string | null;
  note: string;
  remaining: string[];
}

const EXEC_TONE: Record<string, string> = {
  retrieved: '#2fbf71', failed: '#ff5f56', unavailable: '#f0a52e', not_run: '#7d838f', blocked: '#f0a52e',
};
const COMPLETE_TONE: Record<string, string> = {
  complete: '#2fbf71', partial: '#f0a52e', insufficient: '#ff5f56', conflicted: '#ff5f56', blocked: '#f0a52e',
};

export function DdBusinessStatusPanel({ rows }: { rows: DdBusinessStatusRow[] | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows?.length) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-1">Business status by category</div>
      <div class="text-[12.5px] text-[var(--color-text-muted)] mb-3">A green provider step is not a finished business question — execution, business completeness, and evidence strength are tracked separately.</div>
      <div class="space-y-2">
        {rows.map((row) => {
          const expanded = open === row.key;
          return (
            <button key={row.key} type="button" onClick={() => setOpen(expanded ? null : row.key)} class="w-full text-left rounded-md border border-[var(--color-border)] p-3 hover:border-[var(--color-border-strong)]">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[13px] font-semibold text-[var(--color-text)]">{row.label}</span>
                <span class="text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={`background:${EXEC_TONE[row.providerExecution] ?? '#7d838f'}22;color:${EXEC_TONE[row.providerExecution] ?? '#7d838f'}`}>provider: {row.providerExecution.replace(/_/g, ' ')}</span>
                <span class="text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={`background:${COMPLETE_TONE[row.businessCompleteness] ?? '#7d838f'}22;color:${COMPLETE_TONE[row.businessCompleteness] ?? '#7d838f'}`}>business: {row.businessCompleteness}</span>
                {row.evidenceStrength && <span class="text-[10.5px] px-1.5 py-0.5 rounded border border-[var(--color-border-strong)] text-[var(--color-text-muted)]">evidence: {row.evidenceStrength.replace(/_/g, ' ')}</span>}
              </div>
              <div class="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{row.note}</div>
              {expanded && row.remaining.length > 0 && (
                <ul class="mt-2 space-y-0.5">
                  {row.remaining.map((r) => <li class="text-[12px] text-[var(--color-text-muted)] pl-3 relative"><span class="absolute left-0 top-[7px] w-1 h-1 rounded-full bg-[var(--color-text-faint)]" />{r}</li>)}
                </ul>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Seller-call readiness (same gates Strategy/Market read) ───────────────────

export function SellerReadinessPanel({ parcelVerified, readiness, offerReadiness, unified }: { parcelVerified: boolean; readiness: StrategyReadinessView | null; offerReadiness?: { state: string; why: string } | null; unified?: UnifiedReadinessView | null }) {
  // Offer discussion consumes the SHARED offer-readiness record (pricing gate +
  // research completeness) — never the pricing gate alone, so it can't read
  // "Ready" while the operator record says the property is still researching.
  const offerOk = offerReadiness
    ? (offerReadiness.state === 'ready' || offerReadiness.state === 'needs_confirmation')
    : (readiness ? readiness.pricingAllowed : null);
  const offerNote = offerReadiness
    ? (offerOk ? 'May be structured once remaining verifications close.' : `NOT ready — ${offerReadiness.why}`)
    : (readiness?.pricingAllowed ? 'May be structured once remaining verifications close.' : 'NOT ready — blocked by the same pricing gate.');
  // Contract readiness comes from the SHARED unified record — never a hardcoded
  // frontend verdict. It stays separate from (and never outruns) offer readiness.
  const contract = unified?.dimensions.find((d) => d.key === 'contract') ?? null;
  const contractOk: boolean | null = contract ? contract.state === 'ready' : null;
  const contractNote = contract
    ? (contract.state === 'ready' ? contract.why : `${contract.stateLabel} — ${contract.why}`)
    : 'Contract readiness unavailable until the shared readiness record loads.';
  const rows: Array<{ label: string; ok: boolean | null; note: string }> = [
    { label: 'Parcel identity', ok: parcelVerified, note: parcelVerified ? 'Verified against the official parcel record.' : 'Not verified — resolve identity before substantive seller commitments.' },
    { label: 'Discovery call', ok: parcelVerified, note: parcelVerified ? 'Ready — use the guardrails and property-specific questions below.' : 'Light rapport only until the parcel is verified.' },
    { label: 'Pricing discussion', ok: readiness ? readiness.pricingAllowed : null, note: readiness?.pricingAllowed ? 'A validated value basis exists — preliminary guidance only, never a final number.' : 'NOT ready — no defensible value basis yet. Do not quote values, ranges, or $/acre.' },
    { label: 'Offer discussion', ok: offerOk, note: offerNote },
    { label: 'Contract readiness', ok: contractOk, note: contractNote },
  ];
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2">Seller-call readiness</div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
        {rows.map((row) => {
          const color = row.ok == null ? '#7d838f' : row.ok ? '#2fbf71' : '#f0a52e';
          return (
            <div key={row.label} class="rounded-md border border-[var(--color-border)] p-2.5" style={`border-left:4px solid ${color}`}>
              <div class="text-[12.5px] font-semibold text-[var(--color-text)]">{row.label}</div>
              <div class="text-[11.5px] font-bold mt-0.5" style={`color:${color}`}>{row.ok == null ? 'Unknown' : row.ok ? 'Ready' : 'Not ready'}</div>
              <div class="mt-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{row.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The one pricing guardrail block for calls — driven by the shared gate. */
export function CallGuardrailsPanel({ readiness }: { readiness: StrategyReadinessView | null }) {
  if (!readiness) return null;
  return (
    <div class="rounded-lg border border-[#f0a52e55] bg-[#f0a52e11] p-4 space-y-1.5">
      <div class="text-[12px] font-bold uppercase tracking-wider text-[#f0a52e]">Call Guardrails</div>
      {readiness.pricingAllowed ? (
        <div class="text-[13px] leading-relaxed text-[var(--color-text)]">A validated value basis exists — pricing may be discussed as preliminary guidance, never as a final offer.</div>
      ) : (
        <>
          <div class="text-[13px] leading-relaxed text-[var(--color-text)]">Do not quote a property value, offer range, price per acre, or strategy recommendation on this call — the evidence does not support them yet.</div>
          {readiness.pricingBlockers.map((b) => (
            <div class="text-[12px] leading-relaxed text-[#f0a52e]">• {b}</div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Merged "confirm before offer" (one section, specific blockers only) ───────

export function RemainingBlockersPanel({ readiness, unknowns }: { readiness: StrategyReadinessView | null; unknowns?: string[] | null }) {
  const items = new Set<string>();
  for (const b of readiness?.pricingBlockers ?? []) items.add(b);
  for (const s of readiness?.strategies ?? []) for (const b of s.blockers) items.add(b);
  for (const u of unknowns ?? []) items.add(u);
  // One fact, one bullet: when the pricing gate and the strategy record both
  // describe the SAME unresolved fact (e.g. disputed legal acreage needing a
  // survey/plat) in different wordings, keep only the most detailed wording.
  const topics: Array<RegExp> = [/acreage|acres/i, /legal access|road contact|right-of-way/i, /trust authority|title chain/i];
  for (const topic of topics) {
    const matched = [...items].filter((i) => topic.test(i) && /survey|plat|recorded|instrument|title/i.test(i));
    if (matched.length > 1) {
      const keep = matched.reduce((a, b) => (b.length > a.length ? b : a));
      for (const m of matched) if (m !== keep) items.delete(m);
    }
  }
  if (!items.size) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2">Confirm before offer — specific remaining blockers</div>
      <ul class="space-y-1.5">
        {[...items].map((item) => (
          <li class="text-[12.5px] leading-relaxed text-[var(--color-text)] pl-4 relative">
            <span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#f0a52e]" />{item}
          </li>
        ))}
      </ul>
      <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
        <div class="rounded-md border border-[var(--color-border)] p-2.5">
          <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)]">Research decision</div>
          <div class="text-[12.5px] text-[var(--color-text)] mt-0.5">{readiness?.decision === 'archive' ? 'Archive' : 'Continue research'}{readiness?.decisionWhy ? ` — ${readiness.decisionWhy}` : ''}</div>
        </div>
        <div class="rounded-md border border-[var(--color-border)] p-2.5">
          <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)]">Acquisition decision</div>
          <div class="text-[12.5px] text-[var(--color-text)] mt-0.5">{readiness?.pricingAllowed ? 'Reviewable — a value basis exists.' : 'Not ready — the pricing gate is closed.'}</div>
        </div>
      </div>
    </div>
  );
}

// ── Reconciled Land Score (screening profile only — never a pursue/pass chip) ─

export function ReconciledLandScorePanel({ ls }: { ls: OperatorRecordView['landScore'] | null | undefined }) {
  if (!ls) return null;
  if (!ls.available) {
    return (
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-1">Land Score</div>
        <div class="text-[12.5px] text-[var(--color-text-muted)]">{ls.unavailableReason}</div>
      </div>
    );
  }
  const profile = (ls as { profileLabel?: string }).profileLabel ?? 'Screening score only — not decision-ready';
  const highRisk = /high-risk/i.test(profile);
  const tone = highRisk ? '#ff5f56' : '#f0a52e';
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Land Score (screening rubric)</span>
        <span class="text-[14px] font-bold text-[var(--color-text)]">{ls.score}/{ls.maxScore}</span>
        <span class="text-[11.5px] px-2 py-0.5 rounded-full font-semibold border" style={`color:${tone};border-color:${tone}55;background:${tone}11`}>{profile}</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {ls.factors.map((f) => (
          <div key={f.id} class="text-[12.5px] leading-relaxed">
            <span class={`font-semibold ${f.lowestTier ? 'text-[#ff8a84]' : 'text-[var(--color-text)]'}`}>{f.label}</span>
            <span class="text-[var(--color-text-muted)]"> {f.points}/{f.maxPoints}{f.dataGap ? ' (not screened)' : ''}</span>
            <div class="text-[11.5px] text-[var(--color-text-faint)]">{f.basis}</div>
          </div>
        ))}
      </div>
      {ls.flags.length > 0 && (
        <ul class="space-y-1 border-t border-[var(--color-border)] pt-2">
          {ls.flags.map((flag) => (
            <li class="text-[12px] leading-relaxed text-[#f0a52e] pl-4 relative"><span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#f0a52e]" />{flag}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Official records (assessor + recorder), readable — not one dense block ────

export function OfficialRecordsPanel({ record, documents }: { record: OperatorRecordView; documents?: DocumentRegistryView | null }) {
  const id = record.identity;
  const deedLegal = documents?.documents.flatMap((d) => d.findings).find((f) => /legal description/i.test(f.label))?.detail ?? null;
  const nominal = !!id.lastSale && /(?:^|[^\d,.])\$[01](?:[^\d]|$)/.test(id.lastSale);
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
      <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Official records (assessor + recorder)</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {id.legalDescription && (
          <div class="text-[12.5px] leading-relaxed">
            <span class="text-[var(--color-text-faint)]">Assessor note / abbreviated legal field:</span> <span class="text-[var(--color-text)]">{id.legalDescription}</span>
            <div class="text-[11px] text-[var(--color-text-faint)]">Assessor shorthand — not the full legal description.</div>
          </div>
        )}
        {deedLegal && <div class="text-[12.5px] leading-relaxed"><span class="text-[var(--color-text-faint)]">Deed legal description:</span> <span class="text-[var(--color-text)]">{deedLegal}</span></div>}
        {id.deedReference && <div class="text-[12.5px]"><span class="text-[var(--color-text-faint)]">Deed reference:</span> <span class="text-[var(--color-text)]">{id.deedReference}</span></div>}
        {id.lastSale && (
          <div class="text-[12.5px]">
            <span class="text-[var(--color-text-faint)]">Last recorded transfer:</span> <span class="text-[var(--color-text)]">{id.lastSale}</span>
            {nominal && <div class="text-[11px] text-[#f0a52e]">Nominal family/trust conveyance — excluded from market evidence.</div>}
          </div>
        )}
        {id.landUseClass && <div class="text-[12.5px]"><span class="text-[var(--color-text-faint)]">County land class:</span> <span class="text-[var(--color-text)]">{id.landUseClass}</span></div>}
        {id.taxArea && <div class="text-[12.5px]"><span class="text-[var(--color-text-faint)]">Tax area:</span> <span class="text-[var(--color-text)]">{id.taxArea}</span></div>}
        {id.appraisedValue != null && <div class="text-[12.5px]"><span class="text-[var(--color-text-faint)]">County appraised value:</span> <span class="text-[var(--color-text)]">{`$${id.appraisedValue.toLocaleString()}`}</span></div>}
      </div>
    </div>
  );
}

// ── Manual local document upload ──────────────────────────────────────────────

interface OperatorUploadRow {
  id: number;
  category: string;
  title: string;
  docType: string;
  fileName: string;
  mimeType: string;
  documentDate: string | null;
  uploadedAt: string;
  note: string | null;
}

export function DocumentUploadPanel({ dealId, token, onUploaded }: { dealId: number; token: string; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('contract');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploads, setUploads] = useState<OperatorUploadRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('other');
  const [editNote, setEditNote] = useState('');
  const categories = [
    ['contract', 'Contract / purchase agreement'], ['survey', 'Survey'], ['plat', 'Plat'],
    ['title', 'Title commitment'], ['disclosure', 'Seller disclosure'], ['permit', 'Permit / approval'],
    ['other', 'Other (perc test, delineation, elevation cert, utility/zoning letter, closing doc)'],
  ] as const;
  const endpoint = (suffix = '') =>
    `/api/landos/deal-cards/${dealId}/documents/uploads${suffix}?token=${encodeURIComponent(token)}`;
  const loadUploads = async () => {
    try {
      const response = await fetch(endpoint());
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'uploads unavailable');
      setUploads(Array.isArray(body.uploads) ? body.uploads : []);
    } catch (error) {
      setMsg(`Documents could not be refreshed: ${(error as Error).message}`);
    }
  };
  useEffect(() => {
    void loadUploads();
  }, [dealId]);
  const upload = async () => {
    if (!file) { setMsg('Choose a file first.'); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', category);
      fd.append('title', title || file.name);
      const res = await fetch(`/api/landos/deal-cards/${dealId}/documents/upload?token=${encodeURIComponent(token)}`, { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'upload failed');
      setMsg(`Uploaded "${body.upload?.title ?? file.name}".`);
      setFile(null); setTitle('');
      setUploads(Array.isArray(body.uploads) ? body.uploads : []);
      onUploaded();
    } catch (err) {
      setMsg(`Upload failed: ${(err as Error).message}`);
    } finally { setBusy(false); }
  };
  const startEdit = (row: OperatorUploadRow) => {
    setEditingId(row.id);
    setEditTitle(row.title);
    setEditCategory(row.category);
    setEditNote(row.note ?? '');
    setMsg(null);
  };
  const saveEdit = async () => {
    if (editingId == null || !editTitle.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const response = await fetch(endpoint(`/${editingId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), category: editCategory, note: editNote.trim() || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'update failed');
      setUploads(Array.isArray(body.uploads) ? body.uploads : []);
      setEditingId(null);
      setMsg('Document details updated.');
      onUploaded();
    } catch (error) {
      setMsg(`Document update failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const removeUpload = async (row: OperatorUploadRow) => {
    if (!window.confirm(`Remove "${row.title}" from this Deal Card? The retained file will not be erased.`)) return;
    setBusy(true); setMsg(null);
    try {
      const response = await fetch(endpoint(`/${row.id}`), { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'delete failed');
      setUploads(Array.isArray(body.uploads) ? body.uploads : []);
      if (editingId === row.id) setEditingId(null);
      setMsg(`Removed "${row.title}" from this Deal Card.`);
      onUploaded();
    } catch (error) {
      setMsg(`Document removal failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="rounded-lg border border-dashed border-[var(--color-border-strong)] p-4 space-y-2">
      <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Upload a document</div>
      <div class="flex flex-wrap items-center gap-2">
        <input type="file" class="text-[12px] text-[var(--color-text-muted)]" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        <select class="text-[12px] bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)]" value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
          {categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="text" placeholder="Title (optional)" class="text-[12px] bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)]" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <button type="button" disabled={busy || !file} onClick={() => void upload()} class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      <div class="text-[11px] text-[var(--color-text-faint)]">Stored locally under this Deal Card. Supported: contracts, surveys, plats, title commitments, disclosures, perc tests, septic permits, wetland delineations, elevation certificates, utility/zoning letters, closing documents.</div>
      {msg && <div class="text-[12px] text-[var(--color-text-muted)]">{msg}</div>}
      <div class="border-t border-[var(--color-border)] pt-3">
        <div class="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-muted)]">Operator-uploaded documents</div>
        {uploads.length ? (
          <div class="space-y-2">
            {uploads.map((row) => (
              <div key={row.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                {editingId === row.id ? (
                  <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
                    <label class="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                      Title
                      <input aria-label={`Document title for ${row.title}`} value={editTitle} onInput={(event) => setEditTitle((event.currentTarget as HTMLInputElement).value)} class="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-2 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
                    </label>
                    <label class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                      Category
                      <select value={editCategory} onChange={(event) => setEditCategory((event.currentTarget as HTMLSelectElement).value)} class="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-2 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]">
                        {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label class="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)] sm:col-span-2">
                      Notes
                      <textarea value={editNote} onInput={(event) => setEditNote((event.currentTarget as HTMLTextAreaElement).value)} class="mt-1 min-h-[72px] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-2 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
                    </label>
                    <div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
                      <button type="button" disabled={busy} onClick={() => setEditingId(null)} class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11px]">Cancel</button>
                      <button type="button" disabled={busy || !editTitle.trim()} onClick={() => void saveEdit()} class="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-white">Save details</button>
                    </div>
                  </div>
                ) : (
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="min-w-[220px] flex-1">
                      <div class="break-words text-[12.5px] font-semibold text-[var(--color-text)]">{row.title}</div>
                      <div class="mt-1 break-words text-[10.5px] text-[var(--color-text-muted)]">{row.docType} · {row.category.replace(/_/g, ' ')} · uploaded {row.uploadedAt.slice(0, 10)}</div>
                      {row.note && <div class="mt-1 whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-[var(--color-text-faint)]">{row.note}</div>}
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <a href={`/api/landos/deal-cards/${dealId}/documents/upload-file/${encodeURIComponent(row.fileName)}?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer" class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-accent)]">Open</a>
                      <button type="button" disabled={busy} onClick={() => startEdit(row)} class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11px]">Edit details</button>
                      <button type="button" disabled={busy} onClick={() => void removeUpload(row)} class="rounded-md border border-rose-500/50 px-3 py-1.5 text-[11px] text-rose-400">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div class="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-[11px] text-[var(--color-text-faint)]">No operator-uploaded documents are attached to this Deal Card.</div>
        )}
      </div>
    </div>
  );
}
