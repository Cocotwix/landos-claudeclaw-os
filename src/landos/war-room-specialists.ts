// LandOS — deal-scoped War Room specialist seats (Slice 7).
//
// The deal-scoped War Room board is the SAME four persistent Hermes profiles
// that produce production intelligence — no duplicate personas:
//
//   Property      → landos-property
//   Market + Area → landos-market
//   Seller        → landos-seller
//   Deal Brain    → landos-deal-brain   (the chair)
//
// TRANSPORT. Each seat turn is one profile-scoped Hermes CLI one-shot — the
// proven Slice 6 transport, unchanged. The persistent identity (SOUL, mandate,
// cognitive memory) loads every run; the session itself is ephemeral, so a
// seat turn structurally cannot carry one deal's conversation into another.
// Multi-turn boardroom continuity comes from the LandOS-owned War Room
// transcript, which is deal-scoped by meeting. No API_SERVER_KEY, no new
// secret.
//
// AUTHORITY. Every seat turn carries the authoritative LANDOS CURRENT DEAL
// CONTEXT envelope (built by the routes-registered deal context provider)
// stating that profile memory may shape HOW the seat reasons and never WHAT
// is currently true. The `clarify`-only toolset means a seat structurally
// cannot research, browse, run commands, or mutate anything — capability
// governance stays deny-by-default.

import {
  ANALYST_TOOLSETS as _ANALYST_TOOLSETS, // re-exported below for tests
  hermesProfileProvisioned,
  hermesRuntimePaths,
  invokeHermesCli,
  resolveAnalystModel,
  type AnalystModelSelection,
  type SettingsReader,
} from './acquisition-analyst.js';
import {
  SPECIALIST_PROFILES,
  SPECIALIST_TRANSPORT,
  specialistInvocationArgs,
} from './specialist-intelligence-executor.js';
import type { DealWarRoomContext } from './war-room-deal-context.js';

export const SEAT_TOOLSETS = _ANALYST_TOOLSETS; // 'clarify' — structurally tool-less

/** Roster seat ids for the deal-scoped board. Chair first for display. */
export const WAR_ROOM_CHAIR_ID = 'deal-brain';

export interface WarRoomSeat {
  id: string;
  /** Operator-facing label. Technical provenance (profile id, transport)
   *  stays internal. */
  name: string;
  description: string;
  /** The persistent Hermes profile that IS this seat's identity. */
  profile: string;
  chair?: boolean;
}

export const WAR_ROOM_SPECIALIST_SEATS: WarRoomSeat[] = [
  {
    id: WAR_ROOM_CHAIR_ID,
    name: 'Deal Brain',
    description: 'Chairs the board — synthesizes the specialist positions, carries real disagreement, and lands the current decision and next action',
    profile: SPECIALIST_PROFILES.deal,
    chair: true,
  },
  {
    id: 'property',
    name: 'Property',
    description: 'Physical property and official records: condition, visual evidence, acreage, access and frontage, zoning and subdivision posture, unresolved property questions',
    profile: SPECIALIST_PROFILES.property,
  },
  {
    id: 'market',
    name: 'Market + Area',
    description: 'Valuation and market context: current land FMV, comps, liquidity, buyer pool, area development activity, market risks and opportunities',
    profile: SPECIALIST_PROFILES.market,
  },
  {
    id: 'seller',
    name: 'Seller',
    description: 'Seller intelligence: canonical seller evidence, motivation and price posture where established, what to ask next — honestly pre-contact when no communication exists',
    profile: SPECIALIST_PROFILES.seller,
  },
];

const seatById = new Map(WAR_ROOM_SPECIALIST_SEATS.map((seat) => [seat.id, seat]));

export function getSpecialistSeat(id: string): WarRoomSeat | null {
  return seatById.get(id) ?? null;
}

// ── Seat turn prompt ───────────────────────────────────────────────────────

const SEAT_BOARD_RULES = [
  'BOARDROOM RULES:',
  '- The LANDOS CURRENT DEAL CONTEXT above is authoritative for every current fact about this deal. Your',
  '  persistent memory may shape HOW you reason, never WHAT is currently true; where memory disagrees with the',
  '  context, the context wins. Never carry facts from another deal into this room.',
  '- Speak only from your specialist domain. Where the question belongs to another seat, leave it to them.',
  '- You cannot research or browse, and must not pretend to. If a question needs current outside evidence you',
  '  do not have (news, pending decisions, anything time-sensitive), say the current evidence is insufficient',
  '  and name the single bounded check LandOS should run — never invent or assume a current fact.',
  '- If your current persisted read is marked STALE above, say your read predates the latest evidence instead',
  '  of presenting it as current.',
  "- The operator's statements are deal-specific guidance or hypotheses, never canonical property facts.",
  '- Reply in plain text, boardroom style: at most one short paragraph plus up to three short bullet lines.',
  '  No JSON, no headers, no preamble.',
].join('\n');

const CHAIR_BOARD_RULES = [
  'BOARDROOM RULES:',
  '- You chair this board. The LANDOS CURRENT DEAL CONTEXT above is authoritative for every current fact;',
  '  your persistent memory may shape HOW you reason, never WHAT is currently true. Never carry facts from',
  '  another deal into this room.',
  '- Synthesize the specialist positions with the current LandOS products and deterministic economics. Quote',
  '  deterministic numbers verbatim, never recompute.',
  '- Specialist disagreement is information: never manufacture consensus or average incompatible positions.',
  '  Name real agreement, real disagreement, the material issue, what would resolve it, and the recommended',
  '  next action.',
  '- If a seat failed to respond this turn, say so — never invent its position.',
  '- You cannot research or browse. Where current outside evidence is needed, name the bounded check LandOS',
  '  should run.',
  "- The operator's statements are guidance or hypotheses, never canonical property facts.",
  '- Reply in plain text: at most two short paragraphs plus up to four short bullet lines. No JSON, no',
  '  headers, no preamble.',
].join('\n');

export interface SeatPromptInput {
  seat: WarRoomSeat;
  dealCtx: DealWarRoomContext | null;
  dealCardId: number;
  dealLabel: string;
  /** The orchestrator's "[Meeting so far …]" block; empty on first turn. */
  transcriptBlock: string;
  /** The operator's message this turn (or the framed synthesis ask). */
  userText: string;
}

export function buildSpecialistSeatPrompt(input: SeatPromptInput): string {
  const { seat } = input;
  const seatContext = input.dealCtx?.seatContext?.(seat.id) ?? null;
  const roleLine = seat.chair
    ? `You are the persistent LandOS Deal Brain, chairing the live deal War Room boardroom for ${input.dealLabel}.`
    : `You are the persistent LandOS ${seat.name} Intelligence specialist, seated in the live deal War Room boardroom for ${input.dealLabel}.`;
  return [
    roleLine,
    'The operator and the other specialist seats — Property, Market + Area, Seller, chaired by Deal Brain — are in the room.',
    '',
    seatContext
      ?? `No bounded deal context is available for this seat right now (Deal ${input.dealCardId}). Say plainly that the current LandOS context did not load and answer only from what the meeting itself established — never from profile memory of other sessions.`,
    '',
    seat.chair ? CHAIR_BOARD_RULES : SEAT_BOARD_RULES,
    input.transcriptBlock ? `\n${input.transcriptBlock}` : '',
    '',
    `Operator: ${input.userText}`,
  ].filter((part) => part !== '').join('\n');
}

/** Round-2 framing the chair receives after a boardroom round: the operator's
 *  question plus each seat's actual position (or its honest absence). */
export function buildChairSynthesisText(input: {
  operatorText: string;
  positions: Array<{ seatName: string; text: string | null }>;
}): string {
  const lines = input.positions.map((position) =>
    `${position.seatName}: ${position.text?.trim() ? position.text.trim() : '(no response this turn — do not invent this seat\'s position)'}`);
  return [
    input.operatorText,
    '',
    '[Boardroom round complete. The specialist seats just gave these positions on the operator\'s question:',
    ...lines,
    'As chair, synthesize now: where the seats agree, where they materially disagree and why, the material issue,',
    'what would resolve it, and the recommended next action. Preserve real disagreement.]',
  ].join('\n');
}

// ── Seat model call ────────────────────────────────────────────────────────

export interface SeatCallRuntime {
  engine: 'hermes';
  agentProfile: string;
  provider: string;
  model: string;
  transport: string;
  durationMs: number;
}

export interface SeatCallDeps {
  /** Injected in tests so nothing spawns. */
  invoke?: (args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<string>;
  settings?: SettingsReader;
  now?: () => number;
}

/**
 * One seat turn: one profile-scoped one-shot on the seat's persistent Hermes
 * profile, `clarify`-only, same model-resolution chain as production
 * intelligence. Returns the raw plain-text reply plus provenance.
 */
export async function runSeatModelCall(
  input: { seat: WarRoomSeat; prompt: string; timeoutMs: number; signal?: AbortSignal },
  deps: SeatCallDeps = {},
): Promise<{ text: string; runtime: SeatCallRuntime }> {
  const now = deps.now ?? (() => Date.now());
  const model: AnalystModelSelection = resolveAnalystModel(undefined, deps.settings);
  const invoke = deps.invoke ?? (async (args: string[], timeoutMs: number, signal?: AbortSignal) => {
    hermesRuntimePaths();
    if (!hermesProfileProvisioned(input.seat.profile)) {
      throw new Error(`The Hermes specialist profile ${input.seat.profile} is not provisioned. Run: npm run landos:hermes:specialists`);
    }
    return invokeHermesCli(args, timeoutMs, signal);
  });
  const t0 = now();
  const raw = await invoke(
    specialistInvocationArgs({ profile: input.seat.profile, prompt: input.prompt, model }),
    input.timeoutMs,
    input.signal,
  );
  return {
    text: (raw ?? '').trim(),
    runtime: {
      engine: 'hermes',
      agentProfile: input.seat.profile,
      provider: model.provider,
      model: model.model,
      transport: SPECIALIST_TRANSPORT,
      durationMs: Math.max(0, now() - t0),
    },
  };
}
