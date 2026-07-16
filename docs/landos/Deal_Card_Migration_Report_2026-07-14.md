# Deal Card Migration Report — 2026-07-14 system-wide repair

Every current deal card was reconciled idempotently (model v2), re-projected
through the repaired shared read path, and — where a jurisdiction adapter
exists — its public property-intelligence mission was run. Seller/CRM data,
operator notes, raw intake, accepted evidence, documents, visuals, provider
observations, activity, and previously accepted address/APN values were all
preserved (verified against `landos_property_card` rows before/after).

Research = core screening lanes with accepted evidence (of 8).
Audit = shared consistency audit (25 checks).

| Deal | Property (address · APN) | Prev status | New status | Research | Value | Strategy | Offer | Audit | Comp accounting | Migration |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2510 State Highway 153, Winters, TX · R000020383 | complete_with_gaps (false-clean) | Research progress report | 0/8 | not_ready | all blocked | researching | PASS | 0 sold / 0 active | reconciled; mission BLOCKED (no TX adapter) |
| 2 | 388 Gilstrap Rd, Cleveland, GA 30528 · 021 033 002 | same | Research progress report | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; mission BLOCKED (no GA adapter) |
| 3 | 3401 62nd St W, Lehigh Acres, FL · 02-44-26-L4-08070.0100 | same | Research progress report | 0/8 | not_ready | all blocked | researching | PASS | 0 sold / 15 active | reconciled; mission BLOCKED (no FL adapter) |
| 4 | 3401 62nd St W, Lehigh Acres FL (unverified dup) · — | unresolved | Research progress report (resolution gated) | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; safe |
| 5 | Parcel 397-1-1-106, Newberry, SC · 397-1-1-106 | same | Research progress report | 0/8 | not_ready | all blocked | researching | PASS | 0 sold / 15 active | reconciled; SCDOT lane needs address match (card lacks street; county derived) — retriable |
| 7 | 50 Nelson Rd, Jackson Gap, AL · 62 11 05 21 0 000 007.008 | same | Research progress report | 0/8 | conflicted | all blocked | researching | PASS | 4 sold / 59 active of 68 raw | reconciled; mission BLOCKED (no AL adapter) |
| 8 | 3705 24th St W, Lehigh Acres, FL (unverified) · — | unresolved | resolution gated | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; safe |
| 9 | Henson Lane blob (unverified) · — | unresolved | resolution gated | 0/8 | not_ready | all blocked | researching | PASS | 0 sold / 6 active | reconciled; safe |
| 10 | Scott County, TN (area lead, unverified) · — | unresolved | resolution gated | 0/8 | thin_evidence | all blocked | researching | PASS | 50 sold / 54 active (area context) | reconciled; safe |
| 11 | Henson Lane, Scott County, TN · 094-020.08 | complete_with_gaps (false-clean) | Research progress report | 6/8 | conflicted | all blocked | researching | **FAIL (by design)** — displayed 5.12 ac (official) vs 0.98 ac (card) | 6 sold / 13 active of 33 raw (8 rejected) | mission RAN (official parcel = EIGHINGER, 5.12 ac, Zone A 100% SFHA, soils very limited, no mapped road contact). **AWAITING TYLER**: official owner/acreage differ from card values — nothing changed silently |
| 12 | Henson Lane, Oneida, TN (unverified) · — | unresolved | resolution gated | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; safe |
| 13 | 1600 Pennsylvania Ave, Athens, GA (unverified) · — | unresolved | resolution gated | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; safe |
| 14 | 473 Seaside Rd, St Helena Island, SC · R300 018 000 0085 0000 | prior full run | Preliminary intelligence report | 8/8 | thin_evidence | all blocked | blocked | PASS | 1 sold / 10 active of 27 raw (16 rejected) | reconciled; already evidenced |
| 15 | 002-07637-000 (+ -07579-000), De Queen, AR · 002-07637-000 | complete_with_gaps (false-clean) | Research progress report | 0/8 | not_ready | all blocked | researching | PASS | 0 sold / 10 active of 18 raw | reconciled; mission BLOCKED (no AR adapter) |
| 17 | 171 Camp Davidson Rd, Vonore, TN · 062 059G A 03400 000 2026 | same | Research progress report | 6/8 | ready | scoreable | researching | PASS | 66 sold / 51 active of 128 raw | mission RAN (TN APN match; flood X, soils very limited, Camp Davidson Rd ~389 ft proximity) |
| 18 | 999 Model Validation Test Ln, Beaufort County, SC (test, unverified) · — | unresolved | resolution gated | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; safe |
| 19 | **200 Sid Edens Rd, Pickens, SC 29671 · 5105-00-44-0497 (acceptance)** | complete_with_gaps w/ 22 live contradictions | Research progress report | 7/8 | ready | scoreable | researching | PASS 25/25 | 55 sold / 51 active of 118 raw (10 dup merged, 2 rejected; equation reconciles) | mission RAN (official SCDOT parcel; flood X 100%, soils somewhat limited, slope 3.8%, Sid Edens Rd ~546 ft proximity, utilities screen). **NOTE FOR TYLER**: official assessed 1.32 ac vs mapped/provider 1.15 ac — both displayed, calc uses 1.15 |
| 20 | 12345 Sprint Test Rd, Pickens, SC (test, unverified) · — | unresolved | resolution gated | 0/8 | not_ready | all blocked | researching | PASS | 0/0 | reconciled; safe |

Notes
- Card 16 is archived (terminal status; downstream disabled by design).
- Card 6 does not exist (gap in the id sequence).
- "Mission BLOCKED (no adapter)" is a true external gap: `lookupOfficialParcel`
  records the honest attempted trail; new jurisdictions plug in as registry
  entries / adapter branches (SC statewide + TN improvements shipped this sprint
  prove the path).
- No card, seller, CRM, note, document, visual, or activity row was deleted or
  overwritten. Reconcile is idempotent (second runs report "no changes needed").
