import { describe, expect, it } from 'vitest';

import { readSection, sectionHref, SECTION_SLUGS } from './workspace-v2-nav';

describe('workspace V2 section navigation', () => {
  it('derives the section from the URL, defaulting to Overview', () => {
    expect(readSection('')).toBe('Overview');
    expect(readSection('?deal=81')).toBe('Overview');
    expect(readSection('?deal=81&section=property-intelligence')).toBe('Property Intelligence');
    expect(readSection('?section=property-intelligence&deal=81')).toBe('Property Intelligence');
    expect(readSection('?deal=81&section=unknown-section')).toBe('Overview');
  });

  it('builds section hrefs that preserve every other query param', () => {
    expect(sectionHref('/dept/acquisitions/v2', '?deal=81', 'property-intelligence'))
      .toBe('/dept/acquisitions/v2?deal=81&section=property-intelligence');
    expect(sectionHref('/dept/acquisitions/v2', '?deal=81&section=property-intelligence', 'overview'))
      .toBe('/dept/acquisitions/v2?deal=81');
  });

  it('keeps Overview as the canonical bare URL (no section param)', () => {
    expect(sectionHref('/dept/acquisitions/v2', '', 'overview')).toBe('/dept/acquisitions/v2');
    expect(sectionHref('/dept/acquisitions/v2', '?section=property-intelligence', 'overview'))
      .toBe('/dept/acquisitions/v2');
  });

  it('round-trips every real section through href and back', () => {
    for (const [label, slug] of Object.entries(SECTION_SLUGS)) {
      const href = sectionHref('/dept/acquisitions/v2', '?deal=81', slug);
      const search = href.includes('?') ? href.slice(href.indexOf('?')) : '';
      expect(readSection(search)).toBe(label);
    }
  });
});
