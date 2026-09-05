// LandOS Napkin Underwriting surface — the top of Strategy & Underwriting.
//
// Renders the deterministic ACQUISITION NAPKIN (supported FMV, the 40/60%
// screening band, seller ask, current quick-flip MAO) and the STRATEGY
// NAPKINS comparison beneath it. Rendering runs nothing: no model call, no
// research call — every number is computed client-side from already-persisted
// canonical products.

import { PencilRuler } from 'lucide-preact';

import type { CompsValuationViewData } from './AcquisitionWorkspaceV2CompsValuation';
import type { OverviewStrategyView } from './AcquisitionWorkspaceV2Overview';
import {
  buildAcquisitionNapkin, buildStrategyNapkins,
  NAPKIN_KIND_LABEL,
  type DealBrainStrategyFit, type NapkinRange, type NapkinValue,
} from '../lib/napkin-underwriting';

import '../styles/workspace-v2-napkin.css';

const usd = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;
const usdCompact = (v: number): string => {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
};

function rangeText(r: NapkinRange | null, fmt: (v: number) => string): string {
  if (!r) return 'UNKNOWN';
  const parts = [r.low, r.base, r.high].filter((v): v is number => v != null);
  const uniq = [...new Set(parts.map(fmt))];
  return uniq.length > 1 ? uniq.join(' / ') : fmt(r.base);
}

function KindTag({ kind }: { kind: NapkinValue['kind'] }) {
  return <em class={`awv2-nk-kind k-${kind}`}>{NAPKIN_KIND_LABEL[kind]}</em>;
}

export function NapkinUnderwriting({ compsValuation, quickFlipScreen, askingPrice, strategies, dealBrainStrategies, bestCurrentStrategy, openCompsValuation }: {
  compsValuation: CompsValuationViewData | null;
  /** The persisted quick-flip screen (intelligence stack product). Its
   *  economics.cashMao is the CANONICAL current supported acquisition
   *  ceiling — the same structured value Deal Brain consumes. */
  quickFlipScreen: { economics?: { cashMao?: number | null; bindingConstraint?: string } | null } | null;
  askingPrice: number | null;
  strategies: OverviewStrategyView[] | null | undefined;
  /** Persisted Deal Brain strategy assessments (current snapshot). Projected
   *  deterministically into strategy napkins; rendering runs nothing. */
  dealBrainStrategies?: DealBrainStrategyFit[] | null;
  bestCurrentStrategy?: { strategy?: string; why?: string | null } | null;
  openCompsValuation: () => void;
}) {
  const summary = compsValuation?.summary ?? null;
  const quickFlip = compsValuation?.quickFlip ?? null;
  const negotiation = compsValuation?.negotiation ?? null;
  const screenEconomics = quickFlipScreen?.economics ?? null;
  const napkin = buildAcquisitionNapkin(summary, quickFlip, askingPrice, negotiation, screenEconomics);
  const scenarios = buildStrategyNapkins({ summary, quickFlip, negotiation, screenEconomics, strategies, dealBrainStrategies, bestCurrentStrategy });

  return (
    <section class="awv2-panel awv2-napkin" data-domain="strategy" aria-label="Napkin underwriting" data-testid="napkin-underwriting">
      <div class="section-heading">
        <div>
          <span class="awv2-dom-eyebrow" data-dom="strategy"><PencilRuler size={13} aria-hidden="true" /> Napkin Underwriting</span>
          <h2>Acquisition Napkin</h2>
        </div>
      </div>
      <p class="awv2-nk-disclaimer">
        Early feasibility economics. Assumptions are directional and are not final acquisition underwriting.
      </p>

      {!napkin ? (
        <p class="awv2-nk-empty" data-testid="napkin-acquisition-empty">
          No supported FMV is established yet, so the acquisition screen cannot be calculated.
          The napkin consumes the canonical valuation — establish it on Comps &amp; Valuation.
        </p>
      ) : (
        <div class="awv2-nk-acq" data-testid="napkin-acquisition">
          <div class="awv2-nk-fmv">
            <i>Supported FMV</i>
            <b data-testid="napkin-fmv">{usd(napkin.supportedFmv)}</b>
            <span>{napkin.fmvStatusLabel} · {napkin.fmvBasisLabel}</span>
            <button type="button" class="awv2-nk-link" onClick={openCompsValuation}>Valuation evidence →</button>
          </div>
          {/* The standard operating benchmarks are 40% and 60% of the current
              Combined LandOS FMV. A 50% band is deliberately NOT shown: it read
              as a third recommended number beside them and had no operating
              meaning. Strategy-specific maximum purchase basis and seller ask
              stay separate, below. */}
          <div class="awv2-nk-band" data-testid="napkin-band">
            <div><i>40% of FMV</i><b data-testid="napkin-band-40">{usd(napkin.band.pct40)}</b></div>
            <div><i>60% of FMV</i><b data-testid="napkin-band-60">{usd(napkin.band.pct60)}</b></div>
          </div>
          <div class="awv2-nk-facts">
            <div><i>Seller ask</i><b data-testid="napkin-seller-ask">{napkin.sellerAsk != null ? usd(napkin.sellerAsk) : 'UNKNOWN'}</b>
              {napkin.askPctOfFmv != null && <span>{Math.round(napkin.askPctOfFmv)}% of FMV · spread to FMV {usdCompact(napkin.askSpreadToFmv!)}</span>}
            </div>
            <div><i>Current supported acquisition ceiling (cash MAO)</i><b data-testid="napkin-current-basis">{napkin.currentCeiling != null ? usd(napkin.currentCeiling) : 'Not established'}</b>
              {napkin.currentCeilingSource && <span>{napkin.currentCeilingSource}</span>}
            </div>
          </div>
          {napkin.technicalCeiling != null && (
            <p class="awv2-nk-technote" data-testid="napkin-technical-ceiling">
              <b>Technical negotiation ceiling: {usd(napkin.technicalCeiling)}</b> — {napkin.technicalCeilingNote}
            </p>
          )}
          <p class="awv2-nk-bandnote" data-testid="napkin-band-note">
            The 40–60% band is the normal early acquisition screen — FMV is not profit, so the discount carries required
            profit, transaction and selling costs, holding time, capital exposure, diligence uncertainty and execution risk.
            It is a screening reference, not an automatic offer and not a rigid buy rule; where a specific deal belongs
            inside or outside it is a separate judgment.
          </p>
        </div>
      )}

      <div class="section-heading awv2-nk-strathead"><div><h2>Strategy Napkins</h2></div></div>
      {scenarios.length === 0 ? (
        <p class="awv2-nk-empty">No strategy has enough current evidence to sketch a napkin scenario yet.</p>
      ) : (
        <>
          <div class="awv2-nk-tablewrap">
            <table class="awv2-nk-table" data-testid="napkin-strategy-table">
              <thead>
                <tr>
                  <th>Strategy</th><th>Purchase basis</th><th>Napkin revenue</th><th>Napkin profit</th>
                  <th>Napkin ROI</th><th>Rough time</th><th>Confidence</th><th>Biggest unknown</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.id} data-testid={`napkin-row-${s.id}`}>
                    <td><b>{s.label}</b>{s.napkinSketch && <em class="awv2-nk-sketch">NAPKIN SKETCH / HYPOTHESIS</em>}</td>
                    <td>{s.purchaseBasis.value != null ? usdCompact(s.purchaseBasis.value) : 'UNKNOWN'}</td>
                    <td>{rangeText(s.roughGrossRevenue, usdCompact)}</td>
                    <td>{s.economics === 'complete' ? rangeText(s.roughNetProfit, usdCompact) : 'INCOMPLETE'}</td>
                    <td>{s.economics === 'complete' && s.roughRoiPct ? rangeText(s.roughRoiPct, (v) => `${Math.round(v)}%`) : '—'}</td>
                    <td>{s.roughHoldPeriod ?? 'UNKNOWN'}</td>
                    <td class={`awv2-nk-conf c-${s.confidence}`}>{s.confidence}</td>
                    <td>{s.controllingUnknowns[0] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scenarios.map((s) => (
            <details key={s.id} class="awv2-nk-detail" data-testid={`napkin-detail-${s.id}`}>
              <summary>{s.label}{s.napkinSketch ? ' — napkin sketch / hypothesis' : ''}</summary>
              <p class="awv2-nk-concept">{s.conceptSummary}</p>
              <dl class="awv2-nk-lines">
                <div><dt>Purchase basis</dt><dd>{s.purchaseBasis.value != null ? usd(s.purchaseBasis.value) : 'UNKNOWN'} <KindTag kind={s.purchaseBasis.kind} /> <small>{s.purchaseBasis.source}</small></dd></div>
                <div><dt>Rough revenue</dt><dd>{s.roughGrossRevenue ? <>{rangeText(s.roughGrossRevenue, usd)} <KindTag kind={s.roughGrossRevenue.kind} /> <small>{s.roughGrossRevenue.source}</small></> : 'UNKNOWN'}</dd></div>
                <div><dt>Major costs</dt><dd>{s.roughMajorCosts ? <>{rangeText(s.roughMajorCosts, usd)} <KindTag kind={s.roughMajorCosts.kind} /></> : <>UNKNOWN — <b>not included</b> (never assumed $0)</>}</dd></div>
                <div><dt>Hold / selling allowance</dt><dd>{s.roughHoldSellingAllowance?.value != null ? <>{usd(s.roughHoldSellingAllowance.value)} <KindTag kind={s.roughHoldSellingAllowance.kind} /> <small>{s.roughHoldSellingAllowance.source}</small></> : 'UNKNOWN — not included'}</dd></div>
                <div><dt>Total investment</dt><dd>{s.roughTotalInvestment ? rangeText(s.roughTotalInvestment, usd) : 'INCOMPLETE'}</dd></div>
                <div><dt>Rough profit / ROI</dt><dd>{s.economics === 'complete' ? <>{rangeText(s.roughNetProfit, usd)} · {s.roughRoiPct ? rangeText(s.roughRoiPct, (v) => `${Math.round(v)}%`) : '—'}</> : <b>{s.incompleteReason}</b>}</dd></div>
                <div><dt>Time</dt><dd>{s.roughHoldPeriod ?? 'UNKNOWN'}</dd></div>
              </dl>
              {s.keyAssumptions.length > 0 && <div class="awv2-nk-list"><i>Key assumptions</i><ul>{s.keyAssumptions.map((a) => <li key={a}><em class="awv2-nk-kind k-assumption">ASSUMPTION</em> {a}</li>)}</ul></div>}
              {s.controllingUnknowns.length > 0 && <div class="awv2-nk-list"><i>Controlling unknowns</i><ul>{s.controllingUnknowns.map((u) => <li key={u}><em class="awv2-nk-kind k-unknown">UNKNOWN</em> {u}</li>)}</ul></div>}
              {s.killConditions.length > 0 && <div class="awv2-nk-list"><i>Kill conditions</i><ul>{s.killConditions.map((k) => <li key={k}>{k}</li>)}</ul></div>}
              {s.provenance.length > 0 && <p class="awv2-nk-prov">{s.provenance.join(' · ')}</p>}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
