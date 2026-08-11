---
name: landos-systematic-debug
description: Use when canonical LandOS state and localhost visible behavior disagree.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, debugging, projection, browser, root-cause]
    related_skills: [systematic-debugging, test-driven-development, node-inspect-debugger]
---

# LandOS systematic debug

## Overview

Trace an operator-visible disagreement from canonical persistence through every
projection and rendering boundary. The `landos-debug` profile diagnoses and
recommends a narrow correction; it does not independently accept that repair.
An implementation role may apply the correction only when separately assigned
implementation authority.

## When to use

- Canonical accepted records exist but a Deal Card section is empty.
- Displayed counts contradict rendered rows or artifacts.
- Refresh or restart changes what the operator sees.
- A frontend, API projection, Node runtime, or Python worker fails visibly.

Do not begin with a broad repository audit. Start from the exact visible defect,
current property identity, affected section, and directly relevant request.

## Diagnostic sequence

1. Use bounded shell and isolated Playwright/browser diagnostics to reproduce the exact
   operator-visible defect. Record address, APN when present, Deal Card identity,
   section, visible text/counts, and time. CDP is allowed for diagnostic targets,
   but never extract cookies, tokens, credentials, or browser storage. Completion criterion: another operator can
   reach the same discrepancy without reading code.
2. Inspect rendered DOM and accessibility state using stable visible roles and
   labels. Determine whether data is absent, hidden, filtered, duplicated, or
   contradicted by summary text.
3. Inspect browser console messages and relevant or failed network requests.
   Preserve request identity, status, response shape, and timestamps without
   exposing credentials or cookies.
4. Inspect the API projection that serves the visible section. Compare its
   property identity, category status, counts, and records with what rendered.
5. Inspect canonical storage read-only. Confirm the accepted record belongs to
   the exact current address/APN/property id and distinguish accepted evidence
   from context-only, rejected, duplicate, or failed evidence.
6. Trace every transformation between persistence and rendering: canonical
   query, mapper, API serializer, client fetch/cache, selector/filter, component
   props, and rendered rows or artifacts. Completion criterion: every observed
   value has a named producing boundary.
7. State one testable root-cause hypothesis. Include the predicted observation
   that would prove it and the observation that would reject it.
8. Run the narrowest discriminating check. Reject the hypothesis when evidence
   disagrees; do not preserve it by adding assumptions. A failure pattern seen
   twice requires permanent regression coverage.
9. Recommend one narrow correction at the proven boundary. Repository/runtime
   access remains read-only; a separately assigned implementation owner must
   protect unrelated dirty work, add regression coverage, and apply any change.
10. Hand the result to independent `landos-visual-qa`. The debug profile may
    report `ready for independent visual acceptance`; it may not issue the
    acceptance verdict for its own correction.

## Root-cause report

Report the visible defect, exact property, evidence from DOM/accessibility,
console, network, API projection, canonical storage, transformation trace,
hypothesis, proof or rejection, narrow recommendation, and regression coverage.
Separate facts from inference.

## Common pitfalls

- Treating a database row or HTTP 200 as proof that the operator sees it.
- Inspecting a different property, cached session, or nearby parcel.
- Repairing a downstream component when the projection already omitted data.
- changing multiple boundaries before one hypothesis is proved.
- certifying the repair from the same role that diagnosed or implemented it.

## Verification checklist

- [ ] Exact visible defect reproduced and property identity fixed
- [ ] DOM/accessibility, console, and network inspected
- [ ] API projection compared with canonical accepted storage
- [ ] Every persistence-to-render transformation named
- [ ] One falsifiable hypothesis proved or rejected
- [ ] Recommendation is narrow and regression coverage is identified
- [ ] Independent full visual acceptance remains required
