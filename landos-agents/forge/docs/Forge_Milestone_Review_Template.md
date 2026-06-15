# Forge Milestone Review Template

Standard report Forge gives Tyler at the end of a milestone. Lead with the verdict. Keep it tight.

---

**Milestone:** _____
**Date:** _____
**Verdict:** SHIPPED / BLOCKED / NEEDS DECISION

---

## 1. What This Now Is

Plain-language description of what exists after this milestone that did not before.

## 2. Files Changed

Exact list. Mark each new / modified / deleted.

- `path/...` (new)

## 3. Tests and Build

- Command(s) run:
- Result: PASS / FAIL
- Evidence (counts, key output):

## 4. Security Review

- Result: PASS / FAIL
- Notes (secrets check on changed files, any dependency review):

## 5. QA Review

- Result: PASS / FAIL
- Behavior verified:
- Nothing-broke check (discovery, dashboard, other agents):

## 6. Visible in Dashboard / Host

- Does the new thing appear where it should? Yes / No / N/A
- How confirmed:

## 7. Intentionally Kept Out

What was deliberately excluded and why.

## 8. Next Recommended Milestone

The single best next step, with a one-line reason.

## 9. Decisions Needed From Tyler

Any Red-lane gates waiting on Tyler (push approval, paid tool, secret, install).
