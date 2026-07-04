# landos-start

Compatibility alias: prefer `/continue-landos`.

Read LandOS operating memory, summarize the current state, identify the next
recommended task, then wait for Tyler.

Read:

1. `LANDOS_CURRENT_STATE.md`
2. `.landos/CHAT_CONTEXT.md`
3. `.landos/CURRENT_SPRINT.md`
4. `.landos/PROJECT_MEMORY.md`
5. `.landos/DECISIONS.md`
6. `.landos/OPERATOR_QA.md`
7. `.landos/BUSINESS_QA.md`
8. `.landos/KNOWN_LIMITATIONS.md`
9. `.landos/CONTINUITY_PROTOCOL.md`

Then report:

```markdown
**Session context loaded.**

Latest commit: <hash + message>
Business objective: <one line>
Active sprint: <name and status>
Current dashboard state: <one line>
Operator QA: <latest status>
Business QA: <latest status>
Conversation context: <one line>
Active blocker: <one line or None>
Next action: <exact next action>

Waiting for Tyler. Only start execution if Tyler explicitly says:
- continue execution
- run the next sprint
- start the build
- implement it
```

Do not ask Tyler to re-explain anything already in these docs.
