# Forge Promotion Checklist

The final gate before anything is staged, committed, or promoted. Forge promotes only on a clean pass. If any item fails, send it back to build with specifics; do not promote.

---

## Gates Cleared

- [ ] QA Review result is PASS (evidence on file).
- [ ] Security Review result is PASS (Part A, plus Part B if a dependency was added).
- [ ] Host project tests pass.
- [ ] Host project build / typecheck passes.

## Staging Discipline

- [ ] Staged file list equals the approved file list, exactly.
- [ ] `git add .` was NOT used. Files were staged by explicit path.
- [ ] No `.env`, logs, secrets, private business data, or unrelated untracked files are staged.
- [ ] In this repo specifically, none of these are staged: `landos-agents/ClaudeClaw_Mark_Install_and_Update_Workflow_Fork_Upstream_Git_Pull.txt`, `landos-agents/acquisition-copilot/.no-avatar`, `start.bat`.

## Commit

- [ ] Commit message is clear and describes the milestone.
- [ ] Diff reviewed one final time for anything that should not ship.

## Push

- [ ] Push happens ONLY with Tyler's explicit approval. Default is do not push.

## Verdict

- Result: PROMOTE / HOLD
- If HOLD: the exact items blocking promotion.
