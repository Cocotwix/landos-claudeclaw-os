// Full details for one comparable — the expanded block behind "Full details".
//
// A closed sale and an active listing answer different questions, so they get
// different layouts rather than one generic field dump:
//
//   Closed sale        →  SALE SUMMARY · PHOTOS · LISTING DESCRIPTION ·
//                         LANDOS COMP NOTES · LISTING TIMELINE ·
//                         COMPARABILITY · SOURCE
//   Active competitor  →  CURRENT COMPETITION · PHOTOS · LISTING DESCRIPTION ·
//                         LANDOS COMPETITION NOTES · LISTING TIMELINE ·
//                         COMPETITION ANALYSIS · SOURCE
//
// The closed layout leads with the verified sold price and how long the parcel
// took to sell. The active layout leads with what the seller is asking and how
// long the market has refused to pay it — the two facts that decide whether a
// live listing is competition or a warning.
//
// Three rules are enforced here rather than left to styling:
//   • A pending-price proxy is labeled an ESTIMATE everywhere it appears and
//     carries a visible reduced-confidence note. It is never called a sold price.
//   • The source description and the LandOS summary are separate SECTIONS with
//     separate attribution. Marketing claims are listed AS claims.
//   • Retrieval diagnostics are not shown. Image-provenance narratives, bot
//     interstitial explanations, capture timestamps, raw coordinates and
//     missing-field debugging are all real and all retained on the projection's
//     `evidence.diagnostics`, and none of them help someone decide what to offer
//     on a parcel. They competed for attention with the sold price and the market
//     time, so they now live in the audit record and nowhere else. What survives
//     here is the one thing the operator genuinely needs to re-check a fact: the
//     provider's name and a link to the original page.

import { ExternalLink } from 'lucide-preact';
import { AcquisitionWorkspaceV2CompPhotoGallery } from './AcquisitionWorkspaceV2CompPhotoGallery';
import { CompPhotoCarousel } from './CompPhotoCarousel';
import { CompProvenanceBadges } from './CompRecordIdentity';
import { compProviders, providerSummary } from '@/lib/comp-provenance';
import type { CvComp, CvTimelineRow } from './AcquisitionWorkspaceV2CompsValuation';

const usd = (n: number | null | undefined) =>
  (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—');

const ROLE_LABEL: Record<string, string> = {
  direct: 'Direct comp',
  supporting: 'Supporting comp',
  supplemental_historical: 'Supplemental historical comp',
  boundary: 'Boundary comp',
  historical_context: 'Historical context',
};

const EVENT_LABEL: Record<CvTimelineRow['kind'], string> = {
  listed: 'Listed for sale',
  price_change: 'Price change',
  withdrawn: 'Withdrawn / removed',
  relisted: 'Relisted',
  pending: 'Pending',
  back_on_market: 'Back on market',
  sold: 'Sold',
  active: 'Active',
};

const nameOf = (c: CvComp) => c.address ?? (c.apn ? `APN ${c.apn}` : 'this parcel');

function Figure({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div class={`awv2-cvd-fig${strong ? ' strong' : ''}${warn ? ' warn' : ''}`}>
      <span class="l">{label}</span>
      <b class="v">{value}</b>
    </div>
  );
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="awv2-cvd-section">
      <h4 class="awv2-cvd-h">{title}</h4>
      {children}
    </section>
  );
}

/** The dated event list. Undated rows the source printed are shown separately. */
function Timeline({ c }: { c: CvComp }) {
  const rows = c.listing?.timeline ?? [];
  return (
    <Section title="LISTING TIMELINE">
      {rows.length === 0 ? (
        <p class="awv2-cvd-note">
          The source published no dated listing events for this record, so no timeline can be shown.
        </p>
      ) : (
        <ol class="awv2-cvd-timeline">
          {rows.map((r, i) => (
            <li key={`${r.dateIso}-${r.kind}-${i}`} class={`ev-${r.kind}`}>
              <span class="d">{r.dateIso}</span>
              <span class="e">{EVENT_LABEL[r.kind] ?? r.kind}</span>
              <span class="p">{r.price != null ? usd(r.price) : ''}</span>
              <span class="s">{r.label && r.label.toLowerCase() !== (EVENT_LABEL[r.kind] ?? '').toLowerCase() ? `“${r.label}” · ` : ''}{r.source}</span>
            </li>
          ))}
        </ol>
      )}
      {c.listing?.marketTime.relistStitched && (
        <p class="awv2-cvd-note stitched">
          Relist stitching applied: {c.listing.marketTime.episodeCount} listing episodes were treated as one continuous
          marketing effort ({c.listing.marketTime.withdrawnDays} day{c.listing.marketTime.withdrawnDays === 1 ? '' : 's'} off market,
          no intervening sale).
        </p>
      )}
      {c.listing?.marketTime.stitchUncertain && (
        <p class="awv2-cvd-note warn">Relist stitching uncertain. Earlier episodes are shown but are NOT merged into the cumulative figure.</p>
      )}
    </Section>
  );
}

/** The provider's own words, kept as the provider's own words. */
function ListingDescription({ c }: { c: CvComp }) {
  const d = c.listing?.description;
  return (
    <Section title="LISTING DESCRIPTION">
      {d?.source ? (
        <>
          <p class="awv2-cvd-descbody">{d.source.text}</p>
          <p class="awv2-cvd-attr">{d.source.attribution}. {d.source.note}</p>
        </>
      ) : (
        <p class="awv2-cvd-note">The source page published no property description for this record.</p>
      )}
    </Section>
  );
}

/**
 * LandOS's own reading of the parcel.
 *
 * Kept in its own section, below the source's words, so the operator can always
 * see which sentence came from a broker trying to sell a parcel and which came
 * from LandOS reading retained evidence. A marketing claim is repeated as a
 * claim and attributed; it is never quietly promoted into a verified fact and
 * never turned into a valuation adjustment on its own.
 */
function LandosNotes({ c, active }: { c: CvComp; active: boolean }) {
  const l = c.listing?.description.landos;
  return (
    <Section title={active ? 'LANDOS COMPETITION NOTES' : 'LANDOS COMP NOTES'}>
      <p class="awv2-cvd-descbody">{l?.text || 'Not enough retained evidence to summarise this parcel.'}</p>
      {l?.verified.length ? (
        <p class="awv2-cvd-line"><b>Verified by LandOS:</b> {l.verified.join(' · ')}</p>
      ) : null}
      {l?.sourceClaims.length ? (
        <p class="awv2-cvd-line claims">
          <b>Listing claims (not verified by LandOS):</b>{' '}
          {l.sourceClaims.map((s) => `${s.claim}${s.status === 'independently_confirmed' ? ' (independently confirmed)' : ''}`).join(' · ')}
        </p>
      ) : null}
      {l?.unresolved.length ? (
        <p class="awv2-cvd-line unresolved"><b>Unresolved:</b> {l.unresolved.join('; ')}.</p>
      ) : null}
      {l?.note && <p class="awv2-cvd-attr">{l.note}</p>}
    </Section>
  );
}

/** The one piece of provenance the operator genuinely uses: where to re-check. */
function Source({ c }: { c: CvComp }) {
  const providers = compProviders(c);
  const provider = providerSummary(c.listing?.evidence.provider ?? c.source);
  return (
    <Section title="SOURCE">
      <div class="awv2-cvd-source">
        <Figure label="Source" value={provider} />
        <CompProvenanceBadges c={c} className="awv2-cvd-sourcebadges" />
        {/* What the merge actually did, in the server's own words. Without it a
            record standing for ten provider observations looks exactly like one
            standing for a single listing. */}
        {c.mergeStatus && <p class="awv2-cvd-attr">{c.mergeStatus}</p>}
        {providers.length === 1 && !c.mergeStatus && (
          <p class="awv2-cvd-note">One source observation; nothing was merged into this record.</p>
        )}
        {c.sourceUrl ? (
          <a class="awv2-cvd-sourcelink" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Open original listing
          </a>
        ) : (
          <p class="awv2-cvd-note">No original source page is retained for this record.</p>
        )}
      </div>
    </Section>
  );
}

function Comparability({ c }: { c: CvComp }) {
  const role = c.operatorExcluded ? 'Excluded' : c.valuationRole ? ROLE_LABEL[c.valuationRole] : c.categoryLabel;
  return (
    <Section title="COMPARABILITY">
      <div class="awv2-cvd-grid">
        <Figure label="Role" value={role} strong />
        <Figure label="Valuation weight" value={c.valuationWeight != null ? String(c.valuationWeight) : 'zero'} />
        <Figure label="Distance from subject" value={c.distanceMiles != null ? `${c.distanceMiles} mi` : 'unavailable'} />
        <Figure label="Acreage difference" value={c.acresDeltaFromSubject != null ? `${c.acresDeltaFromSubject > 0 ? '+' : ''}${c.acresDeltaFromSubject} ac vs subject` : '—'} />
      </div>
      <p class="awv2-cvd-body">{c.zeroWeightReason ?? c.classificationReason}</p>
      {c.primaryComparability && <p class="awv2-cvd-body">{c.primaryComparability}</p>}
      {c.keyDifference && <p class="awv2-cvd-body diff">Key difference: {c.keyDifference}</p>}
      {c.listing?.description.landos.comparability.map((l) => (
        <p class="awv2-cvd-body" key={l.slice(0, 30)}>{l}</p>
      ))}
    </Section>
  );
}

function CompetitionAnalysis({ c, adoptedFmv, landBasis }: { c: CvComp; adoptedFmv: number | null; landBasis: boolean }) {
  const m = c.listing?.marketTime;
  const ask = c.listing?.price.amount ?? c.price;
  const valueLabel = landBasis ? 'adopted cleaned land value' : 'adopted cleaned FMV';
  const vsFmv = ask != null && adoptedFmv != null
    ? ask > adoptedFmv
      ? `Priced ${usd(ask - adoptedFmv)} ABOVE the ${valueLabel} of ${usd(adoptedFmv)}.`
      : ask < adoptedFmv
        ? `Priced ${usd(adoptedFmv - ask)} BELOW the ${valueLabel} of ${usd(adoptedFmv)}.`
        : `Priced at the ${valueLabel} of ${usd(adoptedFmv)}.`
    : `The ${landBasis ? 'adopted land value' : 'adopted FMV'} is unavailable, so this listing cannot be positioned against it.`;
  const acreCompare = c.acresDeltaFromSubject != null
    ? `${Math.abs(c.acresDeltaFromSubject)} acre${Math.abs(c.acresDeltaFromSubject) === 1 ? '' : 's'} ${c.acresDeltaFromSubject > 0 ? 'larger' : 'smaller'} than the subject.`
    : 'Acreage cannot be compared to the subject from the retained record.';
  const exposure = m?.cumulativeDays != null
    ? `Exposed to the market for ${m.cumulativeDays} cumulative day${m.cumulativeDays === 1 ? '' : 's'} across ${m.episodeCount} listing episode${m.episodeCount === 1 ? '' : 's'}.`
    : 'Cumulative market exposure is unavailable from the retained source.';
  const reductions = m?.priceReductions ?? [];
  const resistance = reductions.length > 0
    ? `${reductions.length} documented price reduction${reductions.length === 1 ? '' : 's'} totalling ${usd(reductions.reduce((s, r) => s + (r.drop ?? 0), 0))} — the asking price has already met buyer resistance.`
    : m?.cumulativeDays != null && m.cumulativeDays > 180
      ? 'No documented price reduction despite more than six months of exposure — the seller is holding a price the market has not met.'
      : 'No documented price reduction in the retained history.';
  return (
    <Section title="COMPETITION ANALYSIS">
      <p class="awv2-cvd-body">{c.classificationReason}</p>
      <p class="awv2-cvd-body">{vsFmv}</p>
      <p class="awv2-cvd-body">{acreCompare}</p>
      <p class="awv2-cvd-body">{exposure}</p>
      <p class="awv2-cvd-body">{resistance}</p>
      {landBasis && <p class="awv2-cvd-note">Land-basis comparison only. It is not a completed whole-property value or offer recommendation.</p>}
      {m?.freshnessLabel && <p class="awv2-cvd-body">{m.freshnessLabel}</p>}
      {c.listing?.description.landos.comparability.map((l) => (
        <p class="awv2-cvd-body" key={l.slice(0, 30)}>{l}</p>
      ))}
      <p class="awv2-cvd-note">
        An asking price never enters the cleaned sold-price calculations. It positions the subject against live
        competition and nothing more.
      </p>
    </Section>
  );
}

function Photos({ c }: { c: CvComp }) {
  const p = c.listing?.photos;
  return (
    <Section title="PHOTOS">
      {(p?.items.length ?? 0) > 1 ? (
        <CompPhotoCarousel
          photos={p?.items ?? []}
          address={nameOf(c)}
          sourcePage={p?.sourcePage ?? c.sourceUrl}
          provider={p?.provider ?? null}
          fallbackNote={p?.fallbackNote ?? null}
        />
      ) : (
        <AcquisitionWorkspaceV2CompPhotoGallery
          photos={p?.items ?? []}
          address={nameOf(c)}
          sourcePage={p?.sourcePage ?? c.sourceUrl}
          provider={p?.provider ?? null}
          fallbackNote={p?.fallbackNote ?? null}
        />
      )}
    </Section>
  );
}

export function CompFullDetails({ c, adoptedFmv, landBasis = false }: { c: CvComp; adoptedFmv: number | null; landBasis?: boolean }) {
  const identity = identity_of(c);
  const l = c.listing;
  const m = l?.marketTime;
  const isActive = c.transactionKind === 'active';
  const proxy = l?.price.confidence === 'estimated_proxy';

  return (
    <div class={`awv2-cvd kind-${identity}`}>
      {isActive ? (
        <Section title="CURRENT COMPETITION">
          <div class="awv2-cvd-grid">
            <Figure label="Current asking price" value={usd(l?.price.amount ?? c.price)} strong />
            <Figure label="Current asking price per acre" value={usd(l?.price.perAcre ?? c.pricePerAcre)} strong />
            <Figure label="Original listing date" value={m?.originalListingDateIso ?? 'not documented'} />
            <Figure label="Original list price" value={usd(m?.originalListPrice)} />
            <Figure
              label="LandOS cumulative active market days"
              value={m?.cumulativeDays != null ? `${m.cumulativeDays} days` : 'unavailable'}
              strong
              warn={m?.cumulativeDays != null && m.providerDaysOnMarket != null && m.cumulativeDays > m.providerDaysOnMarket}
            />
            <Figure label="Provider days on market" value={m?.providerDaysOnMarket != null ? `${m.providerDaysOnMarket} days` : 'not published'} />
            <Figure label="Current listing episode" value={m?.currentEpisodeDays != null ? `${m.currentEpisodeDays} days` : 'unavailable'} />
            <Figure label="Listing episodes" value={m?.episodeCount != null ? String(m.episodeCount) : '—'} />
            <Figure label="Price reductions" value={String(m?.priceReductions.length ?? 0)} />
            <Figure label="Listing freshness" value={m?.freshnessLabel ?? 'unknown'} />
          </div>
          {(m?.priceReductions.length ?? 0) > 0 && (
            <p class="awv2-cvd-body">
              <b>Price reductions:</b>{' '}
              {m!.priceReductions.map((r) => `${r.dateIso}: ${usd(r.from)} → ${usd(r.to)} (−${usd(r.drop)})`).join(' · ')}
            </p>
          )}
          {(l?.timeline ?? []).some((t) => t.kind === 'pending' || t.kind === 'back_on_market') && (
            <p class="awv2-cvd-body">
              <b>Pending / back-on-market history:</b>{' '}
              {(l!.timeline).filter((t) => t.kind === 'pending' || t.kind === 'back_on_market')
                .map((t) => `${t.dateIso} ${EVENT_LABEL[t.kind]}`).join(' · ')}
            </p>
          )}
          {m?.lines.map((line) => <p class="awv2-cvd-note" key={line.slice(0, 40)}>{line}</p>)}
        </Section>
      ) : (
        <Section title="SALE SUMMARY">
          {proxy && (
            <p class="awv2-cvd-proxy" role="note">
              {l!.price.lines.join(' ')}
            </p>
          )}
          <div class="awv2-cvd-grid">
            <Figure label={l?.price.amountLabel ?? 'Sold price'} value={usd(l?.price.amount ?? c.price)} strong warn={proxy} />
            <Figure label="Sold date" value={l?.soldDateIso ?? c.dateIso ?? 'not documented'} strong />
            <Figure label={l?.price.perAcreLabel ?? 'Sold price per acre'} value={usd(l?.price.perAcre ?? c.pricePerAcre)} strong warn={proxy} />
            <Figure label="Original listing date" value={m?.originalListingDateIso ?? 'not documented'} />
            <Figure label="Original list price" value={usd(m?.originalListPrice)} />
            <Figure
              label="LandOS cumulative days on market"
              value={m?.cumulativeDays != null ? `${m.cumulativeDays} days` : 'unavailable'}
              strong
            />
            <Figure label="Provider days on market" value={m?.providerDaysOnMarket != null ? `${m.providerDaysOnMarket} days` : 'not published'} />
            <Figure label="Listing episodes" value={m?.episodeCount != null ? String(m.episodeCount) : '—'} />
            <Figure label="Price reductions before sale" value={String(m?.priceReductions.length ?? 0)} />
          </div>
          {(m?.priceReductions.length ?? 0) > 0 && (
            <p class="awv2-cvd-body">
              <b>Price reductions before sale:</b>{' '}
              {m!.priceReductions.map((r) => `${r.dateIso}: ${usd(r.from)} → ${usd(r.to)} (−${usd(r.drop)})`).join(' · ')}
            </p>
          )}
          {m?.lines.map((line) => <p class="awv2-cvd-note" key={line.slice(0, 40)}>{line}</p>)}
          {l?.price.basis === 'verified_sale' && l.price.lines.map((line) => (
            <p class="awv2-cvd-note" key={line.slice(0, 40)}>{line}</p>
          ))}
        </Section>
      )}

      <Photos c={c} />
      <ListingDescription c={c} />
      <LandosNotes c={c} active={isActive} />
      <Timeline c={c} />
      {isActive ? <CompetitionAnalysis c={c} adoptedFmv={adoptedFmv} landBasis={landBasis} /> : <Comparability c={c} />}
      <Source c={c} />
    </div>
  );
}

/** Local identity key for the wrapper class; the full identity lives in CompRecordIdentity. */
function identity_of(c: CvComp): string {
  if (c.operatorExcluded) return 'excluded';
  if (c.transactionKind === 'active') return 'active';
  if (c.inValuationSet) return 'closed';
  if (c.transactionKind === 'closed') return 'zeroWeight';
  return 'context';
}
