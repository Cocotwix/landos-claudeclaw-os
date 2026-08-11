---
name: landos-sprint-acceptance
description: Use when independently accepting meaningful LandOS operator-facing work.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, acceptance, visual-qa, playwright, independent-review]
    related_skills: [dogfood, adversarial-ux-test]
---

# LandOS sprint acceptance

## Overview

Independently determine whether a meaningful operator-facing LandOS sprint is
visibly correct. LandOS is the canonical system of record, but canonical data,
tests, logs, APIs, database reads, and replay checks are supporting evidence
only. They never substitute for the real localhost operator workflow.

This skill is for the `landos-visual-qa` profile operating the independent
repository Playwright harness on localhost. Browser and CDP inspection are
authorized only for the fresh harness-owned context, never a shared operator
session. The inspector must not receive the implementation role's
conclusion before its first inspection, must not repair the work, and must issue
a claim-by-claim `PASS` or `FAIL`. Incomplete visual evidence is always `FAIL`.

## When to use

- A sprint changes anything an operator sees or operates.
- A defect repair claims visible behavior now agrees with canonical data.
- A release or completion gate needs independent visual evidence.

Do not use this skill to implement, repair, value, strategize, or mutate an
existing Deal Card. Do not certify work this profile implemented.

## Required contract

Before the profile opens the application, the integration owner must
freeze the sprint's acceptance contract. It must name the fresh address
requirement, changed operator sections, every visible claim, expected values or
invariants, canonical comparison source, stable operator-facing locators, and
required artifacts. Refuse an after-the-fact contract that merely describes
what the UI happened to show.

For each claim record:

- property address and exact operator-facing section;
- expected and visible values;
- displayed count and independently counted rendered rows or artifacts;
- canonical comparison result;
- refresh, restart, and contamination results;
- timestamp and evidence path;
- explicit `PASS` or `FAIL`.

## Acceptance workflow

1. Start the repository Playwright acceptance engine in an isolated browser
   context using only approved authentication state. Use browser/CDP tools only
   against that harness-owned context; never attach to a shared operator Chrome
   session. Completion criterion: the run attests ownership of every page it
   created and closes them without affecting the operator browser.
2. Enter a genuinely fresh property address through **New Lead** when freshness
   is required. Capture `new-lead.png`. Completion criterion: the visible input
   and submitted address agree with the contract.
3. Follow normal localhost navigation into the resulting Deal Card. Capture a
   full-page `deal-card-loaded.png`. Completion criterion: identity on the page
   matches the acceptance property before any feature claim is inspected.
4. Inspect every changed section in place. Capture a full-page view plus close
   screenshots of each changed section, relevant tab, panel, row set, and visual
   artifact. Completion criterion: every claim points to evidence where its
   visible value can actually be seen.
5. Inspect browser console output and failed network requests for the relevant
   workflow. Record `console.json` and `network-failures.json`; do not suppress
   errors to obtain a pass.
6. Compare displayed counts with rendered rows and artifacts, then compare the
   visible content with canonical accepted data. A zero or empty state while
   accepted data exists, a contradictory summary, or a claimed specialist
   result that is not visibly rendered is `FAIL`.
7. Check all visible evidence for wrong-address, wrong-APN, wrong-property-id,
   or prior-property contamination. Any cross-property evidence is `FAIL`.
8. Refresh the browser and visibly reinspect every claim. Capture
   `after-refresh.png`. A backend readback without visible reinspection is not a
   refresh result.
9. Request the approved managed LandOS restart through the integration owner.
   Reopen the same Deal Card, visibly reinspect every claim, and capture
   `after-restart.png`. A health response or durable database row is not a
   restart result.
10. Verify the external harness closed every test-created page and context and
    preserved trace, video, full-page and section screenshots, console, network,
    results, and report artifacts. Completion criterion: the artifact package
    validator can account for every required file and claim.
11. Issue `PASS` only when every required claim passes before refresh, after
    refresh, and after restart with complete visible evidence. Otherwise issue
    `FAIL` and identify the exact failed claim and evidence.

## Failure report

A failure report must state the property address, exact claim, operator-facing
section, expected behavior, visible behavior, screenshot path, trace path, and
relevant console or network evidence. Return it to the implementation role.
After correction, rerun the complete workflow; never rerun only the failed
assertion.

## Verification checklist

- [ ] Fresh address entered through New Lead when required
- [ ] Full-page and close screenshots cover every changed section
- [ ] Console and failed-network evidence recorded
- [ ] Visible counts reconcile with rendered rows and canonical accepted data
- [ ] Empty states, contradictions, and contamination explicitly checked
- [ ] Refresh and managed-restart visual reinspections completed
- [ ] Trace and video retained and every created page/context closed
- [ ] Every claim has an explicit verdict and visible evidence
- [ ] Incomplete evidence produced `FAIL`
