// Executive Orchestrator — Deal Card coherence audit.
//
// The Deal Card is not "done" when each department has merely run; it is done
// when every tab tells the SAME story: one acreage, one valuation, one comp
// state, one strategy narrative, imagery that belongs to this card, and no
// developer language anywhere the operator reads. This audit is the gate the
// report/run route enforces — a failing repairable check triggers one bounded
// automatic re-run before the card is presented.
//
// Pure + deterministic. Loose input shapes so it is testable without building a
// full report view.

export type AuditCheckId =
  | 'single_acreage'
  | 'single_valuation'
  | 'comp_consistency'
  | 'imagery_association'
  | 'strategy_single_story'
  | 'market_geography'
  | 'operator_language'
  | 'one_comp_pricing_gate'
  | 'comp_counts_validated'
  | 'wetlands_consistency'
  | 'fema_consistency'
  | 'acreage_conflict_preserved'
  | 'strategy_five_approved'
  | 'pricing_gate_agreement'
  | 'documents_visible'
  | 'land_score_current'
  | 'blocked_offer_agreement'
  | 'displayed_acreage_alignment'
  | 'geography_format'
  | 'exec_pricing_gate'
  | 'strategy_card_agreement'
  | 'red_flags_completeness'
  | 'valuation_registry_count'
  | 'market_summary_currency'
  | 'offer_readiness_gate'
  | 'unified_readiness_agreement'
  | 'readiness_states_reconcile';

export interface AuditCheck {
  id: AuditCheckId;
  label: string;
  pass: boolean;
  detail: string;
  /** True when a bounded automatic re-run can plausibly repair this. */
  repairable: boolean;
}

export interface DealCardAudit {
  passed: boolean;
  failedCount: number;
  checks: AuditCheck[];
  /** One operator-facing line ("Executive review: 7/7 consistency checks passed."). */
  summaryLine: string;
  generatedAt: string;
}

// Developer wording that must never reach an operator-facing narrative.
const DEV_LANGUAGE = /source field not returned|missing api field|provider field absent|\bTODO\b|\bFIXME\b|\blorem ipsum\b|\bundefined\b|\bNaN\b|\[object Object\]/i;

// Unsafe business language that must never reach an operator-facing narrative:
// one-observation market claims, unverified access/utility claims, and false
// all-clear statements.
const UNSAFE_LANGUAGE = /land is generally going for|verified land is trading around|no blocking items|ready for use\b|excellent paved road access|clean access and soils|existing utility infrastructure|mapped public-road frontage|mapped frontage(?:\s+(?:on|along|at)|\s*[:=-])|usable acreage\s*[:=-]?\s*~?\d/i;

export interface AuditInputs {
  /** Loose report view (only the fields the audit reads). */
  report: {
    exists?: boolean;
    parcelVerified?: boolean;
    reconciliation?: {
      acreage?: { primary?: string | null; conflict?: boolean; conflictNote?: string | null } | null;
      conflicts?: string[] | null;
    } | null;
    valuation?: {
      primary?: { value?: number | null; label?: string; kind?: string } | null;
      conflict?: boolean;
      conflictNote?: string | null;
      valueRange?: { low?: number | null; high?: number | null } | null;
    } | null;
    compState?: { soldCount?: number; activeCount?: number; anyRetrieved?: boolean; summaryLine?: string; strategyLine?: string } | null;
    marketComps?: { soldCount?: number; activeCount?: number; query?: { county?: string; state?: string } | null } | null;
    ddFactChecklist?: Array<{ key: string; value?: string | null }> | null;
    ddSummary?: string;
    marketSummary?: string;
    strategySummary?: string;
    mostViableStrategy?: string;
    visualContext?: { assets?: Array<{ status?: string; imageUrl?: string | null }> | null } | null;
    landportalInspection?: { parcelUrl?: string | null; assets?: Array<{ url?: string; kind?: string }> | null } | null;
  };
  /** Visual-capture services that PASS the parcel-association eligibility model
   *  for the subject card (from loadEligibleCardVisualCapture). When provided,
   *  every rendered Google visual must be in this set — a card-scoped filename
   *  or matching card id alone is NOT association proof. */
  eligibleVisualServices?: string[] | null;
  /** Executive summary (strategy story + pricing-gate cross-checks). */
  executiveSummary?: {
    strongestStrategy?: { strategy?: string } | null;
    strategyRanking?: Array<{ strategy: string; viability?: string }> | null;
    headline?: string;
    preliminaryAcquisitionRange?: { available?: boolean } | null;
  } | null;
  /** Strategy tab / seller-brief pursuit read. Must not promote a different primary. */
  pursuit?: {
    recommended?: { strategy?: string } | null;
    runnerUps?: Array<{ strategy?: string }> | null;
    attractiveAcquisition?: { low?: number | null; high?: number | null; estMarketValue?: number | null } | null;
    remainingVerification?: string[];
  } | null;
  /** Subject property card id — imagery must belong to THIS card. */
  subjectCardId?: number | null;
  /** Subject geography for the market-consistency check. */
  subject?: { county?: string | null; state?: string | null } | null;
  /** Unique comparable registry counts — the ONLY comp counts that may be shown. */
  compRegistry?: {
    counts?: { validatedSold?: number; validatedActive?: number; rawCandidates?: number; rejected?: number } | null;
    valuationReady?: boolean;
  } | null;
  /** Shared strategy-readiness record (five approved strategies + pricing gate). */
  strategyReadiness?: {
    strategies?: Array<{ strategy: string; status?: string }> | null;
    pricingAllowed?: boolean;
  } | null;
  /** Reconciled operator record (physical screen truth + displayed identity). */
  operatorRecord?: {
    identity?: { acreageConflict?: boolean; assessedAcres?: number | null; mappedAcres?: number | null } | null;
    description?: string | null;
    decisionCards?: Array<{ key: string; verdict?: string; headline?: string }> | null;
    offerReadiness?: { state?: string } | null;
    valueReadiness?: { state?: string } | null;
    pricingGate?: { pricingAllowed?: boolean } | null;
    researchCompleteness?: { complete?: boolean; missing?: string[] } | null;
    landScore?: { available?: boolean; verdict?: string | null; unavailableReason?: string | null } | null;
  } | null;
  /** The shared unified readiness record — every visible readiness state must
   *  reconcile with it; the audit fails on any disagreement. */
  unifiedReadiness?: {
    value?: { state?: string; why?: string } | null;
    offer?: { state?: string; why?: string } | null;
    contract?: { state?: string } | null;
    valuationContext?: { state?: string } | null;
    strategyScoreability?: { state?: string } | null;
    strategyActionability?: { state?: string } | null;
    allStrategiesBlocked?: boolean;
    consistencyIssues?: string[] | null;
  } | null;
  /** The legacy per-report offer label — must never outrank the shared record. */
  reportOfferReadiness?: string | null;
  /** Document registry summary (deed pages must be viewable when claimed). */
  documentRegistry?: { documentCount?: number; pageCount?: number } | null;
  /** True when deed research evidence claims a retrieved recorded document. */
  deedRetrieved?: boolean;
  nowIso?: string;
}

const APPROVED_STRATEGY_NAMES = ['quick flip', 'novation or double close', 'subdivide or minor split', 'land home package', 'improvement then flip'];

function parseAcres(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = String(v).match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function normStrategy(s: string | null | undefined): string {
  const n = norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bquick\b.*\bflip\b/.test(n)) return 'quick flip';
  if (/\bsubdivide\b/.test(n)) return 'subdivide';
  if (/\bland\b.*\bhome\b/.test(n)) return 'land home package';
  if (/\bdouble\b.*\bclose\b|\bnovation\b/.test(n)) return 'double close novation';
  if (/\bimprovement\b|\bvalue\b.*\badd\b/.test(n)) return 'improvement value add';
  if (/\bhold\b/.test(n)) return 'hold';
  if (/\bpass\b|\bno offer\b/.test(n)) return 'pass';
  return n;
}

/** Image URLs are card-scoped (`/property-cards/<id>/…` or `card=<id>` /
 *  `cardId=<id>`); an asset pointing at a DIFFERENT card id is a cross-parcel
 *  imagery leak. URLs with no card marker pass (absolute provider URLs etc.). */
function imageCardMismatch(url: string, subjectCardId: number): boolean {
  const m = url.match(/property-cards\/(\d+)\//) ?? url.match(/[?&]card(?:Id)?=(\d+)/);
  if (!m) return false;
  return Number(m[1]) !== subjectCardId;
}

export function auditDealCardCoherence(inputs: AuditInputs): DealCardAudit {
  const r = inputs.report ?? {};
  const checks: AuditCheck[] = [];
  const generatedAt = inputs.nowIso ?? new Date().toISOString();

  // 1. Single acreage — the reconciled primary governs; the DD checklist must not
  //    quote a materially different number.
  {
    const recAcres = parseAcres(r.reconciliation?.acreage?.primary ?? null);
    const ddAcres = parseAcres((r.ddFactChecklist ?? []).find((f) => f.key === 'acres')?.value ?? null);
    let pass = true;
    let detail = 'One reconciled acreage governs the card.';
    if (recAcres != null && ddAcres != null) {
      const diff = Math.abs(recAcres - ddAcres);
      if (diff > 0.1 || diff / Math.max(recAcres, ddAcres) > 0.02) {
        pass = false;
        detail = `The card shows two acreages: reconciled ${recAcres} ac vs DD checklist ${ddAcres} ac.`;
      }
    } else if (recAcres == null && ddAcres == null && r.exists) {
      detail = 'No acreage established yet (honest unknown, not a contradiction).';
    }
    // An unresolved reconciliation conflict without an explanation is a failure —
    // conflicts must be explained, never silent.
    if (r.reconciliation?.acreage?.conflict && !r.reconciliation.acreage.conflictNote) {
      pass = false;
      detail = 'Acreage sources conflict with no explanation shown.';
    }
    checks.push({ id: 'single_acreage', label: 'Single acreage', pass, detail, repairable: true });
  }

  // 2. Single valuation — one primary basis; a conflict must carry its note.
  {
    const v = r.valuation;
    let pass = true;
    let detail = v?.primary?.value != null ? `One primary valuation (${v.primary.label ?? 'basis'}).` : 'No valuation yet (honest unknown).';
    if (v?.conflict && !v.conflictNote) {
      pass = false;
      detail = 'Valuation conflict flagged with no explanation.';
    }
    checks.push({ id: 'single_valuation', label: 'Single valuation', pass, detail, repairable: true });
  }

  // 3. Comp consistency — the comp state cannot contradict its own counts, and
  //    the strategy line cannot claim comps are missing when a source retrieved
  //    them. When a unique-comp registry drives the compState, the registry
  //    comparison (check 9) is authoritative and the legacy lane count is
  //    expected to differ (it predates dedup/validation).
  {
    const cs = r.compState;
    const mcSold = r.marketComps?.soldCount ?? 0;
    const registryDriven = inputs.compRegistry?.counts != null;
    const mcActive = r.marketComps?.activeCount ?? 0;
    let pass = true;
    let detail = 'Comp status agrees across tabs.';
    if (cs) {
      if (!registryDriven && (cs.soldCount ?? 0) !== mcSold) {
        pass = false;
        detail = `Comp state says ${cs.soldCount} sold but market comps hold ${mcSold}.`;
      } else if (cs.anyRetrieved && /no comps retrieved/i.test(cs.strategyLine ?? '')) {
        pass = false;
        detail = 'Strategy line claims no comps while a source retrieved them.';
      } else if (!registryDriven && cs.activeCount != null && cs.activeCount !== mcActive) {
        pass = false;
        detail = `Comp state says ${cs.activeCount} active but market comps hold ${mcActive}.`;
      }
    }
    checks.push({ id: 'comp_consistency', label: 'Comp consistency', pass, detail, repairable: true });
  }

  // 4. Imagery association — SUBJECT association, not just card-scoped URLs.
  //    Every rendered visual must (a) reference THIS card, and (b) carry parcel-
  //    association proof: Google visuals must be in the eligibility-passing set;
  //    LandPortal screenshots must come from a recorded APN parcel page. A
  //    correct filename / matching card id alone never qualifies.
  {
    let pass = true;
    let detail = 'Every rendered visual carries parcel-association proof.';
    const subjectId = inputs.subjectCardId ?? null;
    const eligibleSet = inputs.eligibleVisualServices != null ? new Set(inputs.eligibleVisualServices) : null;
    const parseRef = (url: string): { cardId: number; service: string } | null => {
      const m = url.match(/cardId=(\d+)&service=([A-Za-z0-9_%-]+)/);
      return m ? { cardId: Number(m[1]), service: decodeURIComponent(m[2]) } : null;
    };
    const fail = (why: string) => { pass = false; detail = why; };

    // Cross-card leak check (any image URL referencing another card).
    if (pass && subjectId != null) {
      const urls = [
        ...((r.visualContext?.assets ?? []).map((a) => a.imageUrl ?? '')),
        ...((r.landportalInspection?.assets ?? []).map((a) => a.url ?? '')),
      ].filter(Boolean) as string[];
      const bad = urls.find((u) => imageCardMismatch(u, subjectId));
      if (bad) fail(`An image references a different property card (${bad.slice(0, 80)}…).`);
    }

    // Rendered Google visuals must be association-proven (eligible set).
    if (pass) {
      for (const a of r.visualContext?.assets ?? []) {
        if (a.status !== 'captured') continue;
        const ref = parseRef(a.imageUrl ?? '');
        if (!ref) { fail('Displayed imagery could not be verified as belonging to the subject parcel (no recorded source reference).'); break; }
        if (eligibleSet && !eligibleSet.has(ref.service)) {
          fail('Displayed imagery could not be verified as belonging to the subject parcel.');
          break;
        }
      }
    }
    if (pass) {
      for (const a of r.landportalInspection?.assets ?? []) {
        if (a.kind !== 'google') continue;
        const ref = parseRef(a.url ?? '');
        if (!ref || (eligibleSet && !eligibleSet.has(ref.service))) {
          fail('Displayed imagery could not be verified as belonging to the subject parcel.');
          break;
        }
      }
    }
    // LandPortal parcel screenshots require the APN parcel page they came from.
    if (pass) {
      const lpShots = (r.landportalInspection?.assets ?? []).filter((a) => a.kind !== 'google');
      if (lpShots.length > 0 && !(r.landportalInspection?.parcelUrl ?? '').trim()) {
        fail('LandPortal screenshots lack a recorded APN parcel page — parcel association unproven.');
      }
    }
    checks.push({ id: 'imagery_association', label: 'Imagery belongs to this parcel', pass, detail, repairable: true });
  }

  // 5. Strategy single story — the strongest strategy must exist in the ranking,
  //    and the report's most-viable must not name a different strategy.
  {
    const es = inputs.executiveSummary;
    let pass = true;
    let detail = 'One strategy story across the card.';
    const strongest = normStrategy(es?.strongestStrategy?.strategy);
    const topRanked = normStrategy(es?.strategyRanking?.[0]?.strategy);
    // A blocked executive conclusion is valid when every approved strategy is
    // explicitly not viable. It is not a hidden sixth strategy.
    const allStrategiesBlocked = (es?.strategyRanking?.length ?? 0) > 0
      && (es?.strategyRanking ?? []).every((strategy) => strategy.viability === 'not_viable');
    const safeBlockedConclusion = strongest === 'no acquisition strategy is ready' && allStrategiesBlocked;
    if (!safeBlockedConclusion && strongest && (es?.strategyRanking?.length ?? 0) > 0) {
      const inRanking = (es!.strategyRanking ?? []).some((s) => normStrategy(s.strategy) === strongest);
      if (!inRanking) {
        pass = false;
        detail = `Strongest strategy "${es!.strongestStrategy!.strategy}" is not in the ranking shown to the operator.`;
      }
    }
    if (pass && !safeBlockedConclusion && strongest && topRanked && topRanked !== strongest) {
      pass = false;
      detail = `Executive summary says "${es?.strongestStrategy?.strategy}" but the ranking promotes "${es?.strategyRanking?.[0]?.strategy}".`;
    }
    const mostViable = normStrategy(r.mostViableStrategy);
    if (pass && !safeBlockedConclusion && strongest && mostViable && mostViable !== strongest) {
      pass = false;
      detail = `Report says most-viable "${r.mostViableStrategy}" but the executive summary says "${es?.strongestStrategy?.strategy}".`;
    }
    const pursuitPrimary = normStrategy(inputs.pursuit?.recommended?.strategy);
    if (pass && !safeBlockedConclusion && strongest && pursuitPrimary && pursuitPrimary !== strongest) {
      pass = false;
      detail = `Strategy tab says "${inputs.pursuit?.recommended?.strategy}" but the executive summary says "${es?.strongestStrategy?.strategy}".`;
    }
    checks.push({ id: 'strategy_single_story', label: 'Single strategy story', pass, detail, repairable: true });
  }

  // 6. Market geography — comps must be for the subject's county/state.
  {
    let pass = true;
    let detail = 'Market data matches the subject geography.';
    const subjState = norm(inputs.subject?.state);
    const qState = norm(r.marketComps?.query?.state);
    if (subjState && qState && subjState !== qState) {
      pass = false;
      detail = `Comps were queried for ${r.marketComps?.query?.state} but the subject is in ${inputs.subject?.state}.`;
    }
    checks.push({ id: 'market_geography', label: 'Market geography', pass, detail, repairable: true });
  }

  // 7. Operator language — no developer or unsafe business wording in narratives.
  {
    const texts = [r.ddSummary, r.marketSummary, r.strategySummary, r.compState?.summaryLine, r.compState?.strategyLine, ...(inputs.pursuit?.remainingVerification ?? [])].filter(Boolean) as string[];
    const bad = texts.find((t) => DEV_LANGUAGE.test(t)) ?? texts.find((t) => UNSAFE_LANGUAGE.test(t));
    checks.push({
      id: 'operator_language',
      label: 'Operator language',
      pass: !bad,
      detail: bad ? `Unsafe or developer wording reached an operator narrative: "${bad.slice(0, 80)}…"` : 'No developer or unsafe wording in operator narratives.',
      repairable: false,
    });
  }

  // 8. One-comp pricing gate — no attractive band, value range, or offer number
  //    may exist while fewer than 3 validated unique sold comps exist.
  {
    const validatedSold = inputs.compRegistry?.counts?.validatedSold;
    let pass = true;
    let detail = 'Pricing outputs respect the validated-comp gate.';
    if (validatedSold != null && validatedSold < 3) {
      const attractive = inputs.pursuit?.attractiveAcquisition;
      if (attractive && (attractive.low != null || attractive.high != null)) {
        pass = false;
        detail = `An acquisition band is shown from only ${validatedSold} validated sold comp(s) — one observation is not a market.`;
      } else if (r.valuation?.primary) {
        pass = false;
        detail = `A valuation primary is shown from only ${validatedSold} validated sold comp(s).`;
      }
    }
    checks.push({ id: 'one_comp_pricing_gate', label: 'One comp never prices', pass, detail, repairable: true });
  }

  // 9. Comp counts are validated-registry counts — provider attempts and raw
  //    candidates must never be presented as comps.
  {
    const reg = inputs.compRegistry?.counts;
    let pass = true;
    let detail = 'Displayed comp counts match the validated unique registry.';
    if (reg && r.compState) {
      if ((r.compState.soldCount ?? 0) !== (reg.validatedSold ?? 0)) {
        pass = false;
        detail = `Comp state shows ${r.compState.soldCount} sold but the validated unique registry holds ${reg.validatedSold}.`;
      } else if (r.compState.activeCount != null && r.compState.activeCount !== (reg.validatedActive ?? 0)) {
        pass = false;
        detail = `Comp state shows ${r.compState.activeCount} active but the validated unique registry holds ${reg.validatedActive}.`;
      }
    }
    checks.push({ id: 'comp_counts_validated', label: 'Comp counts are validated counts', pass, detail, repairable: true });
  }

  // 10./11. Wetlands + FEMA consistency — a screen accepted in the operator
  //    record must never read as "none"/"unknown" elsewhere on the card.
  {
    const cards = inputs.operatorRecord?.decisionCards ?? [];
    const wet = cards.find((c) => c.key === 'wetlands');
    const wetKnown = wet && wet.verdict !== 'unknown';
    const wetShowsRisk = wet && (wet.verdict === 'risk' || wet.verdict === 'caution');
    const ddWetlands = (r.ddFactChecklist ?? []).find((f) => /wetland/i.test(f.key))?.value ?? null;
    let pass = true;
    let detail = wetKnown ? 'Wetlands state agrees across tabs.' : 'Wetlands not screened yet (honest unknown).';
    if (wetShowsRisk && ddWetlands && /^(none|no|0%?|not mapped)$/i.test(ddWetlands.trim())) {
      pass = false;
      detail = `Operator record shows mapped wetlands (${wet!.headline}) but another tab says "${ddWetlands}".`;
    }
    checks.push({ id: 'wetlands_consistency', label: 'Wetlands agree across tabs', pass, detail, repairable: true });

    const flood = cards.find((c) => c.key === 'flood');
    const floodKnown = flood && flood.verdict !== 'unknown';
    const ddFlood = (r.ddFactChecklist ?? []).find((f) => /flood|fema/i.test(f.key))?.value ?? null;
    let fPass = true;
    let fDetail = floodKnown ? 'FEMA state agrees across tabs.' : 'FEMA not screened yet (honest unknown).';
    if (floodKnown && flood!.verdict !== 'good' && ddFlood && /^(unknown|none|not mapped|n\/a)$/i.test(ddFlood.trim())) {
      fPass = false;
      fDetail = `Operator record shows accepted flood screening (${flood!.headline}) but another tab says "${ddFlood}".`;
    }
    checks.push({ id: 'fema_consistency', label: 'FEMA agrees across tabs', pass: fPass, detail: fDetail, repairable: true });
  }

  // 12. A conflicted acreage must remain conflicted — never collapsed to one
  //    silently "verified" number.
  {
    let pass = true;
    let detail = 'Acreage conflict state is preserved.';
    if (inputs.operatorRecord?.identity?.acreageConflict) {
      const rec = r.reconciliation?.acreage;
      if (!rec?.conflict && !rec?.conflictNote) {
        pass = false;
        detail = 'The operator record holds an acreage conflict but the reconciled facts show a single unconflicted acreage.';
      }
    }
    checks.push({ id: 'acreage_conflict_preserved', label: 'Acreage conflict preserved', pass, detail, repairable: true });
  }

  // 13. Exactly the five approved strategies — Pass/Hold are decisions, not
  //    strategies, and fewer than five means a lane was dropped.
  {
    let pass = true;
    let detail = 'The five approved strategies are present.';
    const list = inputs.strategyReadiness?.strategies ?? null;
    if (list) {
      const names = list.map((s) => normStrategy(s.strategy));
      if (list.length !== 5) { pass = false; detail = `${list.length} strategies shown — exactly 5 approved strategies are required.`; }
      else if (names.some((n) => n === 'pass' || n === 'hold')) { pass = false; detail = 'Pass/Hold appears as a strategy — they are decisions, not strategies.'; }
      else {
        const missing = APPROVED_STRATEGY_NAMES.filter((a) => !names.some((n) => n.includes(a.split(' ')[0])));
        if (missing.length) { pass = false; detail = `Approved strategy missing from the record: ${missing.join(', ')}.`; }
      }
    }
    checks.push({ id: 'strategy_five_approved', label: 'Five approved strategies', pass, detail, repairable: true });
  }

  // 14. Pricing gate agreement — when the shared gate is closed, no tab may show
  //    an acquisition band or a promoted winner.
  {
    let pass = true;
    let detail = 'Pricing gate is respected everywhere.';
    if (inputs.strategyReadiness && inputs.strategyReadiness.pricingAllowed === false) {
      const attractive = inputs.pursuit?.attractiveAcquisition;
      if (attractive && (attractive.low != null || attractive.high != null)) {
        pass = false;
        detail = 'The pricing gate is closed but the Strategy tab shows an acquisition band.';
      } else if (inputs.pursuit?.recommended?.strategy) {
        pass = false;
        detail = 'The pricing gate is closed but a winning strategy is promoted.';
      }
    }
    checks.push({ id: 'pricing_gate_agreement', label: 'Pricing gate agreement', pass, detail, repairable: true });
  }

  // 16. Documents visible — claimed retrieved documents must be viewable.
  {
    let pass = true;
    let detail = 'Document claims match viewable pages.';
    if (inputs.deedRetrieved && (inputs.documentRegistry?.pageCount ?? 0) === 0 && (inputs.documentRegistry?.documentCount ?? 0) === 0) {
      pass = false;
      detail = 'Deed research claims a retrieved recorded document but the operator cannot view any pages.';
    }
    checks.push({ id: 'documents_visible', label: 'Documents are viewable', pass, detail, repairable: true });
  }

  // 17. Land Score currency — a legacy score may not display when the reconciled
  //    record says the inputs are CONFLICTED or the parcel is unconfirmed. A
  //    legacy provider-based score on a card with no public-evidence run yet is
  //    that card's current evidence, not stale — it passes.
  {
    let pass = true;
    let detail = 'Land Score reflects the current reconciled record.';
    const rec = inputs.operatorRecord?.landScore;
    const legacyScore = (r as { landScore?: { score?: number } | null }).landScore;
    const hardUnavailable = rec && rec.available === false && /conflicted|not confirmed|unverified/i.test(rec.unavailableReason ?? '');
    if (hardUnavailable && legacyScore && typeof legacyScore.score === 'number') {
      pass = false;
      detail = 'A Land Score is displayed while the reconciled record says the inputs are conflicted or the parcel is unconfirmed.';
    }
    checks.push({ id: 'land_score_current', label: 'Land Score uses current inputs', pass, detail, repairable: true });
  }

  // 18. Blocked-offer agreement — an offer-blocked card cannot simultaneously
  //    recommend pursuing at a price.
  {
    let pass = true;
    let detail = 'Offer readiness agrees with the pursuit answer.';
    if (inputs.operatorRecord?.offerReadiness?.state === 'blocked') {
      const attractive = inputs.pursuit?.attractiveAcquisition;
      if (attractive && (attractive.low != null || attractive.high != null)) {
        pass = false;
        detail = 'Offer readiness is blocked while another section shows an acquisition price range.';
      }
    }
    checks.push({ id: 'blocked_offer_agreement', label: 'Blocked offer shows no price', pass, detail, repairable: true });
  }

  // 19. Displayed acreage vs calculation acreage — the operator header and
  //     description must carry the SAME reconciled acreage the comps/valuation
  //     use. "? ac" beside a numeric comp-scoring acreage is a hard failure.
  {
    let pass = true;
    let detail = 'Displayed acreage matches the calculation acreage.';
    // The reconciled primary governs; when reconciliation has no acreage yet,
    // the DD checklist value is the calculation acreage (comps/valuation use
    // it) — a header showing a materially different official figure is a real
    // contradiction requiring the operator, not a silent pick.
    const positive = (n: number | null): number | null => (n != null && n > 0 ? n : null);
    const recAcres = positive(parseAcres(r.reconciliation?.acreage?.primary ?? null))
      ?? positive(parseAcres((r.ddFactChecklist ?? []).find((f) => f.key === 'acres')?.value ?? null));
    const id = inputs.operatorRecord?.identity;
    const displayed = positive(id?.mappedAcres ?? id?.assessedAcres ?? null);
    const desc = inputs.operatorRecord?.description ?? '';
    if (recAcres != null && inputs.operatorRecord) {
      if (displayed == null) {
        pass = false;
        detail = `Calculations use ${recAcres} ac (reconciled) but the operator record displays no acreage.`;
      } else if (Math.abs(displayed - recAcres) > 0.1 && Math.abs(displayed - recAcres) / Math.max(recAcres, displayed) > 0.02) {
        pass = false;
        detail = `Operator record displays ${displayed} ac but calculations use the reconciled ${recAcres} ac.`;
      } else if (/\?-acre|\?\s*ac\b/.test(desc)) {
        pass = false;
        detail = 'The description renders an unknown acreage while a reconciled numeric acreage exists.';
      }
    }
    checks.push({ id: 'displayed_acreage_alignment', label: 'Displayed acreage = calculation acreage', pass, detail, repairable: true });
  }

  // 20. Geography formatting — no duplicated geographic suffix anywhere the
  //     operator reads.
  {
    const texts = [inputs.operatorRecord?.description, r.marketSummary, r.ddSummary, inputs.executiveSummary?.headline].filter(Boolean) as string[];
    const bad = texts.find((t) => /\b(County|Parish|Borough)\s+\1\b/i.test(t));
    checks.push({
      id: 'geography_format',
      label: 'Geography renders correctly',
      pass: !bad,
      detail: bad ? `Duplicated geographic suffix reached the operator: "${bad.slice(0, 80)}…"` : 'No duplicated geographic suffixes.',
      repairable: true,
    });
  }

  // 21. Executive pricing gate — while the shared gate is closed, NO dollar
  //     figure may render: no acquisition range, no $ headline, no valuation
  //     primary, no value range.
  {
    let pass = true;
    let detail = 'No pricing output while the gate is closed.';
    if (inputs.strategyReadiness && inputs.strategyReadiness.pricingAllowed === false) {
      const es = inputs.executiveSummary;
      if (es?.preliminaryAcquisitionRange?.available) {
        pass = false;
        detail = 'The pricing gate is closed but the executive summary publishes a preliminary acquisition range.';
      } else if (es?.headline && /\$\s?\d/.test(es.headline)) {
        pass = false;
        detail = `The pricing gate is closed but the headline shows a dollar target ("${es.headline.slice(0, 80)}").`;
      } else if (r.valuation?.primary?.value != null) {
        pass = false;
        detail = 'The pricing gate is closed but a primary valuation is displayed.';
      } else if (r.valuation?.valueRange && (r.valuation.valueRange.low != null || r.valuation.valueRange.high != null)) {
        pass = false;
        detail = 'The pricing gate is closed but a value range is displayed.';
      }
    }
    checks.push({ id: 'exec_pricing_gate', label: 'No dollars while pricing gate closed', pass, detail, repairable: true });
  }

  // 22. Strategy/Value decision cards must agree with the shared readiness
  //     record — "Strategies scoreable"/"Value Readiness OK" can never render
  //     while all five strategies are blocked.
  {
    let pass = true;
    let detail = 'Decision cards agree with the shared strategy-readiness record.';
    const list = inputs.strategyReadiness?.strategies ?? null;
    const allBlocked = !!list && list.length > 0 && list.every((s) => (s.status ?? '') === 'blocked');
    const cards = inputs.operatorRecord?.decisionCards ?? [];
    const strategyCard = cards.find((c) => c.key === 'strategy');
    const gateClosed = inputs.strategyReadiness?.pricingAllowed === false || inputs.operatorRecord?.pricingGate?.pricingAllowed === false;
    if (allBlocked && strategyCard && (strategyCard.verdict === 'good' || /scoreable|ready/i.test(strategyCard.headline ?? ''))) {
      pass = false;
      detail = `All five strategies are blocked but the Strategy Readiness card says "${strategyCard.headline}".`;
    } else if (gateClosed && inputs.operatorRecord?.valueReadiness?.state === 'ready') {
      pass = false;
      detail = 'The pricing gate is closed but Value Readiness reads "ready".';
    }
    checks.push({ id: 'strategy_card_agreement', label: 'Readiness cards match shared record', pass, detail, repairable: true });
  }

  // 23. Red-flag completeness — "None surfaced"/verdict good may only render
  //     when every core screening lane produced accepted evidence.
  {
    let pass = true;
    let detail = 'Red-flag status respects screening completeness.';
    const rc = inputs.operatorRecord?.researchCompleteness;
    const rf = (inputs.operatorRecord?.decisionCards ?? []).find((c) => c.key === 'red_flags');
    if (rc && rc.complete === false && rf && (rf.verdict === 'good' || /^none\b/i.test((rf.headline ?? '').trim()))) {
      pass = false;
      detail = `Critical-risk review is incomplete (${(rc.missing ?? []).join(', ') || 'lanes pending'}) but the card says "${rf.headline}".`;
    }
    checks.push({ id: 'red_flags_completeness', label: 'Incomplete screening never reads all-clear', pass, detail, repairable: true });
  }

  // 24. Valuation basis count must cite the validated unique registry.
  {
    let pass = true;
    let detail = 'Valuation basis count matches the validated registry.';
    const reg = inputs.compRegistry?.counts;
    const label = r.valuation?.primary?.label ?? '';
    const m = label.match(/\((\d+)\)/);
    if (reg && m && (r.valuation?.primary as { kind?: string } | null | undefined)?.kind === 'comp_sold') {
      const cited = Number(m[1]);
      if (cited !== (reg.validatedSold ?? 0)) {
        pass = false;
        detail = `The valuation cites ${cited} sold comps but the validated unique registry holds ${reg.validatedSold}.`;
      }
    }
    checks.push({ id: 'valuation_registry_count', label: 'Valuation cites registry counts', pass, detail, repairable: true });
  }

  // 25. Market summary currency — the narrative cannot deny comps the comp
  //     state says were retrieved and validated.
  {
    let pass = true;
    let detail = 'Market narrative agrees with the comp state.';
    const denies = /no approved non-paid market adapter is connected|no comps, solds, actives/i.test(r.marketSummary ?? '');
    if (denies && (r.compState?.anyRetrieved || (r.compState?.soldCount ?? 0) > 0)) {
      pass = false;
      detail = `The market summary claims no comps are computed while the comp state holds ${r.compState?.soldCount ?? 0} sold / ${r.compState?.activeCount ?? 0} active.`;
    }
    checks.push({ id: 'market_summary_currency', label: 'Market narrative is current', pass, detail, repairable: true });
  }

  // 26. Offer readiness respects the pricing gate + research completeness — a
  //     calculated range alone never advances the offer state.
  {
    let pass = true;
    let detail = 'Offer readiness matches its material blockers.';
    const st = inputs.operatorRecord?.offerReadiness?.state ?? '';
    const gateClosed = inputs.strategyReadiness?.pricingAllowed === false;
    const incomplete = inputs.operatorRecord?.researchCompleteness?.complete === false;
    if (gateClosed && (st === 'ready' || st === 'needs_confirmation')) {
      pass = false;
      detail = `The pricing gate is closed but offer readiness reads "${st}".`;
    } else if (incomplete && st === 'ready') {
      pass = false;
      detail = 'Material research is incomplete but offer readiness reads "ready".';
    }
    checks.push({ id: 'offer_readiness_gate', label: 'Offer readiness matches blockers', pass, detail, repairable: true });
  }

  // 27. Unified readiness agreement — every readiness surface must mirror the
  //     ONE shared record; a mirrored field drifting is a hard inconsistency.
  {
    let pass = true;
    let detail = 'Every readiness surface mirrors the shared unified record.';
    const u = inputs.unifiedReadiness;
    const fail = (why: string) => { pass = false; detail = why; };
    if (u) {
      const gateClosed = inputs.strategyReadiness?.pricingAllowed === false || inputs.operatorRecord?.pricingGate?.pricingAllowed === false;
      const list = inputs.strategyReadiness?.strategies ?? null;
      const allBlocked = u.allStrategiesBlocked ?? (!!list && list.length > 0 && list.every((s) => (s.status ?? '') === 'blocked'));
      const recValue = inputs.operatorRecord?.valueReadiness?.state;
      const recOffer = inputs.operatorRecord?.offerReadiness?.state;
      if ((u.consistencyIssues?.length ?? 0) > 0) {
        fail(`The unified readiness record found internal inconsistencies: ${u.consistencyIssues!.join(' ')}`);
      } else if (recValue && u.value?.state && recValue !== u.value.state) {
        fail(`Value readiness disagrees: the operator record shows "${recValue}" but the unified record shows "${u.value.state}".`);
      } else if (recOffer && u.offer?.state && recOffer !== u.offer.state) {
        fail(`Offer readiness disagrees: the operator record shows "${recOffer}" but the unified record shows "${u.offer.state}".`);
      } else if (allBlocked && u.strategyActionability?.state && u.strategyActionability.state !== 'blocked') {
        fail(`All strategies are blocked but strategy actionability reads "${u.strategyActionability.state}".`);
      } else if (gateClosed && u.strategyScoreability?.state === 'scoreable') {
        fail('The pricing gate is closed but strategy scoreability reads "scoreable".');
      } else if (gateClosed && u.value?.state === 'ready') {
        fail('The pricing gate is closed but the unified value readiness reads "ready".');
      }
    }
    checks.push({ id: 'unified_readiness_agreement', label: 'Readiness surfaces mirror the shared record', pass, detail, repairable: true });
  }

  // 28. Readiness states reconcile — no legacy label, count gate, or dependent
  //     state may read more advanced than the shared record allows.
  {
    let pass = true;
    let detail = 'Readiness labels, gates, and dependent states reconcile.';
    const u = inputs.unifiedReadiness;
    const fail = (why: string) => { pass = false; detail = why; };
    if (u) {
      const gateClosed = inputs.strategyReadiness?.pricingAllowed === false || inputs.operatorRecord?.pricingGate?.pricingAllowed === false;
      const offerState = u.offer?.state ?? '';
      const contractState = u.contract?.state ?? '';
      if (inputs.reportOfferReadiness === 'ready_for_offer' && offerState !== 'ready') {
        fail(`The legacy report offer label reads "ready_for_offer" while the shared record says the offer is ${offerState.replace(/_/g, ' ') || 'not ready'}.`);
      } else if (gateClosed && inputs.compRegistry?.valuationReady === true && u.valuationContext?.state === 'defensible') {
        fail('A computable median (registry count gate) is presented as a defensible valuation basis while the shared pricing gate is closed.');
      } else if (contractState === 'ready' && offerState !== 'ready') {
        fail(`Contract readiness reads "ready" while offer readiness is ${offerState.replace(/_/g, ' ') || 'not ready'} — contract cannot outrun the offer.`);
      } else if (contractState === 'needs_confirmation' && (offerState === 'researching' || offerState === 'blocked')) {
        fail(`Contract readiness reads "needs confirmation" while the offer is still ${offerState} — contract cannot outrun the offer.`);
      } else if ((offerState === 'researching' || offerState === 'blocked') && !(u.offer?.why ?? '').trim()) {
        fail(`Offer readiness is ${offerState} with no explanation — a readiness state must always say why.`);
      }
    }
    checks.push({ id: 'readiness_states_reconcile', label: 'Readiness states reconcile across surfaces', pass, detail, repairable: true });
  }

  const failed = checks.filter((c) => !c.pass);
  return {
    passed: failed.length === 0,
    failedCount: failed.length,
    checks,
    summaryLine:
      failed.length === 0
        ? `Executive review: ${checks.length}/${checks.length} consistency checks passed.`
        : `Executive review: ${checks.length - failed.length}/${checks.length} checks passed — ${failed.map((f) => f.label.toLowerCase()).join(', ')} need repair.`,
    generatedAt,
  };
}
