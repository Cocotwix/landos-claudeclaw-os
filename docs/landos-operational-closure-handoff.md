# LandOS Operational Closure Handoff
## Make the Lead and Deal Card Operational End to End

**Current baseline:** Stages 0–5 have produced useful underlying capabilities, but the Deal Card is **not operationally accepted**.
**Primary instruction:** Fix forward. Do not add unrelated features, frameworks, or refinements. Make the one complete operator workflow work reliably from a fresh New Lead through a complete, current, usable Deal Card.

---

## 1. The only outcome that matters

LandOS must work as an operating acquisition machine, not as a collection of technical features.

> An operator enters whatever evidence arrived with a seller lead—an address, APN, LandPortal link, survey, deed, map pin, seller text, parcel description, photos, or incomplete clues. LandOS identifies the actual acquisition subject or asks one focused question, creates or resolves exactly one active Deal Card, gathers the appropriate evidence, analyzes the property and market, values it from current comps, evaluates plausible exits, and presents a concise current acquisition brief with clear next actions.

Do not return with another isolated feature, a new status surface, an additional architecture proposal, a partial audit, or a successful typecheck while this workflow still fails. Continue the internal work until the operational acceptance contract is demonstrably satisfied.

---

## 2. Operational definition of done

A Deal Card is operational only when a fresh lead can complete this sequence without manual database intervention, manual repair, or code changes between runs:

| Step | Required working behavior |
| --- | --- |
| **1. Intake** | Accepts complete or incomplete lead evidence and preserves the raw evidence. |
| **2. Subject understanding** | Establishes the acquisition subject, associated/retained parcels, correct jurisdiction, governing acreage/boundary, and confidence—or asks one precise clarification. |
| **3. Canonical resolution** | Creates or resolves exactly one active canonical Deal Card for that acquisition subject. A later duplicate submission resolves to that card rather than making a second active card. |
| **4. Evidence and research** | Collects/reconciles available LandPortal, public/assessor/official-record, document, property, market, visual, comps, and provider evidence. A blocked provider is a visible provider state, never a workflow hang. |
| **5. Intelligence** | Renders current Property Intelligence, Market Intelligence/Market Pulse, Visual Intelligence where available, Seller Intelligence or an explicit pending state, and Zoning/Development Path with source/currentness evidence. |
| **6. Comparable intelligence and value** | Produces the approved valuation views and a current Combined LandOS FMV when usable price-bearing evidence exists; active competition and manufactured-home-with-land evidence remain separately classified. |
| **7. Strategy and decision** | Compares viable/blocked/pending strategies, including quick flip, minor subdivision, major subdivision/entitlement, and Land Home Package when applicable. Deal Brain consumes the same current evidence and value package. |
| **8. Operator guidance** | Gives one clear LandOS next action and one operator next action, while clearly identifying the decisive risks, missing facts, evidence confidence, and limitations. |
| **9. Reliability** | Behaves correctly after refresh, rerun, correction, and duplicate submission; preserves history but never lets old/uncorrelated evidence present as current guidance. |

A card may say **“research incomplete,” “provider unavailable,” “no defensible FMV yet,” or “confirm this one fact”** where justified. It may not hang, create duplicate active cards, lose retained evidence, mix related parcels into the subject, invent facts, or force the operator to manually reconstruct the deal from disconnected tabs.

---

## 3. Known current defects that must be closed

The status summary identifies these operational gaps. Treat them as one integrated closure effort, in the order that makes the product work—not as separate new product stages.

### A. Restore the canonical Deal Card read model

Deal 90 is the intended canonical record for the Eugene Hill acquisition subject. Deals 114 and 115 are explicit archived aliases. Immutable evidence still attached to those aliases must remain immutable, source-owned, and fully reachable from Deal 90 through a tightly scoped canonical-family read resolver.

Implement the smallest correct repair so that Deal 90 reads artifacts belonging only to itself and its explicit archived aliases 114/115. Preserve original ownership, timestamps, source lineage, and audit history. Do not copy immutable evidence, weaken immutability, or use a broad union that could combine unrelated property families.

Current run selection must use accepted subject equivalence, subject version/currentness, chronology, artifact completeness, and operator acceptance—not only the largest mutable sequence number. Restore the appropriate imagery, geometry, research artifacts, valuation package, and current Decision/Intelligence artifacts on Deal 90.

For this subject, the active working basis is:

```text
Bradford County, Florida
APN 00083A03400
Accepted acquisition subject: 1.50-acre conveyed portion
Accepted governing evidence: signed boundary survey held by the operator
Canonical subject version: promote the accepted survey basis onto Deal 90 through the normal identity writer, preserve the Deal 90 and Deal 115 identity lineages, and generate a new verified canonical subject version for Deal 90. Do not hard-code or permanently reuse Deal 115's alias subject version as Deal 90's canonical version.
Historic 1.846-acre DEP/cadastral geometry: retained, historical, nongoverning
Retained manufactured-home parcel: related property, not the acquisition subject
```

Archived alias routes must visibly resolve to Deal 90 and be read-only. They must not allow new research, editing, or a separate current lifecycle.

### B. Stop future duplicate Deal Cards

Wire the existing canonical identity parser and subject-understanding behavior into the **actual production New Lead path**.

Normalize and interpret APN, address, state, ZIP, acreage, ownership, parcel geometry, and acquisition scope before permanent Deal Card creation where possible. Where evidence is incomplete, create a reversible provisional identity rather than an irreversible competing card.

When authoritative or operator-accepted evidence arrives, rematch the record. Enforce database-backed concurrency protection so overlapping submissions cannot produce two active canonical cards for the same normalized acquisition subject. Preserve genuinely distinct partial-parcel acquisitions, split boundaries, and assemblages; they are not duplicates merely because they are adjacent or share ownership.

### C. Make provider and request behavior terminal and bounded

Diagnose and repair the authenticated focused-request hang. A valid authenticated request must reach a defined terminal state within a bounded timeout, and the cause must be established by tracing actual code/runtime evidence rather than adding another generic timeout wrapper.

Every provider run must end in an explicit state such as `complete`, `partial`, `unavailable`, `blocked`, `requires_operator_action`, `timed_out`, or `failed`. One provider cannot block the rest of property research, market research, comp/valuation work, rendering, or Deal Brain.

Do **not** implement CAPTCHA bypass, browser fingerprint concealment, proxy rotation, CAPTCHA solving, or other access-control circumvention. Zillow, if available, is optional enrichment. If interactive access is challenged, record the provider status and continue the workflow with LandPortal, Redfin, Realtor.com, county/public sources, and approved manual/operator-added evidence. Operator-assisted source capture or an expressly authorized/licensed source is acceptable; stealth automation is not.

### D. Make current artifacts and decisions actually current

Safely promote retained unstamped artifacts only when exact accepted-subject equivalence is established. Generate/recompute current Property Intelligence, Market Intelligence, comparable/valuation, strategy, and Deal Brain artifacts against the accepted canonical subject.

A material change to the accepted subject, admitted comp evidence, selected comp set, valuation, or strategy evidence creates exactly one new correlated current snapshot/decision. An identical rerun creates no write. Prior artifacts and decisions remain accessible history. A historical/uncorrelated artifact cannot render as current risk, strategy, FMV, zoning, or operator guidance.

### E. Complete Comparable Intelligence and FMV within this operational closure

Use the accepted existing comparable workflow. Do not replace it with a second system.

- Merge approved LandPortal sidebar and Show on Map records, Redfin, Realtor.com, Zillow only when available/authorized, county/manual, and other existing approved source lanes into one canonical deduplicated registry.
- Preserve source attribution and richer multi-provider evidence. A property shown by two providers is one record, not two comps.
- Keep closed vacant-land sales separate from active/pending competition, improved-property context, manufactured-home-with-land records, rejected records, and context records.
- Preserve LandPortal’s own land-specialist comp set and provider FMV as a source-backed valuation view when available.
- Preserve an external/expanded-comp valuation view where approved non-LandPortal evidence exists.
- Preserve the accepted valuation rule for this operational release. When both components are available, calculate **Combined LandOS FMV = (LandPortal FMV + Non LandPortal FMV) / 2**. Do not reinterpret or recalculate LandPortal's provider FMV. Calculate Non LandPortal FMV from the qualified selected closed-sale set. If only one component is temporarily available because of a genuine external source failure, keep Combined LandOS FMV populated from the available component, reduce confidence, and display the exact limitation. Do not introduce a new valuation methodology during operational closure.
- Display the exact standard operating benchmarks only from the current Combined LandOS FMV: `40% = FMV × 0.40` and `60% = FMV × 0.60`. Do not display a 50% value. Keep seller ask and strategy-specific maximum purchase basis separate.
- Use governing subject acreage for final value conversion, but use an adaptive candidate-comp acreage band for discovery and selection. A 1.5-acre small lot may appropriately compare with useful roughly 0.5–2.5-acre small-lot sales; a larger rural subject may require a wider proportional range. Do not hard-code a nationwide acreage rule.
- Target five useful sold comps when available. Use fewer if necessary. Do not add bad records merely to reach five, and do not declare a thin market unpriceable if useful evidence still supports a low-confidence current FMV.
- If no usable price-bearing evidence exists after documented reasonable collection/expansion, do not fabricate a value. Show valuation collection incomplete, preserve evidence, and provide the next LandOS action.
- Show up to five relevant active land listings separately as resale competition. Manufactured-home-with-land comps remain separate Land Home Package evidence and never affect vacant-land FMV.

Every valuation must carry accepted subject version, selected-comp-set version, comp evidence fingerprint, valuation method/search-policy version, confidence, retrieval/production time, and currentness correlation. Strategy Comparison and Deal Brain may use it only when the package is current and correlated.

### F. Finish development-path and strategy decision support

Retain the current Stage 5 rule: resolve the relevant local authority first. Current zoning, by-right uses, minor-subdivision processes, major-subdivision/entitlement pathways, dimensional/access/utility/environmental requirements, approval steps, and costs/timing may be stated only with current, source-specific authority evidence. LandOS must not guess a zoning district or hard-code a national subdivision definition.

For each applicable exit, show whether it is viable, potentially viable pending facts, blocked, or not applicable. Make strategy tradeoffs legible: expected path, dependencies, timing, cost/risk assumptions when source-backed or operator-supplied, and the decisive fact that would change the posture. Do not manufacture entitlement probability, development economics, or maximum purchase basis.

---

## 4. Single release command and acceptance gate

Create one minimal, reproducible repository command:

```text
npm run landos:deal-card:release
```

This command must exercise the same production New Lead entry path used by the operator, but in isolated sanitized QA storage with approved fixtures. It must run **exactly five consecutive complete cases**; do not report five batches or five individually repaired tests.

The cases must cover:

1. clean address + APN;
2. address only;
3. malformed/mixed APN, acreage, state, or ZIP clues;
4. thin market or an unavailable external provider; and
5. partial parcel, related parcel, retained improvement, or assemblage boundary.

No code change, manual database edit, manual repair, or non-fixture evidence injection may occur between successful runs. If a run fails, diagnose and repair the defect, reset the consecutive count to zero, and rerun from clean isolated QA storage.

The release command and browser acceptance must prove all of the following:

| Contract | Required proof |
| --- | --- |
| Canonical identity | One active Deal Card; duplicate submission resolves to it; related properties do not contaminate the subject. |
| Evidence | Current versus historical separation; source lineage; official/deed evidence retained when available; clear limitations when unavailable. |
| Intelligence | Property, Market, Seller state, zoning/development path, and visual intelligence complete or clearly state their evidence limitation. |
| Valuation | LandPortal/external/combined value views when available; one current Combined LandOS FMV under the evidence rules; 40%/60%; separate active competition and Land Home Package evidence. |
| Decision | Strategy Comparison and Deal Brain consume the same current package and return risks, opportunity, LandOS action, and operator action. |
| Reliability | Provider failures terminate without hanging the lead; material change creates one new current decision; identical rerun writes nothing; refresh/page load writes nothing. |
| Regression | Deal 90 remains correct; aliases 114/115 resolve to it read-only; Deal 89 retains its accepted subject, Fairview zoning/development path, and current intelligence. |
| Runtime quality | Focused tests, typechecks, production build, managed restart, health, browser console, hard refresh, navigation, and GET-only assertions pass. |

---

## 5. Implementation approach and authorization

You are authorized to make the smallest repository, database, UI, migration, test, and runtime changes necessary to meet this contract.

Before any migration or business-data-changing operation, create and verify an encrypted backup of the business database. Preserve immutable evidence and provenance. If a repair requires a decision that could irreversibly alter a real transaction, seller communication, external system, license/credential, payment, or business evidence, stop and report the exact decision. Otherwise, make the lowest-risk correct engineering decision and continue without returning for incremental architectural approval.

Use one primary working tree. Use subagents only for independent read-only investigation or verification. Do not create temporary Git worktrees, symlinks, directory junctions, or shared `node_modules` links.

Do not push. Local checkpoint commits are permitted after a coherent verified boundary only when the relevant focused tests, database integrity checks, typecheck/build as applicable, and runtime health pass. A checkpoint commit is a rollback safeguard, not operational acceptance or a release. Do not include unrelated or excluded files. After all five consecutive cases pass, return one final implementation report containing the items below and stop for Tyler's approval. Do not create the final release commit or push until Tyler approves. After approval, the final operational acceptance may receive its own focused release commit. A push requires separate authorization.

1. the exact release-command results, including the five consecutive case summaries;
2. the complete before/after data flow;
3. all changed files and why they changed;
4. canonical family/alias evidence-routing proof;
5. duplicate prevention and correction/rematch proof;
6. authenticated request-hang root cause and resolution;
7. provider terminal-state/fallback proof;
8. comp merging, valuation views, Combined LandOS FMV, 40%/60%, and currentness evidence;
9. strategy/Deal Brain correlation and idempotence evidence;
10. QA, Deal 90, and Deal 89 browser/hard-refresh/regression proof;
11. test/typecheck/build/runtime health results;
12. backup location/verification method and restore-test status;
13. honest remaining limitations; and
14. final `git status` plus any proposed commit message(s).

The final report must answer only one practical question: **can Tyler now enter a real lead and receive a complete, accurate, usable Deal Card without manually repairing the system?**

**Basis:** The September 3, 2026 independent operational-status summary and the LandOS operating requirements provided by the operator. **Assumptions:** The reports accurately identify the current canonical migration state, retained artifacts, and outstanding integration defects; the coding agent must verify repository/runtime/database facts before changing them. **Sources & confidence:** High confidence in the operational acceptance contract and closure ordering; actual code paths, database contents, and external-provider availability require direct verification.
