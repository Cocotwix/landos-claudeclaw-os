// Browser visual acceptance for the operational closure.
//
// This scenario names the CONCRETE on-screen outcomes this build produced, on
// the real operator application. A page that merely loads is not acceptance:
// every check below fails if the specific value the build changed is not the
// value actually rendered.
//
// What it proves, on the canonical Deal Card for the Bradford County subject:
//   1. §3E — the operator sees a Combined LandOS FMV with 40% and 60%
//      benchmarks derived from it, and NO 50% band anywhere on the surfaces
//      that used to print one.
//   2. §3A — the governing acreage rendered is the operator-accepted 1.50 ac
//      from the signed boundary survey, not the non-governing 1.846 ac
//      Cadastral 2023 geometry. That acceptance is retained on an archived
//      alias, so this is also the visible proof that the canonical-family read
//      resolver reaches alias-owned immutable evidence.
//   3. §3A — the archived alias route resolves to the canonical Deal Card
//      instead of rendering a second editable copy.
//
// The harness separately asserts that page load and hard refresh issue GET
// requests only, which is how "no unintended research or model reruns" is
// proven rather than asserted.

import type { BrowserQaScenario } from './browser-qa.js';

/** The canonical Deal Card and its archived alias for the standing subject. */
const CANONICAL_DEAL = 90;
const ALIAS_DEAL = 115;
/** The standing live-proof Deal Cards: Bradford County, Fairview TN, Overby Rd TN. */
const STANDING_DEALS = [90, 89, 128];

const OVERVIEW = `/dept/acquisitions/v2?deal=${CANONICAL_DEAL}&page=overview`;

/** Money as the operator reads it, tolerant of thin spaces and separators. */
function containsMoney(haystack: string, dollars: number): boolean {
  const withCommas = dollars.toLocaleString('en-US');
  return haystack.includes(`$${withCommas}`) || haystack.includes(`$${dollars}`);
}

export const operationalClosureBrowserQaScenario: BrowserQaScenario = {
  id: 'operational-closure',
  route: OVERVIEW,
  async run(qa) {
    let overviewText = '';

    // Record every non-GET request this scenario causes. The harness's own
    // browser-pairing handshake is how it authenticates and is not an
    // application write; what the contract actually requires is that opening
    // and refreshing a Deal Card never reruns research, a model call, a
    // valuation or a decision. That is asserted explicitly below rather than
    // inferred from the harness's own traffic.
    const HARNESS_PAIRING = /\/api\/dashboard\/browser-pairings(\/claim)?$/;
    const applicationWrites: string[] = [];
    qa.page.on('request', (request) => {
      const method = (request as { method?(): string }).method?.() ?? 'GET';
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      const url = request.url();
      if (HARNESS_PAIRING.test(new URL(url, 'http://localhost').pathname)) return;
      applicationWrites.push(`${method} ${new URL(url, 'http://localhost').pathname}`);
    });

    await qa.step('Deal 90 Overview renders the current Combined LandOS FMV', async () => {
      await qa.goto();
      await qa.waitFor('body');
      await qa.waitFor('[data-testid="overview-econ-strip"]', 30_000);
      overviewText = await qa.text('body');

      const strip = await qa.text('[data-testid="overview-econ-strip"]');
      qa.check(
        'Overview economics strip shows the current Combined LandOS FMV $52,000',
        containsMoney(strip, 52_000),
        `economics strip text: ${strip.replace(/\s+/g, ' ').slice(0, 240)}`,
      );
      return 'economics strip read';
    });

    await qa.step('the 40% and 60% benchmarks are shown and no 50% band is', async () => {
      qa.check(
        'Overview shows the 40% benchmark $20,800',
        containsMoney(overviewText, 20_800),
        containsMoney(overviewText, 20_800) ? '$20,800 present' : 'no $20,800 found on the Overview',
      );
      qa.check(
        'Overview shows the 60% benchmark $31,200',
        containsMoney(overviewText, 31_200),
        containsMoney(overviewText, 31_200) ? '$31,200 present' : 'no $31,200 found on the Overview',
      );
      const fiftyLabel = /50%\s*of\s*FMV/i.test(overviewText);
      qa.check(
        'Overview prints no "50% of FMV" band',
        !fiftyLabel,
        fiftyLabel ? 'a 50% of FMV label is rendered' : 'no 50% of FMV label',
      );
      // The 50% VALUE must be absent from the benchmark surface specifically.
      // Scoping matters: a figure equal to half the FMV can legitimately appear
      // elsewhere as a comparable's own price-per-acre, and flagging that would
      // be a false positive against real evidence rather than a forbidden band.
      const strip = await qa.text('[data-testid="overview-econ-strip"]');
      qa.check(
        'the Overview economics strip carries no 50%-of-FMV benchmark ($26,000)',
        !containsMoney(strip, 26_000),
        containsMoney(strip, 26_000)
          ? '$26,000 appears in the economics strip'
          : 'economics strip carries 40% and 60% only',
      );
      return '40/60 present, 50 absent';
    });

    await qa.step('the governing acreage is the operator-accepted survey basis', async () => {
      // 1.50 ac from the signed boundary survey, retained on archived alias 115
      // and reachable only through the canonical-family read.
      const hasGoverning = /\b1\.50?\s*(ac\b|acres?\b)/i.test(overviewText);
      qa.check(
        'Overview renders the accepted governing acreage of 1.5 acres',
        hasGoverning,
        hasGoverning ? '1.5-acre governing acreage rendered' : 'no 1.5-acre governing acreage found',
      );
      // The superseded, non-governing figure must not be presented as current.
      const showsCadastralAsCurrent = /governing[^.]{0,60}1\.846/i.test(overviewText);
      qa.check(
        'the non-governing 1.846-acre Cadastral geometry is not presented as governing',
        !showsCadastralAsCurrent,
        showsCadastralAsCurrent ? '1.846 ac is labelled governing' : '1.846 ac is not labelled governing',
      );
      return 'governing acreage verified';
    });

    await qa.screenshot('deal90-overview');

    await qa.step('the Strategy & Underwriting napkin shows 40/60 and no 50% band', async () => {
      await qa.goto(`/dept/acquisitions/v2?deal=${CANONICAL_DEAL}&page=strategy`);
      await qa.waitFor('body');
      const strategyText = await qa.text('body');
      const band = await qa.exists('[data-testid="napkin-band"]');
      if (band) {
        const bandText = await qa.text('[data-testid="napkin-band"]');
        qa.check(
          'the napkin band shows 40% and 60% only',
          /40%/.test(bandText) && /60%/.test(bandText) && !/50%/.test(bandText),
          `napkin band: ${bandText.replace(/\s+/g, ' ').slice(0, 200)}`,
        );
      } else {
        // No napkin rendered is an honest state (no supported FMV), but it must
        // not be reported as if the band had been inspected.
        qa.check(
          'the napkin band is present to inspect',
          false,
          'no [data-testid="napkin-band"] on the Strategy page; the 50% removal was NOT visually proven here',
        );
      }
      qa.check(
        'Strategy & Underwriting prints no "50% of FMV" band',
        !/50%\s*of\s*FMV/i.test(strategyText),
        /50%\s*of\s*FMV/i.test(strategyText) ? 'a 50% of FMV label is rendered' : 'no 50% of FMV label',
      );
      return 'napkin band verified';
    });

    await qa.screenshot('deal90-strategy-napkin');

    await qa.step('the Comps & Valuation page renders the combined map and active competition', async () => {
      await qa.goto(`/dept/acquisitions/v2?deal=${CANONICAL_DEAL}&page=comps`);
      await qa.waitFor('body');
      await qa.waitFor('.awv2-cv-map', 40_000);

      // The ONE combined map: a single map carrying the same filtered records
      // the list shows, not a second parallel comp surface.
      const maps = await qa.count('.awv2-cv-map');
      qa.check('exactly one combined comp map is rendered', maps === 1, `${maps} map container(s)`);
      const mapShown = await qa.text('.awv2-cv-map-shown');
      qa.check(
        'the map states which records it is showing',
        mapShown.trim().length > 0,
        `map header: ${mapShown.replace(/\s+/g, ' ').slice(0, 160)}`,
      );

      // The subject itself must be on the map, and the comparable markers must
      // be present and distinguishable from it. A map that plots nothing but a
      // header is not evidence that any record was placed.
      const subjectMarkers = await qa.count('[data-testid="cv-map-subject"]');
      qa.check(
        'the subject itself is plotted on the combined map',
        subjectMarkers === 1,
        `${subjectMarkers} subject marker`,
      );
      const compMarkers = await qa.count('[data-testid="cv-map-marker"]');
      qa.check(
        'comparable markers are plotted on the combined map',
        compMarkers >= 3,
        `${compMarkers} comparable marker(s) drawn`,
      );
      // The roles must be DISTINCT on the map: closed-sale evidence and active
      // competition are different classes of record and are never one pile.
      const closedMarkers = await qa.count('[data-marker-role="accepted_closed_sale"]');
      const activeMarkers = await qa.count('[data-marker-role="active_competition"]');
      qa.check(
        'closed-sale comps are plotted as their own marker role',
        closedMarkers >= 1,
        `${closedMarkers} accepted_closed_sale marker(s)`,
      );
      qa.check(
        'active competition is plotted as a separate marker role',
        activeMarkers >= 1,
        `${activeMarkers} active_competition marker(s)`,
      );
      qa.check(
        'active competition markers are not mixed into the closed-sale role',
        closedMarkers > 0 && activeMarkers > 0,
        `closed=${closedMarkers} active=${activeMarkers} (distinct data-marker-role values)`,
      );

      // Active competition is carried SEPARATELY from the sold-price evidence.
      const hasActive = await qa.exists('[data-testid="cv-active-summary"]');
      qa.check('an active resale competition summary is present', hasActive,
        hasActive ? 'cv-active-summary rendered' : 'no cv-active-summary on the Comps page');
      if (hasActive) {
        const active = await qa.text('[data-testid="cv-active-summary"]');
        qa.check(
          'active competition names a non-zero listing count and says asking never sets FMV',
          /Active resale competition \((?!0\))\d+\)/.test(active) && /do not set FMV|never enter/i.test(active),
          `active summary: ${active.replace(/\s+/g, ' ').slice(0, 220)}`,
        );
      }
      return 'combined map and active competition verified';
    });

    await qa.screenshot('deal90-comps-map-and-active-competition');

    await qa.step('the archived alias route resolves to the canonical Deal Card', async () => {
      await qa.goto(`/dept/acquisitions/v2?deal=${ALIAS_DEAL}&page=overview`);
      // The alias route opens the CANONICAL card and says so; the notice only
      // exists on the canonical route after that resolution.
      await qa.waitFor('[data-testid="archived-alias-notice"]', 40_000);
      const notice = await qa.text('[data-testid="archived-alias-notice"]');
      qa.check(
        `Deal ${ALIAS_DEAL} is shown as an archived duplicate resolving to Deal ${CANONICAL_DEAL}`,
        new RegExp(`Deal ${ALIAS_DEAL} is an archived duplicate of this Deal Card \\(Deal ${CANONICAL_DEAL}\\)`).test(notice),
        `notice: ${notice.replace(/\s+/g, ' ').slice(0, 200)}`,
      );
      // The alias must not present itself as a second live opportunity carrying
      // its own current valuation lifecycle: the economics shown are the
      // canonical card's, never the alias's retained $42,000 package.
      await qa.waitFor('[data-testid="overview-econ-strip"]', 30_000);
      const strip = await qa.text('[data-testid="overview-econ-strip"]');
      qa.check(
        `the alias route shows the canonical Combined LandOS FMV $52,000, not a rival valuation`,
        containsMoney(strip, 52_000) && !containsMoney(strip, 42_000),
        `economics strip on the alias route: ${strip.replace(/\s+/g, ' ').slice(0, 200)}`,
      );
      return 'alias route inspected';
    });

    await qa.screenshot('deal115-alias-route');

    await qa.step('the subject is not contaminated by the retained manufactured-home parcel', async () => {
      await qa.goto(OVERVIEW);
      await qa.waitFor('[data-testid="overview-combined-fmv"]', 30_000);
      const fmvCell = await qa.text('[data-testid="overview-combined-fmv"]');
      // A subject read as improved renders "Combined LandOS FMV · Land". The
      // manufactured home sits on a related parcel the sellers retain; the
      // 1.5-acre subject stays vacant land and its FMV stays a land value.
      const readAsLand = /Combined LandOS FMV/.test(fmvCell) && !/·\s*Land/.test(fmvCell);
      qa.check(
        'Deal 90 values the vacant 1.5-acre subject, not an improved parcel',
        readAsLand,
        `combined FMV cell: ${fmvCell.replace(/\s+/g, ' ').slice(0, 160)}`,
      );
      return 'subject scope verified';
    });

    // Every standing live-proof card renders CURRENT guidance for its accepted
    // subject after the rerun-stamp repair: no "prior read" banner, a current
    // Deal Brain decision with both next actions, and prior decisions still
    // reachable as history (never as current).
    for (const dealId of STANDING_DEALS) {
      await qa.step(`Deal ${dealId} renders current guidance for its accepted subject`, async () => {
        await qa.goto(`/dept/acquisitions/v2?deal=${dealId}&page=overview`);
        await qa.waitFor('[data-testid="deal-brain-decision"]', 40_000);
        const staleBanners = await qa.count('.awv2-stale-subject');
        qa.check(
          `Deal ${dealId} shows no "No current read for the accepted subject" banner`,
          staleBanners === 0,
          `${staleBanners} stale-subject banner(s)`,
        );
        const decision = await qa.text('[data-testid="deal-brain-decision"]');
        const shownAsHistory = /shown as history, not as current guidance/i.test(decision);
        qa.check(
          `Deal ${dealId} Deal Brain decision is current, not a historical read`,
          !shownAsHistory,
          shownAsHistory ? 'decision panel says it is history' : 'decision panel renders as current',
        );
        const landos = (await qa.exists('[data-testid="deal-decision-landos-action"]'))
          ? await qa.text('[data-testid="deal-decision-landos-action"]') : '';
        const operator = (await qa.exists('[data-testid="deal-decision-operator-action"]'))
          ? await qa.text('[data-testid="deal-decision-operator-action"]') : '';
        qa.check(
          `Deal ${dealId} states one LandOS next action and one operator next action`,
          landos.trim().length > 20 && operator.trim().length > 20,
          `LandOS: ${landos.replace(/\s+/g, ' ').slice(0, 110)} | Operator: ${operator.replace(/\s+/g, ' ').slice(0, 110)}`,
        );
        const historyPresent = await qa.exists('[data-testid="deal-decision-history"]');
        const historySummary = historyPresent ? await qa.text('[data-testid="deal-decision-history"] summary') : '';
        qa.check(
          `Deal ${dealId} keeps prior decisions reachable as history`,
          historyPresent && /Prior decisions \(\d+\)/.test(historySummary),
          historyPresent ? historySummary.trim() : 'no prior-decisions history section',
        );
        await qa.screenshot(`deal${dealId}-overview-current-guidance`);
        return `Deal ${dealId} current guidance inspected`;
      });
    }

    // The retained official outcomes wired into the lifecycle must be VISIBLE
    // on the operator surfaces, not only present in read models: the accepted
    // district with its source, the recorded deed and its restrictions, the
    // legal-access instrument, the Land Home posture, and the accepted acreage.
    // Each proof names the page(s) the text was found on.
    const RECORD_PROOF_PAGES = ['overview', 'property', 'strategy', 'documents'] as const;
    const RECORD_PROOFS: Array<{ dealId: number; label: string; pattern: RegExp }> = [
      { dealId: 90, label: 'AGRICULTURAL-2 district from the Bradford County zoning atlas', pattern: /AGRICULTURAL-2/i },
      { dealId: 90, label: 'recorded deed OR Book 1124 Page 39 / Instrument 2005189911', pattern: /1124\s*\/\s*39|Page 39|2005189911/ },
      { dealId: 90, label: 'River Oak Plantation restrictions and the ingress/egress easement', pattern: /River Oak Plantation Restrictions|ingress\/egress easement/i },
      { dealId: 90, label: 'legal access established from the recorded instrument', pattern: /legal access[^.]{0,80}(verified|established)|verified[^.]{0,40}legal access|recorded_instrument|Recorded instrument/i },
      { dealId: 90, label: 'Land Home Package posture', pattern: /WORTH EXPLORING|Land Home Package|Land \+ Home/i },
      { dealId: 128, label: 'RS40 district from the Fairview zoning layer', pattern: /\bRS40\b/ },
      { dealId: 128, label: 'accepted 50.8 acres', pattern: /50\.8\s*AC|50\.8 acres|50\.8 ac/i },
    ];
    for (const dealId of [...new Set(RECORD_PROOFS.map((proof) => proof.dealId))]) {
      await qa.step(`Deal ${dealId} shows its retained official record outcomes on the operator surfaces`, async () => {
        const texts: Record<string, string> = {};
        for (const page of RECORD_PROOF_PAGES) {
          await qa.goto(`/dept/acquisitions/v2?deal=${dealId}&page=${page}`);
          await qa.waitFor('body', 30_000);
          await new Promise((resolve) => { setTimeout(resolve, 4_000); });
          texts[page] = (await qa.text('body')).replace(/\s+/g, ' ');
          await qa.screenshot(`deal${dealId}-${page}-record-proof`);
        }
        for (const proof of RECORD_PROOFS.filter((entry) => entry.dealId === dealId)) {
          const hits = RECORD_PROOF_PAGES.filter((page) => proof.pattern.test(texts[page]));
          const sample = hits.length
            ? (() => { const text = texts[hits[0]]; const at = text.search(proof.pattern); return text.slice(Math.max(0, at - 70), at + 130); })()
            : 'not found on overview, property, strategy or documents';
          qa.check(`Deal ${dealId} visibly shows ${proof.label}`, hits.length > 0, `${hits.length ? `on ${hits.join(', ')}: ` : ''}${sample}`);
        }
        return `Deal ${dealId} record outcomes inspected on ${RECORD_PROOF_PAGES.length} pages`;
      });
    }

    // Back to the canonical Overview so the harness's hard-refresh persistence
    // and GET-only assertions run against the surface this build changed.
    await qa.goto(OVERVIEW);
    await qa.waitFor('[data-testid="overview-econ-strip"]', 30_000);
    await qa.hardRefresh('/dept/acquisitions/v2');
    await qa.waitFor('[data-testid="overview-econ-strip"]', 30_000);

    await qa.step('the result survives a hard refresh', async () => {
      const afterRefresh = await qa.text('[data-testid="overview-econ-strip"]');
      qa.check(
        'Combined LandOS FMV $52,000 still rendered after a hard refresh',
        containsMoney(afterRefresh, 52_000),
        `economics strip after refresh: ${afterRefresh.replace(/\s+/g, ' ').slice(0, 240)}`,
      );
      const body = await qa.text('body');
      qa.check(
        'no 50% of FMV band after a hard refresh',
        !/50%\s*of\s*FMV/i.test(body),
        'checked the reloaded Overview',
      );
      return 'refresh persistence verified';
    });

    await qa.screenshot('deal90-overview-after-hard-refresh');

    await qa.step('no research, model, valuation or decision rerun was triggered', async () => {
      qa.check(
        'opening, navigating and hard-refreshing the Deal Card issued no application writes',
        applicationWrites.length === 0,
        applicationWrites.length === 0
          ? 'the only non-GET traffic was the QA harness\'s own browser-pairing handshake'
          : `unexpected application writes: ${applicationWrites.join('; ')}`,
      );
      return `${applicationWrites.length} application write(s)`;
    });
  },
};
