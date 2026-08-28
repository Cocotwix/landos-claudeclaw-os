// The subject as the OPERATOR described it, separated from what research guessed.
//
// A property card carries one set of identity columns, and both the operator's
// intake and every research lane write into it. Once a lane has written, there
// is no longer any way to ask "what did the operator actually say?" — and that
// question matters in exactly one situation, which is the one Deal 90 hit:
//
//   The operator supplies their own LandPortal link. A previous run failed to
//   use it, searched by address instead, landed on the NEIGHBOURING parcel, and
//   wrote that parcel's APN and owner onto the card. The next run finally opens
//   the operator's link, reaches the correct parcel — and the visual checkpoint
//   rejects it, because the owner on screen (the real one) disagrees with the
//   owner on the card (the neighbour's). The wrong answer, already recorded,
//   vetoes the right one, and the run falls back to the search that produced it.
//
// So when the entry point is the operator's own link, the record it opens is
// checked against the operator's own words instead. Those words are still
// preserved verbatim in raw intake, so this reads them rather than storing
// anything new.
//
// Two deliberate limits:
//   • It refuses to answer for a card whose identity is ACCEPTED
//     (`verified_property`). Operator prose never gets to overrule an official
//     parcel record; that supersession has its own confirmed operator route.
//   • It never returns an owner. Intake reads a SELLER/contact name, and a
//     seller is not necessarily the owner of record — writing one into the other
//     is the exact conflation the intake path already refuses. Checking a record
//     against it would reject correct parcels sold by an agent, an heir or a
//     spouse. The situs, jurisdiction and any operator-supplied APN carry the
//     check instead.

import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { getPropertyCardRow } from './property-card.js';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';

/** Identity facts the operator supplied, in `BrowserSearchKey` shape. */
export interface OperatorSuppliedSubject {
  address?: string;
  apn?: string;
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
}

const text = (value: unknown): string | undefined => {
  const result = String(value ?? '').trim();
  return result && result !== '-' ? result : undefined;
};

/**
 * Read the operator's own subject description off this deal's retained raw
 * intake. Returns null when the card's identity is already accepted, or when the
 * operator's words carry no locality or identifier at all — in both cases the
 * caller keeps using the card's subject, which is the existing behaviour.
 */
export function operatorSuppliedSubjectFor(
  dealCardId: number,
  propertyCardId?: number | null,
): OperatorSuppliedSubject | null {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const cardId = propertyCardId ?? resolveSubjectPropertyCard(deal).cardId;
  const card = cardId == null ? null : getPropertyCardRow(cardId);
  // An accepted parcel identity is authority; operator prose never supersedes it.
  if (String(card?.verification_status ?? '') === 'verified_property') return null;

  const raw = text(card?.summary) ?? text((deal as { seller_notes?: string }).seller_notes);
  if (!raw) return null;
  const parsed = parseConversationalLeadIntake(raw);
  const subject: OperatorSuppliedSubject = {
    ...(text(parsed.address) ? { address: parsed.address! } : {}),
    ...(text(parsed.apn) ? { apn: parsed.apn! } : {}),
    ...(text(parsed.city) ? { city: parsed.city! } : {}),
    ...(text(parsed.county) ? { county: parsed.county! } : {}),
    ...(text(parsed.state) ? { state: parsed.state! } : {}),
    ...(text(parsed.zip) ? { zip: parsed.zip! } : {}),
  };
  // Nothing to check against is not a subject. Falling through to the card's own
  // values is correct there, and returning an empty subject would instead make
  // every opened record verify trivially.
  const identifying = subject.address || subject.apn;
  return identifying ? subject : null;
}
