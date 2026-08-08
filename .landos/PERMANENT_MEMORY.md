# LandOS Permanent Operating Memory

Stable invariants only. Process, scope, stop conditions, acceptance tiers, and
approval gates live in `.landos/CODING_SESSION_PROTOCOL.md`, the canonical
coding-agent contract. The single active handoff lives in
`.landos/CHECKPOINT.md`.

## Acceptance authority

The live localhost owner experience decides completion; tests, builds, database
rows, and HTTP 200 alone do not establish completion. Staged workstreams and
independent live browser QA are support only. Do not claim completion while an
owner-requested, decision-critical result is missing, unusable, or not
personally verified. Only required new authority or a real external blocker may
pause the work; report the exact visible blocker, never success. The contract's
stop conditions bound how far that obligation extends.

## Data and identity invariants

1. Repair the shared root of the demonstrated defect class system-wide. A
   property is an acceptance example, never implementation scope, and a
   shared-root repair never authorizes unrequested cases or surfaces.
2. Parcel identity gates property intelligence. Identity must be confirmed from
   an APN plus county, state, or FIPS; a LandPortal id plus FIPS; or an
   official assessor or GIS record. If a requested and a resolved APN differ
   after normalization, stop: no downstream research may run.
3. Coordinates, geocoders, map pins, imagery, ZIP centroids, and proximity
   never verify parcel identity. An address that geocoded is not a parcel.
4. Facts from another property, parcel, owner, or assignment are never evidence
   for the current subject.
5. Previously accepted operator information cannot change without Tyler's
   confirmation. Preserve property, seller, CRM, evidence, document, visual,
   Activity, research, and operator data.
6. A failure pattern appearing twice requires root-cause review and permanent
   regression coverage for that pattern.

## Safety invariants

7. Do not commit or push without Tyler's explicit authorization.
   Approval is required for new secrets, charges, credential changes,
   destructive deletes, resets, cleans, arbitrary SQL, and deployment.
8. Environment files and stored credentials are read only. Existing configured
   providers are authorized for ordinary in-scope use. A credential may be
   entered privately into its intended approved login form, but must never be
   printed, summarized, copied, logged, passed in command arguments, placed in
   source, tests, docs, or screenshots, sent elsewhere, committed, or pushed.
9. The repository holds code, personas, safe config, governance, and redacted
   reference artifacts. Private business data stays in `store/landos.db`, the
   dashboard, or local non-repo storage: never raw property reports,
   unredacted seller records, deal-linked APNs, or private financials.
10. Runtime control uses only `npm run landos:status`, `landos:start`,
    `landos:stop`, `landos:restart`, `landos:logs`, and `landos:health`.
11. Live repository and runtime inspection override memory-file narrative.
    Preserve unrelated dirty work.
12. Keep automatic memory compact: no prompts, transcripts, raw logs, browser
    output, secrets, or property history. Link detailed evidence under
    `docs/landos/` instead of pasting it.
13. Tyler receives one full standalone implementation prompt, never patch
    fragments.
