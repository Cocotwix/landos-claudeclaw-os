// Browser Training — per-field selector capture (deterministic, testable).
//
// When Tyler says "this is road frontage" while pointing at a value on the page,
// we bind that canonical field to a DOM element: a stable CSS selector plus the
// nearby label so replay/live execution can extract the value (selector first,
// label-match fallback) and write it to the Deal Card with provenance.
//
// This module holds the pure logic (phrase → field, element info → selector +
// confidence, extraction fallback) and the browser-eval script builders. It does
// no I/O so it is fully unit-testable without a browser.

export type CanonicalField =
  | 'owner'
  | 'apn'
  | 'acreage'
  | 'road_frontage'
  | 'landlocked'
  | 'wetlands'
  | 'fema_flood'
  | 'buildability'
  | 'slope'
  | 'valuation'
  | 'sidebar_counts';

export const LANDPORTAL_FIELDS: CanonicalField[] = [
  'owner', 'apn', 'acreage', 'road_frontage', 'landlocked',
  'wetlands', 'fema_flood', 'buildability', 'slope', 'valuation', 'sidebar_counts',
];

export const FIELD_LABELS: Record<CanonicalField, string> = {
  owner: 'Owner',
  apn: 'APN',
  acreage: 'Acreage',
  road_frontage: 'Road Frontage',
  landlocked: 'Landlocked',
  wetlands: 'Wetlands',
  fema_flood: 'FEMA Flood Zone',
  buildability: 'Buildability',
  slope: 'Slope',
  valuation: 'Valuation',
  sidebar_counts: 'Sidebar Counts',
};

// Spoken aliases per field. Longer/multiword aliases are matched first so
// "road frontage" wins over the bare "frontage", and "flood zone" over "zone".
export const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  owner: ['owner name', 'land owner', 'landowner', 'owner'],
  apn: ['assessor parcel number', 'parcel number', 'parcel id', 'apn', 'ain'],
  acreage: ['lot size', 'parcel size', 'acreage', 'acres', 'size'],
  road_frontage: ['road frontage', 'street frontage', 'frontage'],
  landlocked: ['land locked', 'landlocked', 'road access', 'access'],
  wetlands: ['wetlands', 'wetland', 'nwi'],
  fema_flood: ['fema flood zone', 'flood zone', 'floodplain', 'flood plain', 'fema', 'flood'],
  buildability: ['buildability', 'buildable area', 'buildable', 'build score'],
  slope: ['terrain slope', 'slope', 'grade'],
  valuation: ['estimated value', 'market value', 'assessed value', 'valuation', 'value', 'price'],
  sidebar_counts: ['sidebar counts', 'result count', 'results count', 'parcel count', 'record count', 'count'],
};

// Phrases that signal Tyler is BINDING a field (not just mentioning it). A
// binding needs both a cue and a field alias, to avoid false positives.
const BINDING_CUES: RegExp[] = [
  /\bthis is\b/i,
  /\bthat['’]?s\b/i,
  /\bthat is\b/i,
  /\bhere['’]?s\b/i,
  /\bhere is\b/i,
  /\bmark (?:this|that) as\b/i,
  /\b(?:this|that) (?:shows|field is|is the)\b/i,
  /\bcapture (?:this|the)\b/i,
];

export interface FieldPhraseMatch {
  field: CanonicalField;
  alias: string;
  /** Confidence in the SPEECH→field mapping (not the selector). */
  matchConfidence: 'high' | 'medium';
}

/** Detect a field-binding instruction in an operator utterance. */
export function matchFieldPhrase(text: string): FieldPhraseMatch | null {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return null;
  if (!BINDING_CUES.some((re) => re.test(t))) return null;

  let best: FieldPhraseMatch | null = null;
  let bestLen = 0;
  for (const field of LANDPORTAL_FIELDS) {
    for (const alias of FIELD_ALIASES[field]) {
      if (containsPhrase(t, alias) && alias.length > bestLen) {
        best = { field, alias, matchConfidence: alias.includes(' ') ? 'high' : 'medium' };
        bestLen = alias.length;
      }
    }
  }
  return best;
}

function containsPhrase(haystack: string, needle: string): boolean {
  // Word-boundary-ish match so "size" doesn't match "capsize".
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(haystack);
}

// ── Selector building ────────────────────────────────────────────────

export interface DomElementInfo {
  /** A selector the capture side already computed (e.g. from a real click). */
  selector?: string;
  id?: string;
  tag?: string;
  classes?: string[];
  /** data-testid / data-field / data-qa value, if present. */
  testId?: string;
  testAttr?: string;
  /** The element's own text — the field VALUE. */
  text?: string;
  /** Nearby label text. */
  labelText?: string;
}

export type SelectorStrategy = 'provided' | 'testid' | 'id' | 'label' | 'class';

export interface FieldSelectorEntry {
  selector: string;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  strategy: SelectorStrategy;
}

/** An id is stable enough to target if it isn't obviously framework-generated. */
export function isStableId(id: string | undefined): boolean {
  if (!id) return false;
  if (!/^[A-Za-z][\w-]{1,60}$/.test(id)) return false;
  if (/\d{4,}/.test(id)) return false; // long numeric runs → generated
  if (/^(?:ember|react|:r|radix-|mui-|headlessui-)/i.test(id)) return false;
  return true;
}

function shapeConfidence(selector: string): 'high' | 'medium' | 'low' {
  if (selector.startsWith('#')) return 'high';
  if (selector.startsWith('[data-')) return 'high';
  if (/^\.[\w-]+(\.[\w-]+)+/.test(selector)) return 'medium'; // multi-class
  if (selector.startsWith('.')) return 'low';
  return 'medium';
}

/**
 * Build the best selector entry for a captured element. Priority: an explicit
 * provided selector → data-testid → stable id → label anchor → class. Returns
 * null only when there is nothing at all to anchor on.
 */
export function bestSelector(info: DomElementInfo, fallbackLabel = ''): FieldSelectorEntry | null {
  const observed = (info.labelText || '').trim();
  const label = observed || (fallbackLabel || '').trim();

  if (info.selector && info.selector.trim()) {
    const sel = info.selector.trim();
    return { selector: sel, label, confidence: shapeConfidence(sel), strategy: 'provided' };
  }
  if (info.testId && info.testId.trim()) {
    const attr = info.testAttr || 'data-testid';
    return { selector: `[${attr}="${cssEscape(info.testId)}"]`, label, confidence: 'high', strategy: 'testid' };
  }
  if (isStableId(info.id)) {
    return { selector: `#${cssEscape(info.id!)}`, label, confidence: 'high', strategy: 'id' };
  }
  // A REAL observed label is a robust anchor — prefer it over brittle classes.
  if (observed) {
    return { selector: '', label: observed, confidence: 'medium', strategy: 'label' };
  }
  if (info.classes && info.classes.length) {
    const sel = '.' + info.classes.slice(0, 3).map(cssEscape).join('.');
    return { selector: sel, label, confidence: shapeConfidence(sel), strategy: 'class' };
  }
  // Nothing on the element itself — fall back to a generic label match.
  if (label) {
    return { selector: '', label, confidence: 'low', strategy: 'label' };
  }
  return null;
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

// ── Extraction fallback (pure) ───────────────────────────────────────

export interface ExtractionChoice { value: string; strategy: 'selector' | 'label' | 'none' }

/** Prefer the selector-read value; fall back to the label-read value. */
export function chooseExtraction(selectorValue: string | null | undefined, labelValue: string | null | undefined): ExtractionChoice {
  const s = (selectorValue || '').trim();
  if (s) return { value: s, strategy: 'selector' };
  const l = (labelValue || '').trim();
  if (l) return { value: l, strategy: 'label' };
  return { value: '', strategy: 'none' };
}

// ── Browser-eval script builders ─────────────────────────────────────
// Each returns a JS expression string for page.evaluate. They are kept small,
// read-only, and never touch storage/cookies.

/** Read the trimmed textContent of a selector. */
export function selectorTextScript(selector: string): string {
  return `(document.querySelector(${JSON.stringify(selector)})?.textContent || '').trim()`;
}

/**
 * Find a value by its nearby label. Marker "LABELVALUE" lets test fakes tell this
 * apart from a plain selector read. Strategy: locate an element whose text equals/
 * starts with the label, then read its sibling/next value node.
 */
export function labelValueScript(label: string): string {
  const lbl = JSON.stringify(label.toLowerCase());
  return `(() => { /* LABELVALUE */
    const want = ${lbl};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const els = Array.from(document.querySelectorAll('label,dt,th,span,div,strong,b,td'));
    for (const el of els) {
      const txt = norm(el.textContent);
      if (txt === want || txt.startsWith(want + ':') || txt === want + ':') {
        const sib = el.nextElementSibling;
        if (sib && norm(sib.textContent)) return norm(sib.textContent);
        const parentTxt = norm(el.parentElement && el.parentElement.textContent);
        if (parentTxt && parentTxt !== want) return parentTxt.replace(want, '').replace(/^[:\\s]+/, '').trim();
      }
    }
    return '';
  })()`;
}

/** Probe a clicked element and return its DomElementInfo as JSON. */
export function probeElementScript(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return '';
    const testAttr = ['data-testid','data-field','data-qa'].find((a) => el.getAttribute(a));
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    let labelText = '';
    const prev = el.previousElementSibling;
    if (prev && norm(prev.textContent).length < 60) labelText = norm(prev.textContent).replace(/:$/, '');
    return JSON.stringify({
      selector: ${JSON.stringify(selector)},
      id: el.id || undefined,
      tag: el.tagName ? el.tagName.toLowerCase() : undefined,
      classes: (el.className && typeof el.className === 'string') ? el.className.split(/\\s+/).filter(Boolean) : [],
      testId: testAttr ? el.getAttribute(testAttr) : undefined,
      testAttr: testAttr || undefined,
      text: norm(el.textContent),
      labelText,
    });
  })()`;
}

/** Find the value element for a field by scanning labels; returns DomElementInfo JSON. */
export function labelSearchScript(aliases: string[]): string {
  const wants = JSON.stringify(aliases.map((a) => a.toLowerCase()));
  return `(() => {
    const wants = ${wants};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const els = Array.from(document.querySelectorAll('label,dt,th,span,div,strong,b,td'));
    for (const el of els) {
      const t = norm(el.textContent).toLowerCase().replace(/:$/, '');
      if (wants.includes(t)) {
        const sib = el.nextElementSibling;
        const valEl = sib || el;
        return JSON.stringify({
          selector: '',
          id: valEl.id || undefined,
          tag: valEl.tagName ? valEl.tagName.toLowerCase() : undefined,
          classes: (valEl.className && typeof valEl.className === 'string') ? valEl.className.split(/\\s+/).filter(Boolean) : [],
          text: norm(valEl.textContent),
          labelText: norm(el.textContent).replace(/:$/, ''),
        });
      }
    }
    return '';
  })()`;
}

/** Map a selector-capture confidence onto a Deal Card fact confidence. */
export function toFactConfidence(c: string | undefined): 'high' | 'medium' | 'low' {
  return c === 'high' ? 'high' : c === 'low' ? 'low' : 'medium';
}
