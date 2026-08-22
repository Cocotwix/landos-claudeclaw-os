# Unified Voice + Text Hermes War Room (Slice 8)

Established 2026-08-22. Voice Mode and Text Mode are now two input/output
modes of ONE deal-scoped War Room. Same meeting, same transcript, same four
persistent Hermes specialist seats, same board router, same Deal Brain
chair, same deny-by-default capability governance. No second voice AI, no
second meeting, no second reasoning path.

## The defect this removed

Voice Mode used to be a parallel pipeline: Gemini Live answered from its own
persona, delegated through `answer_as_agent` to the legacy five Claude
department agents, and persisted its own `meeting_type='voice'` rows whose
LLM context reset on every reconnect. A spoken question and a typed question
about the same deal reached different intelligences and landed in different
transcripts.

## Architecture

```
microphone audio
  -> Gemini Live (speech recognition only)
  -> ask_war_room tool                    [warroom/board_mode.py]
  -> POST /api/warroom/voice/turn         [LandOS owns everything past here]
  -> handleTextTurn(..., { origin: 'voice' })
       same board router -> same Hermes seats -> same Deal Brain chair
  -> persisted in warroom_transcript on the SAME meeting
  -> the persisted response text returns
  -> Gemini Live speaks it verbatim
```

The audio provider has no deal context, no property facts, and exactly one
substantive tool. Its persona forbids answering from its own knowledge and
requires reading the returned text verbatim. Delegation, the generic agent
list and the old auto-router are all unregistered in a deal room, so the
provider structurally cannot form a competing opinion or act on the
operator's behalf.

**One meeting.** `/warroom?mode=voice&meetingId=…` binds the existing
deal-scoped meeting (`.runtime/warroom/warroom-voice-session.json`). The
voice page adopts that meeting id rather than calling
`/api/warroom/meeting/start`, never writes transcript rows from the client
(the turn engine persists both sides), and never ends the meeting when the
audio session ends. Entering the generic voice room releases the binding.

**One turn at a time.** Voice turns enqueue on the same per-meeting key as
typed turns (`warroom-text:${meetingId}`), so VAD chatter cannot open a
second writable board turn. The spoken answer is the turn's final persisted
response (chair synthesis on a board turn, the seat's own answer on a direct
question), never a re-summarization, so speech cannot diverge from the
transcript. Incomplete responses are never spoken; barge-in stops playback
while the persisted response stays.

**Provenance.** `warroom_transcript.origin` is `'voice'` on voice-originated
user rows, surfaced as a single mic glyph on the timestamp in both the live
and replayed render. No provenance prose in the operator's conversation.

## Windows runtime repairs

- `warroom/.venv` provisioned; Pipecat 0.0.108 + Gemini Live verified.
- The Node/Python shared state files moved off literal `/tmp` (not a real
  directory on Windows) to `<PROJECT_ROOT>/.runtime/warroom/`:
  `src/warroom-runtime-paths.ts` and `warroom/config.py` are the two halves.
- The respawn process lookup used a hardcoded POSIX `warroom/server.py`,
  which matches no Windows command line, so every respawn (voice binding,
  pin change, voice config apply) silently did nothing and the server kept
  stale configuration. Now `path.join('warroom', 'server.py')`.
- `rememberClientMsgId` accepts only v4 UUIDs and reads any other shape as
  "already seen". The voice route's original `voice_<ts>_<hex>` id made
  every spoken utterance a silent no-op; it now uses `crypto.randomUUID()`.

## Fairview live proof (Deal 89, 0 Kingwood Blvd, 51.11 ac)

One canonical meeting `wr_tk4hzp_ab2be1`, 20 transcript rows, zero
`meeting_type='voice'` deal rows.

| # | Mode | Turn | Routing | Wall clock |
|---|---|---|---|---|
| 1 | text | "Market, defend the current valuation." | market only | ~40s |
| 2 | **voice** | "What are you guys missing on this deal?" | property + market + seller in parallel, then Deal Brain chair | 62.9s |
| 3 | text | "Property, on that first action the chair just named, what exactly do I pull first?" | property only | ~55s |

Turn 2 is row 14 with `origin='voice'`; rows 15-17 are the three seats and
row 18 is the chair. The endpoint's returned spoken text is byte-identical
to the chair's persisted row 18. Turn 3 continues from the chair's
voice-turn synthesis, proving the conversation carries across modes.

Two hard refreshes: same meeting, same deal chip, same four seats, full
mixed-mode transcript in order, mic marker intact, zero new transcript rows,
zero seat invocations, console clean.

## Live audio status

**Microphone -> provider -> audio-out is NOT proven, and is blocked by
hardware, not code.** This workstation exposes no audio input endpoint, so
`getUserMedia` has no device to open and the Pipecat client stalls before
the WebSocket completes. What IS proven: `GOOGLE_API_KEY` is configured, the
Python server starts in board mode bound to the meeting
(`Board mode: meeting=wr_tk4hzp_ab2be1 deal=89`, `tools=2`), and it connects
to Gemini Live successfully. The unified turn path was exercised through the
exact door the `ask_war_room` tool calls. Speech recognition and speech
output remain unverified until a microphone is attached.

## Voice seats

Four roles map to voices in `warroom/voices.json` (`deal-brain` Charon,
`property` Iapetus, `market` Kore, `seller` Sulafat). Gemini Live's
native-audio session pins ONE voice for its lifetime, so per-seat voices
would need one live session per specialist. This slice keeps one audio voice
and names the limitation: the seats are already identified by name in the
shared transcript, and correct reasoning identity matters more than voice
differentiation.

## Files

`src/warroom-runtime-paths.ts` (new), `src/warroom-voice-session.ts` (new),
`warroom/board_mode.py` (new), `src/dashboard.ts` (voice bind/unbind/session/
turn routes, board-aware voice page route, platform-safe respawn pattern),
`src/warroom-html.ts` (board seats, meeting adoption, no client transcript
writes, deal chip, text-mode link), `src/warroom-text-html.ts` (voice button
carries the meeting, mic marker), `src/warroom-text-orchestrator.ts`
(`origin` option), `src/warroom-text-events.ts` (`turn_start.origin`),
`src/db.ts` (`origin` column + reads/writes), `src/agent-config.ts`,
`src/index.ts`, `warroom/config.py`, `warroom/server.py`, `warroom/router.py`,
`warroom/personas.py`, `warroom/voices.json`, `warroom/requirements.txt`.
Tests: `src/warroom-unified-voice.test.ts` (28 focused tests; 243 green
across the War Room + dashboard contract surface).

## Deferred

- Real microphone acceptance (blocked on hardware).
- Per-seat audio voices (needs one Gemini Live session per seat).
- Hand-up seat animation during a voice board turn (the RTVI events the old
  `answer_as_agent` path pushed have no equivalent in board mode yet).
- The governed `invoke_capability` verb stays deferred; seats still name the
  needed bounded check honestly.
