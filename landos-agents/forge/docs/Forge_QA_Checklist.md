# Forge QA Checklist

Run before claiming any milestone done. Verify behavior, not vibes. Produce a clear PASS or FAIL.

---

## Behavior

- [ ] The feature does what the Assumption Summary promised.
- [ ] The success check from the Assumption Summary actually passes.
- [ ] Edge cases that matter were considered (empty input, missing config, first run).

## Tests and Build

- [ ] The host project's test command was run. (This repo: `npm test`.)
- [ ] The host project's build/typecheck was run. (This repo: `npm run build` or `npm run typecheck`.)
- [ ] New behavior has a test where a test is reasonable, or a documented reason it does not.
- [ ] Test output reviewed, not just exit code glanced at.

## Nothing Broke

- [ ] Existing tests still pass.
- [ ] Agent discovery still works (new agent appears; existing agents unaffected).
- [ ] Dashboard still loads and lists agents.
- [ ] MCP loading and safe config still intact.
- [ ] No other agent's behavior changed unintentionally.

## Scope and Cleanliness

- [ ] Only files in the approved set were changed.
- [ ] No stray debug code, console noise, or commented-out blocks left behind.
- [ ] Docs updated if behavior or interface changed.

## Verdict

- Result: PASS / FAIL
- If FAIL: the specific items that failed and what build needs to fix.
