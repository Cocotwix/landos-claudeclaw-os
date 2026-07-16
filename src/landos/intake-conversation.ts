// Conversational Smart Intake — New Lead as a conversation with LandOS.
//
// The operator talks ("I have two parcels from one seller", "Seller says
// utilities are available", "This came from PPC") and LandOS extracts structured
// information while PRESERVING the original conversation. Every operator turn is
// re-parsed against the FULL conversation so later messages enrich earlier ones;
// the raw text is never rewritten — extraction is additive, exactly the raw-
// intake doctrine.
//
// Pure + deterministic (composes buildSmartIntake). The reply is generated from
// what was actually extracted — acknowledgment first, then the single most
// valuable missing identifier. No model call, no fabrication.

import { buildSmartIntake, type SmartIntake } from './smart-intake.js';

export interface IntakeMessage {
  role: 'operator' | 'landos';
  text: string;
}

export interface IntakeConversationResult {
  /** Smart Intake over the FULL operator conversation (raw text preserved). */
  smartIntake: SmartIntake;
  /** LandOS's conversational reply to the latest operator message. */
  reply: string;
  /** Chips the UI shows — what LandOS understood so far. */
  understood: Array<{ label: string; value: string }>;
  /** True when identity confidence clears the auto-continue threshold. */
  readyToRun: boolean;
  /** The exact raw text acquire/run should receive (operator turns only). */
  combinedText: string;
}

function has(v?: string | null): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Structured chips from the parsed fields — what the conversation established. */
function understoodChips(si: SmartIntake): Array<{ label: string; value: string }> {
  const f = si.fields;
  const chips: Array<{ label: string; value: string }> = [];
  if (f.parcels && f.parcels.length > 1) chips.push({ label: 'Parcels', value: `${f.parcels.length} (${f.parcels.join(' · ')})` });
  else if (has(f.apn)) chips.push({ label: 'APN', value: f.apn! });
  if (si.apn.alternates.length) chips.push({ label: 'Alternate APN', value: si.apn.alternates.join(', ') });
  if (has(f.address)) chips.push({ label: 'Address', value: f.address! });
  if (has(f.city)) chips.push({ label: 'City', value: f.city! });
  if (has(f.county)) chips.push({ label: 'County', value: f.county! });
  if (has(f.state)) chips.push({ label: 'State', value: f.state! });
  if (has(f.owner)) chips.push({ label: 'Owner / seller', value: f.owner! });
  if (has(f.lpUrl)) chips.push({ label: 'LandPortal URL', value: f.lpUrl! });
  chips.push({ label: 'Identity confidence', value: `${si.confidence.label} (${si.confidence.percent}%)` });
  return chips;
}

/** Summarize the latest turn's deal intelligence in seller-honest language. */
function intelligenceAck(si: SmartIntake, latestText: string): string[] {
  const latest = buildSmartIntake(latestText);
  const acks: string[] = [];
  const seen = new Set<string>();
  for (const item of latest.dealIntelligence) {
    const key = `${item.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.category === 'Seller Information' || item.evidenceStatus === 'Seller Stated') {
      acks.push(`Noted as seller-stated (needs verification): "${item.text}"`);
    } else if (item.category === 'Property Facts') {
      acks.push(`Captured property fact: "${item.text}"`);
    } else if (item.category === 'Acquisition Notes' || item.category === 'Internal Notes') {
      acks.push(`Logged on the deal: "${item.text}"`);
    } else if (item.category === 'Risks') {
      acks.push(`Flagged as a risk: "${item.text}"`);
    } else if (item.category === 'Opportunities') {
      acks.push(`Flagged as an opportunity: "${item.text}"`);
    }
    if (acks.length >= 2) break;
  }
  void si;
  return acks;
}

/** The single most valuable missing identifier, asked conversationally. */
function nextQuestion(si: SmartIntake): string {
  const f = si.fields;
  if (si.readyForPropertyIntelligence) {
    return 'I have enough to identify the property. Run Property Intelligence whenever you are ready, or keep adding details.';
  }
  if (!has(f.state) && !has(f.county)) return 'Which county and state is this in?';
  if (has(f.apn) && !has(f.county)) return `I have the parcel number — which county is it in?`;
  if (!has(f.apn) && !has(f.address) && !has(f.owner)) {
    return 'What is the parcel number (APN), full address, or the owner name on the lead?';
  }
  if (has(f.owner) && !has(f.apn) && !has(f.address)) {
    return 'Do you have a parcel number or address? An owner name alone is resolvable, but slower.';
  }
  return si.nextStep;
}

/**
 * Advance the intake conversation: parse the full operator text, acknowledge
 * what the latest message added, and either confirm readiness or ask for the
 * single most valuable missing detail. Deterministic, no model call.
 */
export function buildIntakeConversation(messages: IntakeMessage[]): IntakeConversationResult {
  const operatorTurns = (messages ?? []).filter((m) => m.role === 'operator' && has(m.text));
  const combinedText = operatorTurns.map((m) => m.text.trim()).join('\n');
  const smartIntake = buildSmartIntake(combinedText);
  const latestText = operatorTurns.length ? operatorTurns[operatorTurns.length - 1].text : '';

  const parts: string[] = [];
  if (!combinedText) {
    parts.push('Tell me about the lead — paste anything: parcel numbers, an address, the seller, what they said. I will organize it as we go.');
  } else {
    const acks = intelligenceAck(smartIntake, latestText);
    parts.push(...acks);
    if (smartIntake.fields.parcels && smartIntake.fields.parcels.length > 1) {
      parts.push(`I see ${smartIntake.fields.parcels.length} distinct parcels on this lead — each will be resolved on its own.`);
    }
    parts.push(nextQuestion(smartIntake));
  }

  return {
    smartIntake,
    reply: parts.filter(Boolean).join(' '),
    understood: understoodChips(smartIntake),
    readyToRun: smartIntake.readyForPropertyIntelligence,
    combinedText,
  };
}
