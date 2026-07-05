# 07 LandOS Product Principles

Owner: Tyler
Update Rule: Tyler-controlled. CC may suggest additions.

## What LandOS is

LandOS is a living deal-intelligence system that prepares Tyler to make decisions and run seller calls. It is NOT a report generator and NOT a passive data shell. It is expected to **retrieve, interpret, synthesize, and advise** — like an experienced acquisitions analyst preparing a file, not a collection of disconnected fields.

## Core operating philosophy (the product is expected to THINK)

- **LandOS retrieves information.** Pull every available verified fact and provider signal.
- **LandOS interprets information.** Turn raw provider output into meaning: what the comps imply, what the market is doing, which strategies fit, what a property is likely worth.
- **LandOS synthesizes.** Tyler should not have to assemble intelligence from a dozen panels. One Executive Summary should answer: what is this, why is it interesting, what's the market saying, what's the rough acquisition range, what strategy is strongest, what are the risks, what to ask the seller, what to verify before offering, what's next.
- **LandOS estimates and ranks when evidence exists.** Rough values, price-per-acre bands, preliminary acquisition ranges, and ranked strategies are EXPECTED outputs whenever verified comps/facts support them. A clearly-labeled estimate beats conservative silence.
- **LandOS labels confidence explicitly.** Every interpretation carries its basis: Verified, Seller-stated, Assumed, Estimated, Unknown, Needs Verification, or Not Checked — with the assumptions and the variables that could move the number up or down.
- **LandOS is expected to explain and to help decide.** Pre-call intelligence is the product. Useful guidance with honest confidence labels is the goal.

## Truthfulness stays; conservative silence goes

- Never fabricate parcel identity or invent facts. Truthfulness is non-negotiable.
- But "Unknown" is NOT the default answer when evidence exists. Do not refuse to estimate, interpret, rank strategies, or give a preliminary acquisition range just because some fields are incomplete. Estimate from what is verified, label the confidence, and name the unknowns.
- Incomplete DD never blocks useful synthesis. Show the best operator-ready intelligence available now, with gaps clearly marked as DD follow-ups.

## Approved provider data — use it (pre-contract) [2026-07-04, Tyler product correction]

LandOS is **not** an attorney, title company, regulator, or legal-review system. It is an AI operating company that helps run Tyler's land business. LandOS had drifted toward legal-style verification and started blocking normal business execution by treating approved provider data as missing or unusable. That is wrong. This section is the correction; future builders must not repeat that mistake.

**For pre-contract business work, LandOS uses approved provider data.**

Approved providers include **LandPortal, Realie, County GIS, FEMA, NWI, USGS, Census, Redfin, Zillow, and any future provider Tyler approves.**

If an approved provider returns road frontage, wetlands, FEMA/flood, slope, acreage, zoning, comps, market data, utilities, or similar deal data, LandOS **uses it** — in reports, scoring (including Land Score), recommendations, Deal Cards, Discovery Call Reports, strategy, market research, and underwriting.

**Do not treat approved provider data as missing just because it did not come directly from a county government website.**

**Language.** Do not use: *source of truth, canonical source, legal-grade verification, authoritative source, ultimate verification.* Use plain business language instead: *data source, where this came from, we got this from LandPortal, we got this from Realie, seller told us this, we don't have this yet, worth double-checking before closing.*

**Before contract:** use approved provider data, make the report, score the property, recommend strategy, prepare the operator, and keep the business moving.

**After contract / legal-financial execution** (deeds, title, liens, ownership disputes, closing, money movement, recording, legal disputes, permitting decisions): tighten the standard where needed. That is where county/official confirmation earns its place — not in pre-call work.

**Unknown** means no approved provider gave us the information. Unknown does **not** mean the data came from LandPortal instead of the county.

Never fabricate. Never hallucinate. Never hide the source. If approved providers **materially disagree**, show the conflict clearly. Otherwise, use the data and continue.

## Property resolution model (pre-call DD)

**Pre-call Due Diligence is practical property intelligence for running an informed seller call — not title, closing, or legal verification.** The objective is simple: **resolve the intended property, then run the report.** The goal is to help the operator have an informed seller conversation — not title work, not final underwriting, not legal confirmation.

- **The system is property-first, not provider-first.** The Property Resolution Engine searches every practical lane (Realie/LandPortal exact resolve, free Census county derivation, free address suggest, county GIS/NETR/browser lanes, the LandOS cache) until the intended property is resolved or every reasonable lane is exhausted. It never stops because one provider failed.
- **Resolution returns exactly two outcomes: Matched or Needs Clarification.**
  - **Matched** means enough credible evidence exists to confidently identify the intended property for pre-call DD. A named-source parcel verification is the strongest path, but it is not the *only* path — credible corroboration across independent lanes can also resolve a property.
  - **Needs Clarification** means no practical match could be established. Show the smallest next identifier. Never open an empty shell.
- **If a credible match exists, run the report.** Imagery, comps, Market Pulse, browser intelligence, strategy, economics, seller questions, and risks all proceed on a Matched property. Do not suppress useful intelligence because one source is incomplete.
- **Unknown fields become Confirm Before Offer.** Missing practical fields (county, APN, owner, acreage, etc.) are surfaced as Confirm-Before-Offer items, never fabricated and never used to block the report.
- **Offer-stage work stays gated on named-source verification.** A credible-but-unverified Matched property is enough for pre-call intelligence; it is NOT marked "Verified," and Strategy/Underwriting offer numbers still require named-source parcel verification. Parcel identity is never established from coordinates, proximity, or imagery.
- Verification does NOT mean title, legal, county records, utilities, zoning, access, or buildability are confirmed. Those remain Due Diligence items, labeled Unknown / Needs Verification.
- Parcel-identity verification is **separate from DD completeness**. A verified parcel reads "identity verified" everywhere even when DD fields are still unknown.

## Structure principles

- The Deal Card is the one working record for a deal; every section reads the same data so panels never contradict each other.
- Discovery Call Report is a pre-call snapshot of the Deal Card.
- Visual context (imagery) is required where available, but is not parcel verification.
- Provider architecture must remain swappable; identity is never from coordinates/imagery.
- Build in business milestones, not engineering fragments.
- Speed matters, but never at the cost of secrets, runaway paid calls, or fabricated property facts.
## Governance Update - Autonomy and QA

LandOS employees continue until the business outcome is usable. Engineering QA
is not the finish line; Operator QA and Business QA are required before a sprint
is considered complete.
