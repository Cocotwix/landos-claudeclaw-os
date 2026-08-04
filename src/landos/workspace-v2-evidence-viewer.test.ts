// Acquisition Workspace V2 — same-page evidence viewer contract.
//
// Clicking Property Intelligence evidence must open an in-page lightbox (no
// separate page, no new tab) with zoom in/out/reset, wheel zoom, pointer
// panning, previous/next, category + caption + source, an obvious close
// control, and Escape — without adding an image library dependency.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PI_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
  'utf8',
);
const CSS_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/styles/workspace-v2.css'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
};

describe('V2 evidence images open in a same-page viewer', () => {
  it('gallery thumbnails no longer target a separate page or tab', () => {
    // The old pattern wrapped each image in <a target="_blank"> to the raw file.
    expect(PI_SRC).not.toMatch(/full size \(new tab\)/);
    expect(PI_SRC).not.toMatch(/<a href=\{tok\(/);
    expect(PI_SRC).toMatch(/awv2-gallery-open/);
    expect(PI_SRC).toMatch(/setViewerIndex\(index\)/);
  });

  it('renders a modal dialog over the workspace instead of navigating', () => {
    expect(PI_SRC).toMatch(/role="dialog"/);
    expect(PI_SRC).toMatch(/aria-modal="true"/);
    expect(PI_SRC).not.toMatch(/window\.open|location\.href\s*=/);
  });

  it('supports zoom in, zoom out, reset to fit, wheel zoom, and pointer panning', () => {
    expect(PI_SRC).toMatch(/zoomIn/);
    expect(PI_SRC).toMatch(/zoomOut/);
    expect(PI_SRC).toMatch(/resetView/);
    expect(PI_SRC).toMatch(/onWheel/);
    expect(PI_SRC).toMatch(/onPointerDown/);
    expect(PI_SRC).toMatch(/onPointerMove/);
    expect(PI_SRC).toMatch(/translate\(\$\{offset\.x\}px, \$\{offset\.y\}px\) scale\(\$\{scale\}\)/);
    expect(PI_SRC).toMatch(/VIEWER_MAX_SCALE/);
  });

  it('supports previous/next navigation across the whole gallery in order', () => {
    expect(PI_SRC).toMatch(/\(indexRef\.current - 1 \+ items\.length\) % items\.length/);
    expect(PI_SRC).toMatch(/\(indexRef\.current \+ 1\) % items\.length/);
    expect(PI_SRC).toMatch(/ArrowLeft/);
    expect(PI_SRC).toMatch(/ArrowRight/);
  });

  it('shows category, caption, and source metadata', () => {
    expect(PI_SRC).toMatch(/class="cat">\{item\.kind\}/);
    expect(PI_SRC).toMatch(/class="cap">\{item\.label\}/);
    expect(PI_SRC).toMatch(/item\.sourceType/);
    expect(PI_SRC).toMatch(/item\.sourceUrl/);
  });

  it('closes with an obvious control and with Escape, keeping focus usable', () => {
    expect(PI_SRC).toMatch(/awv2-viewer-close/);
    expect(PI_SRC).toMatch(/'Escape'/);
    expect(PI_SRC).toMatch(/closeRef\.current\?\.focus\(\)/);
    expect(PI_SRC).toMatch(/removeEventListener\('keydown'/);
  });

  it('keeps the image aspect ratio and fills most of the viewport', () => {
    expect(CSS_SRC).toMatch(/\.awv2-viewer\s*\{[^}]*position:\s*fixed/);
    expect(CSS_SRC).toMatch(/\.awv2-viewer-stage img\s*\{[^}]*object-fit:\s*contain/);
    expect(CSS_SRC).toMatch(/margin:\s*2\.5vh 2\.5vw/);
  });

  it('adds no new image library dependency', () => {
    const deps = Object.keys({ ...PKG.dependencies, ...PKG.devDependencies }).join(' ');
    expect(deps).not.toMatch(/photoswipe|lightbox|viewerjs|react-zoom|panzoom|pinch|yet-another/i);
  });
});
