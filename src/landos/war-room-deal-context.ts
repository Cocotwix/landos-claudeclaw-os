// Deal-scoped War Room context seam.
//
// The War Room orchestrator lives outside src/landos/ and its meetings persist
// in store/claudeclaw.db, while everything it needs to know about a deal lives
// behind closures inside registerLandosRoutes (acquisitionPropertyFile,
// readIntelligenceStackState, listDealBrainGuidance). This module is the one
// narrow bridge between them: routes.ts registers a read-only provider built
// from those existing builders, and the orchestrator asks for a bounded
// context block by deal card id. Nothing here researches, runs a model, or
// writes — the provider is SELECT-only by construction, which is what keeps
// "opening the War Room reruns no intelligence" true.

export interface DealWarRoomContext {
  dealCardId: number;
  /** Operator-facing identity: address / APN / county — never just the id. */
  dealLabel: string;
  /** Bounded opening context for the meeting's first agent turns. */
  contextText: string;
}

export type DealWarRoomContextProvider = (dealCardId: number) => DealWarRoomContext | null;

let provider: DealWarRoomContextProvider | null = null;

export function setDealWarRoomContextProvider(fn: DealWarRoomContextProvider | null): void {
  provider = fn;
}

/** Null when the deal does not exist or LandOS routes were never registered
 *  (tests, non-LandOS deployments). Callers treat null as "no deal scope". */
export function getDealWarRoomContext(dealCardId: number): DealWarRoomContext | null {
  if (!provider) return null;
  try {
    return provider(dealCardId);
  } catch {
    // A broken deal read must never take a War Room turn down with it.
    return null;
  }
}

/** Hard ceiling on the opening context. The dossier is already bounded
 *  (<60KB by contract test); this cap is the belt for the prose reads and
 *  guidance stacked on top of it. */
const MAX_CONTEXT_CHARS = 48_000;

export function boundContextText(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return text.slice(0, MAX_CONTEXT_CHARS) + '\n[deal context truncated at bound]';
}
