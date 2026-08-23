import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Tight markdown renderer for chat. GFM (tables, code fences, autolinks)
// without anything that could phone home (no images by default — those
// rarely appear in chat replies and are an XSS vector).
// External links (https?://) get target="_blank" rel="noopener noreferrer"
// so they open in a new tab rather than navigating away from the dashboard.
// Internal /api/ links stay ordinary same-origin URLs; the HttpOnly browser
// session authenticates direct clicks without placing a credential in href.

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

marked.use({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const isExternal = !!href && /^https?:\/\//i.test(href);
      const resolvedHref = href;
      const titleAttr = title ? ` title="${escAttr(title)}"` : '';
      const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escAttr(resolvedHref)}"${titleAttr}${targetAttr}>${text}</a>`;
    },
  },
});

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark',
    'a', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export function renderMarkdown(text: string): string {
  if (!text) return '';
  const raw = marked.parse(text) as string;
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
