// LandOS — Semantic browser navigation (parcel-search interface understanding).
//
// Browser Navigation v1 (NOT a future enhancement). After reaching an official
// county source, behave like an experienced researcher: read the page's FORMS
// (inputs, labels, placeholders, buttons) and SEMANTICALLY locate the parcel
// search interface, choose the strongest available identifier (APN/parcel id >
// address > owner), and plan the search — the SAME logic for every county. No
// per-county selectors. Pure + deterministic so it is fully unit-testable.

export interface FormField {
  /** A driver-usable selector (id/name based) for typing into the input. */
  selector: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  type?: string;
}
export interface FormInfo {
  formIndex: number;
  fields: FormField[];
  /** Visible text of the form's submit/search button, when found. */
  submitLabel?: string;
  submitSelector?: string;
}

export interface NavSearchKey {
  apn?: string;
  address?: string;
  owner?: string;
  county?: string;
  state?: string;
}

export type IdentifierKind = 'apn' | 'address' | 'owner';

// ── Identifier formats (alternate attempts) ──────────────────────────────────

/** Common APN format variants counties accept (with/without separators). */
export function apnFormats(apn: string): string[] {
  const raw = apn.trim();
  const digitsAndSeps = raw.replace(/[^0-9A-Za-z.\-/ ]/g, '');
  const compact = digitsAndSeps.replace(/[ .\-/]/g, '');
  const dashed = digitsAndSeps.replace(/[ ./]+/g, '-');
  const spaced = digitsAndSeps.replace(/[.\-/]+/g, ' ');
  const dotted = digitsAndSeps.replace(/[ \-/]+/g, '.');
  return [...new Set([raw, compact, dashed, spaced, dotted].map((s) => s.trim()).filter(Boolean))];
}

const STREET_ABBR: Array<[RegExp, string]> = [
  [/\broad\b/gi, 'Rd'], [/\bstreet\b/gi, 'St'], [/\bavenue\b/gi, 'Ave'], [/\bdrive\b/gi, 'Dr'],
  [/\blane\b/gi, 'Ln'], [/\bcourt\b/gi, 'Ct'], [/\bhighway\b/gi, 'Hwy'], [/\btrail\b/gi, 'Trl'],
  [/\bboulevard\b/gi, 'Blvd'], [/\bcircle\b/gi, 'Cir'], [/\bplace\b/gi, 'Pl'], [/\bparkway\b/gi, 'Pkwy'],
];
/** Address variants: full, number+street only, and abbreviated/expanded street type. */
export function addressFormats(address: string): string[] {
  const raw = address.trim();
  const numStreet = raw.split(',')[0].trim();
  let abbr = numStreet;
  let expanded = numStreet;
  for (const [rx, ab] of STREET_ABBR) { abbr = abbr.replace(rx, ab); }
  const EXP: Array<[RegExp, string]> = [[/\bRd\b/gi, 'Road'], [/\bSt\b/gi, 'Street'], [/\bAve\b/gi, 'Avenue'], [/\bDr\b/gi, 'Drive'], [/\bLn\b/gi, 'Lane'], [/\bHwy\b/gi, 'Highway'], [/\bTrl\b/gi, 'Trail']];
  for (const [rx, ex] of EXP) { expanded = expanded.replace(rx, ex); }
  return [...new Set([raw, numStreet, abbr, expanded].map((s) => s.trim()).filter(Boolean))];
}

/** Strongest identifier first: APN/parcel id, then address, then owner (fallback). */
export function chooseIdentifier(key: NavSearchKey): { kind: IdentifierKind; primary: string; alternates: string[] } | null {
  if (key.apn && key.apn.trim()) { const f = apnFormats(key.apn); return { kind: 'apn', primary: f[0], alternates: f.slice(1) }; }
  if (key.address && key.address.trim()) { const f = addressFormats(key.address); return { kind: 'address', primary: f[0], alternates: f.slice(1) }; }
  if (key.owner && key.owner.trim()) return { kind: 'owner', primary: key.owner.trim(), alternates: [] };
  return null;
}

// ── Semantic input matching ──────────────────────────────────────────────────

// Substring-friendly (form fields are often camelCase / snake_case: ownerName,
// parcel_id) — do NOT require word boundaries.
const INTENT_PATTERNS: Record<IdentifierKind | 'general', RegExp> = {
  apn: /apn|parcel|tax.?map|strap|\bpin\b|account.?(no|num)/i,
  address: /address|situs|location|street|house.?(no|num)/i,
  owner: /owner|grantee|taxpayer/i,
  general: /search|find|lookup|query|keyword/i,
};

function fieldText(f: FormField): string {
  return [f.label, f.placeholder, f.name, f.id].filter(Boolean).join(' ');
}

/** Classify a single input's intent semantically (apn/address/owner/general/null). */
export function classifyInput(f: FormField): IdentifierKind | 'general' | null {
  if (f.type && /checkbox|radio|hidden|submit|button|file/i.test(f.type)) return null;
  const t = fieldText(f);
  if (INTENT_PATTERNS.apn.test(t)) return 'apn';
  if (INTENT_PATTERNS.address.test(t)) return 'address';
  if (INTENT_PATTERNS.owner.test(t)) return 'owner';
  if (INTENT_PATTERNS.general.test(t)) return 'general';
  // A bare text input with no hints can still be a search box.
  if ((f.type ?? 'text') === 'text' && !t.trim()) return 'general';
  return null;
}

export interface ParcelSearchPlan {
  formIndex: number;
  fieldSelector: string;
  /** The value to type (strongest identifier's primary format). */
  value: string;
  /** Remaining identifier formats to retry if the first yields no result. */
  valueAlternates: string[];
  idKind: IdentifierKind;
  submitLabel?: string;
  submitSelector?: string;
  reason: string;
}

/**
 * Plan a parcel search over the page's forms. Picks the strongest identifier the
 * page can actually accept: prefer an input whose intent matches the identifier
 * kind; fall back to a general search box. Returns null when no usable search
 * input exists (caller then tries another source). Pure + deterministic.
 */
export function planParcelSearch(forms: FormInfo[], key: NavSearchKey): ParcelSearchPlan | null {
  const id = chooseIdentifier(key);
  if (!id) return null;
  // Identifier order to try against the page (strongest first, but use what fits).
  const order: IdentifierKind[] = id.kind === 'apn' ? ['apn', 'address', 'owner'] : id.kind === 'address' ? ['address', 'apn', 'owner'] : ['owner', 'address', 'apn'];
  const valuesFor = (k: IdentifierKind): { primary: string; alternates: string[] } | null => {
    if (k === 'apn' && key.apn) { const f = apnFormats(key.apn); return { primary: f[0], alternates: f.slice(1) }; }
    if (k === 'address' && key.address) { const f = addressFormats(key.address); return { primary: f[0], alternates: f.slice(1) }; }
    if (k === 'owner' && key.owner) return { primary: key.owner.trim(), alternates: [] };
    return null;
  };

  // 1) Prefer a form input whose intent matches an available identifier (in order).
  for (const k of order) {
    const vals = valuesFor(k);
    if (!vals) continue;
    for (const form of forms) {
      const field = form.fields.find((f) => classifyInput(f) === k);
      if (field) {
        return { formIndex: form.formIndex, fieldSelector: field.selector, value: vals.primary, valueAlternates: vals.alternates, idKind: k, submitLabel: form.submitLabel, submitSelector: form.submitSelector, reason: `Matched a "${k}" search input; using the strongest available identifier.` };
      }
    }
  }
  // 2) Fall back to a general search box with the strongest identifier value.
  const best = valuesFor(id.kind)!;
  for (const form of forms) {
    const field = form.fields.find((f) => classifyInput(f) === 'general');
    if (field) {
      return { formIndex: form.formIndex, fieldSelector: field.selector, value: best.primary, valueAlternates: best.alternates, idKind: id.kind, submitLabel: form.submitLabel, submitSelector: form.submitSelector, reason: 'No dedicated field; used the page\'s general search box with the strongest identifier.' };
    }
  }
  return null;
}

// ── Result-page handling ─────────────────────────────────────────────────────

export interface ResultLink { text: string; href: string }

/** From a search-results page, choose the most likely parcel record link by
 *  matching the identifier (APN/address/owner) in the link text. Pure. */
export function pickParcelRecordLink(results: ResultLink[], key: NavSearchKey): ResultLink | null {
  const needles = [key.apn, key.address?.split(',')[0], key.owner].filter(Boolean).map((s) => (s as string).toLowerCase());
  const recordish = /detail|parcel|property|record|account|view|result/i;
  let best: ResultLink | null = null;
  for (const r of results) {
    if (!r.href || !/^https?:/i.test(r.href)) continue;
    const hay = `${r.text} ${r.href}`.toLowerCase();
    const matchesId = needles.some((n) => n && hay.includes(n.replace(/[ .\-/]/g, '')) || (n && hay.includes(n)));
    const looksRecord = recordish.test(hay);
    if (matchesId && looksRecord) return r; // strong match wins immediately
    if ((matchesId || looksRecord) && !best) best = r;
  }
  return best;
}
