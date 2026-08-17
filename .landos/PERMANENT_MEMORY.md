# LandOS Permanent Operating Memory

Process, scope, stop conditions, acceptance tiers and approval gates live in
`.landos/CODING_SESSION_PROTOCOL.md`, the canonical
contract; the active handoff in `.landos/CHECKPOINT.md`.

## Acceptance authority

The live localhost owner experience decides completion; tests, builds, database
rows, and HTTP 200 alone do not establish completion. Staged workstreams and
independent live browser QA are support only. Never claim completion while an
owner-requested, decision-critical result is missing, unusable, or unverified by
you. Only required new authority or a real external blocker may pause work;
report the exact visible blocker, never success. The contract's stop conditions
bound that obligation.

Dev control: Git `main` + exact-SHA gate; PASS/FAIL durable; `STATE.md`
generated; business DB separate.

## Research answers

Return the best reasonably supported answer, naming its source and weight:
Confirmed, Well supported, Likely, or Unresolved. A failed source path is not a
failed research question: retry once, then change method. Start the dedicated
LandOS browser, Google the question in plain English, read promising pages,
follow citations, reword until answered. Never report unknown or unavailable
first. On a CAPTCHA, one more try or two minutes, then switch engine or route.
Starting or switching approved research tools is in scope; new tooling is not.
Secondary and search-result evidence may carry an answer; official-only and
perfect-verification gating are rejected. See contract section 9.

## Data and identity invariants

1. Repair the shared root of the demonstrated defect class system-wide. A
   property is an acceptance example, never implementation scope; the repair
   never authorizes unrequested cases or surfaces.
2. Parcel identity gates property intelligence. Confirm it from an APN plus
   county, state, or FIPS; a LandPortal id plus FIPS; or an official assessor
   or GIS record. If requested and resolved APNs differ after normalization,
   stop: no downstream research runs.
3. Coordinates, geocoders, map pins, imagery, ZIP centroids, and proximity
   never verify parcel identity. An address that geocoded is not a parcel.
4. Facts from another property, parcel, owner, or assignment are never evidence
   for the subject.
5. Previously accepted operator information cannot change without Tyler's
   confirmation. Preserve property, seller, CRM, evidence, document, visual,
   Activity, research, and operator data.
6. A failure pattern appearing twice requires root-cause review and permanent
   regression coverage.

## Safety invariants

7. Do not commit or push without Tyler's explicit authorization.
   Approval is required for new secrets, charges, credential changes,
   destructive deletes, resets, cleans, arbitrary SQL, and deployment.
8. Environment files and stored credentials are read only; existing configured
   providers are authorized for ordinary in-scope use. A credential may be
   entered privately into its approved login form, but never printed,
   summarized, copied, logged, passed in command arguments, placed in source,
   tests, docs, or screenshots, sent elsewhere, committed, or pushed.
9. The repository holds code, personas, safe config, governance, and redacted
   reference artifacts. Private business data stays in `store/landos.db`, the
   dashboard, or local non-repo storage: never raw property reports,
   unredacted seller records, deal-linked APNs, or financials.
10. Runtime control uses only `npm run landos:status`, `landos:start`,
    `landos:stop`, `landos:restart`, `landos:logs`, and `landos:health`.
11. Live repository and runtime inspection override memory-file narrative.
    Preserve unrelated dirty work.
12. Keep automatic memory compact: no prompts, transcripts, raw logs, browser
    output, secrets, or property history. Link evidence under `docs/landos/`
    rather than pasting it.
13. Tyler receives one full standalone implementation prompt, never patch
    fragments.
