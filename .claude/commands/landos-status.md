# landos-status

Run a quick LandOS status check and identify the next exact task.

## Checks

1. Git: `git status --short` and `git log --oneline -5`.
2. Memory: read `.landos/CHECKPOINT.md` (skip if already imported this
   session). Do not read Layer C history files or QA ledgers.
3. Runtime: `npm run landos:status` (bounded, no start/restart).
4. Memory budgets: `npm run landos:memory:status`.

## Report Format

```markdown
Git: <clean / N modified / N untracked>
Latest commit: <hash + message>
Checkpoint: <generated date; STALE flag if HEAD/date drifted>
Runtime: <RUNNING pid + URL / STOPPED>
Memory bootstrap: <estimated tokens, pass/fail vs budget>
Current blocker: <one line or None>
Next action: <one line>
```
