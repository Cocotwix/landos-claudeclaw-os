// LandOS — the Property Story and the Market Story.
//
// Both panels render a reading that LandOS produced automatically the moment
// research settled, and both are built on one rule: the operator outcome leads,
// and every statement behind it keeps the source that made it.
//
// Two things this surface must never do, because both have already cost a
// wrong answer on a real deal:
//
//   • Label a record by its position. Each market slot is bound to its own
//     ROLE, so an unavailable subject band stays an unavailable subject band
//     and the county's fastest-selling band can never inherit its heading.
//   • Flatten the standings. A visual observation, an analytical hypothesis,
//     an official record and an outstanding verification read differently and
//     are shown differently, because "the aerial shows a cleared lane" is not
//     "the parcel has legal access".
//
// Rendering runs no model and starts no research: it displays what the read
// already produced.

import { countyLabel } from '@/lib/format';

import '../styles/workspace-v2-stories.css';

// ── View types (the fields this surface consumes) ──────────────────────────

export interface StoryClaimView {
  claimId?: string;
  label?: string;
  statement?: string;
  value?: string | null;
  standing?: string;
  weight?: string;
  asOf?: string | null;
  source?: { name?: string; url?: string | null; tier?: string; geography?: string | null; retrievedAt?: string | null; locator?: string | null };
}

export interface StoryConflictView {
  label?: string;
  statement?: string;
  resolution?: string;
  reason?: string;
  material?: boolean;
}

export interface PropertyStoryView {
  correlation?: string;
  retainedAt?: string | null;
  subject?: {
    apn?: string | null; address?: string | null; city?: string | null; county?: string | null;
    state?: string | null; acres?: number | null; acreageBasis?: string | null;
    interest?: { form?: string; statement?: string };
    verification?: { researchGrade?: boolean; officiallyVerified?: boolean; officialSource?: string | null; statement?: string };
  };
  relatedBoundaries?: Array<{ identifier?: string; relationship?: string; statement?: string }>;
  diligence?: Array<{
    key?: string; label?: string; status?: string; headline?: string;
    gap?: string | null; verificationNeeded?: string[]; claims?: StoryClaimView[];
  }>;
  visualReview?: Array<{
    capture?: string; capturedAt?: string | null; observation?: string | null;
    category?: string | null; signal?: string | null; model?: string | null;
  }>;
  separation?: { counts?: Record<string, number> };
  story?: {
    headline?: string; strengths?: string[]; risks?: string[]; opportunities?: string[];
    economicsDrivers?: Array<{ fact?: string; why?: string }>;
  };
  conflicts?: StoryConflictView[];
  guardrails?: Array<{ claimKind?: string; statement?: string; unlockedBy?: string }>;
  limitations?: string[];
  recordFacts?: StoryClaimView[];
}

export interface MarketRecordView {
  role?: string;
  available?: boolean;
  resolvedKey?: string | null;
  resolvedKeyLabel?: string | null;
  geographyLabel?: string | null;
  bandUsed?: string | null;
  matchLabel?: string;
  bandRequestedLabel?: string | null;
  bandUsedLabel?: string | null;
  bandFallback?: { from?: string | null; to?: string; why?: string } | null;
  period?: string | null;
  staleness?: string;
  sampleCount?: number | null;
  medianPricePerAcre?: number | null;
  pricePerAcreBasis?: string | null;
  daysOnMarket?: number | null;
  sellThroughRate?: number | null;
  absorptionRate?: number | null;
  monthsOfSupply?: number | null;
  populationGrowth?: number | null;
  limitations?: string[];
  note?: string;
}

export interface MarketStoryView {
  correlation?: string;
  retainedAt?: string | null;
  subjectGeography?: { county?: string | null; state?: string | null; zip?: string | null; acres?: number | null };
  subjectBand?: MarketRecordView;
  countyContext?: MarketRecordView;
  zipContext?: MarketRecordView | null;
  mostLiquidBand?: MarketRecordView | null;
  bandLadder?: MarketRecordView[];
  pulsePlan?: Array<{
    key?: string; label?: string; question?: string; geography?: string;
    status?: string; boundedActions?: number;
    sources?: Array<{ name?: string; url?: string | null; kind?: string; tier?: string; authorized?: boolean }>;
  }>;
  pulseClaims?: StoryClaimView[];
  pulseClaimsRefused?: Array<{ statement?: string; reason?: string }>;
  story?: { headline?: string; liquidityRead?: string; demandRead?: string; competitionRead?: string; limitations?: string[] };
  conflicts?: StoryConflictView[];
  limitations?: string[];
}

export interface ResearchStabilityView {
  stable?: boolean;
  reason?: string;
  signals?: { understandingOutcome?: string; establishedTopics?: number };
  sellerIntelligence?: string;
}

// ── Small shared pieces ────────────────────────────────────────────────────

const STANDING_LABEL: Record<string, string> = {
  official_legal_fact: 'Official / legal fact',
  record_fact: 'Record fact',
  visual_observation: 'Visual observation',
  analytical_hypothesis: 'Analytical hypothesis',
  verification_need: 'Verification needed',
};

const STATUS_TONE: Record<string, string> = {
  established: 'green',
  partial: 'yellow',
  unresolved: 'red',
};

const num = (value: number | null | undefined, suffix = ''): string =>
  value == null ? 'Unknown' : `${Math.round(value * 100) / 100}${suffix}`;

const usdPerAcre = (value: number | null | undefined): string =>
  value == null ? 'Unknown' : `$${Math.round(value).toLocaleString('en-US')}/ac`;

function ClaimLine({ claim }: { claim: StoryClaimView }) {
  const source = claim.source ?? {};
  return (
    <li class="awv2-story-claim" data-standing={claim.standing ?? 'record_fact'}>
      <span class="awv2-story-claim-standing">{STANDING_LABEL[claim.standing ?? ''] ?? claim.standing}</span>
      <span class="awv2-story-claim-text">{claim.statement}</span>
      <span class="awv2-story-claim-source">
        {source.url
          ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
          : source.name}
        {source.geography ? ` · ${source.geography}` : ''}
        {claim.asOf ?? source.retrievedAt ? ` · ${(claim.asOf ?? source.retrievedAt ?? '').slice(0, 10)}` : ''}
        {claim.weight ? ` · ${claim.weight.replace(/_/g, ' ')}` : ''}
      </span>
    </li>
  );
}

function ConflictList({ conflicts }: { conflicts: StoryConflictView[] }) {
  if (!conflicts.length) return null;
  return (
    <div class="awv2-story-conflicts" data-testid="story-conflicts">
      <small>Source conflicts, carried rather than resolved away</small>
      <ul>
        {conflicts.map((conflict) => (
          <li data-resolution={conflict.resolution ?? 'unresolved'}>
            <b>{conflict.resolution === 'resolved' ? 'Resolved' : 'Open'}</b> {conflict.statement}
            {conflict.reason && <span> {conflict.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shown in place of a story when research has not settled. Never a blank. */
function NotYet({ stability, what }: { stability: ResearchStabilityView | null | undefined; what: string }) {
  return (
    <div class="awv2-pi-note" data-testid={`${what}-not-yet`}>
      {stability?.reason ?? `No ${what} has been produced yet: research has not reached a stable state for this lead.`}
    </div>
  );
}

// ── Property Story ─────────────────────────────────────────────────────────

export function PropertyStoryPanel({ story, stability }: {
  story: PropertyStoryView | null | undefined;
  stability?: ResearchStabilityView | null;
}) {
  const read = story?.story;
  const subject = story?.subject;
  return (
    <section data-domain="property" class="awv2-panel awv2-story" id="property-story">
      <div class="awv2-panel-title">
        Property Story
        <span class="awv2-src-tag">
          Source-backed synthesis of retained evidence — produced automatically when research settled
        </span>
      </div>
      {!story || !read ? <NotYet stability={stability} what="Property Story" /> : (
        <>
          {story.correlation && story.correlation !== 'equivalent' && (
            <div class="awv2-story-stale" data-testid="property-story-correlation">
              This reading was formed about a different or uncorrelated parcel version and is shown as history, not as current truth.
            </div>
          )}
          <p class="awv2-story-headline" data-testid="property-story-headline">{read.headline}</p>

          <div class="awv2-story-subject" data-testid="property-story-subject">
            <span><b>Subject</b> {subject?.apn ?? 'APN not established'}</span>
            <span>{subject?.acres != null ? `${subject.acres} ac` : 'Acreage not established'}
              {subject?.acreageBasis ? ` · ${subject.acreageBasis}` : ''}</span>
            <span>{[subject?.city, countyLabel(subject?.county), subject?.state].filter(Boolean).join(', ')}</span>
            <span>{subject?.interest?.statement}</span>
            <span class="awv2-story-verification">{subject?.verification?.statement}</span>
          </div>

          {!!story.relatedBoundaries?.length && (
            <div class="awv2-story-boundaries" data-testid="property-story-boundaries">
              <small>Outside the transaction</small>
              <ul>
                {story.relatedBoundaries.map((boundary) => (
                  <li><b>{boundary.identifier}</b> — {boundary.statement}</li>
                ))}
              </ul>
            </div>
          )}

          <div class="awv2-story-columns">
            <div><small>Strengths</small><ul>{(read.strengths ?? []).map((entry) => <li>{entry}</li>)}</ul></div>
            <div><small>Risks</small><ul>{(read.risks ?? []).map((entry) => <li>{entry}</li>)}</ul></div>
            <div><small>Opportunities</small><ul>{(read.opportunities ?? []).map((entry) => <li>{entry}</li>)}</ul></div>
          </div>

          <div class="awv2-story-drivers" data-testid="property-story-drivers">
            <small>Most likely to move acquisition economics</small>
            <ul>
              {(read.economicsDrivers ?? []).map((driver) => (
                <li><b>{driver.fact}</b> <span>{driver.why}</span></li>
              ))}
            </ul>
          </div>

          <div class="awv2-story-diligence" data-testid="property-story-diligence">
            {(story.diligence ?? []).map((topic) => (
              <div class="awv2-story-topic" data-status={topic.status} data-tone={STATUS_TONE[topic.status ?? ''] ?? 'yellow'}>
                <b>{topic.label}</b>
                <span class="awv2-story-topic-status">{topic.status}</span>
                <span class="awv2-story-topic-headline">{topic.headline}</span>
                {topic.gap && <span class="awv2-story-topic-gap">Gap: {topic.gap}</span>}
                {!!topic.claims?.length && <ul class="awv2-story-claims">{topic.claims.map((claim) => <ClaimLine claim={claim} />)}</ul>}
                {!!topic.verificationNeeded?.length && (
                  <ul class="awv2-story-verify">{topic.verificationNeeded.map((entry) => <li>{entry}</li>)}</ul>
                )}
              </div>
            ))}
          </div>

          {!!story.visualReview?.length && (
            <div class="awv2-story-visuals" data-testid="property-story-visuals">
              <small>Visual and neighbourhood review — observation, never record fact</small>
              <ul>
                {story.visualReview.map((item) => (
                  <li>
                    <b>{item.capture}</b>
                    <span>{item.observation ?? 'Retained capture; no vision analysis was run on it.'}</span>
                    <span class="awv2-story-claim-source">
                      {item.model ? `${item.model}` : 'no vision model'}
                      {item.capturedAt ? ` · captured ${item.capturedAt.slice(0, 10)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ConflictList conflicts={story.conflicts ?? []} />

          {!!story.guardrails?.length && (
            <div class="awv2-story-guardrails" data-testid="property-story-guardrails">
              <small>Not claimed, and what would change that</small>
              <ul>
                {story.guardrails.map((guard) => (
                  <li><b>{guard.claimKind}</b> — {guard.statement} <span>Unlocked by: {guard.unlockedBy}</span></li>
                ))}
              </ul>
            </div>
          )}

          {!!story.limitations?.length && (
            <div class="awv2-story-limits"><small>Limitations</small>
              <ul>{story.limitations.map((entry) => <li>{entry}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Market Story ───────────────────────────────────────────────────────────

/** Two slots answered by the identical retained row. */
const sameRecord = (a: MarketRecordView | undefined, b: MarketRecordView | undefined): boolean =>
  !!a?.available && !!b?.available
  && a.resolvedKey === b.resolvedKey
  && a.bandUsed === b.bandUsed
  && a.period === b.period;

function MarketRecordCard({ heading, role, record }: { heading: string; role: string; record: MarketRecordView | null | undefined }) {
  return (
    <div class="awv2-story-market-card" data-role={role} data-available={record?.available ? 'yes' : 'no'}>
      <small>{heading}</small>
      {record?.available ? (
        <>
          <b>{record.bandUsedLabel ?? record.bandRequestedLabel ?? 'All acreage'}</b>
          <span class="awv2-story-market-where">
            {record.resolvedKeyLabel ?? record.matchLabel} · {record.period ?? 'period not stated'} · {record.staleness}
          </span>
          <dl class="awv2-story-metrics">
            <div><dt>Sample</dt><dd>{record.sampleCount == null ? 'Unknown' : `${record.sampleCount} sale(s)`}</dd></div>
            <div><dt>$ / acre</dt><dd>{usdPerAcre(record.medianPricePerAcre)}</dd></div>
            <div><dt>Median DOM</dt><dd>{num(record.daysOnMarket, ' days')}</dd></div>
            <div><dt>Sell-through</dt><dd>{num(record.sellThroughRate, '%')}</dd></div>
            <div><dt>Absorption</dt><dd>{num(record.absorptionRate, '%')}</dd></div>
            <div><dt>Months supply</dt><dd>{num(record.monthsOfSupply, ' mo')}</dd></div>
            <div><dt>Population growth</dt><dd>{num(record.populationGrowth, '%')}</dd></div>
          </dl>
          {record.pricePerAcreBasis && <span class="awv2-story-basis">{record.pricePerAcreBasis}</span>}
          {!!record.limitations?.length && (
            <ul class="awv2-story-market-limits">{record.limitations.map((entry) => <li>{entry}</li>)}</ul>
          )}
        </>
      ) : (
        <>
          <b class="awv2-dx-band-none">Not available</b>
          <span class="awv2-story-market-where">{record?.note ?? 'No retained market record answered for this slot.'}</span>
        </>
      )}
    </div>
  );
}

export function MarketStoryPanel({ story, stability }: {
  story: MarketStoryView | null | undefined;
  stability?: ResearchStabilityView | null;
}) {
  const read = story?.story;
  return (
    <section data-domain="market" class="awv2-panel awv2-story" id="market-story">
      <div class="awv2-panel-title">
        Market Story
        <span class="awv2-src-tag">
          Retained market database for the subject's own band, plus a bounded Market Pulse research plan
        </span>
      </div>
      {!story || !read ? <NotYet stability={stability} what="Market Story" /> : (
        <>
          {story.correlation && story.correlation !== 'equivalent' && (
            <div class="awv2-story-stale" data-testid="market-story-correlation">
              This reading was formed about a different or uncorrelated parcel version and is shown as history, not as current truth.
            </div>
          )}
          <p class="awv2-story-headline" data-testid="market-story-headline">{read.headline}</p>
          <div class="awv2-story-reads" data-testid="market-story-reads">
            <p><b>Liquidity.</b> {read.liquidityRead}</p>
            <p><b>Demand.</b> {read.demandRead}</p>
            <p><b>Competition.</b> {read.competitionRead}</p>
          </div>

          {/* Bound by ROLE. An unavailable subject band stays the subject band. */}
          <div class="awv2-story-market-grid" data-testid="market-story-records">
            <MarketRecordCard heading="Subject band" role="subject_band" record={story.subjectBand} />
            {/* The subject read frequently RESOLVES at county level, in which
                case the county card is the same record twice. Three identical
                cards read as a broken panel, so the duplicate is dropped and
                the subject card already names the geography that carried it. */}
            {!sameRecord(story.subjectBand, story.countyContext) && (
              <MarketRecordCard heading="County context" role="county_context" record={story.countyContext} />
            )}
            {story.zipContext && <MarketRecordCard heading="ZIP context" role="zip_context" record={story.zipContext} />}
            <MarketRecordCard heading="Most liquid band (not the subject's)" role="most_liquid_band" record={story.mostLiquidBand} />
          </div>

          <div class="awv2-story-pulse" data-testid="market-story-pulse">
            <small>Market Pulse research plan — bounded, authorized, not yet run unless marked answered</small>
            <ul>
              {(story.pulsePlan ?? []).map((question) => (
                <li data-status={question.status} data-key={question.key}>
                  <b>{question.label}</b>
                  <span class="awv2-story-pulse-status">{question.status}</span>
                  <span class="awv2-story-pulse-question">{question.question}</span>
                  <span class="awv2-story-claim-source">
                    {question.geography} · up to {question.boundedActions} evidence action(s) ·{' '}
                    {(question.sources ?? []).map((source) => `${source.name}${source.kind === 'fallback' ? ' (fallback)' : ''}`).join('; ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {!!story.pulseClaims?.length && (
            <div class="awv2-story-pulse-claims" data-testid="market-story-pulse-claims">
              <small>Market Pulse findings</small>
              <ul class="awv2-story-claims">{story.pulseClaims.map((claim) => <ClaimLine claim={claim} />)}</ul>
            </div>
          )}
          {!!story.pulseClaimsRefused?.length && (
            <div class="awv2-story-limits">
              <small>Refused pulse claims</small>
              <ul>{story.pulseClaimsRefused.map((entry) => <li>{entry.statement} — {entry.reason}</li>)}</ul>
            </div>
          )}

          <ConflictList conflicts={story.conflicts ?? []} />

          {!!story.limitations?.length && (
            <div class="awv2-story-limits"><small>Limitations</small>
              <ul>{story.limitations.map((entry) => <li>{entry}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
