# LandOS Cross-Session Continuity Protocol (v2)

This protocol was rebuilt on 2026-07-14. The v1 protocol (bulk-reading 12
memory files at session start) caused ~40k-token bootstraps of stale narrative
and is retired. The v1 text remains in git history.

## How fresh sessions get context

`CLAUDE.md` auto-imports two small files:

1. `.landos/PERMANENT_MEMORY.md` — durable rules (≤ 4 KB).
2. `.landos/CHECKPOINT.md` — the single current-state checkpoint (≤ 8 KB).

That is the whole bootstrap. A fresh session then needs only the actual work
request. Live `git status` / `git log` / `npm run landos:status` override
checkpoint narrative when they disagree.

## `/continue-landos` (optional orientation)

Loads only: permanent memory, checkpoint, `git status --short`,
`git log --oneline -5`, `npm run landos:status`. Reports which files it loaded
and their estimated token size. It never loads QA ledgers, handover history,
sprint reports, transcripts, or the database. Plain wording such as
"continue", "current", "existing", "LandOS", or "sprint" does NOT invoke it.

## `/done-landos` (session close)

1. Refresh `.landos/CHECKPOINT.md` (replace in place).
2. Append one concise entry to `.landos/OPERATOR_QA.md` / `BUSINESS_QA.md`
   only when that QA actually ran.
3. Optionally append a short closeout to `.landos/HANDOVER.md` (history).
4. Run `npm run landos:memory:audit` and fix any budget/content violations.

## Budgets (enforced by tooling + tests)

- Automatic bootstrap (CLAUDE.md + imports): target < 10k estimated tokens,
  hard max 20k.
- Permanent memory ≤ 4 KB; checkpoint ≤ 8 KB.
- No secrets, tokenized URLs, transcripts, or browser/MCP output in Layers A/B.

## Safety Rules (unchanged)

- Do not write secrets, tokens, cookies, credentials, or `.env` contents.
- Do not write property-specific business work product, real APNs, seller
  details, private addresses, or raw parcel reports into repo memory.
- `docs/reference-ui/` artifacts must be redacted before adding.
- Do not `git push` or deploy without Tyler approval.
- Do not commit unless the current task asks for a commit workflow or Tyler
  approves the commit.

## Reference-kit decisions

See `docs/landos/Memory_System_Audit.md` for the full component-by-component
reuse/adapt/merge/reject table against the Trejon ix-claude-code-starter-kit.
