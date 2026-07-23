import { useEffect, useState } from 'preact/hooks';
import { apiGet, apiPost, apiPostForm } from '@/lib/api';

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
};
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

export function SmartIntakePanel({ dealId, token = '', onChanged }: { dealId: number; token?: string; onChanged?: () => void }) {
  const [text, setText] = useState('');
  const [type, setType] = useState<'general' | 'transcript'>('general');
  const [file, setFile] = useState<File | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [filePreviewUrl, setFilePreviewUrl] = useState('');
  useEffect(() => {
    if (!file || !/^image\//i.test(file.type)) { setFilePreviewUrl(''); return; }
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const withToken = (url: string) => token && url.startsWith('/api/')
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : url;
  const load = () => apiGet<{ submissions: Submission[] }>(`/api/landos/deal-cards/${dealId}/intake`).then((result) => setSubmissions(result.submissions)).catch(() => setSubmissions([]));
  useEffect(() => { void load(); }, [dealId]);
  const acceptPastedImage = (event: ClipboardEvent) => {
    const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === 'file' && /^image\//i.test(item.type));
    const pasted = imageItem?.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    const extension = pasted.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    setFile(new File([pasted], `clipboard-property-image-${stamp}.${extension}`, { type: pasted.type }));
    setMessage('Pasted image is ready. Add an optional note, then Save and organize.');
  };
  const submit = async () => {
    if (!text.trim() && !file) { setMessage('Paste information or choose a file.'); return; }
    setBusy(true); setMessage('');
    try {
      let result: { submission: Submission; submissions: Submission[] };
      if (file) {
        const body = new FormData(); body.append('file', file); body.append('submissionType', type); body.append('note', text); body.append('source', 'Deal Card smart intake');
        result = await apiPostForm(`/api/landos/deal-cards/${dealId}/intake/upload`, body);
      } else {
        result = await apiPost(`/api/landos/deal-cards/${dealId}/intake`, { text, submissionType: type, source: 'Deal Card smart intake' });
      }
      setSubmissions(result.submissions); setText(''); setFile(null);
      setMessage(file
        ? `${/^image\//i.test(file.type) ? 'Image' : 'File'} saved to this Deal Card. It is visible below and on the Documents tab.`
        : `${type === 'transcript' ? 'Transcript' : 'Information'} saved and routed to ${result.submission.sections.map(sectionLabel).join(', ')}.`);
      onChanged?.();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section id="deal-card-smart-intake" data-testid="smart-intake" onPaste={acceptPastedImage} class="scroll-mt-24 rounded-lg border-2 border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3 shadow-sm">
      <div>
        <h3 class="text-[14px] font-semibold text-[var(--color-text)]">Smart Intake — update this Deal Card</h3>
        <div class="text-[11.5px] text-[var(--color-text-muted)]">Add any new information here: a note, seller statement, call transcript, contact, property fact, public-record finding, or file. Paste a screenshot or property image directly with Ctrl+V, or choose a file. LandOS keeps the original and organizes the useful facts into the right Deal Card sections.</div>
      </div>
      <div class="flex gap-2 items-start flex-wrap">
        <select aria-label="Information type" class={`${inputClass} sm:w-44`} value={type} onChange={(event) => setType((event.target as HTMLSelectElement).value as 'general' | 'transcript')}>
          <option value="general">General information</option><option value="transcript">Call transcript</option>
        </select>
        <input aria-label="Upload information" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.srt,.vtt,.csv,.json,.doc,.docx,.xls,.xlsx" class="text-[12px] text-[var(--color-text-muted)]" onChange={(event) => setFile((event.target as HTMLInputElement).files?.[0] ?? null)} />
      </div>
      {file && (
        <div data-testid="smart-intake-file-preview" class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 flex items-start gap-3">
          {filePreviewUrl && <img src={filePreviewUrl} alt="Pasted property image preview" class="h-24 w-36 rounded border border-[var(--color-border)] object-cover" />}
          <div class="min-w-0 text-[11.5px] text-[var(--color-text-muted)]">
            <div class="font-medium text-[var(--color-text)] break-all">{file.name}</div>
            <div>{/^image\//i.test(file.type) ? 'Property image ready to save' : 'File ready to save'} · {(file.size / 1024).toFixed(1)} KB</div>
            <button type="button" class="mt-1 text-[var(--color-accent)] underline" onClick={() => setFile(null)}>Remove</button>
          </div>
        </div>
      )}
      <textarea aria-label="New Deal Card information" rows={4} class={inputClass} placeholder={type === 'transcript' ? 'Paste the call transcript here…' : 'Paste anything new about this lead or property…'} value={text} onInput={(event) => setText((event.target as HTMLTextAreaElement).value)} />
      <div class="flex items-center gap-3">
        <button type="button" data-testid="smart-intake-submit" disabled={busy || (!text.trim() && !file)} onClick={() => void submit()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent)] disabled:opacity-40">{busy ? 'Organizing…' : 'Save and organize'}</button>
        {message && <div class="text-[11.5px] text-[var(--color-text-muted)]">{message}</div>}
      </div>
      {submissions.length > 0 && (() => {
        const latest = submissions[0];
        const transcript = latest.transcript ?? latest.extracted?.transcript;
        return <div data-testid="latest-saved-intake" class="rounded-md border border-[var(--color-accent)] bg-[var(--color-bg)] p-3">
          <div class="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">Latest saved intake</div>
          <div class="mt-1 flex flex-wrap items-center gap-2"><span class="text-[12px] font-medium">{latest.originalFileName || (latest.submissionType === 'transcript' ? 'Transcript' : 'Information')}</span><span class="text-[10px] text-[var(--color-text-faint)]">{latest.sections.map(sectionLabel).join(' - ')}</span></div>
          {latest.originalFileUrl && /^image\//i.test(latest.mimeType ?? '') && <a href={withToken(latest.originalFileUrl)} target="_blank" rel="noreferrer" class="mt-2 block w-fit"><img src={withToken(latest.originalFileUrl)} alt={latest.originalFileName || 'Latest uploaded property image'} class="max-h-56 max-w-full rounded border border-[var(--color-border)] object-contain" /></a>}
          <div class="mt-1 text-[11.5px] text-[var(--color-text-muted)]">{latest.summary}</div>
          <TranscriptResult transcript={transcript} />
          {latest.originalFileUrl && <a href={withToken(latest.originalFileUrl)} target="_blank" rel="noreferrer" class="mt-1 inline-block text-[10.5px] text-[var(--color-accent)] underline">Open saved {/^image\//i.test(latest.mimeType ?? '') ? 'image' : 'file'} full size ↗</a>}
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
