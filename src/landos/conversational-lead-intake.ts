import { buildSmartIntake, type DealIntelItem, type SmartIntake } from './smart-intake.js';

export interface ConversationalLeadIntake {
  rawInput: string;
  sellerName: string | null;
  phone: string | null;
  email: string | null;
  leadSource: string;
  address: string | null;
  apn: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
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

function extractPhone(raw: string): string | null {
  const match = raw.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/);
  return match?.[0]?.trim() || null;
}

function extractEmail(raw: string): string | null {
  const match = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i);
  return match?.[0] || null;
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
  const sellerName = labeledValue(rawInput, ['seller', 'seller name', 'lead', 'lead name', 'contact', 'contact name', 'owner'])
    ?? oneLine(fields.owner);
  const leadSource = labeledValue(rawInput, ['lead source', 'source', 'came from']) ?? 'manual';
  const address = oneLine(fields.address);
  const apn = oneLine(fields.apn);
  const locality = [fields.city, fields.state].filter(Boolean).join(', ');
  const propertyLabel = address || (apn ? `Parcel ${apn}` : locality || 'Unresolved property');

  return {
    rawInput,
    sellerName,
    phone: extractPhone(rawInput),
    email: extractEmail(rawInput),
    leadSource,
    address,
    apn,
    city: oneLine(fields.city),
    county: oneLine(fields.county),
    state: oneLine(fields.state),
    acreage: extractAcreage(rawInput),
    propertyLabel,
    dealIntelligence: smartIntake.dealIntelligence,
    smartIntake,
  };
}
