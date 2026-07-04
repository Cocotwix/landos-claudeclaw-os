# LandOS Chat Context

Purpose: preserve where Tyler and the AI assistant left off conversationally
when a ChatGPT Project conversation becomes too large and a new conversation
must begin.

This is conversation memory, not architecture memory. Keep it concise.

## Current Conversation Topic

Governance and session-memory cleanup after the Acquisition Specialist Property
Card acceptance sprint exposed cross-session continuity gaps.

## Important Conclusions

- Tyler wants LandOS memory to belong to LandOS as a company, not to `.agents`,
  Claude, Codex, or one coding tool.
- Default governance is autonomy with only narrow approval gates.
- A new ChatGPT Project conversation should be able to start with "Continue
  LandOS" and reconstruct both project state and conversation context from repo
  memory.
- Conversation continuity is distinct from architecture/build memory.

## Decisions Made In Conversation

- Move operating memory into `.landos/`.
- Create root `LANDOS_CURRENT_STATE.md` as the canonical build-state file.
- Add `.landos/CHAT_CONTEXT.md` for conversation continuity.
- Add `.landos/KNOWN_LIMITATIONS.md`.
- Name conversations by sprint or business topic, not "handoff."

## Open Questions

- None blocking this cleanup pass.

## Current Reasoning

Before returning to feature work, finish memory namespace cleanup so the next
agent can load one canonical LandOS state without reading scattered `.agents`
handoffs.

## Unfinished Discussions

- How much of historical `.agents` content should remain as legacy archive
  versus move into `.landos` over time.
- Whether future non-coding LandOS employees should also write structured
  memory into `.landos`.

## Next Conversation Topic

Return to the Property Card dashboard-visible acceptance sprint after this
cleanup is complete.

## Chat Naming Rule

Name future conversations by sprint or business topic, not "handoff."

Examples:

- Market Intelligence UI QA
- Browser Agent 5-10 Acres
- Governance Memory Reset
- Discovery Report Wiring
- Market Selection Matrix
