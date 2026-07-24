import { useEffect, useRef, useState } from 'preact/hooks';
import { apiGet, apiPost, apiPostForm } from '@/lib/api';
import {
  insertClipboardPlainText,
  pendingImageIdentity,
  validatePendingIntakeImage,
  type PendingImageSourceMethod,
} from '@/lib/smart-intake-clipboard';

type RoutedFact = { id: number; section: string; fact_key?: string; key?: string; value: string; fact_status?: string; status?: string; conflictNote?: string };
type Transcript = {
  person?: string | null; department?: string | null; organization?: string | null; phone?: string | null; email?: string | null;
  callDate?: string | null; propertyDiscussed?: string | null; importantStatements?: string[]; confirmedFacts?: string[];
  contactStatedFacts?: string[]; sellerMotivation?: string | null; timeline?: string | null; askingPrice?: number | null;
  objections?: string[]; restrictions?: string[]; unresolvedQuestions?: string[]; followUps?: string[];
};
type Submission = {
  id: number; submissionType: string; source: string; originalText: string; originalFileName?: string; originalFileUrl?: string;
  mimeType?: string;
  summary: string; sections: string[]; extracted?: { transcript?: Transcript | null; followUps?: string[] }; transcript?: Transcript | null;
  facts: RoutedFact[]; status: string; createdAt?: number;
  resolutionHandoff?: {
    state?: string; attempted?: boolean; resolutionStatus?: string; identityEstablishedByApprovedSource?: boolean;
    canonicalPromotionApplied?: boolean; ownerContactMatchRequired?: boolean; message?: string;
  };
  artifacts?: IntakeArtifact[];
};
type IntakeCandidate = { id: number; key: string; value: string; confidence: string; uncertain: boolean; source: string };
type IntakeArtifact = {
  id: number; originalFileName: string; fileUrl: string; mimeType: string; byteSize: number; sha256: string;
  sourceMethod: PendingImageSourceMethod; exactExtractedText: string; extractionStatus: string; extractionModel: string;
  uncertainFields: string[]; missingFields: string[]; notes: string[]; otherFacts: Array<{ label: string; value: string }>;
  capturedAt: number; candidates: IntakeCandidate[];
};
type PendingImage = { id: string; file: File; sourceMethod: PendingImageSourceMethod };
type ResourceContact = {
  id: number; category: string; organization: string; department: string; representative: string; role: string; phone: string; email: string;
  website: string; address: string; jurisdiction: string; notes: string; source: string; last_contacted_date: string; next_follow_up: string;
  linkedItems?: string[];
};
type PublicRecord = {
  id: number; category: string; title: string; jurisdiction: string; authority: string; retrieval_status: string; summary: string;
  facts?: Record<string, unknown>; source_url: string; screenshot_url: string; document_url: string; searched_at: string; next_follow_up: string;
};
type Person = { id: number; name: string; roles?: string[]; role?: string; phone?: string; email?: string; mailing_address?: string };

const inputClass = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';
const sectionLabel = (value: string) => ({
  seller_contact: 'Seller & contact', motivation_timeline: 'Motivation & timeline', property: 'Property', due_diligence: 'Due diligence',
  public_record: 'Public records', deed_title_easement: 'Deed, title & easements', lien_judgment_tax: 'Liens, judgments & taxes',
  planning_zoning_subdivision: 'Planning, zoning & subdivision', utilities_septic_access: 'Utilities, septic & access', market: 'Market',
  strategy: 'Strategy', resource_contact: 'Resources & contacts', document: 'Documents', activity: 'Activity',
}[value] ?? value.replace(/_/g, ' '));
const resourceLabel = (value: string) => ({
  planning_zoning: 'Planning / zoning', assessor_gis: 'Assessor / GIS', clerk_recorder: 'Clerk / recorder', tax_office: 'Tax office',
  health_department: 'Health department', roads_bridges: 'Roads & bridges', utility: 'Utility', surveyor: 'Surveyor', soil_scientist: 'Soil scientist',
  septic_professional: 'Septic professional', excavation_site_work: 'Excavation / site work', manufactured_home: 'Manufactured-home resource', other: 'Other',
}[value] ?? value.replace(/_/g, ' '));
const statusLabel = (value: string) => value === 'retrieved_yes' ? 'Retrieved - Yes' : value === 'no_matching_record' ? 'No matching record in searched public index' : 'Retrieved - No';
const formatArtifactTimestamp = (value: number) => Number.isFinite(value)
  ? new Date(value * 1000).toLocaleString()
  : 'Unknown';

function TranscriptResult({ transcript }: { transcript?: Transcript | null }) {
  if (!transcript) return null;
  const rows = [
    ['Person / department', [transcript.person, transcript.department].filter(Boolean).join(' - ')], ['Organization', transcript.organization],
    ['Contact', [transcript.phone, transcript.email].filter(Boolean).join(' - ')], ['Call date', transcript.callDate],
    ['Property discussed', transcript.propertyDiscussed], ['Seller motivation', transcript.sellerMotivation], ['Timeline', transcript.timeline],
    ['Asking price', transcript.askingPrice == null ? null : `$${transcript.askingPrice.toLocaleString()}`],
  ].filter(([, value]) => value) as Array<[string, string]>;
  const lists: Array<[string, string[] | undefined]> = [
    ['Confirmed facts', transcript.confirmedFacts], ['Contact-stated facts', transcript.contactStatedFacts], ['Important statements', transcript.importantStatements],
    ['Objections', transcript.objections], ['Restrictions', transcript.restrictions], ['Unresolved questions', transcript.unresolvedQuestions], ['Follow-ups', transcript.followUps],
  ];
  return (
    <div class="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 space-y-1.5">
      {rows.length > 0 && <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">{rows.map(([label, value]) => <div key={label} class="text-[11.5px]"><span class="text-[var(--color-text-faint)]">{label}:</span> {value}</div>)}</div>}
      {lists.map(([label, values]) => values?.length ? <div key={label} class="text-[11.5px]"><span class="text-[var(--color-text-faint)]">{label}:</span> {values.slice(0, 5).join('; ')}</div> : null)}
    </div>
  );
}

function PendingImagePreview({ pending, onRemove }: { pending: PendingImage; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(pending.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [pending.file]);
  return (
    <div data-testid="smart-intake-file-preview" class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 flex items-start gap-3">
      {url && <img src={url} alt="Pasted property image preview" class="h-24 w-36 rounded border border-[var(--color-border)] object-cover" />}
      <div class="min-w-0 text-[11.5px] text-[var(--color-text-muted)]">
        <div class="font-medium text-[var(--color-text)] break-all">{pending.file.name}</div>
        <div>Image ready · {(pending.file.size / 1024).toFixed(1)} KB · {pending.sourceMethod}</div>
        <button type="button" data-testid="smart-intake-remove-image" class="mt-1 text-[var(--color-accent)] underline" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

export function SmartIntakePanel({ dealId, token = '', onChanged }: { dealId: number; token?: string; onChanged?: () => void }) {
  const [text, setText] = useState('');
  const [type, setType] = useState<'general' | 'transcript'>('general');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [candidateDraft, setCandidateDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submissionKey, setSubmissionKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `intake-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const [viewerArtifact, setViewerArtifact] = useState<IntakeArtifact | null>(null);
  const [viewerActualSize, setViewerActualSize] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const withToken = (url: string) => token && url.startsWith('/api/')
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : url;
  const load = () => apiGet<{ submissions: Submission[] }>(`/api/landos/deal-cards/${dealId}/intake`).then((result) => setSubmissions(result.submissions)).catch(() => setSubmissions([]));
  useEffect(() => { void load(); }, [dealId]);
  useEffect(() => {
    setViewerArtifact(null);
    setViewerActualSize(false);
  }, [dealId]);
  useEffect(() => {
    if (!viewerArtifact) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewerArtifact(null);
        setViewerActualSize(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [viewerArtifact]);
  useEffect(() => {
    const values: Record<string, string> = {};
    for (const artifact of submissions[0]?.artifacts ?? []) {
      for (const candidate of artifact.candidates ?? []) if (!(candidate.key in values)) values[candidate.key] = candidate.value;
    }
    setCandidateDraft(values);
  }, [submissions]);
  const appendImages = (files: File[], sourceMethod: PendingImageSourceMethod) => {
    const accepted: PendingImage[] = [];
    const errors: string[] = [];
    const seen = new Set(pendingImages.map((pending) => pendingImageIdentity(pending.file)));
    files.forEach((file, index) => {
      const error = validatePendingIntakeImage(file);
      if (error) { errors.push(`${file.name || `Image ${index + 1}`}: ${error}`); return; }
      const identity = pendingImageIdentity(file);
      if (seen.has(identity)) return;
      seen.add(identity);
      const extension = file.type.toLowerCase().includes('jpeg') ? 'jpg' : file.type.split('/')[1] || 'png';
      const normalized = file.name ? file : new File([file], `clipboard-property-image-${Date.now()}-${index + 1}.${extension}`, { type: file.type });
      accepted.push({ id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`, file: normalized, sourceMethod });
    });
    if (accepted.length) setPendingImages((current) => [...current, ...accepted]);
    setMessage(errors.length ? errors.join(' ') : `${accepted.length} image${accepted.length === 1 ? '' : 's'} ready. Add text if useful, then Save and organize.`);
  };
  const handlePaste = (event: ClipboardEvent) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const images = Array.from(clipboard.items)
      .filter((item) => item.kind === 'file' && /^image\/(?:png|jpeg|jpg|webp)$/i.test(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);
    // Leave text-only paste native so Ctrl+V, right-click Paste, selection
    // replacement, undo, line breaks, and large values keep browser semantics.
    if (images.length === 0) return;
    event.preventDefault();
    appendImages(images, 'clipboard');
    const plainText = clipboard.getData('text/plain');
    if (plainText) {
      const textarea = textareaRef.current;
      const insertion = insertClipboardPlainText(text, plainText, textarea?.selectionStart ?? text.length, textarea?.selectionEnd ?? text.length);
      setText(insertion.value);
      queueMicrotask(() => {
        textarea?.focus();
        textarea?.setSelectionRange(insertion.caret, insertion.caret);
      });
    }
  };
  const submit = async () => {
    if (!text.trim() && pendingImages.length === 0) { setMessage('Paste information or add an image.'); return; }
    setBusy(true); setMessage('');
    try {
      let result: { submission: Submission; submissions: Submission[]; duplicatePrevented?: boolean };
      if (pendingImages.length > 0) {
        const body = new FormData();
        pendingImages.forEach((pending) => body.append('files', pending.file));
        body.append('sourceMethods', JSON.stringify(pendingImages.map((pending) => pending.sourceMethod)));
        body.append('submissionType', type);
        body.append('note', text);
        body.append('source', 'Deal Card smart intake');
        body.append('submissionKey', submissionKey);
        result = await apiPostForm(`/api/landos/deal-cards/${dealId}/intake/upload`, body);
      } else {
        result = await apiPost(`/api/landos/deal-cards/${dealId}/intake`, { text, submissionType: type, source: 'Deal Card smart intake', submissionKey });
      }
      setSubmissions(result.submissions);
      setText('');
      setPendingImages([]);
      setSubmissionKey(globalThis.crypto?.randomUUID?.() ?? `intake-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      setMessage(result.duplicatePrevented
        ? 'This intake was already saved; LandOS prevented a duplicate submission.'
        : pendingImages.length
          ? `${pendingImages.length} original image${pendingImages.length === 1 ? '' : 's'} saved with candidate extraction and Documents-tab access.`
          : `${type === 'transcript' ? 'Transcript' : 'Information'} saved and routed to ${result.submission.sections.map(sectionLabel).join(', ')}.`);
      onChanged?.();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const saveCandidateEdits = async (submissionId: number) => {
    setBusy(true); setMessage('');
    try {
      const result = await apiPost<{ submissions: Submission[]; resolutionHandoff: { message?: string } }>(`/api/landos/deal-cards/${dealId}/intake/${submissionId}/candidates`, { values: candidateDraft });
      setSubmissions(result.submissions);
      setMessage(result.resolutionHandoff.message ?? 'Candidate corrections saved and resolution retried.');
      onChanged?.();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section id="deal-card-smart-intake" data-testid="smart-intake" onPaste={handlePaste} class="scroll-mt-24 rounded-lg border-2 border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3 shadow-sm">
      <div>
        <h3 class="text-[14px] font-semibold text-[var(--color-text)]">Smart Intake — update this Deal Card</h3>
        <div class="text-[11.5px] text-[var(--color-text-muted)]">Paste or type addresses, parcel IDs, seller or wholesaler details, notes, emails, and call transcripts. Paste screenshots with Ctrl+V, choose images, or drop PNG, JPG/JPEG, and WEBP files below. Text remains editable and nothing submits until you choose Save and organize.</div>
      </div>
      <div class="flex gap-2 items-start flex-wrap">
        <select aria-label="Information type" class={`${inputClass} sm:w-44`} value={type} onChange={(event) => setType((event.target as HTMLSelectElement).value as 'general' | 'transcript')}>
          <option value="general">General information</option><option value="transcript">Call transcript</option>
        </select>
        <label class="cursor-pointer rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text)]">Choose images<input aria-label="Choose Smart Intake images" type="file" multiple accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" class="sr-only" onChange={(event) => {
          const input = event.target as HTMLInputElement;
          appendImages(Array.from(input.files ?? []), 'upload');
          input.value = '';
        }} /></label>
      </div>
      <div data-testid="smart-intake-drop-zone" class="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11.5px] text-[var(--color-text-muted)]" onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event) => {
        event.preventDefault();
        appendImages(Array.from(event.dataTransfer?.files ?? []), 'drop');
      }}>Drop PNG, JPG/JPEG, or WEBP screenshots here. Up to 10 images, 10 MB each.</div>
      {pendingImages.length > 0 && <div data-testid="smart-intake-image-previews" class="grid gap-2 md:grid-cols-2">{pendingImages.map((pending) => <PendingImagePreview key={pending.id} pending={pending} onRemove={() => setPendingImages((current) => current.filter((item) => item.id !== pending.id))} />)}</div>}
      <textarea ref={textareaRef} aria-label="New Deal Card information" rows={6} class={inputClass} placeholder={type === 'transcript' ? 'Paste the call transcript here…' : 'Paste anything new about this lead or property…'} value={text} onInput={(event) => setText((event.target as HTMLTextAreaElement).value)} />
      <div class="flex items-center gap-3">
        <button type="button" data-testid="smart-intake-submit" disabled={busy || (!text.trim() && pendingImages.length === 0)} onClick={() => void submit()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent)] disabled:opacity-40">{busy ? 'Organizing…' : 'Save and organize'}</button>
        {message && <div data-testid="smart-intake-message" class="text-[11.5px] text-[var(--color-text-muted)]">{message}</div>}
      </div>
      {submissions.length > 0 && (() => {
        const latest = submissions[0];
        const transcript = latest.transcript ?? latest.extracted?.transcript;
        return <div data-testid="latest-saved-intake" class="rounded-md border border-[var(--color-accent)] bg-[var(--color-bg)] p-3">
          <div class="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">Latest saved intake</div>
          <div class="mt-1 flex flex-wrap items-center gap-2"><span class="text-[12px] font-medium">{latest.originalFileName || (latest.submissionType === 'transcript' ? 'Transcript' : 'Information')}</span><span class="text-[10px] text-[var(--color-text-faint)]">{latest.sections.map(sectionLabel).join(' · ')}</span></div>
          <div class="mt-1 text-[11.5px] text-[var(--color-text-muted)]">{latest.summary}</div>
          {latest.originalText && <details class="mt-2"><summary class="cursor-pointer text-[10.5px] text-[var(--color-accent)]">Open exact original text</summary><pre class="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] p-2 text-[11px]">{latest.originalText}</pre></details>}
          <TranscriptResult transcript={transcript} />
          {(latest.artifacts ?? []).map((artifact) => <article key={artifact.id} data-testid="saved-intake-artifact" class="mt-3 rounded-md border border-[var(--color-border)] p-3">
            <div class="grid gap-3 lg:grid-cols-[minmax(180px,320px)_1fr]">
              <button
                type="button"
                data-testid="smart-intake-artifact-preview"
                aria-label={`Open full-resolution original image ${artifact.originalFileName}`}
                class="group rounded border border-[var(--color-border)] bg-[var(--color-card)] p-1 text-left focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                onClick={() => {
                  setViewerActualSize(false);
                  setViewerArtifact(artifact);
                }}
              >
                <img src={withToken(artifact.fileUrl)} alt={artifact.originalFileName || 'Saved Smart Intake image'} class="max-h-64 w-full rounded object-contain" />
                <span class="mt-1 block text-center text-[10.5px] font-medium text-[var(--color-accent)] underline group-hover:no-underline">Open full-resolution original image</span>
              </button>
              <div data-testid="smart-intake-artifact-provenance" class="min-w-0 text-[11px] text-[var(--color-text-muted)]">
                <div class="font-semibold text-[var(--color-text)] break-all">{artifact.originalFileName}</div>
                <div class="mt-1 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5">
                  <span>Type</span><span class="text-[var(--color-text)]">{artifact.mimeType}</span>
                  <span>Size</span><span class="text-[var(--color-text)]">{artifact.byteSize.toLocaleString()} bytes ({(artifact.byteSize / 1024).toFixed(1)} KB)</span>
                  <span>Source</span><span class="text-[var(--color-text)]">{artifact.sourceMethod}</span>
                  <span>Intake time</span><span class="text-[var(--color-text)]">{formatArtifactTimestamp(artifact.capturedAt)}</span>
                  <span>Association</span><span class="text-[var(--color-text)]">Deal Card #{dealId} · Smart Intake submission #{latest.id}</span>
                  <span>SHA-256</span><span class="break-all font-mono text-[10px] text-[var(--color-text)]">{artifact.sha256}</span>
                </div>
                <div class="mt-1">Extraction: <span class="font-medium text-[var(--color-text)]">{artifact.extractionStatus}</span>. These are editable intake candidates, not confirmed property facts or geometry.</div>
                {artifact.uncertainFields.length > 0 && <div class="mt-1 text-amber-700 dark:text-amber-300">Uncertain: {artifact.uncertainFields.join(', ')}</div>}
                {artifact.missingFields.length > 0 && <div class="mt-1">Not read: {artifact.missingFields.join(', ')}</div>}
                {artifact.notes.map((note) => <div key={note} class="mt-1">{note}</div>)}
              </div>
            </div>
            {artifact.exactExtractedText && <details class="mt-2"><summary class="cursor-pointer text-[10.5px] text-[var(--color-accent)]">Exact visible text extracted</summary><pre class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] p-2 text-[11px]">{artifact.exactExtractedText}</pre></details>}
          </article>)}
          {(latest.artifacts ?? []).some((artifact) => artifact.candidates.length > 0) && <div data-testid="smart-intake-candidates" class="mt-3 rounded-md border border-[var(--color-border)] p-3">
            <div class="text-[11px] font-semibold text-[var(--color-text)]">Editable screenshot candidates</div>
            <div class="mt-2 grid gap-2 md:grid-cols-2">{Object.entries(candidateDraft).map(([key, value]) => <label key={key} class="text-[10.5px] text-[var(--color-text-muted)]"><span>{key.replace(/([A-Z])/g, ' $1')}</span><input class={inputClass} value={value} onInput={(event) => setCandidateDraft((current) => ({ ...current, [key]: (event.target as HTMLInputElement).value }))} /></label>)}</div>
            <button type="button" data-testid="smart-intake-save-candidates" disabled={busy} onClick={() => void saveCandidateEdits(latest.id)} class="mt-2 rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--color-accent)] disabled:opacity-40">Save candidate corrections and retry resolution</button>
          </div>}
          {latest.resolutionHandoff?.message && <div data-testid="smart-intake-resolution-handoff" class="mt-2 rounded-md border border-[var(--color-border)] p-2 text-[11px] text-[var(--color-text-muted)]">{latest.resolutionHandoff.message}<div class="mt-1 font-medium text-[var(--color-text)]">Canonical promotion: none · Owner/contact match required: no</div></div>}
        </div>;
      })()}
      {submissions.length > 1 && (
        <details>
          <summary class="cursor-pointer text-[11.5px] font-medium text-[var(--color-text-muted)]">Earlier intake ({submissions.length - 1})</summary>
          <div class="mt-2 space-y-2">
            {submissions.slice(1, 8).map((submission) => {
              const transcript = submission.transcript ?? submission.extracted?.transcript;
              return <div key={submission.id} class="rounded-md border border-[var(--color-border)] p-2.5">
                <div class="flex flex-wrap items-center gap-2"><span class="text-[12px] font-medium">{submission.submissionType === 'transcript' ? 'Transcript' : 'Information'}</span><span class="text-[10px] text-[var(--color-text-faint)]">{submission.sections.map(sectionLabel).join(' - ')}</span></div>
                <div class="mt-1 text-[11.5px] text-[var(--color-text-muted)]">{submission.summary}</div>
                <TranscriptResult transcript={transcript} />
                {submission.facts?.filter((fact) => fact.conflictNote).map((fact) => <div key={fact.id} class="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Needs review: {fact.conflictNote}</div>)}
                <details class="mt-1"><summary class="cursor-pointer text-[10.5px] text-[var(--color-accent)]">Open original</summary>{submission.originalFileUrl && /^image\//i.test(submission.mimeType ?? '') && <img src={withToken(submission.originalFileUrl)} alt={submission.originalFileName || 'Uploaded property image'} class="mt-2 max-h-72 max-w-full rounded border border-[var(--color-border)] object-contain" />}<div class="mt-1 whitespace-pre-wrap text-[11px] text-[var(--color-text-muted)] max-h-52 overflow-auto">{submission.originalText || submission.originalFileName}</div>{submission.originalFileUrl && <a href={withToken(submission.originalFileUrl)} target="_blank" rel="noreferrer" class="text-[10.5px] text-[var(--color-accent)] underline">Open uploaded file</a>}</details>
              </div>;
            })}
          </div>
        </details>
      )}
      {viewerArtifact && (
        <div
          data-testid="smart-intake-artifact-viewer-backdrop"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6"
          onClick={() => {
            setViewerArtifact(null);
            setViewerActualSize(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Full-resolution original image ${viewerArtifact.originalFileName}`}
            data-testid="smart-intake-artifact-viewer"
            class="flex max-h-full w-full max-w-[min(96vw,1600px)] flex-col overflow-hidden rounded-lg border border-white/20 bg-[var(--color-card)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <div class="min-w-0">
                <div class="text-[12px] font-semibold text-[var(--color-text)]">Immutable Smart Intake original</div>
                <div class="truncate text-[10.5px] text-[var(--color-text-muted)]">{viewerArtifact.originalFileName} · {viewerArtifact.mimeType} · {viewerArtifact.byteSize.toLocaleString()} bytes</div>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" data-testid="smart-intake-artifact-viewer-zoom" class="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text)]" onClick={() => setViewerActualSize((current) => !current)}>
                  {viewerActualSize ? 'Fit to viewer' : 'View at 100%'}
                </button>
                <button type="button" data-testid="smart-intake-artifact-viewer-close" aria-label="Close original image viewer" class="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text)]" onClick={() => {
                  setViewerArtifact(null);
                  setViewerActualSize(false);
                }}>Close</button>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-auto bg-black p-2 text-center">
              <img
                data-testid="smart-intake-artifact-full-image"
                src={withToken(viewerArtifact.fileUrl)}
                alt={`Full-resolution original ${viewerArtifact.originalFileName}`}
                class={viewerActualSize ? 'mx-auto h-auto max-w-none' : 'mx-auto max-h-[calc(100vh-10rem)] max-w-full object-contain'}
              />
            </div>
            <div class="border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-muted)]">
              Deal Card #{dealId} · SHA-256 <span class="break-all font-mono">{viewerArtifact.sha256}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function ResourcesContactsPanel({ dealId, people = [] }: { dealId: number; people?: Person[] }) {
  const categories = ['planning_zoning','assessor_gis','clerk_recorder','tax_office','health_department','roads_bridges','utility','surveyor','soil_scientist','septic_professional','excavation_site_work','manufactured_home','other'];
  const [contacts, setContacts] = useState<ResourceContact[]>([]);
  const [form, setForm] = useState({ category: 'planning_zoning', organization: '', department: '', representative: '', role: '', phone: '', email: '', website: '', address: '', jurisdiction: '', notes: '', source: '', lastContactedDate: '', nextFollowUp: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => apiGet<{ contacts: ResourceContact[] }>(`/api/landos/deal-cards/${dealId}/resources`).then((result) => setContacts(result.contacts)).catch(() => setContacts([]));
  useEffect(() => { void load(); }, [dealId]);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await apiPost<{ contacts: ResourceContact[] }>(`/api/landos/deal-cards/${dealId}/resources`, form);
      setContacts(result.contacts); setMessage('Resource contact saved. Matching organization, department, representative, and category were updated instead of duplicated.');
      setForm((current) => ({ ...current, organization: '', department: '', representative: '', role: '', phone: '', email: '', website: '', address: '', notes: '', source: '', lastContactedDate: '', nextFollowUp: '' }));
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="resources-contacts" class="space-y-3">
      {people.length > 0 && <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"><h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Lead and owner contact</h3>{people.map((person) => <div key={person.id} class="text-[12px]"><span class="font-semibold">{person.name}</span>{person.roles?.length ? ` - ${person.roles.map(sectionLabel).join(', ')}` : person.role ? ` - ${person.role}` : ''}{person.phone ? ` - ${person.phone}` : ''}{person.email ? ` - ${person.email}` : ''}</div>)}</section>}
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
        <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Add or update a resource</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select aria-label="Resource category" class={inputClass} value={form.category} onChange={(e) => set('category', (e.target as HTMLSelectElement).value)}>{categories.map((category) => <option key={category} value={category}>{resourceLabel(category)}</option>)}</select>
          <input aria-label="Organization" class={inputClass} placeholder="Organization" value={form.organization} onInput={(e) => set('organization', (e.target as HTMLInputElement).value)} />
          <input aria-label="Department" class={inputClass} placeholder="Department" value={form.department} onInput={(e) => set('department', (e.target as HTMLInputElement).value)} />
          <input aria-label="Representative" class={inputClass} placeholder="Representative" value={form.representative} onInput={(e) => set('representative', (e.target as HTMLInputElement).value)} />
          <input aria-label="Role" class={inputClass} placeholder="Role" value={form.role} onInput={(e) => set('role', (e.target as HTMLInputElement).value)} />
          <input aria-label="Phone" class={inputClass} placeholder="Phone" value={form.phone} onInput={(e) => set('phone', (e.target as HTMLInputElement).value)} />
          <input aria-label="Email" class={inputClass} placeholder="Email" value={form.email} onInput={(e) => set('email', (e.target as HTMLInputElement).value)} />
          <input aria-label="Website" class={inputClass} placeholder="Website" value={form.website} onInput={(e) => set('website', (e.target as HTMLInputElement).value)} />
          <input aria-label="Address" class={inputClass} placeholder="Address" value={form.address} onInput={(e) => set('address', (e.target as HTMLInputElement).value)} />
          <input aria-label="Jurisdiction" class={inputClass} placeholder="Jurisdiction / service area" value={form.jurisdiction} onInput={(e) => set('jurisdiction', (e.target as HTMLInputElement).value)} />
          <input aria-label="Source" class={inputClass} placeholder="Source" value={form.source} onInput={(e) => set('source', (e.target as HTMLInputElement).value)} />
          <input aria-label="Last contacted date" type="date" class={inputClass} value={form.lastContactedDate} onInput={(e) => set('lastContactedDate', (e.target as HTMLInputElement).value)} />
          <input aria-label="Next follow-up" class={`${inputClass} md:col-span-2`} placeholder="Next follow-up" value={form.nextFollowUp} onInput={(e) => set('nextFollowUp', (e.target as HTMLInputElement).value)} />
          <textarea aria-label="Resource notes" class={`${inputClass} md:col-span-3`} rows={2} placeholder="Notes" value={form.notes} onInput={(e) => set('notes', (e.target as HTMLTextAreaElement).value)} />
        </div>
        <button type="button" data-testid="resource-save" disabled={busy || (!form.organization.trim() && !form.department.trim())} onClick={() => void save()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent)] disabled:opacity-40">{busy ? 'Saving…' : 'Save resource'}</button>
        {message && <div class="text-[11px] text-[var(--color-text-muted)]">{message}</div>}
      </section>
      <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"><h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Resources and contacts</h3>{contacts.length === 0 ? <div class="text-[12px] text-[var(--color-text-faint)]">No property-specific resources saved yet.</div> : <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">{contacts.map((contact) => <article key={contact.id} class="rounded-md border border-[var(--color-border)] p-2.5 text-[11.5px]"><div class="flex flex-wrap gap-2"><span class="font-semibold text-[var(--color-text)]">{contact.organization || contact.department}</span><span class="text-[10px] text-[var(--color-text-faint)]">{resourceLabel(contact.category)}</span></div><div>{[contact.department, contact.representative, contact.role].filter(Boolean).join(' - ')}</div><div>{[contact.phone, contact.email].filter(Boolean).join(' - ')}</div>{contact.website && <a href={contact.website} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Website</a>}{contact.address && <div>{contact.address}</div>}{contact.jurisdiction && <div>Serves: {contact.jurisdiction}</div>}{contact.notes && <div class="mt-1 text-[var(--color-text-muted)]">{contact.notes}</div>}{contact.source && <div class="text-[10.5px] text-[var(--color-text-faint)]">Source: {contact.source}</div>}{contact.linkedItems?.length ? <div class="text-[10.5px] text-[var(--color-text-faint)]">Linked: {contact.linkedItems.join(', ')}</div> : null}{contact.last_contacted_date && <div>Last contacted: {contact.last_contacted_date}</div>}{contact.next_follow_up && <div class="mt-1"><span class="font-medium">Next:</span> {contact.next_follow_up}</div>}</article>)}</div>}</section>
    </div>
  );
}

export function PublicRecordsPanel({ dealId }: { dealId: number }) {
  const [data, setData] = useState<{ hierarchy: { subjectReady: boolean; roadOnlyAccepted: boolean; identitySignals: string[]; authorities: Array<{ level: string; label: string }>; warning: string }; records: PublicRecord[] } | null>(null);
  useEffect(() => { apiGet<typeof data & {}>(`/api/landos/deal-cards/${dealId}/public-records`).then(setData).catch(() => setData(null)); }, [dealId]);
  if (!data) return <div class="text-[12px] text-[var(--color-text-faint)]">Loading public records…</div>;
  return (
    <section data-testid="public-records" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
      <div><h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Public records and governing authorities</h3><div class="text-[11px] text-[var(--color-text-muted)]">{data.hierarchy.warning}</div><div class="text-[10.5px] text-[var(--color-text-faint)]">Matched with: {data.hierarchy.identitySignals.join(', ')}{data.hierarchy.roadOnlyAccepted ? ' - road-only situs accepted for this vacant parcel' : ''}</div></div>
      <div class="flex flex-wrap gap-1">{data.hierarchy.authorities.map((authority) => <span key={authority.label} class="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{authority.label}</span>)}</div>
      {data.records.length === 0 ? <div class="text-[12px] text-[var(--color-text-faint)]">No public-record outcomes saved yet.</div> : <div class="space-y-2">{data.records.map((record) => <article key={record.id} class="rounded-md border border-[var(--color-border)] p-3"><div class="flex flex-wrap items-center gap-2"><span class="text-[12px] font-semibold">{record.title || record.category}</span><span class="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">{statusLabel(record.retrieval_status)}</span></div><div class="text-[10.5px] text-[var(--color-text-faint)]">{record.authority}{record.jurisdiction ? ` - ${record.jurisdiction}` : ''}{record.searched_at ? ` - searched ${record.searched_at.slice(0, 10)}` : ''}</div><div class="mt-1 text-[11.5px] text-[var(--color-text-muted)]">{record.summary}</div>{record.facts && Object.keys(record.facts).length > 0 && <dl class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">{Object.entries(record.facts).map(([key, value]) => value == null || value === '' ? null : <div key={key} class="flex justify-between gap-3 text-[11px]"><dt class="text-[var(--color-text-faint)]">{key.replace(/_/g, ' ')}</dt><dd class="text-right">{Array.isArray(value) ? value.join('; ') : String(value)}</dd></div>)}</dl>}<div class="mt-2 flex flex-wrap gap-3 text-[10.5px]">{record.source_url && <a href={record.source_url} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Official source</a>}{record.document_url && <a href={record.document_url} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Open document</a>}{record.screenshot_url && <a href={record.screenshot_url} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Open screenshot</a>}</div>{record.next_follow_up && <div class="mt-1 text-[11px]"><span class="font-medium">Next:</span> {record.next_follow_up}</div>}</article>)}</div>}
    </section>
  );
}
