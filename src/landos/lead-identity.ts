// LandOS — lead identity presentation primitives.
//
// One shared, pure place for the three things a fresh lead needs before any
// provider runs:
//
//   1. WHO the operator is talking to (the seller/lead CONTACT — never the
//      owner of record, which only an official source can establish).
//   2. WHAT the property label looks like in canonical operator-facing form.
//   3. WHICH text is safe to quote back as a street reference.
//
// The failure this replaces: an unlabeled "Davan Smith - 4713 sinking creek rd,
// London Kentucky" produced no seller at all, a Deal Card titled "Unidentified
// seller — 4713 sinking creek rd", and that TITLE then leaked downstream as if
// it were the property's situs address ("…get to the property directly from
// Unidentified seller — 4713 sinking creek rd?").
//
// Deterministic, dictionary-free, no I/O. Every rule here is jurisdiction- and
// property-agnostic; nothing in this module may branch on a specific seller,
// address, county, or state.

// ─────────────────────────────────────────────────────────────────────────
// Vocabulary — tokens that can never be part of a person's name
// ─────────────────────────────────────────────────────────────────────────

const STREET_WORDS = [
  'st', 'street', 'rd', 'road', 'ave', 'av', 'avenue', 'dr', 'drive', 'ln', 'lane', 'ct', 'court',
  'blvd', 'boulevard', 'hwy', 'highway', 'cir', 'circle', 'pl', 'place', 'ter', 'terrace',
  'trl', 'trail', 'pkwy', 'parkway', 'way', 'loop', 'pike', 'route', 'rte', 'rt', 'run', 'creek',
  'ridge', 'hollow', 'holw', 'branch', 'fork', 'spur', 'bend', 'crossing', 'xing', 'landing',
  'box', 'apt', 'ste', 'suite', 'unit',
];

const DIRECTION_WORDS = ['north', 'south', 'east', 'west', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const DOMAIN_WORDS = [
  'parcel', 'parcels', 'apn', 'pin', 'lot', 'lots', 'tract', 'acre', 'acres', 'ac', 'acreage',
  'property', 'properties', 'address', 'situs', 'legal', 'description', 'deed', 'plat', 'survey',
  'seller', 'sellers', 'owner', 'owners', 'landowner', 'lead', 'leads', 'contact', 'buyer', 'agent',
  'broker', 'realtor', 'land', 'farm', 'timber', 'vacant', 'unknown', 'unidentified',
  'caller', 'call', 'called', 'none', 'na', 'tbd', 'no', 'notes', 'note', 'phone', 'cell', 'mobile',
  'email', 'source', 'county', 'parish', 'borough', 'city', 'town', 'township', 'state', 'zip',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'from', 'to', 'about', 'near', 'off',
  'his', 'her', 'their', 'they', 'he', 'she', 'it', 'is', 'was', 'has', 'have', 'wants', 'want',
  'selling', 'sell', 'sale', 'asking', 'price', 'inherited', 'probate', 'estate', 'trust', 'llc',
  'inc', 'company', 'co', 'corp',
];

const STATE_WORDS = [
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia',
  'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj',
  'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt',
  'va', 'wa', 'wv', 'wi', 'wy', 'dc',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'hampshire', 'jersey', 'mexico', 'york', 'carolina',
  'dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode', 'island', 'tennessee', 'texas',
  'utah', 'vermont', 'virginia', 'washington', 'wisconsin', 'wyoming', 'new',
];

/**
 * Structural geography — never part of a person's name, whatever the operator
 * labeled it. Applied to labeled AND inferred names.
 */
const GEOGRAPHY_TOKENS = new Set<string>([...STREET_WORDS, ...DIRECTION_WORDS, ...STATE_WORDS]);

/**
 * Placeholders that are the ABSENCE of a name. "Seller: Unknown caller" must not
 * create a contact called "Unknown caller".
 */
const PLACEHOLDER_TOKENS = new Set(['unknown', 'unidentified', 'unnamed', 'anonymous', 'caller', 'none', 'na', 'tbd', 'n/a']);

/**
 * Every token that disqualifies a word from being part of an INFERRED name. An
 * unlabeled paste has no operator intent behind it, so the bar is much higher:
 * "Old Ridge Rd" and "Called about the property" must never become sellers.
 */
const NON_NAME_TOKENS = new Set<string>([
  ...GEOGRAPHY_TOKENS, ...DOMAIN_WORDS, ...PLACEHOLDER_TOKENS,
]);

/** Generational/honorific tokens that may legitimately appear inside a name. */
// Deliberately excludes street-suffix lookalikes ("St") — "Mary St" is a road,
// not a person, and a particle allowance would have made it a seller.
const NAME_PARTICLES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'de', 'del', 'van', 'von', 'mac', 'mc']);

const nameKey = (token: string): string => token.toLowerCase().replace(/[.,'’]/g, '');

/**
 * `labeled` = the operator explicitly said "this is the seller", so only
 * structural geography and explicit placeholders are rejected — a real person
 * may well be named "Bo Land". `inferred` = LandOS is guessing from position in
 * a paste, so the full vocabulary applies.
 */
type NameVocabulary = 'labeled' | 'inferred';

function isNameToken(token: string, position: number, vocabulary: NameVocabulary): boolean {
  if (!/^[A-Za-z][A-Za-z'’.-]*$/.test(token)) return false;
  const key = nameKey(token);
  if (!key) return false;
  if (PLACEHOLDER_TOKENS.has(key)) return false;
  // A particle is only allowed after the first token ("Ana de la Cruz", "Bo Jr").
  if (position > 0 && NAME_PARTICLES.has(key)) return true;
  if (vocabulary === 'labeled' ? GEOGRAPHY_TOKENS.has(key) : NON_NAME_TOKENS.has(key)) return false;
  // A single letter is only a middle initial, never a standalone name token.
  return key.length > 1 || position > 0;
}

/**
 * Read a person's name out of a free-text token run. Returns null unless EVERY
 * token is plausibly part of a name, so a street, a locality, or a sentence
 * fragment can never be promoted to a seller.
 */
function personNameFrom(fragment: string, opts: { minTokens: number; vocabulary: NameVocabulary }): string | null {
  const tokens = fragment.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < opts.minTokens || tokens.length > 4) return null;
  if (!tokens.every((token, index) => isNameToken(token, index, opts.vocabulary))) return null;
  return tokens.join(' ').replace(/[.,]+$/, '').trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────
// Seller / lead contact extraction
// ─────────────────────────────────────────────────────────────────────────

export interface SellerIdentityCandidate {
  /** The contact's name exactly as the operator wrote it. */
  name: string;
  /** Deterministic, operator-readable reason this text was read as a name. */
  basis: string;
}

/** Labeled forms: "Seller: Davan Smith", "Seller is Davan Smith", "lead - Davan Smith". */
const LABELS = ['seller name', 'seller', 'lead name', 'lead', 'contact name', 'contact', 'owner name', 'owner', 'landowner', 'caller'];

/** Verb-led forms: "talked to Davan Smith", "call from Davan Smith". */
const INTRODUCERS = /\b(?:talked to|spoke (?:with|to)|speaking with|call (?:from|with)|called by|heard (?:back )?from|met with|referred by|inquiry from|message from)\s+/i;

/**
 * Extract the seller / lead CONTACT from a raw operator paste or transcript.
 *
 * This is a SELLER-STATED contact only. It is never written to the property
 * card's owner-of-record field: a name the operator typed is not an official
 * ownership record, and conflating the two would silently satisfy the
 * seller-authority name match that exists to catch exactly that gap.
 */
export function extractSellerIdentity(rawInput: string): SellerIdentityCandidate | null {
  const raw = (rawInput ?? '').trim();
  if (!raw) return null;

  // 1. Explicit label. A labeled single token is accepted — the operator said
  //    outright that this is the contact.
  const escaped = LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const labeled = raw.match(new RegExp(`(?:^|[\\n.!?;])\\s*(?:${escaped})\\s*(?:[:=-]|\\bis\\b|\\bwas\\b)\\s*([^\\n,;.]+)`, 'i'));
  const labeledName = labeled?.[1] ? personNameFrom(labeled[1], { minTokens: 1, vocabulary: 'labeled' }) : null;
  if (labeledName) return { name: labeledName, basis: 'Operator labeled this text as the seller/lead contact.' };

  // 2. Verb-led introduction anywhere in the paste.
  const introduced = raw.split(INTRODUCERS)[1];
  if (introduced) {
    const name = personNameFrom(introduced.split(/[,;\n]|\s+(?:about|regarding|re:|who|and)\s+/i)[0] ?? '', { minTokens: 2, vocabulary: 'inferred' });
    if (name) return { name, basis: 'Named as the person the operator spoke with.' };
  }

  // 3. Leading name before the property, the two most common paste shapes:
  //    "Davan Smith - 4713 Sinking Creek Rd, London Kentucky"  (separator)
  //    "Gerald Pate called about selling. APN …"               (subject verb)
  // The candidate still has to survive the full inferred-name vocabulary, so a
  // road or a sentence opener cannot slip through either shape.
  const lead = raw.split(/\r?\n/)[0] ?? '';
  const SUBJECT_VERBS = 'called|calls|phoned|emailed|texted|contacted|reached|owns|has|inherited|wants|would|said|says|is|was|left|responded|replied';
  const separated = lead.match(new RegExp(`^\\s*([^\\d\\n]{2,60}?)\\s*(?:[-–—|]|,|\\bat\\b|\\bre:|\\b(?:${SUBJECT_VERBS})\\b)\\s`, 'i'));
  const leadingName = separated?.[1] ? personNameFrom(separated[1], { minTokens: 2, vocabulary: 'inferred' }) : null;
  if (leadingName) return { name: leadingName, basis: 'Read as the lead contact named ahead of the property in the paste.' };

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Address label formatting
// ─────────────────────────────────────────────────────────────────────────

/** Tokens rendered fully uppercase in an operator-facing address label. */
const UPPER_TOKENS = new Set([...DIRECTION_WORDS.filter((word) => word.length <= 2), ...STATE_WORDS.filter((word) => word.length === 2), 'po', 'us', 'sr', 'fm', 'cr']);

function titleToken(token: string): string {
  if (!token) return token;
  const key = nameKey(token);
  if (UPPER_TOKENS.has(key)) return token.toUpperCase();
  // Ordinals and alphanumerics ("1st", "23B") keep their digits and uppercase
  // the letters that follow them.
  if (/\d/.test(token)) return /^\d+(?:st|nd|rd|th)$/i.test(token) ? token.toLowerCase() : token.toUpperCase();
  // Interior capitals a human typed deliberately ("McBride", "O'Neal") survive,
  // but an all-caps token is shouting, not intent, and is title-cased.
  const tail = token.slice(1);
  const deliberateInteriorCaps = /[A-Z]/.test(tail) && /[a-z]/.test(tail);
  return token.charAt(0).toUpperCase() + (deliberateInteriorCaps ? tail : tail.toLowerCase());
}

/**
 * Canonical operator-facing form of an address the OPERATOR typed. Collapses
 * whitespace, normalizes comma spacing, and applies consistent casing so
 * "4713 sinking creek rd" reads as "4713 Sinking Creek Rd" on every surface.
 *
 * Only ever applied to operator intake text. Provider/official record strings
 * (which are frequently upper-cased by the source) are quoted verbatim, because
 * their casing is part of the retained record.
 */
export function formatAddressLabel(raw: string): string {
  const cleaned = (raw ?? '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/,\s*$/, '').trim();
  if (!cleaned) return '';
  // Leave a string the source already wrote in all caps alone only when the
  // operator typed it that way AND it carries no lowercase at all; otherwise
  // canonicalize. Operator pastes are the input here, so canonicalize.
  return cleaned.split(' ').map((token) => {
    const [, lead, core, trail] = token.match(/^([("']*)(.*?)([)"',.]*)$/) ?? [null, '', token, ''];
    return `${lead}${titleToken(core)}${trail}`;
  }).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────
// Street references and card titles
// ─────────────────────────────────────────────────────────────────────────

const STREET_SUFFIX_RE = new RegExp(`\\b(?:${STREET_WORDS.join('|')})\\b\\.?\\s*$`, 'i');

/**
 * True when a value can honestly be quoted back to a seller as a road/street.
 * A Deal Card title, a person's name, or a bare locality is not a street, and
 * quoting one produced the nonsensical access question this replaces.
 */
export function looksLikeStreetAddress(value: string | null | undefined): boolean {
  const text = (value ?? '').trim();
  if (!text) return false;
  if (/—|–|\|/.test(text)) return false;           // composed card labels, never a situs
  if (/\bunidentified|unresolved|untitled\b/i.test(text)) return false;
  const first = text.split(',')[0]?.trim() ?? '';
  if (!first) return false;
  // Either a house-numbered address ("4713 Sinking Creek Rd") or a named road
  // with a recognizable street suffix ("Old Ridge Rd").
  return /^\d+[A-Za-z]?\s+\S/.test(first) || STREET_SUFFIX_RE.test(first);
}

/**
 * The road name to quote in a seller question, derived ONLY from a value that
 * actually looks like a street address. Returns null rather than inventing a
 * road out of whatever text happened to be in the field.
 */
export function streetReferenceFrom(situsAddress: string | null | undefined): string | null {
  if (!looksLikeStreetAddress(situsAddress)) return null;
  const first = (situsAddress ?? '').split(',')[0]?.trim() ?? '';
  return first.replace(/^\s*\d+[A-Za-z]?\s+/, '').trim() || null;
}

/**
 * Keep a locality (city/county) candidate only when it is actually locality
 * SHAPED. Free-text parsers occasionally hand back a sentence fragment
 * ("NC. APN may"), and a wrong city is worse than an absent one: it silently
 * scopes a jurisdiction lookup to a place that does not exist.
 */
export function sanitizeLocalityCandidate(
  value: string | null | undefined,
  options: { allowStateName?: boolean } = {},
): string | null {
  const text = (value ?? '').trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
  if (!text) return null;
  if (/[.;:0-9]/.test(text)) return null;
  const tokens = text.split(' ');
  if (tokens.length > 3) return null;
  if (!tokens.every((token) => /^[A-Za-z][A-Za-z'’-]*$/.test(token))) return null;
  // A bare state name/abbreviation is a state, never a city or county.
  // A one-word state name is normally too ambiguous to keep as a city. When
  // the parser also supplied a separate state, however, it can be a genuine
  // place name (for example Hampshire, TN), so retain it for source checks.
  if (!options.allowStateName && tokens.length === 1 && STATE_WORDS.includes(nameKey(tokens[0]))) return null;
  return text;
}

/** The label LandOS stores when intake identified no property at all. */
export const UNRESOLVED_LEAD_LABEL = 'Unresolved property lead';

/**
 * A storage label for a lead with no property reference. It carries a unique
 * suffix ONLY so that two unrelated unidentified leads cannot collapse into one
 * property card via a shared address key. It is an internal handle, not a
 * property name — `isPlaceholderPropertyLabel` exists so no surface prints it.
 */
export function unresolvedLeadStorageLabel(uniqueSuffix: string | number): string {
  return `${UNRESOLVED_LEAD_LABEL} ${uniqueSuffix}`;
}

/**
 * True when a stored "address" is a LandOS placeholder rather than anything the
 * operator or a source said about the property. Owner-facing surfaces must show
 * an honest "not yet identified" instead of an internal token.
 */
export function isPlaceholderPropertyLabel(value: string | null | undefined): boolean {
  return /^\s*unresolved\s+(?:property\s+lead|parcel|property)\b/i.test(value ?? '');
}

export interface LeadTitleParts {
  address?: string | null;
  apn?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
}

/**
 * The Deal Card title for a freshly created lead. PROPERTY-FIRST: a card is
 * identified by the property it is about, never by whether LandOS managed to
 * read a seller's name out of the paste. The seller/lead contact lives on its
 * own person record and renders in the "Seller / Lead" field.
 *
 * Also keeps the title free of em dashes and person names, because downstream
 * surfaces have historically fallen back to the title when an address was
 * missing — a title that is not address-shaped must not read like one.
 */
export function buildLeadCardTitle(parts: LeadTitleParts): string {
  const clean = (value?: string | null) => (value ?? '').trim();
  const locality = [clean(parts.city), clean(parts.state)].filter(Boolean).join(', ');
  const address = clean(parts.address);
  if (address) return [address, locality].filter(Boolean).join(', ');
  const apn = clean(parts.apn);
  if (apn) {
    const jurisdiction = [clean(parts.county) ? `${clean(parts.county).replace(/\s+county$/i, '')} County` : '', clean(parts.state)]
      .filter(Boolean).join(', ');
    return [`Parcel ${apn}`, jurisdiction || locality].filter(Boolean).join(', ');
  }
  if (locality) return `Unresolved parcel, ${locality}`;
  return 'Unresolved property lead';
}
