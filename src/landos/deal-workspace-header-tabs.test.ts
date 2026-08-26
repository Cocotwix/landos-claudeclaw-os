// Deal Workspace — pages in the header, full-width body.
//
// The seven deal pages moved out of a permanent vertical sidebar into the deal
// header row. Routing, selected-page state and record identity are unchanged;
// only the placement moved, so the deal body reclaims the full page width.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync('web/src/pages/AcquisitionWorkspaceV2.tsx', 'utf8');
const OVERVIEW = readFileSync('web/src/components/AcquisitionWorkspaceV2Overview.tsx', 'utf8');
const LEAD_CSS = readFileSync('web/src/styles/workspace-v2-lead-design.css', 'utf8');
const OVERVIEW_CSS = readFileSync('web/src/styles/workspace-v2-overview.css', 'utf8');

describe('Deal Workspace header tabs', () => {
  it('renders all seven deal pages inside the header row', () => {
    const header = PAGE.slice(PAGE.indexOf('<header class="awv2-header">'), PAGE.indexOf('</header>'));
    expect(header).toContain('awv2-deal-tabs');
    expect(header).toContain('DEAL_PAGES.map');
    for (const slug of ['overview', 'property', 'market', 'comps', 'strategy', 'seller', 'documents']) {
      expect(PAGE).toContain(`'${slug}'`);
    }
  });

  it('keeps routing, selected state and record identity on every tab', () => {
    // Same href builder, same click handler, same aria-current as before the move.
    expect(PAGE).toContain('href={pageHref(window.location.pathname, window.location.search, entry.slug)}');
    expect(PAGE).toContain("onClick={(e) => switchPage(e as unknown as MouseEvent, entry.slug)}");
    expect(PAGE).toContain("aria-current={page === entry.slug ? 'page' : undefined}");
    expect(PAGE).toContain("data-testid={`deal-nav-${entry.slug}`}");
  });

  it('removes the vertical sidebar and gives the body the full width', () => {
    expect(PAGE).not.toContain('awv2-deal-sidebar');
    expect(LEAD_CSS).toContain('.awv2-deal-layout { display: block; }');
  });

  it('leads the map overlay with property type and acreage, not address or APN', () => {
    expect(OVERVIEW).toContain('const railPropertyType');
    expect(OVERVIEW).toContain("'Land + Manufactured'");
    expect(OVERVIEW).toContain("'Land + Home'");
    expect(OVERVIEW).toContain("'Vacant Land'");
    expect(OVERVIEW).toContain('<h2>{railHeading}</h2>');
    // The overlay no longer repeats the page heading's address and APN.
    expect(OVERVIEW).not.toContain("{identity.apn ? ` · APN ${identity.apn}` : ''}");
  });

  it('narrows the map overlay without shrinking its headings', () => {
    const rail = OVERVIEW_CSS.slice(OVERVIEW_CSS.lastIndexOf('.awv2-hero-rail { width:'));
    expect(rail).toContain('width: min(272px, 30%)');
    // Headings stay bold and bright: the panel got narrower, not smaller.
    expect(rail).toContain('font-size: 11.5px; font-weight: 800;');
  });

  it('shows every retained visual complete instead of cropping it', () => {
    const OVERVIEW_CSS2 = readFileSync('web/src/styles/workspace-v2-overview.css', 'utf8');
    // Contain, centered: the whole capture is visible and its aspect ratio is
    // preserved; a mismatched capture letterboxes rather than losing content.
    expect(OVERVIEW_CSS2).toContain('.awv2-hero-stage > img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }');
    expect(OVERVIEW_CSS2).not.toMatch(/\.awv2-hero-stage > img \{[^}]*object-fit: cover/);
  });

  it('neons only the subject outline, not amber neighbours or the map pin', () => {
    // Color isolation: pure red only. Amber neighbour lines score near zero on
    // the R-G-B channel, so the steep threshold drops them.
    expect(OVERVIEW).toContain('1 -1 -1 0 0');
    expect(OVERVIEW).toContain('slope="14" intercept="-7"');
    // Shape isolation: an opening isolates the solid map pin so it can be
    // subtracted from the mask and left in its original color.
    expect(OVERVIEW).toContain('operator="erode"');
    // Measured against the retained capture: erode 3 / dilate 7 removes the
    // pin completely (0 pin pixels left in the mask) while keeping the whole
    // boundary (7,661 line pixels retained).
    expect(OVERVIEW).toContain('operator="dilate" radius="7"');
    expect(OVERVIEW).toContain('in="subject" in2="blob" operator="out"');
  });

  it('recolors the retained subject outline instead of redrawing it', () => {
    expect(OVERVIEW).toContain('id="landos-subject-neon"');
    expect(OVERVIEW).toContain('flood-color="#39ff88"');
    expect(OVERVIEW).toContain('flood-color="#eafff1"');
    expect(OVERVIEW_CSS).toContain('filter: url(#landos-subject-neon)');
    // A pixel treatment only: no geometry read, fetch, or derivation.
    expect(OVERVIEW).not.toMatch(/fetch\(|apiPost/);
  });
});
