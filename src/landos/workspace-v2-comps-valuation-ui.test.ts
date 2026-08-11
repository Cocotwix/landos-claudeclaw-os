// Acquisition Workspace V2 — Comps & Valuation section contract.
//
// The section is a real V2 workspace area: mounted from the page's single
// property-intelligence fetch (props, no fetch on mount), URL-addressable via
// ?section=comps-valuation, and honest about which sales may price the subject.
//
// The governing structural rule after the comps refinement sprint: the
// comparable evidence is presented EXACTLY ONCE. The page previously rendered
// the same records three times (a cleaned-set list, then a full card list, then
// a prose restatement of every record), which is what made it unreadable. There
// is now one decision strip, one method block, and ONE list-and-map workspace
// whose list and map always share the same filtered record set.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const NAV_SRC = read('web/src/lib/workspace-v2-nav.ts');
const PAGE_SRC = `${read('web/src/pages/AcquisitionWorkspaceV2.tsx')}\n${read('web/src/components/AcquisitionWorkspaceV2Overview.tsx')}`;
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
const MAP_SRC = read('web/src/components/AcquisitionWorkspaceV2CompMap.tsx');
const D_SRC = read('web/src/components/AcquisitionWorkspaceV2CompDetails.tsx');
const THUMB_SRC = read('web/src/components/CompVisualThumb.tsx');
const GALLERY_SRC = read('web/src/components/AcquisitionWorkspaceV2CompPhotoGallery.tsx');
const CSS_SRC = `${read('web/src/styles/workspace-v2.css')}\n${read('web/src/styles/workspace-v2-comps.css')}`;

describe('Comps & Valuation is a live V2 section', () => {
  it('has a real section slug so the URL round-trips and refresh restores it', () => {
    expect(NAV_SRC).toMatch(/'Comps & Valuation': 'comps-valuation'/);
    expect(NAV_SRC).toMatch(/'Overview' \| 'Property Intelligence' \| 'Comps & Valuation'/);
  });

  it('mounts from the page-level record with props — opening the tab fetches nothing', () => {
    expect(PAGE_SRC).toMatch(/section === 'Comps & Valuation'/);
    expect(PAGE_SRC).toMatch(/<CompsValuationSection dealId=\{dealId\} initial=\{compsValuation\}/);
    expect(PAGE_SRC).toMatch(/compsValuation \?\? null/);
    // The section component never refetches its record on mount.
    expect(CV_SRC).not.toMatch(/apiGet/);
    expect(CV_SRC).not.toMatch(/useEffect/);
  });

  it('only mutates through the explicit operator selection and bounded location-resolution endpoints', () => {
    const posts = CV_SRC.match(/apiPost[^\n]*/g) ?? [];
    expect(posts.length).toBeGreaterThan(0);
    expect(CV_SRC).toMatch(/comps-valuation\/selection/);
    expect(CV_SRC).toMatch(/comps-valuation\/resolve-locations/);
    expect(CV_SRC).not.toMatch(/\/research|\/rerun|\/run\b/);
  });
});

describe('the duplicated comparable presentation is gone', () => {
  it('renders the comp list in exactly one place', () => {
    // One workspace list container, and no second "cleaned valuation set" list
    // or per-role duplicate of the same records.
    expect((CV_SRC.match(/awv2-cv-workspace/g) ?? []).length).toBe(1);
    expect((CV_SRC.match(/class="awv2-cv-list"/g) ?? []).length).toBe(1);
    expect(CV_SRC).not.toMatch(/awv2-cv-rolegroup/);
    expect(CV_SRC).not.toMatch(/awv2-cv-selrow/);
    expect(CV_SRC).not.toMatch(/awv2-cv-selected"/);
    expect(CV_SRC).not.toMatch(/Cleaned valuation set/);
    expect(CV_SRC).not.toMatch(/Comparable records/);
  });

  it('replaces the prose restatement of every comp with the decisive evidence', () => {
    // The old bottom-of-page list rendered explanation.used / explanation.excluded
    // line by line. It is replaced by three strongest comps plus the records that
    // set the bottom and top of the range, with the full set behind a ledger.
    expect(CV_SRC).not.toMatch(/explanation\.used\.map/);
    expect(CV_SRC).not.toMatch(/explanation\.excluded\.map/);
    expect(CV_SRC).toMatch(/Strongest comp/);
    expect(CV_SRC).toMatch(/Lower-value evidence/);
    expect(CV_SRC).toMatch(/Upper-value evidence/);
    expect(CV_SRC).toMatch(/Full calculation ledger/);
    expect(CV_SRC).toMatch(/awv2-cv-ledger/);
  });

  it('mounts exactly one combined comparable map', () => {
    expect((CV_SRC.match(/<CombinedCompMap/g) ?? []).length).toBe(1);
    expect(CV_SRC).not.toMatch(/<CompMap /);
    // The retained LandPortal capture stays available as compact evidence only.
    expect(CV_SRC).toMatch(/key=comps_map/);
    expect(CV_SRC).toMatch(/<details class="awv2-collapse">[\s\S]{0,2000}awv2-cv-mapcapture/);
  });
});

describe('the decision strip leads the page', () => {
  it('shows the adopted FMV, retail range, offers, ceiling, and confidence together', () => {
    expect(CV_SRC).toMatch(/awv2-cv-decision/);
    expect(CV_SRC).toMatch(/Adopted cleaned FMV/);
    expect(CV_SRC).toMatch(/Supported retail range/);
    expect(CV_SRC).toMatch(/Recommended opening/);
    expect(CV_SRC).toMatch(/Recommended target/);
    expect(CV_SRC).toMatch(/Hard ceiling/);
    expect(CV_SRC).toMatch(/cleaned\.confidence/);
  });

  it('labels an improved subject as land-only and leaves whole-property value pending', () => {
    expect(CV_SRC).toMatch(/Land-only indication/);
    expect(CV_SRC).toMatch(/Land-basis opening reference/);
    expect(CV_SRC).toMatch(/Land-basis target reference/);
    expect(CV_SRC).toMatch(/Land-basis ceiling reference/);
    expect(CV_SRC).toMatch(/LAND BASIS ONLY/);
    expect(CV_SRC).toMatch(/Land-basis 40 \/ 50 \/ 60 references/);
    expect(CV_SRC).toMatch(/Whole-property value/);
    expect(CV_SRC).toMatch(/<div class="v">PENDING<\/div>/);
  });

  it('does not repeat stale no-comp blockers when canonical accepted comps exist', () => {
    expect(CV_SRC).toMatch(/isStaleCompConclusion/);
    expect(CV_SRC).toMatch(/summary\.acceptedCount > 0/);
    expect(CV_SRC).toMatch(/no usable comp\|another/);
    expect(CV_SRC).toMatch(/reconciledNeededEvidence/);
  });

  it('explains which comp window was selected and why it stopped there', () => {
    expect(CV_SRC).toMatch(/valuationWindow/);
    expect(CV_SRC).toMatch(/selectedMonths\}-month sale window/);
    expect(CV_SRC).toMatch(/acreageBand\?\.label/);
    expect(CV_SRC).toMatch(/Credible within 12 mo/);
    expect(CV_SRC).toMatch(/Added 13–24 mo/);
    expect(CV_SRC).toMatch(/Added 25–30 mo/);
    expect(CV_SRC).toMatch(/Moved to historical context/);
    expect(CV_SRC).toMatch(/win\.explanation\.map/);
    // Whether the exceptional 30-month step was needed is stated, not implied.
    expect(CV_SRC).toMatch(/addedFrom25To30 > 0 && <span class="chip warn">/);
    expect(CV_SRC).toMatch(/Why this FMV/);
    expect(CV_SRC).toMatch(/Older sales:/);
  });

  it('keeps the method comparison compact with detail behind progressive disclosure', () => {
    expect(CV_SRC).toMatch(/Cleaned average/);
    expect(CV_SRC).toMatch(/Cleaned median/);
    expect(CV_SRC).toMatch(/Weighted indication/);
    expect(CV_SRC).toMatch(/Active competition/);
    expect(CV_SRC).toMatch(/Simplified 40 \/ 50 \/ 60 method/);
    expect(CV_SRC).toMatch(/Technical quick-flip method/);
    expect(CV_SRC).toMatch(/Technical maximum allowable offer/);
    expect(CV_SRC).toMatch(/As a percentage of cleaned FMV/);
    expect(CV_SRC).toMatch(/Reconciliation/);
    expect(CV_SRC).toMatch(/<summary>Full method detail and assumptions/);
    expect(CV_SRC).toMatch(/LandOS operating assumption \(revisable\)/);
  });

  it('keeps Market Research context compact and subordinate to the valuation', () => {
    expect(CV_SRC).toMatch(/Market Research acreage-band context/);
    expect(CV_SRC).toMatch(/not LandPortal/);
    expect(CV_SRC).toMatch(/awv2-cv-bandsummary/);
    expect(CV_SRC).toMatch(/<summary>Full Market Research metrics<\/summary>/);
    expect(CV_SRC).toMatch(/Median DOM/);
    expect(CV_SRC).toMatch(/Sell-through/);
    expect(CV_SRC).toMatch(/Absorption/);
    expect(CV_SRC).toMatch(/Fastest band/);
    expect(CV_SRC).toMatch(/Snapshot/);
    expect(CV_SRC).toMatch(/never makes the property or the market unsuitable/);
  });
});

describe('one filtered record set drives both the list and the map', () => {
  it('offers every comparable role plus the context and excluded filters', () => {
    for (const label of ['Decision set', 'Direct', 'Supporting', 'Supplemental historical',
      'Boundary', 'Historical context', 'Active competitors', 'Improved context',
      'Other context', 'Excluded', 'All']) {
      expect(CV_SRC).toContain(`label: '${label}'`);
    }
    // The default view is the decision-relevant set, not everything at once.
    expect(CV_SRC).toMatch(/useState<FilterKey>\('decision'\)/);
    expect(CV_SRC).toMatch(/key: 'decision'[\s\S]{0,200}valuationRole === 'direct' \|\| c\.valuationRole === 'supporting'\)\) \|\| isActive\(c\)/);
  });

  it('passes the SAME filtered records to the map that the list renders', () => {
    expect(CV_SRC).toMatch(/const visible = useMemo\(\(\) => comps\.filter\(spec\.match\)/);
    expect(CV_SRC).toMatch(/<CombinedCompMap[\s\S]{0,300}comps=\{visible\}/);
    expect(CV_SRC).toMatch(/visible\.map\(\(c\) => \{/);
  });

  it('keeps the collapsed card compact and puts the evidence behind Full details', () => {
    expect(CV_SRC).toMatch(/Radius stage/);
    expect(CV_SRC).toMatch(/\$ \/ acre/);
    expect(CV_SRC).toMatch(/vs subject/);
    expect(CV_SRC).toMatch(/mo ago/);
    expect(CV_SRC).toMatch(/conciseReason\(c\)/);
    expect(CV_SRC).toMatch(/\{open \? 'Hide details' : 'Full details'\}/);
    expect(CV_SRC).toMatch(/awv2-cv-forensics/);
    // The expanded evidence now lives in CompFullDetails, which owns the
    // transaction/competition summary, timeline, descriptions and evidence.
    expect(CV_SRC).toMatch(/<CompFullDetails c=\{c\} adoptedFmv=\{cleaned\.adoptedFmv\} landBasis=/);
    expect(D_SRC).toMatch(/label="Valuation weight"/);
    expect(D_SRC).toMatch(/target="_blank" rel="noopener noreferrer"/);
    // Retrieval diagnostics were removed from the operator's Full details; the
    // original provider link is what survives, because it is the only piece of
    // provenance an operator uses to re-check a figure.
    expect(D_SRC).not.toMatch(/Image provenance:/);
    expect(D_SRC).not.toMatch(/Not supplied by the source/);
    expect(D_SRC).toMatch(/Open original listing/);
  });

  it('keeps include, exclude, and restore available and honest about who excluded', () => {
    expect(CV_SRC).toMatch(/Exclude…/);
    expect(CV_SRC).toMatch(/Restore to valuation/);
    expect(CV_SRC).toMatch(/Include in valuation/);
    expect(CV_SRC).toMatch(/Concise exclusion reason/);
    // A LandOS exclusion must never read as Tyler's own.
    expect(CV_SRC).toMatch(/exclusionActor === 'operator' \? 'Excluded by the operator' : 'Excluded by LandOS/);
  });

  it('reconciles retained versus mapped counts for every category', () => {
    expect(CV_SRC).toMatch(/awv2-cv-mapcounts/);
    expect(CV_SRC).toMatch(/mapCounts\.byCategory/);
    expect(CV_SRC).toMatch(/Retained vs mapped/);
    expect(CV_SRC).toMatch(/never guessed onto the map/);
  });
});

describe('every comparable carries a visual with stated provenance', () => {
  it('renders the server-resolved visual and always shows what it is', () => {
    expect(CV_SRC).toMatch(/<CompVisualThumb visual=\{c\.visual\} thumbnailUrl=\{c\.thumbnailUrl\}/);
    expect(THUMB_SRC).toMatch(/awv2-cv-prov/);
    // The chip states what the image IS, which is the honesty requirement. It
    // carries no native `title`: the browser rendered that as a second wide
    // white strip over the map underneath the real hover preview.
    expect(THUMB_SRC).not.toMatch(/title=\{visual\.detail\}/);
    // The map fallback is drawn from the same free OSM tiles as the comp map:
    // no new provider, no key, and it is never called a photograph.
    expect(THUMB_SRC).toMatch(/osmTileUrl/);
    expect(THUMB_SRC).toMatch(/map_fallback/);
    expect(THUMB_SRC).toMatch(/not a photograph of the property/);
    // The empty "No photo supplied" block is no longer the normal state.
    expect(CV_SRC).not.toMatch(/No photo supplied/);
    expect(CV_SRC).not.toMatch(/awv2-cv-thumb/);
  });

  it('shows one reconciled card with every contributing provider badge', () => {
    expect(CV_SRC).toMatch(/sourceBadges\(c\)\.map/);
    expect(CV_SRC).toMatch(/One property/);
    expect(CV_SRC).toMatch(/canonical accepted comps/);
    expect(CV_SRC).toMatch(/Improved-property context only/);
    expect(CV_SRC).toMatch(/Never included in the vacant-land pricing calculation/);
  });

  it('provides a lightweight multi-photo gallery without a new dependency', () => {
    expect(D_SRC).toMatch(/AcquisitionWorkspaceV2CompPhotoGallery/);
    expect(GALLERY_SRC).toMatch(/Previous comp photo/);
    expect(GALLERY_SRC).toMatch(/Next comp photo/);
    expect(GALLERY_SRC).toMatch(/Comp photo thumbnails/);
    expect(GALLERY_SRC).toMatch(/Compare clearing, terrain, road relationship, improvements, water, utilities/);
  });

  it('reports the visual provenance tallies to the operator', () => {
    expect(CV_SRC).toMatch(/visuals\.listingPhoto/);
    expect(CV_SRC).toMatch(/visuals\.providerThumbnail/);
    expect(CV_SRC).toMatch(/visuals\.parcelAerial/);
    expect(CV_SRC).toMatch(/visuals\.satelliteFallback/);
    expect(CV_SRC).toMatch(/visuals\.mapFallback/);
    expect(CV_SRC).toMatch(/visuals\.locationUnresolved/);
    expect(CV_SRC).toMatch(/a fallback is never labeled a listing photo/);
  });
});

describe('the Overview mirrors the same numbers', () => {
  it('reads the Comps & Valuation summary and deep-links into it', () => {
    expect(PAGE_SRC).toMatch(/const cvSummary = compsValuation\?\.summary \?\? null/);
    expect(PAGE_SRC).toMatch(/cvSummary\.basisLabel/);
    expect(PAGE_SRC).toMatch(/Open Comps &amp; Valuation →/);
    expect(PAGE_SRC).toMatch(/onOpenSection\('comps-valuation'\)/);
    expect(PAGE_SRC).toMatch(/cvSummary\?\.acquisitionLevels \? usd\(/);
  });
});

describe('styles the section within the V2 visual system', () => {
  it('keeps the shared comps styles and adds the workspace styles', () => {
    expect(PAGE_SRC).toMatch(/import '\.\.\/styles\/workspace-v2-comps\.css'/);
    expect(CSS_SRC).toMatch(/── Comps & Valuation ──/);
    for (const cls of ['awv2-cv-filter', 'awv2-cv-card', 'awv2-cv-actions',
      'awv2-cv-map-canvas', 'awv2-cv-unresolved', 'awv2-cv-forensics',
      'awv2-cv-decision', 'awv2-cv-window', 'awv2-cv-workspace', 'awv2-cv-list',
      'awv2-cv-mapcol', 'awv2-cv-visual', 'awv2-cv-prov', 'awv2-cv-marker',
      'awv2-cv-clusterrow', 'awv2-cv-ledger', 'awv2-cv-sourcebadges',
      'awv2-cv-improved-context', 'awv2-cvd-gallery']) {
      expect(CSS_SRC).toContain(`.${cls}`);
    }
  });

  it('stacks the map and list responsively without a fixed-width desktop-only layout', () => {
    expect(CSS_SRC).toMatch(/@media \(max-width: 1100px\) \{[\s\S]{0,400}\.awv2-cv-workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(CSS_SRC).toMatch(/\.awv2-cv-mapcol \{ position: sticky/);
    // Wide content scrolls inside its own container, never the page body.
    expect(CSS_SRC).toMatch(/\.awv2-cv-ledger,\s*\n\.awv2-cv-mapcount-table \{ display: block; overflow-x: auto/);
  });
});
