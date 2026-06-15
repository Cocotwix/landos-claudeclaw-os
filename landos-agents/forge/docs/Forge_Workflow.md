# Forge Workflow

The full Forge rhythm, start to finish. Every engagement runs this loop. The Orchestrator role keeps it on track and prevents approval spam.

```
Interview → Assumption Summary → Build Milestone → Security Review
   → QA Review → Promotion Review → Tyler Direction Review → Next Milestone
```

---

## Step 1: Interview

Pull the real intent out of Tyler. Most build mistakes come from building the wrong thing, not building it badly.

- Use `Forge_Interview_Template.md`.
- Ask only the questions that actually change the build. No interrogation.
- Capture the problem, the desired outcome, the host OS, the constraints, the hard stops, and what "done" looks like.

Output: filled interview notes.

---

## Step 2: Assumption Summary

State back what you heard and what you are assuming. This is the cheap checkpoint that prevents expensive rework.

- Use `Forge_Assumption_Summary_Template.md`.
- List scope, non-scope, assumptions, files expected to change, risk gates, and the success check.
- For anything non-trivial, get a yes before building.

Output: assumption summary, approved.

---

## Step 3: Build Milestone

One cohesive milestone. Not a thousand approvals.

- Inspect the active project's conventions first (Active Project Adapter).
- Build inside the approved scope. Use native read tools for inspection. Batch safe verification.
- Do not stop mid-build for ordinary safe work. Stop only for a real Red-lane gate (secrets, paid, destructive, install, major tradeoff).
- Preserve existing working systems.

Output: working changes, confined to the approved file set.

---

## Step 4: Security Review

Run `Forge_Security_Checklist.md` on changed files only.

- Secrets hygiene: no secrets, tokens, or `.env` values added or printed.
- Any new dependency or MCP server gets the open-source security pass.
- Scope: no unintended files touched, no unrelated systems modified.

Output: clear PASS or FAIL with reasons. FAIL blocks promotion.

---

## Step 5: QA Review

Run `Forge_QA_Checklist.md`. Verify behavior, not vibes.

- Run the host project's tests and build.
- Confirm the feature does what the assumption summary promised.
- Confirm nothing existing broke (discovery, dashboard, other agents).

Output: clear PASS or FAIL with evidence (test output, build result).

---

## Step 6: Promotion Review

Run `Forge_Promotion_Checklist.md`. Final gate before anything is staged.

- Tests pass. Security PASS. QA PASS.
- Staged file list equals the approved file list, exactly. No `git add .`.
- Commit message is clear. No secrets, logs, or unrelated files in the diff.
- Push only with Tyler's explicit approval.

Output: promote, or send back to build with specifics.

---

## Step 7: Tyler Direction Review

Surface the milestone result in the standard format (`Forge_Milestone_Review_Template.md`) and the next decision. Keep it tight. Lead with the verdict.

---

## Step 8: Next Milestone

Recommend the single best next milestone. Then loop back to Step 1 or Step 3 depending on whether the next milestone needs a fresh interview.

---

## Role-to-Step Map

| Step | Lead role |
|---|---|
| Interview | Interviewer |
| Assumption Summary | Orchestrator + Architect |
| Build Milestone | Builder |
| Security Review | Security Reviewer |
| QA Review | QA Reviewer |
| Promotion Review | Promoter |
| Tyler Direction Review | Orchestrator |
| Next Milestone | Orchestrator + Architect |
