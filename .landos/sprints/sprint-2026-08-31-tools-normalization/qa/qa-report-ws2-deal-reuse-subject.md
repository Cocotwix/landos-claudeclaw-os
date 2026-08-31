# Independent Browser QA — ws2-deal-reuse-subject

- Verdict: PASS
- QA agent: independent browser-QA (Claude), 2026-08-31T15:14–15:35Z
- Runtime: npm run landos:status → RUNNING (healthy), PID 48764, port 3141, single verified server
- Surface: http://localhost:3141/tools in operator Chrome (own tab, session tab group)

## Journey results

1. Picker renders. "USE AN EXISTING DEAL (OPTIONAL)" select present with default
   "No Deal selected — research the raw input below" and 30 real deal titles
   (deals 81–113 minus soft-deleted 82 and nonexistent 91/94; exclusion of the
   soft-deleted deal verified correct via landos_deal_card.deleted_at).
2. Selected Deal 113 "Parcel 023.003-02, Hamilton County, TN" (option value=113
   verified in DOM). Note appeared verbatim: "Research runs against this Deal's
   canonical subject — LandOS will not re-resolve or reinterpret its identity.
   Clear the selection to research raw input instead."
3. Ran Comps & Valuation. On-screen: "COMPS & VALUATION · Retained comp
   evidence only · Subject RESOLVED · Insufficient closed-sale evidence ·
   Reused persisted result". Honest no-valuation: "No land value is established
   for this subject: No credible closed vacant-land sale currently supports
   valuation. Asking references and active listings indicate market positioning
   but do not establish fair market value." All value tiles "Not established",
   confidence "unavailable". Subject line: "The subject is 40.5 acres...".
   Returned-vs-accepted separation explicit: "Comparable evidence: 72 canonical
   record(s), 0 pricing this subject, 33 active competitor(s), 42 placed,
   30 location(s) unresolved"; comp rows labeled "active competition". Footer:
   "Subject: 94 · Invocation: cap_d65bbd31-5d65-42ae-a9f3-f7f81f4e8ee4".
4. Identity cross-check. Deal Card via Acquisitions → /dept/acquisitions/v2?deal=113:
   header "DEAL 113 · 5170 HIGHWAY 60 · APN 023 003.02 · 40.5 AC · HAMILTON
   COUNTY, TN"; FMV "Pending · 0 accepted sales" — consistent with Tools.
   DB (read-only, store/landos.db): landos_deal_card_property deal 113 role
   subject → card_id 94; landos_property_card 94 = APN "023 003.02", Hamilton,
   TN, 40.5 ac. Newest comps-valuation invocation: caller_type='tools',
   subject_kind='canonical_property', subject_deal_card_id=113,
   subject_ref='94', resolution_state='RESOLVED'. No re-resolution.
5. Adversarial no-side-effects. Before: 31 deal cards, 24 property cards,
   0 leads, 480 invocations. After all QA runs: 31 / 24 / 0 / 481 — the single
   new row is my standalone raw resolve (caller_type='tools',
   subject_kind='raw_property', subject_deal_card_id=NULL). Deal 113
   updated_at unchanged (== created_at). No Deal Card mutated, no card/lead
   created. The Deal-selected Comps run reused the persisted result (UI said
   so) and created no new rows.
6. Hard refresh (Ctrl+Shift+R, twice). Selection survived both times
   (option value=113 still selected; canonical-subject note still shown).
   Invocation count unchanged across all page loads (480 before/after) — no
   capability fires on load. Console: zero messages/errors after reload with
   tracking active. Page rendered cleanly.
7. Regression. Cleared to "No Deal selected"; raw input "333 Cranfill Rd,
   Harmony, NC" + Resolve property → "RESOLUTION RESULT · UNRESOLVED · reuse"
   with honest fields (APN/owner/acres "Not established", county Iredell NC,
   "Needed next: A parcel identifier from an official parcel source",
   TIGERweb provenance). WS1 Market Research: "Iredell County, NC" Market
   Pulse → "Iredell, NC · reused retained run · LOCAL AREA CONTEXT, NOT PARCEL
   VERIFIED", median $50,591/acre across 316 sales, "Market context only, not
   a valuation basis". Both paths intact.

Deal-without-subject error path: not exercisable — every non-deleted deal card
in live data has a subject link (verified by query); no data was created to
force it (read-only mandate). Not counted for or against.

## Findings (non-blocking, recorded)

- OBS-1 (low, in-scope polish): five picker options render identical text
  "Parcel 023.003-02, Hamilton County, TN" (deals 108/109/111/112/113) with no
  Deal # or date disambiguation. All five verified to carry the same parcel
  identity (APN 023 003.02, Hamilton TN, 40.5 ac) on different property cards,
  so no wrong-identity outcome is possible in live data; recommendation:
  prefix option labels with the Deal id.
- OBS-2 (low): the on-screen result panel clears on hard refresh; the
  selection persists and re-running reuses the persisted result without
  recompute ("Reused persisted result"). The controlling journey requires only
  the selection to survive; persisted result state does survive server-side.
- DEF-1 (deferred, outside workstream, patternKey same-label-different-basis):
  Comps & Valuation "SALE WINDOW" reads "30-month sale window to 2024-02-29"
  on a run retained 2026-08-31 — an end date ~2.5 years in the past. This is
  the shared comps-valuation capability display (identical for deal-card
  callers), not the WS2 deal-reuse wiring; it does not block the assigned
  outcome (0 closed sales either way) but the window basis deserves review.

## Evidence
- Screenshots: picker default state, deal-113-selected state, Deal Card 113
  header (captured in-session via operator Chrome; one screenshot attempt
  timed out while the native select popup was open and was retaken).
- Page-text reads recorded above verbatim for the comps result, resolution
  result, and market pulse (substituted where a native popup blocked capture).
- DB reads: read-only better-sqlite3 queries against store/landos.db as quoted.

## Teardown
- Tabs opened by this QA session: 1 (tabId 494897952). Closed: 1.
- Pre-existing tab 494897949 (already at /tools before QA began) left untouched.
