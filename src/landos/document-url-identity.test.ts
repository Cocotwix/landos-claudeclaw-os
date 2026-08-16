import { describe, expect, it } from 'vitest';

import { documentUrlIdentity, sameDocumentUrl } from './document-url-identity.js';

describe('documentUrlIdentity — one published document, one key', () => {
  it('reads the WordPress asset root and its alias as the same document', () => {
    // The measured case: Fairview serves its adopted regulations at both.
    expect(sameDocumentUrl(
      'https://www.fairview-tn.org/content/uploads/docs/FAIRVIEW-SUBDIVISION-REGULATIONS.pdf',
      'https://www.fairview-tn.org/wp-content/uploads/docs/FAIRVIEW-SUBDIVISION-REGULATIONS.pdf',
    )).toBe(true);
    expect(sameDocumentUrl(
      'https://www.fairview-tn.org/content/uploads/docs/Fairview_Subdivision_Regulations_Article8.pdf',
      'https://www.fairview-tn.org/wp-content/uploads/docs/Fairview_Subdivision_Regulations_Article8.pdf',
    )).toBe(true);
  });

  it('ignores the scheme, the www prefix and a trailing slash', () => {
    expect(sameDocumentUrl('http://example.gov/a/b.pdf', 'https://example.gov/a/b.pdf')).toBe(true);
    expect(sameDocumentUrl('https://www.example.gov/a/b.pdf', 'https://example.gov/a/b.pdf')).toBe(true);
    expect(sameDocumentUrl('https://example.gov/regs/', 'https://example.gov/regs')).toBe(true);
    expect(sameDocumentUrl('https://example.gov/a/b.pdf#page=4', 'https://example.gov/a/b.pdf')).toBe(true);
  });

  it('keeps genuinely different documents apart', () => {
    expect(sameDocumentUrl(
      'https://example.gov/content/uploads/Article2.pdf',
      'https://example.gov/content/uploads/Article8.pdf',
    )).toBe(false);
    // A different government publishing the same file name is a different set.
    expect(sameDocumentUrl('https://a.gov/docs/regs.pdf', 'https://b.gov/docs/regs.pdf')).toBe(false);
    // A query routinely selects one document out of many.
    expect(sameDocumentUrl('https://example.gov/view?doc=12', 'https://example.gov/view?doc=13')).toBe(false);
    // Most servers treat a path as case-sensitive; folding it would merge two files.
    expect(sameDocumentUrl('https://example.gov/docs/Regs.pdf', 'https://example.gov/docs/regs.pdf')).toBe(false);
  });

  it('has no identity for a value that is not an http(s) URL', () => {
    for (const value of [null, undefined, '', '   ', 'not a url', 'ftp://example.gov/a.pdf', 'file:///a.pdf']) {
      expect(documentUrlIdentity(value as never)).toBe('');
    }
    // An absent identity never matches, so nothing collapses onto nothing.
    expect(sameDocumentUrl(null, null)).toBe(false);
    expect(sameDocumentUrl('', '')).toBe(false);
  });
});
