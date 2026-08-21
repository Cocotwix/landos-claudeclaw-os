// LandOS specialist intelligence reads — the three persisted specialist
// products (PROPERTY / MARKET + AREA / SELLER), rendered compactly on the
// Overview so the operator can answer "what does Property think, what does
// Market think, what does Seller think?" without hunting through diagnostics.
//
// Everything here is FETCHED, persisted state: rendering never runs a model.
// These are the specialists' current opinions, not the raw reports — the deep
// evidence stays on Property & Market and the activity surfaces. Seller shows
// the honest pre-contact state until real communication exists, and every
// seller-reported statement stays visibly SELLER-REPORTED, never a canonical
// fact. Deal Brain remains the separate synthesizer above these three.

import { Landmark, TrendingUp, UserRound } from 'lucide-preact';

import '../styles/workspace-v2-specialist-reads.css';

// ── View types (fields these cards consume from the persisted products) ────

interface RuntimeView { agentProfile?: string; provider?: string; model?: string }

export interface PropertyIntelligenceReadView {
  score?: number | null;
  quality?: string | null;
  read?: string;
  strengths?: string[];
  constraints?: Array<{ title?: string; why?: string | null; severity?: string }>;
  potential?: string[];
  conflicts?: Array<{ subject?: string; statement?: string; resolution?: string }>;
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  nextActions?: Array<{ action?: string; why?: string | null }>;
  visualObservations?: Array<{ visual?: string; observation?: string; basis?: string | null }>;
  generatedAt?: string;
  runtime?: RuntimeView;
}

export interface MarketIntelligenceReadView {
  score?: number | null;
  quality?: string | null;
  read?: string;
  liquidityRead?: string | null;
  areaStory?: string | null;
  buyerPool?: string | null;
  bestSignals?: string[];
  risks?: string[];
  exitImplications?: string[];
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  subjectBand?: {
    band?: string | null; medianDaysOnMarket?: number | null; sellThroughRate?: number | null;
    monthsOfSupply?: number | null; medianPricePerAcre?: number | null;
  } | null;
  fastestBand?: string | null;
  generatedAt?: string;
  runtime?: RuntimeView;
}

export interface SellerIntelligenceReadView {
  state?: string;
  score?: number | null;
  read?: string;
  motivation?: string | null;
  priceExpectation?: string | null;
  timeline?: string | null;
  decisionMakers?: string | null;
  objections?: string[];
  negotiationPosture?: string | null;
  bestApproach?: string | null;
  sellerReportedFacts?: Array<{ statement?: string; attribution?: string }>;
  followUps?: string[];
  contradictions?: Array<{ subject?: string; earlier?: string | null; later?: string | null; interpretation?: string | null }>;
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  nextQuestion?: string | null;
  generatedAt?: string;
  runtime?: RuntimeView;
}

export interface SpecialistStaleView { property?: boolean; market?: boolean; seller?: boolean }

// ── Shared pieces ──────────────────────────────────────────────────────────

function ScoreChip({ score, quality }: { score: number | null | undefined; quality?: string | null }) {
  const tone = score == null ? 'pending' : score >= 65 ? 'strong' : score >= 50 ? 'moderate' : 'weak';
  return (
    <span class={`awv2-specialist-score s-${tone}`}>
      <b>{score ?? '—'}</b>
      <small>{score == null ? 'No score' : quality ?? '/100'}</small>
    </span>
  );
}

function ReadFooter({ generatedAt, runtime, stale }: { generatedAt?: string; runtime?: RuntimeView; stale?: boolean }) {
  const when = generatedAt ? new Date(generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <footer class="awv2-specialist-foot">
      {when && <span>Read {when}{runtime?.model ? ` · ${runtime.model}` : ''}</span>}
      {stale && <span class="stale" data-testid="specialist-stale">New evidence since this read — refresh from the Deal Read controls</span>}
    </footer>
  );
}

const lines = (items: Array<string | undefined> | undefined, limit: number): string[] =>
  (items ?? []).filter((item): item is string => !!item?.trim()).slice(0, limit);

// ── Property Intelligence ──────────────────────────────────────────────────

function PropertyReadCard({ product, stale }: { product: PropertyIntelligenceReadView | null; stale?: boolean }) {
  return (
    <article class="awv2-panel awv2-specialist" data-domain="property" data-testid="specialist-read-property">
      <header class="awv2-specialist-head">
        <div class="awv2-dom-eyebrow" data-dom="property"><Landmark size={13} /> Property Intelligence</div>
        {product && <ScoreChip score={product.score} quality={product.quality} />}
      </header>
      {!product ? (
        <p class="awv2-specialist-empty">No Property Intelligence read has been produced yet. Run the intelligence read from the Deal Read card.</p>
      ) : (
        <>
          {product.read && <p class="awv2-specialist-read">{product.read}</p>}
          {lines(product.strengths, 3).length > 0 && (
            <div class="awv2-specialist-list good"><b>Materially good</b>{lines(product.strengths, 3).map((item) => <span>+ {item}</span>)}</div>
          )}
          {(product.constraints ?? []).slice(0, 3).filter((item) => item.title).length > 0 && (
            <div class="awv2-specialist-list bad"><b>Constraints & risks</b>
              {(product.constraints ?? []).slice(0, 3).filter((item) => item.title).map((item) => (
                <span>− {item.title}{item.severity === 'high' ? ' (high)' : ''}</span>
              ))}
            </div>
          )}
          {(() => {
            // Grounded visual/record conflicts lead: a record claim the retained
            // imagery disputes is the finding the operator must not scroll past.
            const conflicts = (product.conflicts ?? []).filter((item) => item.subject || item.statement);
            const grounded = conflicts.filter((item) => /grounded visual/i.test(item.statement ?? ''));
            const rest = conflicts.filter((item) => !grounded.includes(item));
            const lead = [...grounded, ...rest].slice(0, 3);
            const remaining = [...grounded, ...rest].slice(3);
            if (!conflicts.length) return null;
            return (
              <div class="awv2-specialist-conflicts" data-testid="specialist-property-conflicts">
                <b>Conflicting evidence</b>
                {lead.map((item) => (
                  <p><i>{item.subject}</i> {item.statement}{item.resolution ? ` — ${item.resolution}` : ''}</p>
                ))}
                {remaining.length > 0 && (
                  <details class="awv2-specialist-details">
                    <summary>More conflicts ({remaining.length})</summary>
                    {remaining.map((item) => (
                      <p><i>{item.subject}</i> {item.statement}{item.resolution ? ` — ${item.resolution}` : ''}</p>
                    ))}
                  </details>
                )}
              </div>
            );
          })()}
          {(product.visualObservations ?? []).filter((item) => item.observation).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Grounded visual observations ({(product.visualObservations ?? []).filter((item) => item.observation).length})</summary>
              {(product.visualObservations ?? []).filter((item) => item.observation).slice(0, 6).map((item) => (
                <p>[{item.visual}] {item.observation}{item.basis ? <small> — {item.basis}</small> : null}</p>
              ))}
            </details>
          )}
          {(product.unknowns ?? []).filter((item) => item.question).length > 0 && (
            <div class="awv2-specialist-list"><b>Material unknowns</b>
              {(product.unknowns ?? []).filter((item) => item.question).slice(0, 3).map((item) => <span>? {item.question}</span>)}
            </div>
          )}
          {(product.nextActions ?? []).filter((item) => item.action).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Recommended verification</summary>
              {(product.nextActions ?? []).filter((item) => item.action).slice(0, 4).map((item) => (
                <p>{item.action}{item.why ? <small> — {item.why}</small> : null}</p>
              ))}
            </details>
          )}
        </>
      )}
      <ReadFooter generatedAt={product?.generatedAt} runtime={product?.runtime} stale={stale} />
    </article>
  );
}

// ── Market + Area Intelligence ─────────────────────────────────────────────

const perAcre = (value: number): string => `$${Math.round(value).toLocaleString('en-US')}/ac`;

function MarketReadCard({ product, stale }: { product: MarketIntelligenceReadView | null; stale?: boolean }) {
  const band = product?.subjectBand;
  return (
    <article class="awv2-panel awv2-specialist" data-domain="market" data-testid="specialist-read-market">
      <header class="awv2-specialist-head">
        <div class="awv2-dom-eyebrow" data-dom="market"><TrendingUp size={13} /> Market + Area Intelligence</div>
        {product && <ScoreChip score={product.score} quality={product.quality} />}
      </header>
      {!product ? (
        <p class="awv2-specialist-empty">No Market Intelligence read has been produced yet. Run the intelligence read from the Deal Read card.</p>
      ) : (
        <>
          {product.read && <p class="awv2-specialist-read">{product.read}</p>}
          {product.liquidityRead && <p class="awv2-specialist-line"><b>Liquidity</b> {product.liquidityRead}</p>}
          {band && (band.band || band.medianDaysOnMarket != null || band.medianPricePerAcre != null) && (
            <p class="awv2-specialist-line"><b>Subject band</b> {[
              band.band,
              band.medianDaysOnMarket != null ? `~${Math.round(band.medianDaysOnMarket)}d on market` : null,
              band.medianPricePerAcre != null ? perAcre(band.medianPricePerAcre) : null,
              band.monthsOfSupply != null ? `${band.monthsOfSupply} mo supply` : null,
            ].filter(Boolean).join(' · ')}{product.fastestBand ? ` · fastest band ${product.fastestBand}` : ''}</p>
          )}
          {product.buyerPool && <p class="awv2-specialist-line"><b>Buyer pool</b> {product.buyerPool}</p>}
          {product.areaStory && (
            <details class="awv2-specialist-details"><summary>Area story</summary><p>{product.areaStory}</p></details>
          )}
          {lines(product.bestSignals, 3).length > 0 && (
            <div class="awv2-specialist-list good"><b>Best signals</b>{lines(product.bestSignals, 3).map((item) => <span>+ {item}</span>)}</div>
          )}
          {lines(product.risks, 3).length > 0 && (
            <div class="awv2-specialist-list bad"><b>Risks & caveats</b>{lines(product.risks, 3).map((item) => <span>− {item}</span>)}</div>
          )}
          {lines(product.exitImplications, 3).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Exit implications</summary>
              {lines(product.exitImplications, 3).map((item) => <p>{item}</p>)}
            </details>
          )}
          {(product.unknowns ?? []).filter((item) => item.question).length > 0 && (
            <div class="awv2-specialist-list"><b>Unknowns</b>
              {(product.unknowns ?? []).filter((item) => item.question).slice(0, 3).map((item) => <span>? {item.question}</span>)}
            </div>
          )}
        </>
      )}
      <ReadFooter generatedAt={product?.generatedAt} runtime={product?.runtime} stale={stale} />
    </article>
  );
}

// ── Seller Intelligence ────────────────────────────────────────────────────

function SellerReadCard({ product, stale }: { product: SellerIntelligenceReadView | null; stale?: boolean }) {
  const established = product?.state === 'established';
  return (
    <article class="awv2-panel awv2-specialist" data-domain="action" data-testid="specialist-read-seller">
      <header class="awv2-specialist-head">
        <div class="awv2-dom-eyebrow" data-dom="action"><UserRound size={13} /> Seller Intelligence</div>
        {established && <ScoreChip score={product?.score} quality="Workability" />}
      </header>
      {!established ? (
        <p class="awv2-specialist-empty" data-testid="specialist-seller-precontact">
          Unknown · pre-contact. No seller communication has been recorded for this deal yet.
          Seller Intelligence reasons only over the real communication record — nothing is
          inferred from ownership records.
        </p>
      ) : (
        <>
          {product?.read && <p class="awv2-specialist-read">{product.read}</p>}
          {product?.motivation && <p class="awv2-specialist-line"><b>Motivation</b> {product.motivation}</p>}
          {product?.priceExpectation && <p class="awv2-specialist-line"><b>Price</b> {product.priceExpectation}</p>}
          {product?.timeline && <p class="awv2-specialist-line"><b>Timing</b> {product.timeline}</p>}
          {product?.decisionMakers && <p class="awv2-specialist-line"><b>Decision authority</b> {product.decisionMakers}</p>}
          {product?.negotiationPosture && <p class="awv2-specialist-line"><b>Posture</b> {product.negotiationPosture}</p>}
          {(product?.sellerReportedFacts ?? []).filter((item) => item.statement).length > 0 && (
            <div class="awv2-specialist-reported" data-testid="specialist-seller-reported">
              <b>Seller-reported <em>(attributed to the seller — not verified property facts)</em></b>
              {(product?.sellerReportedFacts ?? []).filter((item) => item.statement).slice(0, 4).map((item) => (
                <p><span class="tag">SELLER-REPORTED</span> “{item.statement}”{item.attribution ? <small> — {item.attribution}</small> : null}</p>
              ))}
            </div>
          )}
          {(product?.contradictions ?? []).filter((item) => item.subject).length > 0 && (
            <div class="awv2-specialist-conflicts" data-testid="specialist-seller-contradictions">
              <b>Contradictions over time</b>
              {(product?.contradictions ?? []).filter((item) => item.subject).slice(0, 3).map((item) => (
                <p><i>{item.subject}</i> {[item.earlier ? `Earlier: ${item.earlier}` : null, item.later ? `Later: ${item.later}` : null].filter(Boolean).join(' — ')}{item.interpretation ? ` (${item.interpretation})` : ''}</p>
              ))}
            </div>
          )}
          {(product?.unknowns ?? []).filter((item) => item.question).length > 0 && (
            <div class="awv2-specialist-list"><b>Still unknown</b>
              {(product?.unknowns ?? []).filter((item) => item.question).slice(0, 3).map((item) => <span>? {item.question}</span>)}
            </div>
          )}
          {product?.nextQuestion && <p class="awv2-specialist-next"><b>Ask next</b> {product.nextQuestion}</p>}
          {!!product?.followUps?.length && (
            <details class="awv2-specialist-details"><summary>Follow-ups</summary>{product.followUps.slice(0, 5).map((item) => <p>{item}</p>)}</details>
          )}
        </>
      )}
      <ReadFooter generatedAt={product?.generatedAt} runtime={product?.runtime} stale={stale} />
    </article>
  );
}

// ── The strip ──────────────────────────────────────────────────────────────

export function SpecialistReadsPanel({ property, market: marketProduct, seller, stale }: {
  property: PropertyIntelligenceReadView | null;
  market: MarketIntelligenceReadView | null;
  seller: SellerIntelligenceReadView | null;
  stale: SpecialistStaleView | null;
}) {
  return (
    <section class="awv2-specialist-reads" aria-label="Specialist intelligence reads" data-testid="specialist-reads">
      <PropertyReadCard product={property} stale={stale?.property === true && !!property} />
      <MarketReadCard product={marketProduct} stale={stale?.market === true && !!marketProduct} />
      <SellerReadCard product={seller} stale={stale?.seller === true && !!seller} />
    </section>
  );
}
