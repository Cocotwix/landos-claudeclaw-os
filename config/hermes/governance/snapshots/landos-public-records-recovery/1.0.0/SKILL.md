---
name: landos-public-records-recovery
description: Perform one bounded public-records or assessor recovery for an established LandOS subject after known deterministic adapters and escalation ladders fail.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, public-records, assessor, gis, recorder, recovery]
---

# LandOS public-records recovery specialist

## Invocation gate

Use only when LandOS supplies an established canonical subject, the exact
unresolved public-record requirement, the deterministic failure reason,
platform fingerprints/source attempts, a run id, and an exact JSON output path.
Known ArcGIS, Beacon/Schneider, Tyler, assessor, GIS, tax, and recorder adapters
run first. Do not duplicate or restart them. Diagnose why they failed, then use
one bounded alternate route.

## Allowed work

Reason across the supplied platform fingerprint, official assessor/GIS/tax and
recorder sites, ArcGIS service discovery, official document repositories,
permitted direct public endpoints, keyless public search, and the dedicated
governed browser. Attach only to the approved LandOS CDP endpoint when browser
work is required. Do not read credentials, cookies, browser storage, `.env`, or
unrelated tabs; create accounts; pay; accept legal terms; or use a private or
paid API.

Search by exact APN, address, or owner. The returned record must match the
canonical subject. Normalize formatting when comparing APNs. A different APN,
nearby parcel, same-owner parcel, geocode, or map proximity never establishes a
match. On a mismatch, retain no subject facts and report the conflict.

## Procedure

1. Read the deterministic failure and attempts; state the actual failure class.
2. Identify the likeliest official platform/source path not already exhausted.
3. Attempt the bounded route and retain the relevant page, document, response,
   or screenshot reference.
4. Extract only facts the retrieved source directly supports.
5. Write the structured handback to the exact output path and stop.

Retry a plausibly transient route at most once. On CAPTCHA or human verification
return `NEEDS_OPERATOR_ACTION`. On a paid wall return `BLOCKED` with the source
and known cost. A legitimate no-record result is `RETURNED` when the official
source actually answers that no record exists. A source outage is `BLOCKED` for
this requirement only.

## JSON handback

Write one JSON object with:

- `schemaVersion: "1.0"`, `runId`, `dealCardId`, `propertyCardId`;
- `status`: `RETURNED|PARTIAL|BLOCKED|NEEDS_OPERATOR_ACTION|FAILED`;
- `deterministicFailureReason`, `recoveryReason`, `subjectMatch`;
- `facts`: `{key,label,value,sourceId,confidence}` entries;
- `sources`: `{id,name,url,sourceType,retrievedAt,official}` entries;
- `artifacts`: `{kind,label,path,url,sourceId}` entries;
- `unresolvedRequirements`, `exactFailureReason`, and `attempts`.

Every fact references a returned source id. `subjectMatch` must be `exact` before
facts may be included. Use confidence `confirmed`, `well_supported`, or `likely`
without inflation. Do not leave important results only in prose.

Validation scenarios: a new official assessor platform with exact APN and owner
returns structured facts; a record page with an APN mismatch returns no facts;
a CAPTCHA is `NEEDS_OPERATOR_ACTION`; an official zero-result search is a
`RETURNED` no-record result; a paid-only document is `BLOCKED` and unrelated
research remains untouched.

Final response: output only the JSON path and status.
