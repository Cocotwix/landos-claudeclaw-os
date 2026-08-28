// LandOS — operator-supplied links as first-class intake evidence.
//
// THE DEFECT THIS REPAIRS, exactly as it happened on Deal 90.
//
// The operator pasted their own LandPortal saved-map link with the lead. It was
// read at intake and written to the property card's `lp_url` column — and that
// column is a single mutable field every research lane also writes. The
// LandPortal lane failed to find the parcel, landed on the site root, and
// persisted `https://landportal.com/` as the parcel URL, which reconciliation
// then wrote over the operator's link. From that moment the strongest thing
// LandOS had been given about the property no longer existed anywhere a reader
// could find it, and every rerun searched by address instead — landing on the
// neighbouring parcel.
//
// So a supplied link is stored the way a supplied screenshot already is: in its
// own immutable, deal-scoped table, verbatim, alongside the submission it came
// with. Nothing overwrites it, and nothing has to guess later which URL the
// operator actually gave.
//
// What this module deliberately is NOT:
//   • It is not a URL fetcher. Classifying a link says which EXISTING capability
//     should handle it, or that none exists and the general browser/model path
//     applies. Nothing here opens anything.
//   • It is not identity. A LandPortal link classified `landportal_map` is an
//     ENTRY POINT; the parcel it lands on is still verified by the workflow that
//     opens it. `landportal-operating-rules` owns that distinction and this
//     module defers to it.
//   • It is not a whitelist. An unrecognized host is recorded and classified
//     `web`, which is a routing answer ("general browser investigation"), never
//     a rejection. Refusing to keep an operator's link because LandOS has no
//     dedicated workflow for that domain is the behaviour this replaces.

import { getLandosDb } from './db.js';
import {
  isVerifiedLandPortalSubjectUrl,
  operatorLandPortalEntryUrl,
} from './landportal-operating-rules.js';

// The capability ids this module may route to, as literals.
//
// They are NOT imported from the capability modules on purpose: this runs on
// the intake path, and pulling the resolution/comps/zoning graphs in just to
// read four string constants would make a link classifier depend on the whole
// research stack. `intake-links.test.ts` asserts each literal still equals the
// capability's own exported id, so a rename cannot leave an invented name here.
const LANDPORTAL_RESEARCH_CAPABILITY_ID = 'landportal-research';
const PROPERTY_RESOLUTION_CAPABILITY_ID = 'property-resolution';
const COMPS_VALUATION_CAPABILITY_ID = 'comps-valuation';
const ZONING_SUBDIVISION_CAPABILITY_ID = 'zoning-subdivision';

/** Every capability id this classifier is allowed to name. */
export const INTAKE_LINK_CAPABILITY_IDS = [
  LANDPORTAL_RESEARCH_CAPABILITY_ID,
  PROPERTY_RESOLUTION_CAPABILITY_ID,
  COMPS_VALUATION_CAPABILITY_ID,
  ZONING_SUBDIVISION_CAPABILITY_ID,
] as const;

/** What KIND of thing the operator handed over. Routing, never verification. */
export type IntakeLinkClassification =
  | 'landportal_parcel'
  | 'landportal_map'
  | 'landportal_other'
  | 'assessor_gis'
  | 'county_official'
  | 'listing'
  | 'document'
  | 'web';

export interface IntakeLinkRoute {
  classification: IntakeLinkClassification;
  host: string;
  /** An EXISTING capability id, or '' when no specialized path exists and the
   *  general browser/model capability handles it. Never an invented name. */
  capability: string;
  /** Plain-English routing note, shown to the operator and given to the model. */
  note: string;
}

export interface IntakeLinkRecord extends IntakeLinkRoute {
  id: number;
  dealCardId: number;
  submissionId: number | null;
  /** The URL EXACTLY as the operator supplied it. */
  url: string;
  source: string;
  createdAt: number;
}

/** Every http(s) URL in a block of operator text, in order, verbatim. */
export function extractIntakeUrls(text: string | null | undefined): string[] {
  if (typeof text !== 'string' || !text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\])}]+/gi)) {
    // Trailing sentence punctuation is punctuation, not part of the address.
    const url = match[0].replace(/[.,;:!?]+$/, '');
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (!parsed.hostname.includes('.')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    found.push(url);
  }
  return found;
}

/** Normalized comparison key. Two spellings of one address are one artifact. */
export function intakeUrlKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    const query = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${host}${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

const LISTING_HOSTS = /(?:^|\.)(?:zillow|redfin|realtor|trulia|landwatch|land|landsearch|loopnet|movoto|homes|compass)\.com$/i;
const DOCUMENT_PATH = /\.(?:pdf|docx?|xlsx?|csv|txt|rtf|tiff?|jpe?g|png)(?:$|\?)/i;

/**
 * Decide which existing path should handle a supplied link.
 *
 * The classification is read from the address alone — host and path — because
 * this runs at intake, before anything is opened. It is a routing hint the
 * Smart Intake model and the research lanes may act on, and it is revised by
 * whatever the destination actually turns out to be.
 */
export function classifyIntakeUrl(url: string): IntakeLinkRoute {
  let parsed: URL | null = null;
  try { parsed = new URL(url.trim()); } catch { parsed = null; }
  const host = parsed ? parsed.hostname.toLowerCase().replace(/^www\./, '') : '';
  const path = parsed ? `${parsed.pathname}${parsed.search}` : url;

  if (/(?:^|\.)landportal\.com$/i.test(host)) {
    if (isVerifiedLandPortalSubjectUrl(url)) {
      return {
        classification: 'landportal_parcel', host, capability: LANDPORTAL_RESEARCH_CAPABILITY_ID,
        note: 'Canonical LandPortal parcel link. It carries a decodable parcel key, so LandPortal opens this record directly instead of searching for it.',
      };
    }
    if (operatorLandPortalEntryUrl(url)) {
      return {
        classification: 'landportal_map', host, capability: LANDPORTAL_RESEARCH_CAPABILITY_ID,
        note: 'LandPortal saved-map link. It names the view you were looking at, not a parcel, so LandPortal opens it directly as the entry point and still verifies whichever parcel the opened record turns out to be.',
      };
    }
    return {
      classification: 'landportal_other', host, capability: '',
      note: 'A LandPortal page that is not a parcel surface (a search, report, or account page). Kept as supplied; it cannot be used as a parcel entry point.',
    };
  }
  // The HOST is what identifies a parcel source. A path merely containing the
  // word "parcel" does not: ordinary pages talk about parcels, and routing them
  // to Property Resolution would claim a parcel source that is not one. The
  // path only qualifies on an unambiguous viewer/record segment.
  if (/(?:^|\.)(?:arcgis\.com|qpublic\.net|schneidercorp\.com)$/i.test(host)
      || /(?:^|[.-])(?:gis|assessor|appraiser|propertyappraiser|parcels?|beacon|qpublic)(?:[.-]|$)/i.test(host)
      || /\/(?:parcelviewer|parcelsearch|assessor|appraiser|propertyappraiser|gis)(?:\/|\?|$)/i.test(path)) {
    return {
      classification: 'assessor_gis', host, capability: PROPERTY_RESOLUTION_CAPABILITY_ID,
      note: 'Looks like an assessor / GIS parcel source. Property Resolution can read a parcel record from it; whatever it shows is still checked against the subject.',
    };
  }
  if (LISTING_HOSTS.test(host)) {
    return {
      classification: 'listing', host, capability: COMPS_VALUATION_CAPABILITY_ID,
      note: 'A real-estate listing page. Useful as market/comparable context; a listing is never parcel identity.',
    };
  }
  if (/\.(?:gov|us)$/i.test(host)) {
    const zoning = /\b(?:zoning|planning|ordinance|municode|subdivision|land[-_ ]?use)\b/i.test(`${host}${path}`);
    return {
      classification: 'county_official', host,
      capability: zoning ? ZONING_SUBDIVISION_CAPABILITY_ID : '',
      note: zoning
        ? 'An official planning/zoning source. The zoning and subdivision path reads it instead of searching for the same ordinance.'
        : 'An official government source. It is read through the general browser path and its findings are attributed to it.',
    };
  }
  if (DOCUMENT_PATH.test(path)) {
    return {
      classification: 'document', host, capability: '',
      note: 'Points directly at a document. It is fetched and read as a document rather than browsed as a page.',
    };
  }
  return {
    classification: 'web', host, capability: '',
    note: 'No specialized LandOS path exists for this site, so it is investigated with the general browser and interpreted by the model. Unknown domain is not invalid input.',
  };
}

interface LinkRow {
  id: number; deal_card_id: number; submission_id: number | null; url: string;
  host: string; classification: string; capability: string; note: string;
  source: string; created_at: number;
}

function mapRow(row: LinkRow): IntakeLinkRecord {
  return {
    id: row.id,
    dealCardId: row.deal_card_id,
    submissionId: row.submission_id ?? null,
    url: row.url,
    host: row.host,
    classification: row.classification as IntakeLinkClassification,
    capability: row.capability,
    note: row.note,
    source: row.source,
    createdAt: row.created_at,
  };
}

/**
 * Keep every supplied link. Re-supplying one is a no-op rather than a duplicate,
 * and a link that cannot be parsed is simply not a link — it stays in the raw
 * text it came from, which is never rewritten.
 */
export function recordIntakeLinks(input: {
  dealCardId: number;
  submissionId?: number | null;
  /** Operator text to read links out of. */
  text?: string | null;
  /** Links supplied through an explicit field rather than pasted in prose. */
  urls?: Array<string | null | undefined>;
  source?: string;
}): IntakeLinkRecord[] {
  const db = getLandosDb();
  const source = (input.source ?? 'operator').slice(0, 120);
  const candidates = [
    ...(input.urls ?? []).flatMap((url) => (typeof url === 'string' && url.trim() ? [url.trim()] : [])),
    ...extractIntakeUrls(input.text),
  ];
  const written: IntakeLinkRecord[] = [];
  const seen = new Set<string>();
  for (const url of candidates) {
    const key = intakeUrlKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const route = classifyIntakeUrl(url);
    try {
      db.prepare(`INSERT OR IGNORE INTO landos_intake_link
        (deal_card_id, submission_id, url, url_key, host, classification, capability, note, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.dealCardId, input.submissionId ?? null, url.slice(0, 2_000), key.slice(0, 2_000),
        route.host, route.classification, route.capability, route.note, source,
      );
    } catch {
      // A link is supporting evidence. Failing to file one must never fail the
      // submission that carried it.
      continue;
    }
    const row = db.prepare('SELECT * FROM landos_intake_link WHERE deal_card_id = ? AND url_key = ?')
      .get(input.dealCardId, key.slice(0, 2_000)) as LinkRow | undefined;
    if (row) written.push(mapRow(row));
  }
  return written;
}

/** Operator text already retained on this deal, oldest first. */
function retainedOperatorText(dealCardId: number): string[] {
  const db = getLandosDb();
  const out: string[] = [];
  const deal = db.prepare('SELECT seller_notes FROM landos_deal_card WHERE id = ?')
    .get(dealCardId) as { seller_notes?: string } | undefined;
  if (deal?.seller_notes) out.push(deal.seller_notes);
  const cards = db.prepare(`SELECT pc.summary FROM landos_deal_card_property l
    JOIN landos_property_card pc ON pc.id = l.card_id WHERE l.deal_card_id = ?`)
    .all(dealCardId) as Array<{ summary?: string }>;
  for (const card of cards) if (card.summary) out.push(card.summary);
  const submissions = db.prepare('SELECT original_text FROM landos_intake_submission WHERE deal_card_id = ? ORDER BY id')
    .all(dealCardId) as Array<{ original_text?: string }>;
  for (const submission of submissions) if (submission.original_text) out.push(submission.original_text);
  return out;
}

/**
 * The links supplied for this deal.
 *
 * Deals created before links were filed separately still carry them inside the
 * raw intake that has always been preserved verbatim. Reading them out on first
 * access recovers those without a migration and without inventing anything: the
 * text is the operator's own, unchanged.
 */
export function listIntakeLinks(dealCardId: number): IntakeLinkRecord[] {
  const db = getLandosDb();
  const read = () => (db.prepare('SELECT * FROM landos_intake_link WHERE deal_card_id = ? ORDER BY created_at, id')
    .all(dealCardId) as LinkRow[]).map(mapRow);
  let rows = read();
  if (rows.length) return rows;
  const text = retainedOperatorText(dealCardId).join('\n');
  if (!extractIntakeUrls(text).length) return rows;
  recordIntakeLinks({ dealCardId, text, source: 'operator:retained_raw_intake' });
  rows = read();
  return rows;
}

/**
 * The LandPortal link to ENTER the record at, or null.
 *
 * A canonical parcel link beats a saved-map link because it carries identity;
 * beyond that the most recently supplied link wins, because the operator's
 * latest word about the subject is the current one. This returns a URL to open
 * and never a parcel: `landportal-operating-rules` is the authority on that, and
 * the workflow that opens the link still verifies whatever it lands on.
 */
export function operatorLandPortalEntryUrlForDeal(dealCardId: number): string | null {
  const links = listIntakeLinks(dealCardId).filter((link) => operatorLandPortalEntryUrl(link.url) !== null);
  if (!links.length) return null;
  const canonical = [...links].reverse().find((link) => link.classification === 'landportal_parcel');
  return operatorLandPortalEntryUrl((canonical ?? links[links.length - 1]).url);
}
