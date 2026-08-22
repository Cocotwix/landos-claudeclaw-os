# Persistent Hermes Specialists in the Deal-Scoped War Room (Slice 7)

Established 2026-08-22. The deal-scoped acquisition War Room board now seats
the SAME four persistent Hermes specialist profiles that produce production
intelligence — no duplicate personas, no new chat surface, no new transcript
store, no new multi-agent runtime. Voice is untouched.

## Seat model

Deal-scoped meetings (`warroom_meetings.deal_card_id` set) get a per-meeting
roster of exactly four seats (`getRosterForMeeting`, orchestrator):

| Seat id | Operator label | Profile |
|---|---|---|
| `deal-brain` | Deal Brain (Chair) | `landos-deal-brain` |
| `property` | Property | `landos-property` |
| `market` | Market + Area | `landos-market` |
| `seller` | Seller | `landos-seller` |

Generic meetings keep the full department roster unchanged. The old generic
agents simply no longer appear in deal-scoped acquisition rooms (roster is
derived, no migration); their historical transcript rows remain and render
under their raw ids. Deal Brain is listed first and badged "Chair" in the
rail; profile ids, transport and session ids never surface in the UI.

## Transport and isolation

Each seat turn is ONE profile-scoped Hermes CLI one-shot (`--profile <bot>
… -t clarify --oneshot`), the proven Slice 6 transport, via the same
argv-temp-file bootstrap (now abortable via an `AbortSignal` so Stop works).
No Bot Chat sessions, no API_SERVER_KEY, no new secret. Persistent identity
(SOUL, cognitive memory) loads every run; the session is ephemeral, so Deal A
conversation structurally cannot leak into Deal B. Boardroom continuity comes
from the LandOS-owned deal-scoped meeting transcript, which remains the
authoritative meeting history; seat turns are excluded from the hive
memory/conversation-log bridges by design, so no War Room statement becomes
durable bot memory.

## Context authority

Every seat turn rebuilds its prompt from the current LandOS deal context: the
`war-room-deal-context` provider (routes.ts) now exposes a lazy
`seatContext(seatId)` carrying the authoritative `LANDOS CURRENT DEAL
CONTEXT` envelope (shared body with production via
`specialistContextEnvelopeForPhase` — one doctrine string, no drift), the
seat's current persisted intelligence product, an honest FRESHNESS line from
the stack's fingerprint staleness, and the SAME bounded per-layer dossier
view its production run uses (`propertyDossierView` / `marketDossierView` /
`sellerDossierView`; the chair gets all four product projections + quick-flip
+ guidance). SELECT-only by construction. Board rules in every prompt: memory
shapes HOW, never WHAT; no research (structural, clarify-only); name the one
bounded check when current outside evidence is missing; operator statements
are guidance, never facts; capability governance stays deny-by-default.

## Routing

- @mentions / pin / sticky-addressee reuse the existing ladder untouched.
- Greetings in a deal room go to the chair instead of `main`.
- Everything else goes through a new deal-scoped board router
  (`routeBoardMessage`, Haiku classifier, same lockdown as `routeMessage`):
  direct question → one seat, no synthesis; broad question → up to 3
  specialist seats in PARALLEL + ONE chair synthesis; decision ask → chair
  alone. Fallback (degraded/parse failure) is chair-alone, never a fabricated
  round. The chair's synthesis receives each seat's actual position; a failed
  seat is passed as an explicit absence with a do-not-invent instruction.
  No recursive debate; the optional one-clarification pattern was not built
  (nothing in the existing engine provides it naturally).

## No model calls on open/refresh

Opening the room performs only GET history + SSE + a warmup POST that now
short-circuits for deal-scoped meetings (`skipped: 'deal_scoped'`, ~1ms) —
the SDK warmup and per-agent prewarm never run for a board. Slash prewarm
filters hermes seats. Proven live: after the last user turn, two hard
refreshes produced zero seat invocations, zero router calls, zero SDK warms.

## Fairview live proof (Deal 89, 0 Kingwood Blvd, 51.11 ac)

Entered from the Deal Card War Room button (existing one-canonical-meeting
reuse). The persisted meeting contained a pre-Slice-7 line calling the deal
"the 75.91-acre improved tract" — a live stale-history trap.

- "All right guys, what am I missing on this deal?" → board router picked
  property+market+seller with synthesis (11.1s). Round 1 parallel: property
  17.4s, market 15.2s, seller 16.3s (completions within 4s). Chair 27.2s.
  ~63s wall clock total. Property and Market each independently corrected
  the stale line ("this is the current 51.11-acre post-split parcel — not
  the 75.91-acre tract just stated"); Market held $3,084,000 as raw-land FMV
  only; Deal Brain synthesized agreement/emphasis, quoted the deterministic
  economics verbatim, flagged "the earlier boardroom description was wrong",
  and landed the next action.
- "Market, defend the current valuation." → market ONLY (12.8s; no property/
  seller/chair calls). Defended $3.084M as current raw-land FMV, named its
  limitations and the cheapest bounded check.
- "Seller, what do we know and what should I ask first?" → seller ONLY
  (7.9s). Honest pre-contact: zero communications recorded, first-call
  qualification objective, concrete first ask.
- Hard refresh ×2: same meeting, same deal chip, same four seats, full
  transcript, console clean, no model calls. Screenshot evidence (7 JPEGs)
  in local non-repo storage under `store/evidence/warroom-slice7/`.

All calls: provider `openai-codex`, model `gpt-5.6-sol`, transport
`hermes-cli-oneshot`, logged with per-seat provenance
(`war room specialist seat turn complete`).

## Files

`src/warroom-text-orchestrator.ts` (seat roster, board turn, seat branch in
runAgentTurn), `src/warroom-text-router.ts` (board router),
`src/landos/war-room-specialists.ts` (seats, prompts, seat model call),
`src/landos/war-room-deal-context.ts` (+`seatContext`), `src/landos/routes.ts`
(per-seat context in the provider), `src/landos/intelligence-stack-contract.ts`
(exported views/envelope), `src/landos/acquisition-analyst.ts`
(abortable one-shot), `src/dashboard.ts` (per-meeting roster + warmup skip),
`src/warroom-text-html.ts` (chair badge, deal fallback roster). Tests:
`src/landos/war-room-specialists.test.ts`,
`src/warroom-specialist-board.test.ts` (23 focused tests; full warroom +
executor + contract suites green).

## Deferred

- Voice boardroom (Slice 8). Knowledge compiler/RAG. Bounded time-sensitive
  research capability requests from the room (seats currently name the needed
  check honestly; the governed `invoke_capability` verb remains future work).
- Chair one-clarification follow-up turns.
- Old generic-agent transcript rows in deal rooms render raw speaker ids
  (cosmetic only).
