// LandOS — Semantic public-record extraction (multi-state; NO county scrapers).
//
// Given the VISIBLE label→value fields a browser read from ANY official county
// page (assessor/tax/recorder/GIS/appraiser), map them to normalized public-
// record facts by SEMANTIC synonym patterns — the same logic for every county.
// No per-county CSS selectors. Every fact carries full provenance and is never a
// guess: a value is only 'extracted' when a labeled field matched; otherwise the
// caller records 'needs_verification' / 'not_found'. Pure + deterministic.

import type { BrowserFact, FactOrigin } from './browser-intelligence.js';

/** Normalized record facts we attempt to pull from any official page. */
export const RECORD_FACT_KEYS = [
  'owner', 'mailingAddress', 'situsAddress', 'apn', 'acreage', 'landUse',
  'assessedValue', 'marketValue', 'taxAmount', 'taxStatus', 'lastSale', 'deedRef',
] as const;
export type RecordFactKey = (typeof RECORD_FACT_KEYS)[number];

interface FactSpec { key: RecordFactKey; label: string; rx: RegExp; numeric?: boolean }
// Synonyms seen across assessor / appraiser / tax / recorder platforms nationwide.
const FACT_SPECS: FactSpec[] = [
  { key: 'owner', label: 'Official owner', rx: /^(owner(\s*name)?|current\s+owner|grantee|titleholder|deeded\s+owner|name\s*\(s?\))$/i },
  { key: 'mailingAddress', label: 'Mailing address', rx: /mailing(\s*address)?|owner\s*address|tax(payer)?\s*address|mail\s*to/i },
  { key: 'situsAddress', label: 'Situs / property address', rx: /situs|property\s*(address|location)|site\s*address|location\s*address|physical\s*address/i },
  { key: 'apn', label: 'APN / parcel ID', rx: /^(apn|parcel(\s*(id|number|no\.?|#))?|pin|tax\s*map(\s*(id|number))?|map\s*&?\s*(parcel|lot))$/i },
  { key: 'acreage', label: 'Acreage', rx: /acre(age|s)?|lot\s*size|land\s*area|deeded\s*acres|calc(ulated)?\s*acres/i, numeric: true },
  { key: 'landUse', label: 'Land use', rx: /land\s*use|use\s*code|property\s*(use|class|type)|classification|zoning\s*class/i },
  { key: 'assessedValue', label: 'Assessed value', rx: /assessed\s*(value|total|amount)|total\s*assessed|assessment\s*value/i, numeric: true },
  { key: 'marketValue', label: 'Market / appraised value', rx: /market\s*value|appraised\s*value|just\s*value|fair\s*market|total\s*value/i, numeric: true },
  { key: 'taxAmount', label: 'Tax amount', rx: /tax\s*(amount|due|bill|levy|total)|annual\s*tax|total\s*tax/i, numeric: true },
  { key: 'taxStatus', label: 'Tax status', rx: /tax\s*status|paid\s*status|delinquen|amount\s*due|balance\s*due/i },
  { key: 'lastSale', label: 'Last sale / transfer', rx: /(last\s*)?sale\s*(date|price|amount)|transfer\s*date|deed\s*date|recorded?\s*date|conveyance/i },
  { key: 'deedRef', label: 'Deed reference', rx: /deed\s*(book|ref|reference)|book\s*(&|and|\/)?\s*page|instrument(\s*(number|no\.?|#))?|recording\s*(number|reference)/i },
];

function looksNumeric(v: string): boolean { return /\d/.test(v); }

export interface ExtractContext {
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  origin: FactOrigin;
}

/**
 * Extract normalized public-record facts from visible label→value fields. Only
 * emits a fact when a labeled field semantically matches AND has a plausible
 * value (numeric specs require a digit). Confidence reflects match quality + an
 * official-vs-fallback origin. Never guesses. Pure.
 */
export function extractRecordFacts(fields: Record<string, string>, ctx: ExtractContext): BrowserFact[] {
  const out: BrowserFact[] = [];
  const seen = new Set<RecordFactKey>();
  for (const [rawLabel, rawVal] of Object.entries(fields)) {
    const label = rawLabel.trim();
    const value = (rawVal ?? '').trim();
    if (!label || !value) continue;
    for (const spec of FACT_SPECS) {
      if (seen.has(spec.key)) continue;
      if (!spec.rx.test(label)) continue;
      if (spec.numeric && !looksNumeric(value)) continue;
      seen.add(spec.key);
      // Official county/government source reads 'high'; search-fallback 'medium'.
      const confidence: BrowserFact['confidence'] = ctx.origin === 'search_fallback' ? 'medium' : 'high';
      out.push({
        key: spec.key, label: spec.label, value: value.slice(0, 160),
        sourceName: ctx.sourceName, sourceType: ctx.sourceType, sourceUrl: ctx.sourceUrl,
        confidence, origin: ctx.origin, status: 'extracted',
      });
      break;
    }
  }
  return out;
}

/** A "not found" / "needs verification" fact — used when the browser could not
 *  confidently read a target field (no guessing). */
export function unresolvedFact(key: RecordFactKey, ctx: ExtractContext, status: 'needs_verification' | 'not_found' = 'needs_verification'): BrowserFact {
  const spec = FACT_SPECS.find((s) => s.key === key)!;
  return { key, label: spec.label, value: '', sourceName: ctx.sourceName, sourceType: ctx.sourceType, sourceUrl: ctx.sourceUrl, confidence: 'low', origin: ctx.origin, status };
}
