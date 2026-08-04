import { buildSmartIntake, type DealIntelItem, type SmartIntake } from './smart-intake.js';
import { extractSellerIdentity, formatAddressLabel, sanitizeLocalityCandidate } from './lead-identity.js';
import { extractSafePhone } from './contact-phone.js';

export interface ConversationalLeadIntake {
  rawInput: string;
  sellerName: string | null;
  /** Why that text was read as the seller/lead contact (operator-visible). */
  sellerNameBasis: string | null;
  phone: string | null;
  email: string | null;
  leadSource: string;
  address: string | null;
  apn: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  acreage: number | null;
  propertyLabel: string;
  dealIntelligence: DealIntelItem[];
  smartIntake: SmartIntake;
}

const oneLine = (value: string | undefined): string | null => value?.trim() || null;

function labeledValue(raw: string, labels: string[]): string | null {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = raw.match(new RegExp(`(?:^|[\\n.!?])\\s*(?:${escaped})\\s*[:=-]\\s*([^\\n,;]+)`, 'i'));
  return match?.[1]?.trim() || null;
}

function extractEmail(raw: string): string | null {
  const match = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i);
  return match?.[0] || null;
}

function extractZip(raw: string): string | null {
  // Cautious: a bare 5-digit number could be a price or parcel fragment, so a
  // ZIP is accepted only when labeled or directly following a state
  // abbreviation ("Sterling, NY 13156").
  const labeled = raw.match(/\b(?:zip|zip\s*code|postal\s*code)\s*[:=-]?\s*(\d{5})(?:-\d{4})?\b/i);
  if (labeled) return labeled[1];
  const afterState = raw.match(/,?\s+[A-Z]{2}\.?,?\s+(\d{5})(?:-\d{4})?\b/);
  return afterState?.[1] ?? null;
}

function extractAcreage(raw: string): number | null {
  const labeled = raw.match(/\b(?:acreage|acres?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\b/i);
  const natural = raw.match(/\b(\d+(?:\.\d+)?)\s*(?:acres?|ac\.)\b/i);
  const value = Number((labeled ?? natural)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Converts an operator's unstructured paste or voice transcript into cautious
 * lead clues. The exact input remains the canonical source; extracted values
 * are only seller/operator-provided candidates until research verifies them.
 */
export function parseConversationalLeadIntake(rawInput: string): ConversationalLeadIntake {
  const smartIntake = buildSmartIntake(rawInput);
  const fields = smartIntake.fields;
  // The seller/lead CONTACT. Labels are honored first; an unlabeled paste
  // ("Davan Smith - 4713 Sinking Creek Rd, London Kentucky") is read by the
  // shared person-name reader rather than being dropped on the floor. A parser
  // that read `fields.owner` as the seller conflated a seller-stated contact
  // with the owner of record — those stay separate everywhere.
  const seller = extractSellerIdentity(rawInput);
  const sellerName = seller?.name ?? oneLine(fields.owner);
  const sellerNameBasis = seller?.basis
    ?? (oneLine(fields.owner) ? 'Read from an owner/seller field in the structured paste.' : null);
  const leadSource = labeledValue(rawInput, ['lead source', 'source', 'came from']) ?? 'manual';
  // Canonical operator-facing casing for the address the OPERATOR typed. The
  // exact raw input is still preserved verbatim on the card as the source of
  // truth; this only stops "4713 sinking creek rd" from becoming the label
  // every downstream surface repeats.
  const address = oneLine(fields.address) ? formatAddressLabel(oneLine(fields.address)!) : null;
  const apn = oneLine(fields.apn);
  // A locality candidate is kept only when it is locality shaped. A parser
  // fragment ("NC. APN may") would otherwise be persisted as the city and then
  // scope every jurisdiction lookup to a place that does not exist.
  const city = sanitizeLocalityCandidate(oneLine(fields.city), { allowStateName: !!oneLine(fields.state) });
  const county = sanitizeLocalityCandidate(oneLine(fields.county));
  const locality = [city, fields.state].filter(Boolean).join(', ');
  const propertyLabel = address || (apn ? `Parcel ${apn}` : locality || 'Unresolved property');

  return {
    rawInput,
    sellerName,
    sellerNameBasis,
    phone: extractSafePhone(rawInput),
    email: extractEmail(rawInput),
    leadSource,
    address,
    apn,
    city,
    county,
    state: oneLine(fields.state),
    zip: extractZip(rawInput),
    acreage: extractAcreage(rawInput),
    propertyLabel,
    dealIntelligence: smartIntake.dealIntelligence,
    smartIntake,
  };
}
