// Full details, closed vs active — layout and readability contract.
//
// A closed sale and an active listing answer different questions, so the
// expanded block is not one generic field dump. The closed layout leads with the
// verified sold price and how long the parcel took to sell; the active layout
// leads with the ask and how long the market has refused it. Three honesty rules
// are structural rather than cosmetic: a pending-price proxy is labeled an
// estimate wherever it appears, the source description never merges into the
// LandOS summary, and retrieval diagnostics never appear in the layout the
// operator uses to decide what to offer.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const D_SRC = read('web/src/components/AcquisitionWorkspaceV2CompDetails.tsx');
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
const GALLERY_SRC = read('web/src/components/AcquisitionWorkspaceV2CompPhotoGallery.tsx');
const CSS_SRC = read('web/src/styles/workspace-v2-comps.css');
// Source provenance badges live with the shared comp identity, so every surface
// showing a record names the same providers for it.
const IDENTITY_SRC = read('web/src/components/CompRecordIdentity.tsx');

describe('the Full details control is preserved and drives the new block', () => {
  it('still toggles per record and now renders CompFullDetails', () => {
    expect(CV_SRC).toMatch(/setExpandedKey\(open \? null : c\.key\)/);
    expect(CV_SRC).toMatch(/\{open \? 'Hide details' : 'Full details'\}/);
    expect(CV_SRC).toMatch(/<CompFullDetails c=\{c\} adoptedFmv=\{cleaned\.adoptedFmv\} landBasis=/);
  });

  it('opens the same block from the map popup', () => {
    expect(CV_SRC).toMatch(/onOpenDetails=\{\(key\) => \{ setExpandedKey\(key\); selectFromMap\(key\); \}\}/);
  });
});

describe('sold comparable full details', () => {
  it('shows the required SALE SUMMARY figures', () => {
    expect(D_SRC).toMatch(/title="SALE SUMMARY"/);
    for (const label of [
      'Sold date', 'Original listing date', 'Original list price',
      'LandOS cumulative days on market', 'Provider days on market',
      'Listing episodes', 'Price reductions before sale',
    ]) {
      expect(D_SRC).toContain(`label="${label}"`);
    }
    // The price and per-acre labels come from the projection, so a proxy renames
    // itself rather than being hard-coded as a sold price.
    expect(D_SRC).toMatch(/label=\{l\?\.price\.amountLabel \?\? 'Sold price'\}/);
    expect(D_SRC).toMatch(/label=\{l\?\.price\.perAcreLabel \?\? 'Sold price per acre'\}/);
    expect(D_SRC).toMatch(/Price reductions before sale:/);
  });

  it('emphasises sold price, sold date, per-acre and cumulative DOM', () => {
    // `strong` is what makes a figure read first; these are the deciding ones.
    expect(D_SRC).toMatch(/label=\{l\?\.price\.amountLabel \?\? 'Sold price'\}[\s\S]{0,80}strong/);
    expect(D_SRC).toMatch(/label="Sold date"[\s\S]{0,80}strong/);
    expect(D_SRC).toMatch(/label="LandOS cumulative days on market"[\s\S]{0,120}strong/);
  });

  it('renders comparability rather than competition analysis', () => {
    expect(D_SRC).toMatch(/title="COMPARABILITY"/);
    expect(D_SRC).toMatch(/isActive \? <CompetitionAnalysis c=\{c\} adoptedFmv=\{adoptedFmv\} landBasis=\{landBasis\} \/> : <Comparability c=\{c\} \/>/);
    for (const label of ['Role', 'Valuation weight', 'Distance from subject', 'Acreage difference']) {
      expect(D_SRC).toContain(`label="${label}"`);
    }
  });

  it('composes the sections in the required operator order', () => {
    for (const t of ['SALE SUMMARY', 'PHOTOS', 'LISTING DESCRIPTION',
      'LISTING TIMELINE', 'COMPARABILITY', 'SOURCE']) {
      expect(D_SRC).toContain(`title="${t}"`);
    }
    // The LandOS notes heading is chosen at render time, so it is a bound
    // expression rather than a literal attribute.
    expect(D_SRC).toContain("'LANDOS COMPETITION NOTES' : 'LANDOS COMP NOTES'");
    // Section components are DECLARED before the layout that composes them, so
    // it is the composed order that has to be asserted, not the declarations.
    const composed = ['<Photos c={c} />', '<ListingDescription c={c} />',
      '<LandosNotes c={c} active={isActive} />', '<Timeline c={c} />', '<Source c={c} />'];
    const at = composed.map((frag) => D_SRC.indexOf(frag));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});

describe('active competitor full details', () => {
  it('shows the required CURRENT COMPETITION figures', () => {
    expect(D_SRC).toMatch(/title="CURRENT COMPETITION"/);
    for (const label of [
      'Current asking price', 'Current asking price per acre', 'Original listing date',
      'Original list price', 'Current listing episode', 'Provider days on market',
      'LandOS cumulative active market days', 'Listing episodes', 'Listing freshness',
    ]) {
      expect(D_SRC).toContain(`label="${label}"`);
    }
    expect(D_SRC).toMatch(/Price reductions:/);
    expect(D_SRC).toMatch(/Pending \/ back-on-market history:/);
  });

  it('keeps the provider figure and the LandOS figure side by side', () => {
    expect(D_SRC).toMatch(/label="Provider days on market"/);
    expect(D_SRC).toMatch(/label="LandOS cumulative active market days"/);
    // The LandOS figure is flagged when it exceeds the provider's counter.
    expect(D_SRC).toMatch(/warn=\{m\?\.cumulativeDays != null && m\.providerDaysOnMarket != null && m\.cumulativeDays > m\.providerDaysOnMarket\}/);
  });

  it('analyses the competition against the adopted FMV, acreage and exposure', () => {
    expect(D_SRC).toMatch(/title="COMPETITION ANALYSIS"/);
    expect(D_SRC).toMatch(/ABOVE the \$\{valueLabel\}/);
    expect(D_SRC).toMatch(/BELOW the \$\{valueLabel\}/);
    expect(D_SRC).toMatch(/landBasis \? 'adopted cleaned land value' : 'adopted cleaned FMV'/);
    expect(D_SRC).toMatch(/Exposed to the market for/);
    expect(D_SRC).toMatch(/met buyer resistance/);
    expect(D_SRC).toMatch(/'larger' : 'smaller'/);
    expect(D_SRC).toMatch(/never enters the cleaned sold-price calculations/);
    expect(D_SRC).toMatch(/Land-basis comparison only/);
  });

  it('names the LandOS notes section for competition rather than comparability', () => {
    expect(D_SRC).toMatch(/active \? 'LANDOS COMPETITION NOTES' : 'LANDOS COMP NOTES'/);
  });
});

describe('listing timeline', () => {
  it('renders every dated event with its own kind styling', () => {
    expect(D_SRC).toMatch(/title="LISTING TIMELINE"/);
    for (const kind of ['listed', 'price_change', 'withdrawn', 'relisted', 'pending', 'back_on_market', 'sold']) {
      expect(D_SRC).toContain(`${kind}:`);
      expect(CSS_SRC).toContain(`.awv2-cvd-timeline li.ev-${kind}`);
    }
    expect(D_SRC).toMatch(/class=\{`ev-\$\{r\.kind\}`\}/);
  });

  it('states relist stitching and stitch uncertainty instead of hiding them', () => {
    expect(D_SRC).toMatch(/Relist stitching applied/);
    expect(D_SRC).toMatch(/Relist stitching uncertain\. Earlier episodes are shown but are NOT merged/);
  });

  it('says plainly when no timeline could be recovered', () => {
    expect(D_SRC).toMatch(/The source published no dated listing events for this record/);
  });
});

describe('listing description and LandOS notes are separate sections', () => {
  it('gives the source description its own section with its own attribution', () => {
    expect(D_SRC).toMatch(/title="LISTING DESCRIPTION"/);
    expect(D_SRC).toMatch(/\{d\.source\.attribution\}\. \{d\.source\.note\}/);
    expect(D_SRC).toMatch(/The source page published no property description for this record/);
  });

  it('presents marketing claims AS claims, never as verified facts', () => {
    expect(D_SRC).toMatch(/Listing claims \(not verified by LandOS\)/);
    expect(D_SRC).toMatch(/independently confirmed/);
    expect(D_SRC).toMatch(/<b>Verified by LandOS:<\/b>/);
    expect(D_SRC).toMatch(/<b>Unresolved:<\/b>/);
  });
});

describe('comp photographs are browsable underwriting evidence', () => {
  it('renders the lane-owned lightweight gallery from Full details', () => {
    expect(D_SRC).toMatch(/<AcquisitionWorkspaceV2CompPhotoGallery/);
    expect(GALLERY_SRC).toMatch(/photos\.map/);
    expect(GALLERY_SRC).toMatch(/setIndex/);
    expect(GALLERY_SRC).toMatch(/Open original listing/);
    expect(GALLERY_SRC).toMatch(/another property&apos;s photo is never substituted/);
  });

  it('shows merged providers as provenance on the canonical property record', () => {
    // The badges are the shared component, so the card, the map popup and this
    // panel can never name different providers for the same record.
    expect(D_SRC).toMatch(/<CompProvenanceBadges c=\{c\} className="awv2-cvd-sourcebadges" \/>/);
    expect(IDENTITY_SRC).toMatch(/Reconciled source provenance/);
    expect(IDENTITY_SRC).toMatch(/One property/);
    expect(IDENTITY_SRC).toMatch(/compProviders\(c\)/);
    // Full details states what the merge actually did, in the server's words.
    expect(D_SRC).toMatch(/c\.mergeStatus/);
    expect(D_SRC).toMatch(/nothing was merged into this record/);
  });
});

describe('retrieval diagnostics are gone from the operator layout', () => {
  it('drops the EVIDENCE dump and every diagnostic string it carried', () => {
    expect(D_SRC).not.toMatch(/title="EVIDENCE"/);
    for (const gone of [
      'Image provenance:', 'reconciled to the exact property on', 'Retrieval limitation:',
      'label="Coordinates"', 'unresolved — never guessed', 'Not supplied by the source',
      'capturedAtIso', 'imageProvenance', 'missingFields',
    ]) {
      expect(D_SRC).not.toContain(gone);
    }
    // Raw coordinates and the resolution method left the card body too.
    expect(CV_SRC).not.toMatch(/awv2-cv-locfacts/);
    expect(CV_SRC).not.toMatch(/provider map point' : 'address geocode/);
  });

  it('keeps the original provider link, which is the provenance actually used', () => {
    expect(D_SRC).toMatch(/title="SOURCE"/);
    expect(D_SRC).toMatch(/label="Source"/);
    expect(D_SRC).toMatch(/Open original listing/);
    expect(D_SRC).toMatch(/href=\{c\.sourceUrl\} target="_blank" rel="noopener noreferrer"/);
  });

  it('still retains the diagnostics on the projection for audit', () => {
    expect(CV_SRC).toMatch(/diagnostics: \{/);
    expect(CV_SRC).toMatch(/NEVER rendered in Full details/);
  });
});

describe('an estimated price proxy is never allowed to read as a verified sale', () => {
  it('shows the proxy note in full details, on the card and in the map popup', () => {
    expect(D_SRC).toMatch(/\{proxy && \(/);
    expect(D_SRC).toMatch(/awv2-cvd-proxy/);
    expect(D_SRC).toMatch(/const proxy = l\?\.price\.confidence === 'estimated_proxy'/);
    expect(CV_SRC).toMatch(/c\.listing\?\.price\.confidence === 'estimated_proxy'/);
    expect(CV_SRC).toMatch(/an estimate, not a verified sale price\. Reduced transaction price confidence\./);
    expect(CSS_SRC).toMatch(/\.awv2-cv-proxy,\s*\n\.awv2-cvd-proxy/);
  });
});

describe('readability correction', () => {
  it('raises card, figure, address, popup and details type sizes', () => {
    // The override block is loaded last, so the LAST declaration of a selector
    // is the one that actually applies. Reading the first would let a raised
    // size pass a test while the browser renders the older, smaller one.
    // The selector must be matched EXACTLY, up to the opening brace. A loose
    // match reads `.awv2-cvd-timeline li .s` as `.awv2-cvd-timeline li` and
    // reports a child's small caption size as the row's size.
    const size = (selector: string, prop = 'font-size') => {
      const rx = new RegExp(`(?:^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*${prop}:\\s*([\\d.]+)px`, 'gm');
      let last: number | null = null;
      for (const m of CSS_SRC.matchAll(rx)) last = Number(m[1]);
      return last;
    };
    // Nothing key drops below ~12.5px, and the deciding figures are far larger.
    expect(size('.awv2-cv-head .addr')!).toBeGreaterThanOrEqual(17);
    expect(size('.awv2-cv-figs .f')!).toBeGreaterThanOrEqual(13);
    expect(size('.awv2-cv-figs b')!).toBeGreaterThanOrEqual(15);
    expect(size('.awv2-cv-figs .f.lead b')!).toBeGreaterThanOrEqual(18);
    expect(size('.awv2-cv-why')!).toBeGreaterThanOrEqual(13.5);
    expect(size('.awv2-cv-filter')!).toBeGreaterThanOrEqual(13);
    expect(size('.awv2-cv-link')!).toBeGreaterThanOrEqual(13);
    expect(size('.awv2-cv-map-detail .grid span')!).toBeGreaterThanOrEqual(13.5);
    expect(size('.awv2-cvd-body')!).toBeGreaterThanOrEqual(14);
    expect(size('.awv2-cvd-fig .v')!).toBeGreaterThanOrEqual(15);
    expect(size('.awv2-cvd-fig.strong .v')!).toBeGreaterThanOrEqual(18);
    expect(size('.awv2-cvd-timeline li')!).toBeGreaterThanOrEqual(13);
    expect(size('.awv2-cvd-descbody')!).toBeGreaterThanOrEqual(14);
    // Control labels and filter chips are read as often as the figures are.
    expect(size('.awv2-cv-modes button')!).toBeGreaterThanOrEqual(12.5);
    expect(size('.awv2-cv-overlaybtn')!).toBeGreaterThanOrEqual(12);
    expect(size('.awv2-cv-expandbtn')!).toBeGreaterThanOrEqual(12);
  });

  it('adds vertical separation between the detail sections', () => {
    expect(CSS_SRC).toMatch(/\.awv2-cvd \{[^}]*gap: 2\dpx/);
    expect(CSS_SRC).toMatch(/\.awv2-cvd-section \{[^}]*border-top: 1px solid[^}]*padding-top: 1\dpx/);
    expect(CSS_SRC).toMatch(/\.awv2-cvd-h \{[^}]*letter-spacing: 0\.1\de?m?/);
  });

  it('preserves the unified layout, the responsive behaviour, and adds no duplicate comp list', () => {
    // One list, one map, one filtered set — unchanged by this sprint.
    expect(CV_SRC).toMatch(/One list · one map · same filtered records/);
    expect(CV_SRC).toMatch(/comps=\{visible\}/);
    expect((CV_SRC.match(/visible\.map\(\(c\) => \{/g) ?? [])).toHaveLength(1);
    expect(CSS_SRC).toMatch(/@media \(max-width: 760px\)/);
    // Wide detail content stays inside its own scroller.
    expect(CSS_SRC).toMatch(/overflow-wrap: anywhere/);
  });
});
