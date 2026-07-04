# landos-status

Run a quick LandOS status check and identify the next exact task.

## Checks

1. Git status
   - Run `git status --short`.
   - Flag staged files, modified files, and untracked files.

2. Recent commits
   - Run `git log --oneline -5`.

3. Current state
   - Read `LANDOS_CURRENT_STATE.md`.
   - Read `.landos/CHAT_CONTEXT.md`.
   - Read `.landos/CURRENT_SPRINT.md`.
   - Read `.landos/KNOWN_LIMITATIONS.md`.

4. QA memory
   - Read `.landos/OPERATOR_QA.md`.
   - Read `.landos/BUSINESS_QA.md`.

5. Reference assets
   - List `docs/reference-ui/`.

## Report Format

```markdown
Git: <clean / N modified / N untracked>
Latest commit: <hash + message>
Business objective: <one line>
Dashboard state: <one line>
Sprint: <name> - <complete / in progress / blocked>
Operator QA: <latest>
Business QA: <latest>
Conversation context: <one line>
Current blocker: <one line or None>
Next action: <one line>
Reference assets: <summary>
Known limitations: <blocking count / summary>
```
