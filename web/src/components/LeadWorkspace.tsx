import { useEffect, useState } from 'preact/hooks';
import { apiGet, apiPost, apiPostForm, dashboardToken } from '@/lib/api';
import { TrashCardButton } from '@/components/TrashCardButton';
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
  opportunity?: {
    id: number;
    publicUid?: string | null;
    lifecycleStatus: string;
    disposition?: string | null;
    researchStatus: string;
    discoveryStatus?: string;
    researchMessage?: string | null;
    rawInput?: string;
    pursuedAt?: string | number | null;
  };
  discoveryPackage?: RecordValue;
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

// A visual can be either a captured image or a useful external map/Earth
// destination.  Only captured image endpoints and explicit image files belong
// in an <img>; rendering an interactive page URL as an image leaves the owner
// with a broken thumbnail.
// The API surface is token-gated; <img> requests carry no auth header, so
// same-origin API image URLs must embed the dashboard token as a query param
// (the same pattern the GIS overlay and PDF download links already use).
function withDashboardToken(url: string): string {
  if (!url.startsWith('/api/') || !dashboardToken || /[?&]token=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
}

function isRenderableImageArtifact(url: string | undefined): boolean {
  return !!url && (
    /^\/api\/landos\/(?:inspection|visual)\/image(?:\?|$)/.test(url)
    || /^\/api\/landos\/deal-cards\/\d+\/overlay\/[^/?]+(?:\?|$)/.test(url)
    || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(url)
  );
}

/** Project verified-sale rows once for the owner card. A source may be
 * enriched later with coordinates/type notes, so dedupe the same observed sale
 * by its business identity and retain the version that carries source access. */
function ownerRecordedSales(rows: RecordValue[]): RecordValue[] {
  const bySale = new Map<string, RecordValue>();
  for (const row of rows) {
    if (asString(row.status) !== 'verified_sale') continue;
    const view: RecordValue = {
      address: row.address_desc,
      salePrice: row.price,
      acres: row.acres,
      saleDate: row.sale_or_list_date,
      provider: row.source_label,
      sourceUrl: row.source_url,
    };
    const key = [view.address, view.salePrice, view.acres, view.saleDate]
      .map((value) => String(value ?? '').replace(/[^a-z0-9.]/gi, '').toLowerCase())
      .join('|');
    if (!key.replace(/\|/g, '')) continue;
    const prior = bySale.get(key);
    if (!prior || (!asString(prior.sourceUrl) && asString(view.sourceUrl))) bySale.set(key, view);
  }
  return [...bySale.values()];
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

type OwnerBriefProps = {
  dealCardId: number;
  title: string;
  identity: RecordValue;
  propertyIdentity: RecordValue;
  deed: RecordValue;
  deedFindings: RecordValue[];
  deedPages: RecordValue[];
  lienReview: RecordValue;
  lienFindings: RecordValue[];
  facts: RecordValue[];
  visuals: RecordValue[];
  comparables: RecordValue[];
  recordedSales: RecordValue[];
  marketSales: RecordValue[];
  marketPulse: RecordValue;
  strategies: RecordValue[];
  researchRunning: boolean;
  actionBusy: boolean;
  onResearch: () => void;
  onCorrectLocality: () => void;
  onReconcileVerifiedParcel: () => void;
  onAttachRecordedDeedPage: () => void;
  onRecordLienReview: () => void;
  onRecordVerifiedSale: () => void;
  onOpenVisual: (visual: { url: string; label: string }) => void;
  trashed: boolean;
  onTrashed: () => void;
  onTrashError: (message: string) => void;
};

/** Owner cards state the evidence-backed finding, never its internal artifact
 * path, retrieval trace, or citation bookkeeping.  The complete source record
 * remains available to the research workflow; this is only the concise
 * operator-facing projection. */
function ownerFacingCopy(value: unknown): string {
  const raw = asString(value)?.replace(/\s+/g, ' ').trim() ?? '';
  if (!raw) return '';
  return raw
    .split(/\s*\|\s*(?:Page screenshots?|Viewed on|Cited pages?|Cited page|Official public parcel record)/i, 1)[0]
    .replace(/\s+(?:Page screenshots?|Viewed on the official|Cited pages?|Cited page):?.*$/i, '')
    .trim();
}

function OwnerBrief({
  dealCardId, title, identity, propertyIdentity, deed, deedFindings, deedPages, lienReview, lienFindings, facts, visuals, comparables, recordedSales, marketSales,
  marketPulse, strategies, researchRunning, actionBusy,
  onResearch, onCorrectLocality, onReconcileVerifiedParcel, onAttachRecordedDeedPage, onRecordLienReview, onRecordVerifiedSale, onOpenVisual,
  trashed, onTrashed, onTrashError,
}: OwnerBriefProps) {
  const [officialGisUnavailable, setOfficialGisUnavailable] = useState(false);
  const [countyResearch, setCountyResearch] = useState<RecordValue | null>(null);
  const owners = dedupeLines(identity.apparentRecordOwners);
  const recordedOwnerFinding = deedFindings.find((finding) => /recorded owner/i.test(asString(finding.label) ?? ''));
  // The property identity's recorded owner is the canonical concise field.
  // Apparent-owner candidates may contain a whole deed/evidence narrative from
  // older reports, so use them only if the canonical field is genuinely empty.
  const owner = ownerFacingCopy(recordedOwnerFinding?.value || owners.map(ownerFacingCopy).find(Boolean) || asString(propertyIdentity.owner));
  const identityApn = (asString(identity.apn) ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const renderedFactsApn = (asString(propertyIdentity.apn) ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  // An owner-confirmed official parcel reconciliation can change the accepted
  // APN before its replacement research run completes. Never let the previous
  // inspection masquerade as the new parcel during that interval.
  const pendingReplacementResearch = !!identityApn && !!renderedFactsApn && identityApn !== renderedFactsApn;
  const ownerFacingDeedFindings = deedFindings
    .map((finding) => ({ ...finding, value: ownerFacingCopy(finding.value) }))
    .filter((finding) => finding.value && !/^Official public parcel record; supports\b/i.test(finding.value));
  const ownerFacingEasements = dedupeLines(deed.easements).map(ownerFacingCopy).filter(Boolean);
  const ownerFacingRestrictions = dedupeLines(deed.restrictions).map(ownerFacingCopy).filter(Boolean);
  const ownerFacingLienFindings = lienFindings
    .map((finding) => ({ ...finding, value: ownerFacingCopy(finding.value) }))
    .filter((finding) => finding.value);
  const recordSourceUrl = (finding: RecordValue) => asString(finding.sourceUrl) ?? asString(finding.source_url);
  const lienDisclaimer = ownerFacingCopy(lienReview.disclaimer) || 'Recorded-lien screening is not a title search or title opinion. An owner/debtor-name result must be matched to the parcel and checked for releases, satisfactions, priority, and later recordings.';
  const researchState = asString(propertyIdentity.state);
  const researchCounty = asString(propertyIdentity.county);
  useEffect(() => {
    let active = true;
    if (!researchState || !researchCounty) { setCountyResearch(null); return () => { active = false; }; }
    apiGet(`/api/landos/research-access?state=${encodeURIComponent(researchState)}&county=${encodeURIComponent(researchCounty)}`)
      .then((value) => { if (active) setCountyResearch(asRecord(asRecord(value).countyCapability)); })
      .catch(() => { if (active) setCountyResearch(null); });
    return () => { active = false; };
  }, [researchState, researchCounty]);
  const platformFamily = asString(countyResearch?.platformFamily)?.replace(/_/g, ' ');
  const recipeVersion = countyResearch?.currentRecipeVersion;
  const accessState = asString(countyResearch?.managedAccountState);
  const visibleFacts = pendingReplacementResearch ? [] : facts.filter((fact) => asString(fact.status) === 'verified').slice(0, 24);
  const imageVisuals = pendingReplacementResearch ? [] : visuals.filter((visual) => isRenderableImageArtifact(asString(visual.url)));
  const terrain = imageVisuals.filter((visual) => /terrain|slope|contour|topograph/i.test(`${asString(visual.label) ?? ''} ${asString(visual.kind) ?? ''}`));
  const googleVisuals = imageVisuals.filter((visual) => !terrain.includes(visual) && (
    /^\/api\/landos\/visual\/image/.test(asString(visual.url) ?? '')
    || /google/i.test(`${asString(visual.kind) ?? ''} ${asString(visual.key) ?? ''} ${asString(visual.label) ?? ''}`)
  ));
  const landPortalVisuals = imageVisuals.filter((visual) => !terrain.includes(visual) && !googleVisuals.includes(visual));
  const landPortalSourceUrl = asString(facts.find((fact) => /landportal/i.test(asString(fact.source) ?? '') && asString(fact.sourceUrl))?.sourceUrl);
  const googleSourceAddress = [asString(identity.address) ?? title, asString(identity.county), asString(identity.state)].filter(Boolean).join(', ');
  const googleSourceUrl = googleSourceAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleSourceAddress)}` : null;
  const officialGisVisual = {
    key: `official-gis-${dealCardId}`,
    label: 'Official county GIS parcel map',
    kind: 'official_gis_aerial',
    url: `/api/landos/deal-cards/${dealCardId}/overlay/aerial?token=${encodeURIComponent(dashboardToken)}`,
  };
  const pulseFacts = asArray(marketPulse.facts).map(asRecord).filter((fact) => asString(fact.value));
  const slope = visibleFacts.find((fact) => /slope|gradient/i.test(asString(fact.label) ?? ''));
  const activeResearch = researchRunning;
  const pendingEvidence = activeResearch
    ? 'Verified evidence is being collected for this parcel.'
    : 'No verified parcel evidence has been returned yet.';
  const marketNarrative = asString(marketPulse.marketPulse);
  const showMarketNarrative = !!marketNarrative && !/\b0\s+sold\b|\b0\s+active\b|price evidence is still thin/i.test(marketNarrative);
  const marketSections = asArray(marketPulse.sections).map(asRecord).filter((section) => asString(section.heading) && asString(section.finding));
  const renderVisual = (visual: RecordValue, index: number) => {
    const url = asString(visual.url);
    if (!url) return null;
    const label = asString(visual.label) ?? 'Property visual';
    return <button key={`${asString(visual.key) ?? label}-${index}`} type="button" onClick={() => onOpenVisual({ url: withDashboardToken(url), label })} class="group overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] text-left transition hover:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">
      <img src={withDashboardToken(url)} alt={label} loading="lazy" class="h-48 w-full object-cover transition duration-200 group-hover:scale-[1.02]" />
      <span class="block px-3 py-2 text-[12px] font-semibold text-[var(--color-text)]">{label}</span>
    </button>;
  };
  const renderOfficialGisVisual = () => officialGisUnavailable
    ? <p data-testid="owner-brief-gis-map-unavailable" class="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-3 text-[12px] text-[var(--color-text-muted)]">An official GIS parcel image is not available for this county or the matched parcel yet. LandOS has not substituted a generic map.</p>
    : <button data-testid="owner-brief-gis-map-image" type="button" onClick={() => onOpenVisual({ url: officialGisVisual.url, label: officialGisVisual.label })} class="group overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] text-left transition hover:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]">
      <img src={officialGisVisual.url} alt={officialGisVisual.label} loading="lazy" onError={() => setOfficialGisUnavailable(true)} class="h-48 w-full object-cover transition duration-200 group-hover:scale-[1.02]" />
      <span class="block px-3 py-2 text-[12px] font-semibold text-[var(--color-text)]">{officialGisVisual.label}</span>
    </button>;
  const compLabel = (comp: RecordValue) => asString(comp.address) ?? asString(comp.name) ?? asString(comp.label) ?? 'Comparable sale';
  const compPrice = (comp: RecordValue) => fmtMoney(comp.salePrice ?? comp.price ?? comp.soldPrice) ?? asString(comp.price) ?? null;
  const compSourceUrl = (comp: RecordValue) => asString(comp.sourceUrl) ?? asString(comp.source_url);
  const compSourceLabel = (comp: RecordValue) => {
    const saved = asString(comp.provider) ?? asString(comp.source) ?? 'Verified sale';
    const url = compSourceUrl(comp);
    if (saved !== 'Other' || !url) return saved;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return saved; }
  };
  const renderCompSource = (comp: RecordValue) => {
    const url = compSourceUrl(comp);
    const label = compSourceLabel(comp);
    return url ? <a class="text-[var(--color-accent)] underline" href={url} target="_blank" rel="noreferrer">{label}</a> : label;
  };
  // Source-backed market rows can be useful context even when this card already
  // has a few operator-recorded sales. Keep the two evidence tiers distinct:
  // the additional rows are never presented as selected/valuation-qualified
  // comparables until the shared validation gate accepts them.
  const recordedMarketKeys = new Set(recordedSales.map((comp) => compLabel(comp).replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean));
  const additionalMarketSales = marketSales
    .filter((comp) => !recordedMarketKeys.has(compLabel(comp).replace(/[^a-z0-9]/gi, '').toLowerCase()))
    .slice(0, 5);

  return <div data-testid="owner-lead-brief" class="px-4 py-5 sm:px-6">
    <div class="mx-auto max-w-6xl space-y-5">
      <header class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-5 shadow-sm">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Acquisitions brief</p>
        <h1 class="mt-1 text-[24px] font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" data-testid="owner-brief-research" disabled={actionBusy || researchRunning} onClick={onResearch} class="rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-50">
            Refresh property research
          </button>
          {trashed
            ? <span class="ml-auto text-[11px] font-semibold text-[var(--color-text-faint)]">In Trash</span>
            : <span class="ml-auto"><TrashCardButton
                dealCardId={dealCardId}
                title={title}
                variant="labelled"
                label="Move to Trash"
                testId="lead-trash-action"
                confirmTestId="lead-trash-confirm"
                disabled={actionBusy}
                onDeleted={onTrashed}
                onError={onTrashError}
              /></span>}
        </div>
      </header>

      <section data-testid="owner-brief-identity" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">1. Lead identity</p>
        <div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Property" value={asString(identity.address) ?? title} />
          <Field label="County" value={[asString(identity.county), asString(identity.state)].filter(Boolean).join(', ')} />
          <Field label="APN" value={asString(identity.apn)} mono />
          <Field label="Owner of record" value={owner} />
        </div>
        <div class="mt-4 flex flex-wrap gap-2"><button type="button" data-testid="owner-brief-correct-locality" onClick={onCorrectLocality} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Correct location details</button><button type="button" data-testid="owner-brief-reconcile-parcel" onClick={onReconcileVerifiedParcel} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Reconcile verified parcel</button></div>
      </section>

      <section data-testid="owner-brief-deed" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">2. Deed and ownership</p><button type="button" data-testid="owner-brief-attach-deed-page" disabled={actionBusy} onClick={onAttachRecordedDeedPage} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-50">Attach recorder page</button></div>
        {ownerFacingDeedFindings.length ? <div class="mt-3 space-y-2">{ownerFacingDeedFindings.map((finding, index) => <div key={`${asString(finding.key) ?? 'deed'}-${index}`} class="rounded-lg bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"><span class="font-semibold">{asString(finding.label) ?? 'Recorded finding'}:</span> {String(finding.value ?? '')}{recordSourceUrl(finding) ? <> <a data-testid="owner-brief-deed-source-link" class="ml-2 font-semibold text-[var(--color-accent)] underline" href={recordSourceUrl(finding)!} target="_blank" rel="noreferrer">Open supporting source</a></> : null}</div>)}</div> : <p class="mt-3 text-[12px] text-[var(--color-text-muted)]">{pendingEvidence}</p>}
        {(ownerFacingEasements.length || ownerFacingRestrictions.length) ? <div class="mt-3 grid gap-3 sm:grid-cols-2">{ownerFacingEasements.length ? <Field label="Access or easements" value={ownerFacingEasements.join('; ')} /> : null}{ownerFacingRestrictions.length ? <Field label="Restrictions" value={ownerFacingRestrictions.join('; ')} /> : null}</div> : null}
        {deedPages.length ? <div class="mt-4"><p class="text-[12px] font-semibold text-[var(--color-text)]">Recorded deed images</p><p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Select a deed page to inspect the county-recorded image full size.</p><div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{deedPages.map((visual, index) => <div key={`${asString(visual.key) ?? 'deed-page'}-${index}`}>{renderVisual(visual, index)}{recordSourceUrl(visual) ? <a data-testid="owner-brief-deed-page-source-link" class="mt-2 inline-block text-[12px] font-semibold text-[var(--color-accent)] underline" href={recordSourceUrl(visual)!} target="_blank" rel="noreferrer">Open source record</a> : null}</div>)}</div></div> : null}
      </section>

      <section data-testid="owner-brief-liens" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">2a. Recorded liens and encumbrances</p><button type="button" data-testid="owner-brief-record-lien-review" disabled={actionBusy} onClick={onRecordLienReview} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-50">Record lien review</button></div>
        {ownerFacingLienFindings.length ? <div class="mt-3 space-y-2">{ownerFacingLienFindings.map((finding, index) => <div key={`${asString(finding.key) ?? 'lien'}-${index}`} class="rounded-lg bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"><span class="font-semibold">{asString(finding.label) ?? 'Recorded lien review'}:</span> {String(finding.value ?? '')}{recordSourceUrl(finding) ? <> <a data-testid="owner-brief-lien-source-link" class="ml-2 font-semibold text-[var(--color-accent)] underline" href={recordSourceUrl(finding)!} target="_blank" rel="noreferrer">Open source record</a></> : null}</div>)}</div> : <p class="mt-3 text-[12px] text-[var(--color-text-muted)]">No verified lien or judgment result has been returned for this property yet.</p>}
        <p data-testid="owner-brief-local-records-first" class="mt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">Research order: local city, township, and county record systems are prioritized before statewide indexes.</p>
        <p data-testid="owner-brief-county-research-memory" class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{platformFamily ? <>County research memory: local portal classified as {platformFamily}{recipeVersion ? `; verified county navigation recipe v${String(recipeVersion)} is available.` : '; LandOS will verify this county before treating platform guidance as a reusable recipe.'}{accessState && accessState !== 'none' ? ` Public-access status: ${accessState.replace(/_/g, ' ')}.` : ''}</> : <>County research memory: LandOS classifies the local portal and retains a reusable county recipe only after an official county lookup returns verified property facts.</>}</p>
        <p class="mt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{lienDisclaimer}</p>
      </section>

      <section data-testid="owner-brief-gis-map" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">3. Official GIS parcel map</p>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Official county aerial imagery with the matched parcel boundary. This is screening evidence, not a survey or legal-boundary determination.</p>
        <div class="mt-3 grid gap-3 sm:max-w-md">{renderOfficialGisVisual()}</div>
      </section>

      <section data-testid="owner-brief-facts" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">4. Property facts</p>
        {visibleFacts.length ? <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleFacts.map((fact, index) => <Field key={`${asString(fact.key) ?? 'fact'}-${index}`} label={asString(fact.label) ?? 'Property fact'} value={fact.value} />)}</div> : <p class="mt-3 text-[12px] text-[var(--color-text-muted)]">{pendingEvidence}</p>}
      </section>

      <section data-testid="owner-brief-visuals" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">5. LandPortal visuals</p>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Select an image to inspect it full size.</p>
        {landPortalVisuals.length ? <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{landPortalVisuals.map(renderVisual)}</div> : <p class="mt-3 text-[12px] text-[var(--color-text-muted)]">{pendingEvidence}</p>}
        {landPortalVisuals.length && landPortalSourceUrl ? <a data-testid="owner-brief-landportal-source-link" class="mt-2 inline-block text-[12px] font-semibold text-[var(--color-accent)] underline" href={landPortalSourceUrl} target="_blank" rel="noreferrer">Open LandPortal source</a> : null}
        {googleVisuals.length ? <div class="mt-5"><p class="text-[12px] font-semibold text-[var(--color-text)]">Google visuals</p><div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{googleVisuals.map(renderVisual)}</div>{googleSourceUrl ? <a data-testid="owner-brief-google-source-link" class="mt-2 inline-block text-[12px] font-semibold text-[var(--color-accent)] underline" href={googleSourceUrl} target="_blank" rel="noreferrer">Open Google Maps source</a> : null}</div> : null}
        {terrain.length ? <div class="mt-5"><p class="text-[12px] font-semibold text-[var(--color-text)]">Terrain</p>{slope ? <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">{asString(slope.label)}: {String(slope.value)}</p> : null}<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{terrain.map(renderVisual)}</div></div> : null}
      </section>

      <section data-testid="owner-brief-feasibility" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">6. Feasibility</p>
        {visibleFacts.filter((fact) => /zoning|use|manufactured|mobile|wetland|flood|frontage|access|utility|septic|soil|slope/i.test(asString(fact.label) ?? '')).length ? <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleFacts.filter((fact) => /zoning|use|manufactured|mobile|wetland|flood|frontage|access|utility|septic|soil|slope/i.test(asString(fact.label) ?? '')).map((fact, index) => <Field key={`${asString(fact.key) ?? 'feasibility'}-${index}`} label={asString(fact.label) ?? 'Feasibility'} value={fact.value} />)}</div> : <p class="mt-3 text-[12px] text-[var(--color-text-muted)]">{pendingEvidence}</p>}
      </section>

      <section data-testid="owner-brief-comparables" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">7. Sold comparables</p><button type="button" data-testid="owner-brief-record-sale" disabled={actionBusy} onClick={onRecordVerifiedSale} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-50">Record verified sale</button></div>
        {!pendingReplacementResearch && comparables.length ? <div class="mt-3 overflow-x-auto"><table class="w-full min-w-[620px] text-left text-[12px]"><thead class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><tr><th class="pb-2 pr-3">Property</th><th class="pb-2 pr-3">Sale price</th><th class="pb-2 pr-3">Acres</th><th class="pb-2 pr-3">Distance</th><th class="pb-2 pr-3">Type</th><th class="pb-2 pr-3">Sale date</th><th class="pb-2">Source</th></tr></thead><tbody>{comparables.map((comp, index) => <tr key={`${compLabel(comp)}-${index}`} class="border-t border-[var(--color-border)] text-[var(--color-text)]"><td class="py-2 pr-3 font-medium">{compLabel(comp)}</td><td class="py-2 pr-3">{compPrice(comp) ?? 'Not reported'}</td><td class="py-2 pr-3">{asString(comp.acres) ?? asString(comp.acreage) ?? String(comp.acres ?? comp.acreage ?? 'Not reported')}</td><td class="py-2 pr-3">{typeof comp.distanceMiles === 'number' ? `${comp.distanceMiles} mi` : 'Not reported'}</td><td class="py-2 pr-3">{asString(comp.propertyType)?.replace(/_/g, ' ') ?? 'Not reported'}</td><td class="py-2 pr-3">{asString(comp.saleDate) ?? asString(comp.date) ?? 'Not reported'}</td><td class="py-2">{renderCompSource(comp)}</td></tr>)}</tbody></table></div> : null}
        {!pendingReplacementResearch && !comparables.length && recordedSales.length ? <div class="mt-3"><p class="mb-1 text-[12px] font-semibold text-[var(--color-text)]">Recorded source-backed sales — market context</p><p class="mb-2 text-[11px] text-[var(--color-text-muted)]">These recorded rows remain market context only until their distance, acreage band, sale date, and property type pass the shared valuation checks.</p><div class="overflow-x-auto"><table class="w-full min-w-[520px] text-left text-[12px]"><thead class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><tr><th class="pb-2 pr-3">Property</th><th class="pb-2 pr-3">Sale price</th><th class="pb-2 pr-3">Acres</th><th class="pb-2 pr-3">Sale date</th><th class="pb-2">Source</th></tr></thead><tbody>{recordedSales.map((comp, index) => <tr key={`${compLabel(comp)}-${index}`} class="border-t border-[var(--color-border)] text-[var(--color-text)]"><td class="py-2 pr-3 font-medium">{compLabel(comp)}</td><td class="py-2 pr-3">{compPrice(comp) ?? 'Not reported'}</td><td class="py-2 pr-3">{asString(comp.acres) ?? String(comp.acres ?? 'Not reported')}</td><td class="py-2 pr-3">{asString(comp.saleDate) ?? asString(comp.date) ?? 'Not reported'}</td><td class="py-2">{renderCompSource(comp)}</td></tr>)}</tbody></table></div></div> : null}
        {!pendingReplacementResearch && !comparables.length && additionalMarketSales.length ? <div class="mt-4"><p class="mb-1 text-[12px] font-semibold text-[var(--color-text)]">Additional local sold-market evidence</p><p class="mb-2 text-[11px] text-[var(--color-text-muted)]">These returned sale records are market context only. They are not selected for valuation until distance, acreage, date, and property-type checks pass.</p><div class="overflow-x-auto"><table class="w-full min-w-[520px] text-left text-[12px]"><thead class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><tr><th class="pb-2 pr-3">Property</th><th class="pb-2 pr-3">Sale price</th><th class="pb-2 pr-3">Acres</th><th class="pb-2 pr-3">Sale date</th><th class="pb-2">Source</th></tr></thead><tbody>{additionalMarketSales.map((comp, index) => <tr key={`${compLabel(comp)}-${index}`} class="border-t border-[var(--color-border)] text-[var(--color-text)]"><td class="py-2 pr-3 font-medium">{compLabel(comp)}</td><td class="py-2 pr-3">{compPrice(comp) ?? 'Not reported'}</td><td class="py-2 pr-3">{asString(comp.acres) ?? String(comp.acres ?? 'Not reported')}</td><td class="py-2 pr-3">{asString(comp.saleDate) ?? asString(comp.date) ?? 'Not reported'}</td><td class="py-2">{renderCompSource(comp)}</td></tr>)}</tbody></table></div></div> : null}
        {!pendingReplacementResearch && !comparables.length && !recordedSales.length && !additionalMarketSales.length ? <p class="mt-3 text-[12px] text-[var(--color-text-muted)]">{activeResearch ? 'Qualified sold comparable research is in progress.' : 'No local sold-market evidence has been returned yet.'}</p> : null}
      </section>

      <section data-testid="owner-brief-market" class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">8. Market pulse</p>
        {marketSections.length ? <div class="mt-3 grid gap-3 lg:grid-cols-2">{marketSections.map((section, index) => { const sources = asArray(section.sources).map(asRecord); return <div key={`${asString(section.key) ?? 'market'}-${index}`} class="rounded-xl bg-[var(--color-elevated)] px-3 py-3"><p class="text-[12px] font-semibold text-[var(--color-text)]">{asString(section.heading)}</p><p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{asString(section.finding)}</p>{sources.length ? <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{sources.map((source, sourceIndex) => { const label = asString(source.label) ?? 'Source'; const url = asString(source.url); return url ? <a key={`${label}-${sourceIndex}`} class="text-[var(--color-accent)] underline" href={url} target="_blank" rel="noreferrer">{label}</a> : <span key={`${label}-${sourceIndex}`} class="text-[var(--color-text-faint)]">{label}</span>; })}</div> : null}</div>; })}</div> : null}
        {showMarketNarrative ? <p class="mt-4 text-[13px] leading-relaxed text-[var(--color-text)]">{marketNarrative}</p> : null}
        {pulseFacts.length ? <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{pulseFacts.map((fact, index) => <Field key={`${asString(fact.key) ?? 'pulse'}-${index}`} label={asString(fact.label) ?? 'Market fact'} value={fact.value} />)}</div> : null}
        {strategies.length ? <div class="mt-4 border-t border-[var(--color-border)] pt-4"><p class="text-[12px] font-semibold text-[var(--color-text)]">Acquisition paths</p><div class="mt-2 grid gap-2 sm:grid-cols-2">{strategies.slice(0, 2).map((strategy, index) => <div key={`${asString(strategy.name) ?? 'strategy'}-${index}`} class="rounded-lg bg-[var(--color-elevated)] px-3 py-2 text-[12px]"><span class="font-semibold text-[var(--color-text)]">{asString(strategy.name) ?? 'Acquisition path'}</span><p class="mt-1 text-[var(--color-text-muted)]">{asString(strategy.opportunityLogic) ?? asString(strategy.fit) ?? ''}</p></div>)}</div></div> : null}
      </section>
    </div>
  </div>;
}

export function LeadWorkspace({ dealCardId }: { dealCardId: number }) {
  const [workspace, setWorkspace] = useState<LeadWorkspacePayload | null>(null);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<'research' | 'decision' | 'package' | 'transcript' | 'locality' | 'parcel' | 'deed' | 'lien' | 'comp' | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [trashed, setTrashed] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcripts, setTranscripts] = useState<RecordValue[]>([]);
  const [reconciliation, setReconciliation] = useState<RecordValue | null>(null);
  const [selectedVisual, setSelectedVisual] = useState<{ url: string; label: string } | null>(null);
  const [localityEditorOpen, setLocalityEditorOpen] = useState(false);
  const [localityDraft, setLocalityDraft] = useState({ city: '', county: '', state: '' });
  const [parcelEditorOpen, setParcelEditorOpen] = useState(false);
  const [parcelDraft, setParcelDraft] = useState({ address: '', city: '', county: '', state: '', apn: '', owner: '', sourceLabel: 'Official county parcel record', sourceUrl: '', deedReference: '', confirmAcceptedIdentityReplacement: false });
  const [deedPageEditorOpen, setDeedPageEditorOpen] = useState(false);
  const [deedPageFile, setDeedPageFile] = useState<File | null>(null);
  const [deedPageDraft, setDeedPageDraft] = useState({ title: 'Recorded deed', documentId: '', pageNumber: '1', sourceLabel: 'County recorder', sourceUrl: '', confirmedOfficialSource: false });
  const [lienEditorOpen, setLienEditorOpen] = useState(false);
  const [lienDraft, setLienDraft] = useState({ status: 'no_matching_index_entry', sourceLabel: 'Official recorder or lien index', sourceUrl: '', searchedNameOrReference: '', recordingReference: '', lienType: '', propertyMatch: '', notes: '', confirmedOfficialSource: false });
  const [recordedSales, setRecordedSales] = useState<RecordValue[]>([]);
  const [compEditorOpen, setCompEditorOpen] = useState(false);
  const [compDraft, setCompDraft] = useState({ sourceLabel: 'Redfin', sourceUrl: '', addressDesc: '', saleOrListDate: '', price: '', acres: '', lat: '', lng: '', notes: '' });

  useEffect(() => {
    let active = true;
    setWorkspace(null);
    setError('');
    const load = () => Promise.all([
      apiGet<LeadWorkspacePayload>(`/api/landos/lead-workspace/${dealCardId}`),
      apiGet<{ comps?: RecordValue[] }>(`/api/landos/deal-cards/${dealCardId}/comps`),
    ])
      .then(([payload, compPayload]) => {
        if (!active) return;
        setWorkspace(payload);
        setRecordedSales(ownerRecordedSales(compPayload.comps ?? []));
        setError('');
      })
      .catch(() => { if (active) setError('The Lead Workspace could not be loaded.'); });
    void load();
    return () => { active = false; };
  }, [dealCardId]);

  // While the Lead Workspace is mounted the browser document must be the only
  // vertical scroll surface (full-page capture tools depend on it). The tag on
  // <body> releases the app shell's viewport lock via a scoped CSS override.
  useEffect(() => {
    document.body.classList.add('lead-workspace-doc-scroll');
    return () => { document.body.classList.remove('lead-workspace-doc-scroll'); };
  }, []);

  async function refreshWorkspace() {
    const [payload, compPayload] = await Promise.all([
      apiGet<LeadWorkspacePayload>(`/api/landos/lead-workspace/${dealCardId}`),
      apiGet<{ comps?: RecordValue[] }>(`/api/landos/deal-cards/${dealCardId}/comps`),
    ]);
    setWorkspace(payload);
    setRecordedSales(ownerRecordedSales(compPayload.comps ?? []));
  }

  async function refreshTranscript(opportunityId = workspace?.opportunity?.id) {
    if (!opportunityId) return;
    const [history, latest] = await Promise.all([
      apiGet<{ transcripts?: RecordValue[] }>(`/api/landos/opportunities/${opportunityId}/transcripts`),
      apiGet<{ reconciliation?: RecordValue | null }>(`/api/landos/opportunities/${opportunityId}/reconciliation`),
    ]);
    setTranscripts(history.transcripts ?? []);
    setReconciliation(latest.reconciliation ?? null);
  }

  useEffect(() => {
    if (workspace?.opportunity?.id) void refreshTranscript(workspace.opportunity.id).catch(() => undefined);
  }, [workspace?.opportunity?.id]);

  useEffect(() => {
    if (!['queued', 'pending', 'running'].includes(workspace?.opportunity?.researchStatus ?? '')) return;
    const timer = setInterval(() => { void refreshWorkspace().catch(() => undefined); }, 3_000);
    return () => clearInterval(timer);
  }, [dealCardId, workspace?.opportunity?.researchStatus]);

  async function runResearch() {
    const opportunityId = workspace?.opportunity?.id;
    if (!opportunityId) { setActionMessage('This Lead Card is still being linked to its opportunity record.'); return; }
    setActionBusy('research'); setActionMessage('');
    try {
      await apiPost(`/api/landos/opportunities/${opportunityId}/research`, {});
      await refreshWorkspace();
      setActionMessage('Research started. This card will update as evidence arrives.');
    } catch (err) {
      setActionMessage(`Research could not start: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  function openLocalityEditor() {
    const currentProperty = asRecord(workspace?.property);
    const currentIdentity = asRecord(currentProperty.identity);
    setLocalityDraft({
      city: asString(currentIdentity.city) ?? '',
      county: asString(currentIdentity.county) ?? '',
      state: asString(currentIdentity.state) ?? '',
    });
    setLocalityEditorOpen(true);
  }

  async function saveLocalityCorrection(event: Event) {
    event.preventDefault();
    const cardId = Number(asRecord(workspace?.property).cardId);
    if (!Number.isInteger(cardId) || cardId < 1) {
      setActionMessage('This Lead Card is not linked to a property record yet.');
      return;
    }
    setActionBusy('locality'); setActionMessage('');
    try {
      await apiPost(`/api/landos/property-cards/${cardId}/locality-correction`, localityDraft);
      await refreshWorkspace();
      setLocalityEditorOpen(false);
      setActionMessage('Location details saved. Refresh property research to verify the parcel in the corrected jurisdiction.');
    } catch (err) {
      setActionMessage(`Location details could not be saved: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  function openVerifiedParcelReconciliation() {
    const property = asRecord(workspace?.property);
    const identity = asRecord(property.identity);
    setParcelDraft({
      address: asString(identity.address) ?? asString(workspace?.lead.title) ?? '',
      city: asString(identity.city) ?? '',
      county: asString(identity.county) ?? '',
      state: asString(identity.state) ?? '',
      apn: asString(identity.apn) ?? '',
      owner: asString(identity.owner) ?? '',
      sourceLabel: 'Official county parcel record',
      sourceUrl: '',
      deedReference: '',
      confirmAcceptedIdentityReplacement: false,
    });
    setParcelEditorOpen(true);
  }

  async function saveVerifiedParcelReconciliation(event: Event) {
    event.preventDefault();
    const cardId = Number(asRecord(workspace?.property).cardId);
    if (!Number.isInteger(cardId) || cardId < 1) {
      setActionMessage('This Lead Card is not linked to a property record yet.');
      return;
    }
    setActionBusy('parcel'); setActionMessage('');
    try {
      await apiPost(`/api/landos/property-cards/${cardId}/verified-parcel-reconciliation`, parcelDraft);
      await refreshWorkspace();
      setParcelEditorOpen(false);
      setActionMessage('Verified parcel identity saved. Refresh property research to collect parcel-specific records and visuals.');
    } catch (err) {
      setActionMessage(`Verified parcel identity could not be saved: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  function openRecordedDeedPageEditor() {
    setDeedPageFile(null);
    setDeedPageDraft({ title: 'Recorded deed', documentId: '', pageNumber: '1', sourceLabel: 'County recorder', sourceUrl: '', confirmedOfficialSource: false });
    setDeedPageEditorOpen(true);
  }

  async function saveRecordedDeedPage(event: Event) {
    event.preventDefault();
    const cardId = Number(asRecord(workspace?.property).cardId);
    if (!Number.isInteger(cardId) || cardId < 1) { setActionMessage('This Lead Card is not linked to a property record yet.'); return; }
    if (!deedPageFile) { setActionMessage('Choose the county-recorder image page first.'); return; }
    setActionBusy('deed'); setActionMessage('');
    try {
      const form = new FormData();
      form.append('file', deedPageFile);
      form.append('title', deedPageDraft.title);
      form.append('documentId', deedPageDraft.documentId);
      form.append('pageNumber', deedPageDraft.pageNumber);
      form.append('sourceLabel', deedPageDraft.sourceLabel);
      form.append('sourceUrl', deedPageDraft.sourceUrl);
      form.append('confirmedOfficialSource', String(deedPageDraft.confirmedOfficialSource));
      await apiPostForm(`/api/landos/property-cards/${cardId}/recorded-deed-pages`, form);
      await refreshWorkspace();
      setDeedPageEditorOpen(false);
      setActionMessage('County recorder page attached. Open the rendered deed image to review the actual page.');
    } catch (err) {
      setActionMessage(`The recorder page could not be attached: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  function openRecordedLienReviewEditor() {
    setLienDraft({ status: 'no_matching_index_entry', sourceLabel: 'Official recorder or lien index', sourceUrl: '', searchedNameOrReference: '', recordingReference: '', lienType: '', propertyMatch: '', notes: '', confirmedOfficialSource: false });
    setLienEditorOpen(true);
  }

  async function saveRecordedLienReview(event: Event) {
    event.preventDefault();
    const cardId = Number(asRecord(workspace?.property).cardId);
    if (!Number.isInteger(cardId) || cardId < 1) { setActionMessage('This Lead Card is not linked to a property record yet.'); return; }
    setActionBusy('lien'); setActionMessage('');
    try {
      await apiPost(`/api/landos/property-cards/${cardId}/recorded-lien-review`, lienDraft);
      if (workspace?.opportunity?.id) await apiPost(`/api/landos/opportunities/${workspace.opportunity.id}/discovery-package/run`, {});
      await refreshWorkspace();
      setLienEditorOpen(false);
      setActionMessage('Recorded lien review saved. It remains screening evidence, not a title opinion or clear-title conclusion.');
    } catch (err) {
      setActionMessage(`The recorded lien review could not be saved: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  function openVerifiedSaleEditor() {
    setCompDraft({ sourceLabel: 'Redfin', sourceUrl: '', addressDesc: '', saleOrListDate: '', price: '', acres: '', lat: '', lng: '', notes: '' });
    setCompEditorOpen(true);
  }

  async function saveVerifiedSale(event: Event) {
    event.preventDefault();
    const property = asRecord(workspace?.property);
    const identity = asRecord(property.identity);
    setActionBusy('comp'); setActionMessage('');
    try {
      await apiPost(`/api/landos/deal-cards/${dealCardId}/comps`, {
        ...compDraft,
        county: asString(identity.county) ?? '',
        state: asString(identity.state) ?? '',
        price: Number(compDraft.price),
        acres: Number(compDraft.acres),
        lat: compDraft.lat.trim() ? Number(compDraft.lat) : undefined,
        lng: compDraft.lng.trim() ? Number(compDraft.lng) : undefined,
        priceKind: 'sale',
        status: 'verified_sale',
        addedBy: 'owner/verified-sale',
      });
      if (workspace?.opportunity?.id) await apiPost(`/api/landos/opportunities/${workspace.opportunity.id}/discovery-package/run`, {});
      await refreshWorkspace();
      setCompEditorOpen(false);
    } catch (err) {
      setActionMessage(`The verified sale could not be recorded: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  async function recordDecision(decision: 'pursue' | 'disposition', disposition?: string) {
    const opportunityId = workspace?.opportunity?.id;
    if (!opportunityId) { setActionMessage('This Lead Card is still being linked to its opportunity record.'); return; }
    setActionBusy('decision'); setActionMessage('');
    try {
      await apiPost(`/api/landos/opportunities/${opportunityId}/decision`, { decision, disposition });
      await refreshWorkspace();
      setActionMessage(decision === 'pursue' ? 'Owner decision saved: this opportunity is now a Deal.' : 'Disposition saved on this Lead Card.');
    } catch (err) {
      setActionMessage(`Decision could not be saved: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  async function rebuildDiscoveryPackage() {
    if (!workspace?.opportunity?.id) return;
    setActionBusy('package'); setActionMessage('');
    try {
      await apiPost(`/api/landos/opportunities/${workspace.opportunity.id}/discovery-package/run`, {});
      await refreshWorkspace();
      setActionMessage('The current discovery-call package is ready.');
    } catch (err) {
      setActionMessage(`Discovery package could not be rebuilt: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  async function submitTranscriptPaste() {
    if (!workspace?.opportunity?.id || !transcriptText.trim()) return;
    setActionBusy('transcript'); setActionMessage('');
    try {
      await apiPost(`/api/landos/opportunities/${workspace.opportunity.id}/transcripts`, { content: transcriptText, sourceType: 'paste', actor: 'owner' });
      setTranscriptText('');
      await Promise.all([refreshWorkspace(), refreshTranscript(workspace.opportunity.id)]);
      setActionMessage('Original transcript preserved; reconciliation and follow-up work are ready.');
    } catch (err) {
      setActionMessage(`Transcript could not be reconciled: ${(err as Error).message}`);
    } finally { setActionBusy(null); }
  }

  async function uploadTranscript(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!workspace?.opportunity?.id || !file) return;
    const form = new FormData(); form.append('file', file); form.append('actor', 'owner');
    setActionBusy('transcript'); setActionMessage('');
    try {
      await apiPostForm(`/api/landos/opportunities/${workspace.opportunity.id}/transcripts`, form);
      await Promise.all([refreshWorkspace(), refreshTranscript(workspace.opportunity.id)]);
      setActionMessage('Uploaded original preserved; reconciliation and follow-up work are ready.');
    } catch (err) {
      setActionMessage(`Transcript upload failed: ${(err as Error).message}`);
    } finally { input.value = ''; setActionBusy(null); }
  }

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
  const compPolicy = asRecord(comparables.policy);
  const contextComps = asArray(comparables.contextComps);
  const compRows = topComps(comparables, 6);
  const strategies = strategyRows(workspace.strategies.entries);
  const pricingBlockers = dedupeLines(workspace.strategies.pricingBlockers);
  const readiness = readinessRows(asRecord(workspace.readiness));
  const work = asRecord(workspace.work);
  const missionEnvelope = asRecord(work.mission);
  const researchMission = asRecord(missionEnvelope.research);
  const missionConstraints = asRecord(researchMission.constraints);
  const missionVerification = asRecord(researchMission.verification);
  const missionObserved = asRecord(missionVerification.observed);
  const missionTrace = asArray(researchMission.toolTrace).map(asRecord);
  const quarantinedEvidence = asArray(missionEnvelope.quarantinedEvidence).map(asRecord);
  const nextAction = asRecord(work.recommendedNextAction);
  const blockers = dedupeLines(work.blockers);
  const decisions = dedupeLines(work.decisions);
  const evidence = asRecord(workspace.evidence);
  const visuals = asRecord(evidence.visuals);
  const documents = asRecord(evidence.documents);
  // The document registry already constrains pages to the subject card. Project
  // those registered county-recorded deed scans into the owner brief without
  // exposing storage paths or research traces.
  const deedPageVisuals = asArray(documents.documents).map(asRecord)
    .filter((document) => asString(document.category) === 'deed')
    .flatMap((document) => asArray(document.pages).map(asRecord).map((page) => {
      const file = asString(page.file);
      const pageNumber = asString(page.pageNumber) ?? String(page.pageNumber ?? '');
      const title = asString(document.title) ?? 'Recorded deed';
      return file ? {
        key: `deed-${file}`,
        label: `${title} — page ${pageNumber || 'image'}`,
        kind: 'recorded_deed',
        url: `/api/landos/deal-cards/${dealCardId}/document-page/${encodeURIComponent(file)}`,
        sourceUrl: asString(document.officialUrl),
      } : {};
    }))
    .filter((visual) => isRenderableImageArtifact(asString(visual.url)));
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
  const opportunity = workspace.opportunity;
  const discoveryPackage = asRecord(workspace.discoveryPackage);
  const callPrep = asRecord(discoveryPackage.callPrep);
  const packageIdentity = asRecord(discoveryPackage.identity);
  const packageValue = asRecord(discoveryPackage.preliminaryValue);
  const packageValueRange = asRecord(packageValue.marketValue);
  const acquisitionRange = asRecord(packageValue.ownerReviewAcquisitionRange40To60Pct);
  const packageScore = asRecord(discoveryPackage.landScore);
  const packageDeed = asRecord(discoveryPackage.deedFindings);
  const packageDeedFindings = asArray(packageDeed.findings).map(asRecord);
  const packageDeedOwners = dedupeLines(packageDeed.owners);
  const packageDeedEasements = dedupeLines(packageDeed.easements);
  const packageDeedRestrictions = dedupeLines(packageDeed.restrictions);
  const packageLienReview = asRecord(discoveryPackage.lienReview);
  const packageLienFindings = asArray(packageLienReview.findings).map(asRecord);
  const packagePulse = asRecord(discoveryPackage.marketPulse);
  const packageFacts = asArray(discoveryPackage.landCharacteristics).map(asRecord);
  const verifiedPackageFacts = packageFacts.filter((fact) => fact.parcelAssociated === true && asString(fact.status) === 'verified');
  const packageVisuals = asArray(discoveryPackage.visuals).map(asRecord);
  const packageStrategies = asArray(discoveryPackage.strategies).map(asRecord);
  const packageComparables = asRecord(discoveryPackage.comparables);
  const selectedComparables = asArray(packageComparables.selectedComparables).map(asRecord);
  const subjectCompCity = asString(packageIdentity.city) ?? asString(identity.city);
  const subjectCompState = asString(packageIdentity.state) ?? asString(identity.state);
  const normalizedCompLocation = (value: string | null | undefined) => (value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const localSoldMarketEvidence = asArray(packageComparables.rejectedComparables).map(asRecord)
    .map((row) => asRecord(row.comparable))
    .filter((row) => {
      if (asString(row.status) !== 'sold') return false;
      const location = asString(row.address) ?? asString(row.addressDesc) ?? '';
      const cityMatches = !subjectCompCity || normalizedCompLocation(location).includes(normalizedCompLocation(subjectCompCity));
      const stateMatches = !subjectCompState || new RegExp(`(?:,|\\s)${subjectCompState.replace(/[^a-z]/gi, '')}(?:\\s|,|$)`, 'i').test(location);
      return cityMatches && stateMatches;
    })
    .map((row) => ({ ...row, acres: row.acres ?? row.acreage }))
    .slice(0, 5);
  const contextComparables = asArray(packageComparables.contextComparables).map(asRecord);
  const packageScoreRows = asArray(packageScore.subscores).map(asRecord);
  const packagePulseFacts = asArray(packagePulse.facts).map(asRecord);
  const packageBlockers = dedupeLines(callPrep.blockers);
  const packageReady = callPrep.ready === true && callPrep.decisionUseful === true;
  const valueThresholdMet = packageReady && asString(packageValue.basis) === 'parcel' && asString(packageValue.confidence) !== 'none';
  const scoreThresholdMet = packageReady && packageScore.score != null;
  const strategyMode = asString(discoveryPackage.strategyMode) ?? 'validation_hypotheses';
  const packageGaps = dedupeLines(discoveryPackage.gaps);
  const packageSources = asArray(discoveryPackage.sources).map(asRecord);
  const isDeal = opportunity?.lifecycleStatus === 'deal';
  const researchRunning = ['queued', 'pending', 'running'].includes(opportunity?.researchStatus ?? '');
  const transcriptRecord = asRecord(transcripts[0]);
  const transcriptReconciliation = asRecord(reconciliation);
  const renderStatement = (value: unknown): string => {
    const row = asRecord(value);
    const field = asString(row.field) ?? 'statement';
    const stated = Array.isArray(row.value) ? row.value.join(', ') : String(row.value ?? 'not stated');
    return `${field.replace(/_/g, ' ')}: ${stated}${asString(row.evidence) ? ` — “${asString(row.evidence)}”` : ''}`;
  };
  const sellerStatements = asArray(transcriptReconciliation.sellerStatements).map(renderStatement);
  const verifiedFacts = asArray(transcriptReconciliation.verifiedFacts).map((fact) => {
    const row = asRecord(fact); return `${asString(row.field)?.replace(/_/g, ' ') ?? 'fact'}: ${String(row.value ?? 'unknown')} (${asString(row.source) ?? 'canonical evidence'})`;
  });
  const transcriptParties = asArray(transcriptReconciliation.parties).map((party) => {
    const row = asRecord(party); return [asString(row.name), asString(row.role)].filter(Boolean).join(' — ');
  }).filter(Boolean);
  const propertyStatements = asArray(transcriptReconciliation.propertyStatements).map(renderStatement);
  const contradictions = asArray(transcriptReconciliation.contradictions).map((conflict) => {
    const row = asRecord(conflict); return `${asString(row.field)?.replace(/_/g, ' ') ?? 'field'}: seller said ${String(row.sellerValue ?? 'unknown')}; research says ${String(row.currentValue ?? 'unknown')} — ${asString(row.explanation) ?? 'needs review'}`;
  });
  const deeperTasks = asArray(transcriptReconciliation.researchTasks).map((task) => asString(asRecord(task).title) ?? asString(asRecord(task).description) ?? asString(task)).filter(Boolean) as string[];
  const followUpTasks = asArray(transcriptReconciliation.followUpTasks).map((task) => asString(asRecord(task).title) ?? asString(asRecord(task).description) ?? asString(task)).filter(Boolean) as string[];
  const transcriptNextAction = asRecord(transcriptReconciliation.nextAction);

  const legacyWorkspace = (
    <div data-testid="lead-workspace-root" class="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
      <div class="mx-auto max-w-7xl space-y-3">
        {/* Lead identity header */}
        <header data-testid={isDeal ? 'deal-card-highlight' : 'lead-card-standard'} class={`rounded-xl border bg-[var(--color-card)] p-4 transition-shadow ${isDeal ? 'border-emerald-400/70 shadow-[0_0_18px_rgba(52,211,153,0.18)]' : 'border-[var(--color-border)]'}`}>
          <p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Lead Workspace {'·'} v{workspace.contract.version}</p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <h2 class="text-[20px] font-semibold text-[var(--color-text)] break-words">{asString(workspace.lead.title) ?? 'Untitled lead'}</h2>
            <Chip tone={chip.tone} testId="lead-workspace-resolution-chip">{chip.label}</Chip>
            <Chip tone={isDeal ? 'good' : 'unknown'} testId="opportunity-lifecycle-chip">{isDeal ? 'Pursued Deal' : 'Lead'}</Chip>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="APN" value={identity.apn} mono />
            <Field label="County" value={identity.county} />
            <Field label="State" value={identity.state} />
            <Field label="Acreage" value={disputed ? `${displayAcres ?? 'disputed'} (disputed)` : displayAcres} />
            <Field label="Owner" value={identity.owner} />
            <Field label="Lifecycle" value={opportunity?.lifecycleStatus ?? workspace.lead.lifecycle} />
          </div>
          {asString(nextAction.label) ? (
            <div class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2">
              <span class="text-[11px] font-semibold text-[var(--color-text)]">Next action: </span>
              <span class="text-[12px] text-[var(--color-text)]">{asString(nextAction.label)}</span>
              {asString(nextAction.reason) ? <span class="text-[11px] text-[var(--color-text-muted)]"> {'—'} {asString(nextAction.reason)}</span> : null}
            </div>
          ) : null}
          <div data-testid="discovery-call-guardrail" class="mt-3 rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[11.5px] text-[var(--color-text)]">
            <span class="font-semibold">Discovery calls are never blocked.</span> Missing or conflicting research becomes a call question. Unresolved identity still blocks unsupported parcel conclusions, confident valuation, offer preparation, and automatic pursuit.
          </div>
          <a data-testid="discovery-package-entry" href="#pre-discovery-report" class="mt-3 inline-flex rounded-md border border-[var(--color-accent)] bg-[var(--color-elevated)] px-3 py-2 text-[11.5px] font-semibold text-[var(--color-accent)]">Open pre-discovery research report</a>
        </header>

        {opportunity?.rawInput ? (
          <section data-testid="original-lead-intake" class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-[12px] font-semibold text-[var(--color-text)]">Original lead intake</div>
                <div class="text-[10.5px] text-[var(--color-text-muted)]">Preserved exactly as entered. Extracted card fields remain unverified until research confirms them.</div>
              </div>
              <Chip tone="unknown">operator supplied</Chip>
            </div>
            <pre class="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3 font-sans text-[12px] leading-5 text-[var(--color-text)]">{opportunity.rawInput}</pre>
          </section>
        ) : null}

        <section data-testid="opportunity-actions" class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-[12px] font-semibold text-[var(--color-text)]">Research and owner decision</div>
              <div class="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                Research: <span class="font-medium text-[var(--color-text)]">{opportunity?.researchStatus?.replace(/_/g, ' ') ?? 'not started'}</span>
                {opportunity?.researchMessage ? ` — ${opportunity.researchMessage}` : ''}
              </div>
            </div>
            <button type="button" data-testid="research-retry-action" disabled={!opportunity || actionBusy !== null || researchRunning} onClick={() => void runResearch()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-45">
              {researchRunning ? 'Research running…' : actionBusy === 'research' ? 'Starting…' : 'Run / retry research'}
            </button>
          </div>
          {asString(researchMission.status) ? (
            <div data-testid="research-mission-status" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[11.5px] font-semibold text-[var(--color-text)]">Property Research Agent mission</span>
                <Chip tone={missionVerification.accepted === true ? 'good' : asString(researchMission.status) === 'quarantined' || asString(researchMission.status) === 'failed' ? 'risk' : 'caution'}>
                  {asString(researchMission.status)?.replace(/_/g, ' ')}
                </Chip>
                <span class="text-[10.5px] text-[var(--color-text-faint)]">attempt {String(researchMission.attempt ?? 0)} · trigger {asString(researchMission.trigger) ?? 'unknown'}</span>
              </div>
              <p class="mt-1 text-[11.5px] text-[var(--color-text)]">{asString(researchMission.summary) ?? 'Mission is queued; no parcel evidence has been promoted yet.'}</p>
              <p class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">
                Immutable search: {[asString(missionConstraints.address), asString(missionConstraints.city), asString(missionConstraints.county), asString(missionConstraints.state), asString(missionConstraints.apn) ? `APN ${asString(missionConstraints.apn)}` : null].filter(Boolean).join(', ') || 'identity clues incomplete'}
              </p>
              {asString(missionVerification.verdict) ? <p data-testid="research-verification-result" class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Verification: {asString(missionVerification.verdict)?.replace(/_/g, ' ')}{asString(missionObserved.state) ? ` · observed ${asString(missionObserved.city) ?? 'unknown city'}, ${asString(missionObserved.state)}` : ''}</p> : null}
              <p class="mt-1 text-[10.5px] text-[var(--color-text-muted)]"><span class="font-semibold">Safe next action:</span> {asString(researchMission.safeNextAction) ?? 'Wait for the current bounded attempt or retry after adding identity clues.'}</p>
              {missionTrace.length ? (
                <details class="mt-2">
                  <summary data-testid="research-trace-toggle" class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text)]">Tools and verification trace ({missionTrace.length})</summary>
                  <ul class="mt-2 space-y-1 pl-4 text-[10.5px] text-[var(--color-text-muted)]">
                    {missionTrace.map((row, index) => {
                      const provider = asString(row.provider) ?? asString(row.stage) ?? 'tool';
                      const testId = `research-path-${provider.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
                      return <li key={`${provider}-${index}`} data-testid={testId} class="list-disc">{[provider, asString(row.status) ?? 'unknown', asString(row.note)].filter(Boolean).join(' — ')}</li>;
                    })}
                  </ul>
                </details>
              ) : null}
              {quarantinedEvidence.length ? <div data-testid="quarantined-research-evidence" class="mt-2 rounded border border-red-500/35 bg-red-500/10 px-2.5 py-2 text-[10.5px] text-[var(--color-text)]"><span class="font-semibold">Quarantined evidence ({quarantinedEvidence.length})</span> — preserved for audit and excluded from parcel facts, comps, valuation, score, strategy, and report. {quarantinedEvidence.map((row) => asString(row.reason)).filter(Boolean).join(' · ')}</div> : null}
            </div>
          ) : null}
          <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
            {!isDeal && (
              <button type="button" data-testid="pursue-opportunity-action" disabled={!opportunity || actionBusy !== null} onClick={() => void recordDecision('pursue')} class="rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-45 dark:text-emerald-300">
                Pursue — promote this Lead to Deal
              </button>
            )}
            <label class="text-[11px] text-[var(--color-text-muted)]" for="lead-disposition">Disposition</label>
            <select id="lead-disposition" data-testid="disposition-action" disabled={!opportunity || actionBusy !== null} value={opportunity?.disposition ?? ''} onChange={(event) => { const value = (event.target as HTMLSelectElement).value; if (value) void recordDecision('disposition', value); }} class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1.5 text-[11.5px] text-[var(--color-text)] disabled:opacity-45">
              <option value="">Choose disposition…</option>
              <option value="follow_up">Follow up</option>
              <option value="nurture">Nurture</option>
              <option value="dead_lead">Dead lead</option>
              <option value="wrong_property">Wrong property</option>
              <option value="do_not_contact">Do not contact</option>
              <option value="duplicate">Duplicate</option>
              <option value="unlocatable">Unlocatable</option>
            </select>
            {opportunity?.disposition ? <span class="text-[11px] text-[var(--color-text-muted)]">Current: {opportunity.disposition.replace(/_/g, ' ')}</span> : null}
            <span class="ml-auto text-[10.5px] text-[var(--color-text-faint)]">{trashed ? 'In Trash' : 'Need to remove this lead?'}</span>
            {/* The live trash control lives in the Owner Brief header. */}
          </div>
          {actionMessage ? <div class="mt-2 text-[11px] text-[var(--color-text-muted)]" role="status">{actionMessage}</div> : null}
        </section>

        <section id="pre-discovery-report" data-testid="discovery-package" class="scroll-mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Pre-call property research report</p>
                <Chip tone={packageReady ? 'good' : 'caution'} testId="discovery-package-readiness">{packageReady ? 'Ready — decision-useful' : researchRunning ? 'Research in progress' : 'Incomplete — call may proceed'}</Chip>
              </div>
              <h3 class="mt-0.5 text-[15px] font-semibold text-[var(--color-text)]">{packageReady ? 'Research is ready for the discovery call' : 'Research is not yet decision-useful'}</h3>
              <p class="mt-1 max-w-4xl text-[12px] text-[var(--color-text-muted)]">{asString(callPrep.executiveBrief) ?? 'Confirm seller motivation, authority, timeline, price, and the missing property identity clues.'}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button data-testid="discovery-package-run" type="button" disabled={actionBusy !== null || !opportunity?.id} onClick={() => void rebuildDiscoveryPackage()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] disabled:opacity-45">
                {actionBusy === 'package' ? 'Building…' : 'Refresh call package'}
              </button>
              {opportunity?.id ? <a data-testid="discovery-package-pdf" href={`/api/landos/opportunities/${opportunity.id}/discovery-package/download?format=pdf&token=${encodeURIComponent(dashboardToken)}`} class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-text)]">Download PDF</a> : null}
            </div>
          </div>
          {asString(callPrep.unresolvedIdentityWarning) ? <div data-testid="unresolved-call-brief" class="mt-3 rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-[11.5px] text-[var(--color-text)]">{asString(callPrep.unresolvedIdentityWarning)}</div> : null}
          {!packageReady && packageBlockers.length ? <div data-testid="discovery-package-blockers" class="mt-3 rounded-lg border border-amber-500/45 bg-amber-500/10 p-3"><p class="text-[11.5px] font-semibold text-[var(--color-text)]">Why this report is incomplete</p><Lines items={packageBlockers} empty="Research is still running." /></div> : null}
          <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Field label="Identity" value={packageIdentity.resolutionStatus} />
            <Field label="Package confidence" value={discoveryPackage.confidence} />
            <Field label="Visuals" value={packageVisuals.length} />
            <Field label="Deed review" value={packageDeed.status} />
            <Field label="Land Score" value={scoreThresholdMet ? `${packageScore.score}/${packageScore.maxScore ?? 100}` : 'Withheld — threshold not met'} />
            <Field label="Value confidence" value={valueThresholdMet ? packageValue.confidence : 'Withheld — threshold not met'} />
          </div>
          <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <p class="font-semibold text-[var(--color-text)]">Known property evidence</p>
              <Lines items={verifiedPackageFacts.slice(0, 10).map((fact) => `${asString(fact.label) ?? 'Fact'}: ${String(fact.value ?? 'Needs verification')} (${asString(fact.confidence) ?? 'unknown'} confidence; ${asString(fact.source) ?? 'source unavailable'})`)} empty="Land-characteristic threshold not met: no verified, parcel-associated conclusion is established yet; use the questions below." />
              <p class="mt-2 text-[10.5px] text-[var(--color-text-faint)]">{asString(packageDeed.disclaimer) ?? 'Automated deed review is research, not title or legal confirmation.'}</p>
            </div>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <p class="font-semibold text-[var(--color-text)]">Market Pulse and preliminary range</p>
              <p class="mt-1 text-[11.5px]">{asString(packagePulse.marketPulse) ?? 'Market direction remains a visible research gap.'}</p>
              <p class="mt-2 text-[11.5px] text-[var(--color-text)]">Preliminary parcel value: {valueThresholdMet ? `${fmtMoney(packageValueRange.low) ?? 'Not defensible'} – ${fmtMoney(packageValueRange.high) ?? 'Not defensible'}` : 'Withheld — parcel identity, qualified sold comps, and decision-useful research thresholds are not met.'}</p>
              <p class="text-[11.5px] text-[var(--color-text)]">40–60% owner-review range: {valueThresholdMet ? `${fmtMoney(acquisitionRange.low) ?? 'Not available'} – ${fmtMoney(acquisitionRange.high) ?? 'Not available'}` : 'Withheld — no offer range is supported.'}</p>
              <p class="mt-1 text-[10.5px] text-[var(--color-text-faint)]">{asString(packageValue.note) ?? 'No offer is prepared or sent. The owner chooses after discovery.'}</p>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div data-testid="discovery-package-visuals" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <p class="font-semibold text-[var(--color-text)]">Parcel visuals</p>
              {packageVisuals.length ? <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{packageVisuals.map((visual, index) => {
                const url = asString(visual.url);
                const label = asString(visual.label) ?? asString(visual.kind) ?? 'Visual evidence';
                const kind = asString(visual.kind)?.replace(/_/g, ' ') ?? 'visual';
                return <div data-testid="discovery-package-visual-artifact" key={`${asString(visual.key) ?? 'visual'}-${index}`} class="overflow-hidden rounded border border-[var(--color-border)] p-2">
                  {isRenderableImageArtifact(url) ? <img src={withDashboardToken(url!)} alt={label} loading="lazy" class="mb-2 h-32 w-full rounded bg-[var(--color-card)] object-cover" /> : url ? <div data-testid="external-visual-artifact" class="mb-2 flex h-32 items-center rounded border border-dashed border-[var(--color-border)] bg-[var(--color-card)] px-3 text-[11px] text-[var(--color-text-muted)]">Interactive external map or Earth artifact — open the link below.</div> : null}
                  <p class="text-[11.5px] font-semibold text-[var(--color-text)]">{label}</p><p class="text-[10.5px] text-[var(--color-text-muted)]">{visual.parcelAssociated === true ? 'Parcel associated' : 'Not parcel associated'} · {asString(visual.confidence) ?? 'unknown'} confidence · {asString(visual.source) ?? 'source unavailable'}</p>{url ? <a href={url} target="_blank" rel="noreferrer" class="text-[10.5px] text-[var(--color-accent)]">View full {kind} artifact</a> : <p class="text-[10.5px] text-[var(--color-text-faint)]">Artifact retrieval gap: no captured image URL.</p>}
                </div>;
              })}</div> : <p class="mt-1 text-[11px] text-[var(--color-text-muted)]">Artifact retrieval gap: no verified parcel boundary, satellite, street, comps-map, overlay, or terrain image is available.</p>}
            </div>
            <div data-testid="discovery-package-score" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
              <p class="font-semibold text-[var(--color-text)]">Land Score evidence</p>
              <p class="mt-1 text-[12px] text-[var(--color-text)]">{scoreThresholdMet ? `${packageScore.score}/${packageScore.maxScore ?? 100} · ${asString(packageScore.verdict) ?? 'established'}` : 'Withheld — the parcel-bound scoring threshold is not met.'}</p>
              <Lines items={packageScoreRows.map((row) => `${asString(row.label) ?? 'Dimension'}: ${row.points == null ? 'not established' : `${row.points}/${row.maxPoints ?? '?'}`}${asString(row.gap) ? ` — ${asString(row.gap)}` : ''}`).slice(0, 11)} empty="Land characteristics are not sufficient to score this parcel." />
            </div>
          </div>
          <div data-testid="discovery-package-comps" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><p class="font-semibold text-[var(--color-text)]">Qualified sold land comparables</p><Chip tone={selectedComparables.length >= 3 ? 'good' : 'caution'}>{selectedComparables.length} of up to 5 qualified</Chip></div>
            {selectedComparables.length ? <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{selectedComparables.slice(0, 5).map((comp, index) => <article data-testid="discovery-package-sold-comp" key={`${asString(comp.address) ?? asString(comp.apn) ?? 'comp'}-${index}`} class="rounded border border-[var(--color-border)] p-3 text-[10.5px]"><p class="text-[11.5px] font-semibold text-[var(--color-text)]">{asString(comp.address) ?? asString(comp.apn) ?? 'Location unavailable'}</p><p class="mt-1">Sold {asString(comp.saleDate) ?? 'date missing'} · {typeof comp.distanceMiles === 'number' ? `${comp.distanceMiles} mi` : 'distance missing'}</p><p>{String(comp.acreage ?? '?')} ac · {asString(comp.propertyType)?.replace(/_/g, ' ') ?? 'type missing'}</p><p>{fmtMoney(comp.salePrice) ?? 'price missing'} · {fmtMoney(comp.pricePerAcre) ?? '?'} / ac</p><p class="mt-1 text-[var(--color-text-muted)]">{asString(comp.radiusTier)?.replace(/_/g, ' ') ?? 'radius tier missing'} · {asString(comp.recencyTier)?.replace(/_/g, ' ') ?? 'date tier missing'} · {asString(comp.source) ?? 'source missing'}</p></article>)}</div> : <p class="mt-1 text-[11px] text-[var(--color-text-muted)]">Comparable retrieval gap: no sold row passed all valuation gates — sold status, sale within 24 months, distance within the 3/5/10-mile sequence, comparable acreage/type, usable price, and provenance.</p>}
            {contextComparables.length ? <p class="mt-2 text-[10.5px] text-[var(--color-text-faint)]">{contextComparables.length} active/pending/listed row(s) retained as market context only; they do not drive value.</p> : null}
          </div>
          <div data-testid="discovery-package-market-pulse" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <p class="font-semibold text-[var(--color-text)]">Market Pulse</p>
            <p class="mt-1 text-[11.5px] text-[var(--color-text)]">{packagePulseFacts.length ? asString(packagePulse.marketPulse) ?? 'Market Pulse summary is not established.' : 'Market Pulse withheld — no sourced local-market fact meets the display threshold.'}</p>
            <Lines items={packagePulseFacts.map((fact) => `${asString(fact.label) ?? 'Market fact'}: ${asString(fact.value) ?? 'not established'} (${asString(fact.status) ?? 'unknown'}; ${asString(fact.source) ?? 'source missing'})`).slice(0, 10)} empty="No sourced local-market facts are available." />
          </div>
          <div data-testid="discovery-package-deed" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><p class="font-semibold text-[var(--color-text)]">Deed, ownership, easement, and restriction review</p><Chip tone={asString(packageDeed.status) === 'reviewed' ? 'good' : 'caution'}>{asString(packageDeed.status)?.replace(/_/g, ' ') ?? 'not retrieved'}</Chip></div>
            <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
              <div><p class="text-[10.5px] font-semibold text-[var(--color-text)]">Apparent record owners</p><Lines items={packageDeedOwners} empty="Retrieval gap: no attributable vesting owner was found." /></div>
              <div><p class="text-[10.5px] font-semibold text-[var(--color-text)]">Preliminary easement findings</p><Lines items={packageDeedEasements} empty="Retrieval gap: no attributable easement or right-of-way finding is available." /></div>
              <div><p class="text-[10.5px] font-semibold text-[var(--color-text)]">Preliminary restriction findings</p><Lines items={packageDeedRestrictions} empty="Retrieval gap: no attributable restriction or covenant finding is available." /></div>
            </div>
            {packageDeedFindings.length ? <div class="mt-2 space-y-1">{packageDeedFindings.map((finding, index) => <div data-testid="discovery-package-deed-finding" key={`${asString(finding.key) ?? 'deed'}-${index}`} class="rounded border border-[var(--color-border)] px-2 py-1.5 text-[10.5px]"><span class="font-semibold text-[var(--color-text)]">{asString(finding.label) ?? 'Recorded-document finding'}:</span> {String(finding.value ?? 'not established')} · {asString(finding.source) ?? 'source unavailable'}{asString(finding.observedAt) ? ` · accessed ${asString(finding.observedAt)}` : ''}{asString(finding.sourceUrl) ? <> · <a href={asString(finding.sourceUrl)!} target="_blank" rel="noreferrer" class="text-[var(--color-accent)]">Open document provenance</a></> : ' · document URL not retrieved'}</div>)}</div> : <p class="mt-2 text-[10.5px] text-[var(--color-text-muted)]">Deed retrieval gap: obtain the vesting deed and related recorded instruments from the county recorder before relying on ownership, easement, or restriction conclusions.</p>}
            <p class="mt-2 text-[10.5px] text-[var(--color-text-faint)]">{asString(packageDeed.disclaimer) ?? 'Automated deed review is preliminary research only, not title or legal advice.'}</p>
          </div>
          <div data-testid="discovery-package-sources" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <p class="font-semibold text-[var(--color-text)]">Evidence provenance</p>
            {packageSources.length ? <div class="mt-2 space-y-1">{packageSources.slice(0, 16).map((source, index) => <div data-testid="discovery-package-source" key={`${asString(source.name) ?? 'source'}-${index}`} class="text-[10.5px] text-[var(--color-text-muted)]"><span class="font-semibold text-[var(--color-text)]">{asString(source.name) ?? 'Source'}</span> · {asString(source.kind) ?? 'evidence'} · {asString(source.status) ?? 'status unknown'}{asString(source.accessedAt) ? ` · accessed ${asString(source.accessedAt)}` : ''} — {asString(source.note) ?? 'No source note.'}{asString(source.url) ? <> · <a href={asString(source.url)!} target="_blank" rel="noreferrer" class="text-[var(--color-accent)]">Open provenance</a></> : null}</div>)}</div> : <p class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Evidence retrieval gap: no attributable source record is available.</p>}
          </div>
          <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <p class="mb-1 font-semibold text-[var(--color-text)]">{strategyMode === 'ranked' ? 'Two evidence-backed first-look strategies' : 'Strategy validation hypotheses — not recommendations'}</p>
              <div class="space-y-2">
                {packageStrategies.slice(0, 2).map((strategy) => <div data-testid={strategyMode === 'ranked' ? 'discovery-package-strategy' : 'discovery-package-strategy-hypothesis'} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2"><span class="font-semibold text-[var(--color-text)]">{strategyMode === 'ranked' ? `#${String(strategy.rank ?? '')} ` : ''}{asString(strategy.name) ?? 'Strategy'}</span><p class="mt-1 text-[11px]">{asString(strategy.opportunityLogic) ?? asString(strategy.fit) ?? 'Validate during discovery.'}</p></div>)}
              </div>
            </div>
            <div>
              <p class="mb-1 font-semibold text-[var(--color-text)]">Call questions, gaps, and provenance</p>
              <Lines items={dedupeLines(callPrep.questions).slice(0, 12)} empty="Ask motivation, price, timeline, authority, access, utilities, condition, liens, and reason for sale." />
              {packageGaps.length ? <p class="mt-2 text-[10.5px] text-[var(--color-text-faint)]">Open gaps: {packageGaps.slice(0, 8).join(' · ')}</p> : null}
              <p class="mt-1 text-[10.5px] text-[var(--color-text-faint)]">{packageSources.length} source record(s); {packageVisuals.length} visual(s), each with parcel association and confidence.</p>
            </div>
          </div>
        </section>

        <section data-testid="transcript-reconciliation" class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">After the discovery call</p>
              <h3 class="mt-0.5 text-[15px] font-semibold text-[var(--color-text)]">Upload the transcript after pre-call research and the human conversation</h3>
              <p class="mt-1 text-[11.5px] text-[var(--color-text-muted)]">The transcript does not replace property research. It preserves seller statements after the call so Max and Acquisitions can reconcile what changed. No offer, contract, paid action, or seller outbound action is available here.</p>
            </div>
            <label data-testid="transcript-upload-control" class="cursor-pointer rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-text)]">
              Upload .txt transcript
              <input data-testid="transcript-file-input" type="file" accept=".txt,text/plain" disabled={!opportunity?.id || actionBusy !== null} onChange={(event) => void uploadTranscript(event)} class="sr-only" />
            </label>
          </div>
          <textarea data-testid="transcript-paste-input" value={transcriptText} onInput={(event) => setTranscriptText((event.currentTarget as HTMLTextAreaElement).value)} rows={6} placeholder="Paste the discovery-call transcript here…" class="mt-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3 text-[12px] text-[var(--color-text)]" />
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button data-testid="transcript-paste-submit" type="button" disabled={!opportunity?.id || !transcriptText.trim() || actionBusy !== null} onClick={() => void submitTranscriptPaste()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] disabled:opacity-45">{actionBusy === 'transcript' ? 'Reconciling…' : 'Preserve & reconcile transcript'}</button>
            <Chip tone={transcripts.length ? 'good' : 'unknown'} testId="transcript-count-chip">{transcripts.length} immutable original{transcripts.length === 1 ? '' : 's'}</Chip>
          </div>
          {transcripts.length ? (
            <div data-testid="transcript-reconciliation-output" class="mt-4 space-y-3 border-t border-[var(--color-border)] pt-3">
              <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Original source" value={transcriptRecord.sourceType} />
                <Field label="Original hash" value={transcriptRecord.contentSha256} mono />
                <Field label="Reconciliation" value={transcriptReconciliation.version ? `v${transcriptReconciliation.version}` : 'pending'} />
                <Field label="Discovery state" value={opportunity?.discoveryStatus ?? 'reconciled'} />
              </div>
              <details data-testid="transcript-original" class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
                <summary class="cursor-pointer font-semibold text-[var(--color-text)]">Immutable original transcript</summary>
                <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[var(--color-text-muted)]">{asString(transcriptRecord.rawText) ?? 'Original unavailable.'}</pre>
              </details>
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
                <p class="font-semibold text-[var(--color-text)]">Concise call summary</p>
                <p data-testid="transcript-summary" class="mt-1 text-[12px]">{asString(transcriptReconciliation.summary) ?? 'Reconciliation pending.'}</p>
                <p class="mt-2 text-[11px] text-[var(--color-text-muted)]">Motivation: {String(asRecord(transcriptReconciliation.motivation).score ?? transcriptReconciliation.motivationScore ?? 'not scored')}/10 ({asString(asRecord(transcriptReconciliation.motivation).label) ?? 'unrated'}) — {dedupeLines(asRecord(transcriptReconciliation.motivation).evidence).join(' · ') || asString(transcriptReconciliation.motivationEvidence) || 'No motivation evidence stated.'}</p>
                <p class="text-[11px] text-[var(--color-text-muted)]">Asking price: {fmtMoney(transcriptReconciliation.askingPrice) ?? 'not stated'} · Timeline: {asString(transcriptReconciliation.timeline) ?? 'not stated'}</p>
              </div>
              <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div><p class="mb-1 font-semibold text-[var(--color-text)]">Seller statements (unverified)</p><Lines items={[...sellerStatements, ...propertyStatements]} empty="No seller/property statements extracted." /></div>
                <div><p class="mb-1 font-semibold text-[var(--color-text)]">Verified facts kept separate</p><Lines items={verifiedFacts} empty="No transcript statement was promoted to a verified fact." /></div>
                <div><p class="mb-1 font-semibold text-[var(--color-text)]">Named parties</p><Lines items={transcriptParties} empty="No named party extracted." /></div>
                <div><p class="mb-1 font-semibold text-[var(--color-text)]">Material conflicts</p><Lines items={contradictions} empty="No material conflict detected against current research." /></div>
                <div><p class="mb-1 font-semibold text-[var(--color-text)]">Deeper research</p><Lines items={deeperTasks} empty="No deeper-research task created." /></div>
                <div><p class="mb-1 font-semibold text-[var(--color-text)]">Follow-up work</p><Lines items={followUpTasks} empty="No follow-up task created." /></div>
              </div>
              <div data-testid="transcript-next-action" class="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[12px] text-[var(--color-text)]"><span class="font-semibold">One allowed next action:</span> {asString(transcriptNextAction.label) ?? asString(transcriptNextAction.action) ?? asString(transcriptReconciliation.nextAction) ?? 'more research'}</div>
            </div>
          ) : null}
        </section>

        {/* HARD STOP: genuine requested-vs-resolved parcel conflict. Nothing downstream ran. */}
        {hasConflict ? (
          <div data-testid="lead-workspace-conflict" class="rounded-xl border-2 border-red-600/60 bg-red-600/10 p-4">
            <div class="text-[13px] font-bold text-red-700 dark:text-red-400">WRONG PARCEL {'—'} HARD STOP</div>
            <div class="mt-1.5 text-[12px] text-[var(--color-text)]">
              You asked for APN <span class="font-mono font-semibold">{asString(conflict.requestedApn) ?? 'unknown'}</span>, but {asString(conflict.source) ?? 'a parcel-level source'} resolved a different parcel {'—'} APN <span class="font-mono font-semibold">{asString(conflict.resolvedApn) ?? 'unknown'}</span>
              {asString(conflict.resolvedContext) ? <span class="text-[var(--color-text-muted)]"> ({asString(conflict.resolvedContext)})</span> : null}.
            </div>
            <div class="mt-1.5 border-t border-red-600/30 pt-2 text-[11px] text-[var(--color-text-muted)]">
              The resolved parcel was NOT accepted as the subject. Property conclusions, Land Score, valuation, offer preparation, and automatic pursuit remain blocked until the correct parcel is confirmed. The discovery call can still proceed using identity-confirmation questions.
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

          {/* This is the eight-lane diligence workflow, not the Property
              Research Agent mission shown above. Keep the two statuses
              separate: a completed identity/source mission never means every
              physical and legal screening lane has been completed. */}
          <Section title="Core due-diligence screening" subtitle="separate from Property Research Agent mission" testId="lead-workspace-research">
            {asString(researchMission.status) ? (
              <div data-testid="research-mission-context" class="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2">
                <p class="text-[11.5px] font-semibold text-[var(--color-text)]">
                  Property Research Agent mission: {asString(researchMission.status)?.replace(/_/g, ' ')}
                </p>
                <p class="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {asString(researchMission.summary) ?? 'No property-research mission summary is available.'} This mission verifies and gathers parcel-source evidence; it does not by itself complete the core due-diligence lanes below.
                </p>
              </div>
            ) : null}
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
          {asString(compPolicy.disclosure) ? <div data-testid="comp-policy-disclosure" class="rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-[11.5px] font-semibold text-[var(--color-text)]">{asString(compPolicy.disclosure)}</div> : null}
          <p class="text-[10.5px] text-[var(--color-text-faint)]">Sold properties drive preliminary value. {contextComps.length} active/pending/listed record(s) are context only and cannot create value or offer guidance.</p>
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

  return <div data-testid="lead-workspace-root" class="min-w-0 flex-1">
    <OwnerBrief
      dealCardId={dealCardId}
      title={asString(packageIdentity.leadTitle) ?? asString(workspace.lead.title) ?? 'Untitled lead'}
      identity={packageIdentity}
      propertyIdentity={identity}
      deed={packageDeed}
      deedFindings={packageDeedFindings}
      deedPages={deedPageVisuals}
      lienReview={packageLienReview}
      lienFindings={packageLienFindings}
      facts={packageFacts}
      visuals={packageVisuals}
      comparables={selectedComparables}
      recordedSales={recordedSales}
      marketSales={localSoldMarketEvidence}
      marketPulse={packagePulse}
      strategies={packageStrategies}
      researchRunning={researchRunning}
      actionBusy={actionBusy !== null}
      onResearch={() => void runResearch()}
      onCorrectLocality={openLocalityEditor}
      onReconcileVerifiedParcel={openVerifiedParcelReconciliation}
      onAttachRecordedDeedPage={openRecordedDeedPageEditor}
      onRecordLienReview={openRecordedLienReviewEditor}
      onRecordVerifiedSale={openVerifiedSaleEditor}
      onOpenVisual={setSelectedVisual}
      trashed={trashed}
      onTrashed={() => { setTrashed(true); setActionMessage('Moved to Trash. The lead, research, and documents are preserved and can be restored from Deal Library → Trash.'); }}
      onTrashError={setActionMessage}
    />
    <div class="mx-auto max-w-7xl space-y-3 px-4 pb-4 sm:px-6">
      <section data-testid="discovery-package" class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Pre-call property research report</p>
            <h3 class="mt-0.5 text-[15px] font-semibold text-[var(--color-text)]">{packageReady ? 'Research is ready for the discovery call' : 'Research is not yet decision-useful'}</h3>
            <p class="mt-1 max-w-4xl text-[12px] text-[var(--color-text-muted)]">{asString(callPrep.executiveBrief) ?? 'Confirm seller motivation, authority, timeline, price, and remaining property questions.'}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button data-testid="discovery-package-run" type="button" disabled={actionBusy !== null || !opportunity?.id} onClick={() => void rebuildDiscoveryPackage()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] disabled:opacity-45">{actionBusy === 'package' ? 'Building…' : 'Refresh call package'}</button>
            {opportunity?.id ? <a data-testid="discovery-package-pdf" href={`/api/landos/opportunities/${opportunity.id}/discovery-package/download?format=pdf&token=${encodeURIComponent(dashboardToken)}`} class="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-text)]">Download PDF</a> : null}
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Field label="Package status" value={packageReady ? 'Decision-useful' : 'Incomplete — call may proceed'} />
          <Field label="Identity" value={packageIdentity.resolutionStatus} />
          <Field label="Package confidence" value={discoveryPackage.confidence} />
          <Field label="Visuals" value={packageVisuals.length} />
          <Field label="Land Score" value={scoreThresholdMet ? `${packageScore.score}/${packageScore.maxScore ?? 100}` : 'Withheld'} />
          <Field label="Value confidence" value={valueThresholdMet ? packageValue.confidence : 'Withheld'} />
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <p class="font-semibold text-[var(--color-text)]">Known property evidence</p>
            <Lines items={verifiedPackageFacts.slice(0, 10).map((fact) => `${asString(fact.label) ?? 'Fact'}: ${String(fact.value ?? 'Needs verification')}`)} empty="No verified property evidence is available yet." />
          </div>
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
            <p class="font-semibold text-[var(--color-text)]">Market and acquisition range</p>
            <p class="mt-1 text-[11.5px]">{asString(packagePulse.marketPulse) ?? 'Market direction remains a research gap.'}</p>
            <p class="mt-2 text-[11.5px]">Preliminary parcel value: {valueThresholdMet ? `${fmtMoney(packageValueRange.low)} – ${fmtMoney(packageValueRange.high)}` : 'Withheld until the research thresholds are met.'}</p>
            <p class="text-[11.5px]">Owner-review range: {valueThresholdMet ? `${fmtMoney(acquisitionRange.low)} – ${fmtMoney(acquisitionRange.high)}` : 'Withheld — no offer range is supported.'}</p>
          </div>
        </div>
        <div data-testid="discovery-package-comps" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
          <p class="font-semibold text-[var(--color-text)]">Qualified sold land comparables</p>
          <Lines items={selectedComparables.map((comp) => `${asString(comp.address) ?? 'Comparable'} · ${fmtMoney(comp.salePrice) ?? 'price unavailable'} · ${String(comp.acreage ?? '?')} ac · ${typeof comp.distanceMiles === 'number' ? comp.distanceMiles : '?'} mi · ${asString(comp.saleDate) ?? 'date unavailable'}`)} empty="No sold comparable has passed the valuation checks yet." />
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div><p class="mb-1 font-semibold text-[var(--color-text)]">Call questions</p><Lines items={dedupeLines(callPrep.questions).slice(0, 12)} empty="Ask motivation, price, timeline, authority, access, utilities, and reason for sale." /></div>
          <div><p class="mb-1 font-semibold text-[var(--color-text)]">Parcel visual evidence</p><Lines items={packageVisuals.slice(0, 12).map((visual) => `${asString(visual.label) ?? asString(visual.kind) ?? 'Visual evidence'} — ${visual.parcelAssociated === true ? 'parcel associated' : 'context evidence'}`)} empty="No visual evidence is available yet." /></div>
        </div>
      </section>
      <section data-testid="transcript-reconciliation" class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">After the discovery call</p><h3 class="mt-0.5 text-[15px] font-semibold text-[var(--color-text)]">Preserve and reconcile the call transcript</h3><p class="mt-1 text-[11.5px] text-[var(--color-text-muted)]">Seller statements stay distinct from verified property facts. No offer, contract, paid action, or seller outbound action is available here.</p></div>
          <label data-testid="transcript-upload-control" class="cursor-pointer rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-text)]">Upload .txt transcript<input data-testid="transcript-file-input" type="file" accept=".txt,text/plain" disabled={!opportunity?.id || actionBusy !== null} onChange={(event) => void uploadTranscript(event)} class="sr-only" /></label>
        </div>
        <textarea data-testid="transcript-paste-input" value={transcriptText} onInput={(event) => setTranscriptText((event.currentTarget as HTMLTextAreaElement).value)} rows={6} placeholder="Paste the discovery-call transcript here…" class="mt-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3 text-[12px] text-[var(--color-text)]" />
        <div class="mt-2 flex flex-wrap items-center gap-2"><button data-testid="transcript-paste-submit" type="button" disabled={!opportunity?.id || !transcriptText.trim() || actionBusy !== null} onClick={() => void submitTranscriptPaste()} class="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] disabled:opacity-45">{actionBusy === 'transcript' ? 'Reconciling…' : 'Preserve & reconcile transcript'}</button><Chip tone={transcripts.length ? 'good' : 'unknown'}>{transcripts.length} immutable original{transcripts.length === 1 ? '' : 's'}</Chip></div>
        {transcripts.length ? <div data-testid="transcript-reconciliation-output" class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3"><p class="font-semibold text-[var(--color-text)]">{asString(transcriptReconciliation.summary) ?? 'Reconciliation pending.'}</p><p class="mt-1 text-[11.5px]">One allowed next action: {asString(transcriptNextAction.label) ?? asString(transcriptNextAction.action) ?? 'more research'}</p></div> : null}
      </section>
    </div>
    {deedPageEditorOpen ? <div data-testid="owner-brief-recorder-page-editor" role="dialog" aria-modal="true" aria-label="Attach county recorder deed page" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <form onSubmit={(event) => void saveRecordedDeedPage(event)} class="my-6 w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl">
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Attach county recorder deed page</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Attach only an image page visibly displayed by the official county recorder. LandOS stores the page with its official source URL and renders it on this card; it does not turn a book/page reference into a document or replace title review.</p>
        <label class="mt-4 block text-[12px] font-semibold text-[var(--color-text)]">Recorder image page<input required accept="image/png,image/jpeg,image/webp" type="file" onChange={(event) => setDeedPageFile((event.target as HTMLInputElement).files?.[0] ?? null)} class="mt-1 block w-full text-[12px] text-[var(--color-text-muted)]" /></label>
        <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="block text-[12px] font-semibold text-[var(--color-text)]">Document title<input required value={deedPageDraft.title} onInput={(event) => setDeedPageDraft((draft) => ({ ...draft, title: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">Image page number<input required min="1" max="999" type="number" value={deedPageDraft.pageNumber} onInput={(event) => setDeedPageDraft((draft) => ({ ...draft, pageNumber: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label></div>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Recorded document or book/page reference<input required value={deedPageDraft.documentId} onInput={(event) => setDeedPageDraft((draft) => ({ ...draft, documentId: (event.target as HTMLInputElement).value }))} placeholder="Example: Book 795 Page 429" class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Official recorder label<input required value={deedPageDraft.sourceLabel} onInput={(event) => setDeedPageDraft((draft) => ({ ...draft, sourceLabel: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Official recorder URL<input required type="url" value={deedPageDraft.sourceUrl} onInput={(event) => setDeedPageDraft((draft) => ({ ...draft, sourceUrl: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-4 flex items-start gap-2 text-[12px] text-[var(--color-text)]"><input required type="checkbox" checked={deedPageDraft.confirmedOfficialSource} onInput={(event) => setDeedPageDraft((draft) => ({ ...draft, confirmedOfficialSource: (event.target as HTMLInputElement).checked }))} /><span>I confirm this exact image was displayed by the official county recorder at the URL above.</span></label>
        <div class="mt-5 flex justify-end gap-2"><button type="button" disabled={actionBusy !== null} onClick={() => setDeedPageEditorOpen(false)} class="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--color-text-muted)]">Cancel</button><button type="submit" disabled={actionBusy !== null || !deedPageFile} class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{actionBusy === 'deed' ? 'Attachingâ€¦' : 'Attach recorder page'}</button></div>
      </form>
    </div> : null}
    {lienEditorOpen ? <div data-testid="owner-brief-recorded-lien-editor" role="dialog" aria-modal="true" aria-label="Record official lien review" class="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <form onSubmit={(event) => void saveRecordedLienReview(event)} class="my-6 w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl">
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Record official lien review</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Record only what an official recorder or government lien index displayed. A name-index hit or empty search is screening evidence, never a title opinion or clear-title conclusion.</p>
        <label class="mt-4 block text-[12px] font-semibold text-[var(--color-text)]">Official result<select value={lienDraft.status} onInput={(event) => setLienDraft((draft) => ({ ...draft, status: (event.target as HTMLSelectElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]"><option value="no_matching_index_entry">No matching name/reference index entry</option><option value="index_hit">Index hit — owner/debtor match only</option><option value="parcel_confirmed">Potential lien matched to parcel</option><option value="released_or_satisfied">Recorded lien released or satisfied</option></select></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Official source label<input required value={lienDraft.sourceLabel} onInput={(event) => setLienDraft((draft) => ({ ...draft, sourceLabel: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Official source URL<input required type="url" value={lienDraft.sourceUrl} onInput={(event) => setLienDraft((draft) => ({ ...draft, sourceUrl: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Searched owner/debtor name or reference<input required value={lienDraft.searchedNameOrReference} onInput={(event) => setLienDraft((draft) => ({ ...draft, searchedNameOrReference: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="block text-[12px] font-semibold text-[var(--color-text)]">Recording reference{lienDraft.status !== 'no_matching_index_entry' ? <span> (required)</span> : null}<input required={lienDraft.status !== 'no_matching_index_entry'} value={lienDraft.recordingReference} onInput={(event) => setLienDraft((draft) => ({ ...draft, recordingReference: (event.target as HTMLInputElement).value }))} placeholder="Book/page or instrument number" class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">Lien or instrument type<input value={lienDraft.lienType} onInput={(event) => setLienDraft((draft) => ({ ...draft, lienType: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label></div>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Parcel or legal-description match{lienDraft.status === 'parcel_confirmed' ? <span> (required)</span> : null}<textarea required={lienDraft.status === 'parcel_confirmed'} rows={2} value={lienDraft.propertyMatch} onInput={(event) => setLienDraft((draft) => ({ ...draft, propertyMatch: (event.target as HTMLTextAreaElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" placeholder="Describe the parcel/legal-description comparison if the record can be matched." /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Observed notes<textarea rows={3} value={lienDraft.notes} onInput={(event) => setLienDraft((draft) => ({ ...draft, notes: (event.target as HTMLTextAreaElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" placeholder="Release, satisfaction, date, or uncertainty noted on the official source." /></label>
        <label class="mt-4 flex items-start gap-2 text-[12px] text-[var(--color-text)]"><input required type="checkbox" checked={lienDraft.confirmedOfficialSource} onInput={(event) => setLienDraft((draft) => ({ ...draft, confirmedOfficialSource: (event.target as HTMLInputElement).checked }))} /><span>I confirm this result was displayed by the official recorder or government source at the URL above.</span></label>
        <div class="mt-5 flex justify-end gap-2"><button type="button" disabled={actionBusy !== null} onClick={() => setLienEditorOpen(false)} class="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--color-text-muted)]">Cancel</button><button type="submit" disabled={actionBusy !== null} class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{actionBusy === 'lien' ? 'Saving…' : 'Save official lien review'}</button></div>
      </form>
    </div> : null}
    {compEditorOpen ? <div data-testid="owner-brief-verified-sale-editor" role="dialog" aria-modal="true" aria-label="Record verified sale" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <form onSubmit={(event) => void saveVerifiedSale(event)} class="my-6 w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl">
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Record verified sold comparable</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Save the observed closed-sale facts and its source page. LandOS will apply the same distance, acreage, date, and property-type checks used for every comparable.</p>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="block text-[12px] font-semibold text-[var(--color-text)]">Source<select value={compDraft.sourceLabel} onInput={(event) => setCompDraft((draft) => ({ ...draft, sourceLabel: (event.target as HTMLSelectElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]"><option>Redfin</option><option>Zillow</option><option>LandPortal</option><option>Realtor</option><option>County</option><option>Other</option></select></label>
          <label class="block text-[12px] font-semibold text-[var(--color-text)]">Sale date<input required type="date" value={compDraft.saleOrListDate} onInput={(event) => setCompDraft((draft) => ({ ...draft, saleOrListDate: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        </div>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Source page<input required type="url" value={compDraft.sourceUrl} onInput={(event) => setCompDraft((draft) => ({ ...draft, sourceUrl: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Property address<input required value={compDraft.addressDesc} onInput={(event) => setCompDraft((draft) => ({ ...draft, addressDesc: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="block text-[12px] font-semibold text-[var(--color-text)]">Closed sale price<input required min="1" step="1" type="number" value={compDraft.price} onInput={(event) => setCompDraft((draft) => ({ ...draft, price: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">Lot acres<input required min="0.01" step="0.01" type="number" value={compDraft.acres} onInput={(event) => setCompDraft((draft) => ({ ...draft, acres: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label></div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="block text-[12px] font-semibold text-[var(--color-text)]">Latitude<input type="number" step="any" value={compDraft.lat} onInput={(event) => setCompDraft((draft) => ({ ...draft, lat: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">Longitude<input type="number" step="any" value={compDraft.lng} onInput={(event) => setCompDraft((draft) => ({ ...draft, lng: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label></div>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Observed property type and source notes<textarea required rows={3} value={compDraft.notes} onInput={(event) => setCompDraft((draft) => ({ ...draft, notes: (event.target as HTMLTextAreaElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" placeholder="Example: Manufactured home, 3 bed / 2 bath; observed on source page." /></label>
        <div class="mt-5 flex justify-end gap-2"><button type="button" disabled={actionBusy !== null} onClick={() => setCompEditorOpen(false)} class="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--color-text-muted)]">Cancel</button><button type="submit" disabled={actionBusy !== null} class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{actionBusy === 'comp' ? 'Savingâ€¦' : 'Save verified sale'}</button></div>
      </form>
    </div> : null}
    {parcelEditorOpen ? <div data-testid="owner-brief-parcel-reconciliation-editor" role="dialog" aria-modal="true" aria-label="Reconcile verified parcel" class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <form onSubmit={(event) => void saveVerifiedParcelReconciliation(event)} class="my-6 w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl">
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Reconcile verified parcel</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Use this only when an official parcel record contradicts the current APN or owner. LandOS preserves the prior evidence for audit and quarantines it instead of merging it into this parcel.</p>
        <label class="mt-4 block text-[12px] font-semibold text-[var(--color-text)]">Property address<input required value={parcelDraft.address} onInput={(event) => setParcelDraft((draft) => ({ ...draft, address: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <div class="mt-3 grid gap-3 sm:grid-cols-3"><label class="block text-[12px] font-semibold text-[var(--color-text)]">City<input required value={parcelDraft.city} onInput={(event) => setParcelDraft((draft) => ({ ...draft, city: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">County<input required value={parcelDraft.county} onInput={(event) => setParcelDraft((draft) => ({ ...draft, county: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">State<input required maxlength={2} value={parcelDraft.state} onInput={(event) => setParcelDraft((draft) => ({ ...draft, state: (event.target as HTMLInputElement).value.toUpperCase() }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label></div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2"><label class="block text-[12px] font-semibold text-[var(--color-text)]">Verified APN<input required value={parcelDraft.apn} onInput={(event) => setParcelDraft((draft) => ({ ...draft, apn: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 font-mono text-[13px] text-[var(--color-text)]" /></label><label class="block text-[12px] font-semibold text-[var(--color-text)]">Verified owner<input required value={parcelDraft.owner} onInput={(event) => setParcelDraft((draft) => ({ ...draft, owner: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label></div>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Official source label<input required value={parcelDraft.sourceLabel} onInput={(event) => setParcelDraft((draft) => ({ ...draft, sourceLabel: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Official source URL<input required type="url" value={parcelDraft.sourceUrl} onInput={(event) => setParcelDraft((draft) => ({ ...draft, sourceUrl: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">Recorded deed book/page (if shown)<input value={parcelDraft.deedReference} onInput={(event) => setParcelDraft((draft) => ({ ...draft, deedReference: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-4 flex items-start gap-2 text-[12px] text-[var(--color-text)]"><input required type="checkbox" checked={parcelDraft.confirmAcceptedIdentityReplacement} onInput={(event) => setParcelDraft((draft) => ({ ...draft, confirmAcceptedIdentityReplacement: (event.target as HTMLInputElement).checked }))} /><span>I confirm this official record replaces the accepted parcel identity. I understand conflicting prior research will be quarantined, not merged.</span></label>
        <div class="mt-5 flex justify-end gap-2"><button type="button" disabled={actionBusy !== null} onClick={() => setParcelEditorOpen(false)} class="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--color-text-muted)]">Cancel</button><button type="submit" disabled={actionBusy !== null} class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{actionBusy === 'parcel' ? 'Saving…' : 'Save verified parcel'}</button></div>
      </form>
    </div> : null}
    {localityEditorOpen ? <div data-testid="owner-brief-locality-editor" role="dialog" aria-modal="true" aria-label="Correct location details" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={(event) => void saveLocalityCorrection(event)} class="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl">
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Correct location details</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">This corrects the lead’s city, county, and state. It does not change or verify a parcel ID.</p>
        <label class="mt-4 block text-[12px] font-semibold text-[var(--color-text)]">City<input required value={localityDraft.city} onInput={(event) => setLocalityDraft((draft) => ({ ...draft, city: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">County<input required value={localityDraft.county} onInput={(event) => setLocalityDraft((draft) => ({ ...draft, county: (event.target as HTMLInputElement).value }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <label class="mt-3 block text-[12px] font-semibold text-[var(--color-text)]">State<input required maxlength={2} value={localityDraft.state} onInput={(event) => setLocalityDraft((draft) => ({ ...draft, state: (event.target as HTMLInputElement).value.toUpperCase() }))} class="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[13px] text-[var(--color-text)]" /></label>
        <div class="mt-5 flex justify-end gap-2"><button type="button" disabled={actionBusy !== null} onClick={() => setLocalityEditorOpen(false)} class="rounded-lg px-3 py-2 text-[12px] font-semibold text-[var(--color-text-muted)]">Cancel</button><button type="submit" disabled={actionBusy !== null} class="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{actionBusy === 'locality' ? 'Saving…' : 'Save location'}</button></div>
      </form>
    </div> : null}
    {selectedVisual ? <div data-testid="owner-brief-visual-lightbox" role="dialog" aria-modal="true" aria-label={selectedVisual.label} class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setSelectedVisual(null)}>
      <div class="relative max-h-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Close visual" onClick={() => setSelectedVisual(null)} class="absolute right-2 top-2 z-10 rounded-full bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white">Close</button>
        <img src={selectedVisual.url} alt={selectedVisual.label} class="max-h-[88vh] max-w-full rounded-xl object-contain" />
        <p class="mt-2 text-center text-[12px] font-semibold text-white">{selectedVisual.label}</p>
      </div>
    </div> : null}
  </div>;
}
