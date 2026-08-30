# Browser QA — WS4 Unified Evidence Admission and Result Vocabulary

- Date: 2026-08-30
- Runtime: managed local LandOS
- Verdict: PASS

## Journey

1. Created one controlled `lead_type=test` fixture, Deal 94, with a confirmed test-only subject identity.
2. Staged two browser facts: an extracted road-frontage answer and a not-found well item.
3. Promoted through `promoteBrowserFactsToEvidence` / `writeEvidence`. Exactly one evidence row was admitted; the unanswered/not-found row was not.
4. Read the canonical row back: subject Deal 94 / identity version 106, fact `road_frontage_ft=310 ft`, source `Iredell County GIS QA fixture`, source tier `county_gis`, verification `retained_not_identity_verifying`, confidence `confirmed`, capability and collector `browser-intelligence`, and retained retrieval timestamp.
5. Readiness reconciliation consumed the promoted canonical evidence and marked Road Frontage green/returned with the reason `Road frontage retained at 310 ft (property_evidence)`. The live Overview rendered **3 / 18 Returned**.
6. Hard-refreshed the live Overview. **3 / 18 Returned** persisted; browser console errors: zero; the read triggered no research run.
7. Permanently deleted the exact controlled test fixture after validating its `lead_type` and title. No operating Deal Card was changed.

## Evidence

- `.runtime/landos/qa/shared-foundation-ws4-browser-evidence.jpg`
- `src/landos/shared-evidence-contract.test.ts` proves deterministic/adaptive admission, run attribution, late-write rejection, readiness consumption, confidence normalization, and all seven canonical result states.

The browser journey also contrasted Deal 92's actual readiness: completed-but-unanswered lanes remain partial/unresolved or blocked, never returned merely because a worker ran.
