---
name: landos-property-research
description: Use when collecting exact-subject LandOS property evidence from public sources.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, property, parcel, gis, zoning, citations]
    related_skills: [maps, ocr-and-documents, pdf]
---

# LandOS property research

## Overview

Collect grounded, incremental, property-isolated evidence for one exact LandOS
subject. LandOS remains canonical. This skill returns verified evidence through
the approved research boundary and never owns the Deal Card, valuation,
strategy, offer, or operator decision.

## Identity gate

Fix the assignment's address as primary identity. Reconcile APN, county,
municipality, owner, acreage, canonical property identifier, and subject URL
where available. A nearby parcel, different same-owner parcel, context-only
result, or unsupported inference is never the subject.

Classify evidence as verified exact subject, context only, no match, or failed.
Only verified exact-subject facts may be submitted as subject evidence. Every
record must carry property identity, source URL, source date when shown,
retrieval timestamp, and uncertainty.

## Research coverage

Collect only sourced values for:

- address, owner, mailing address, APN, county, municipality, and acreage;
- road frontage and landlocked status;
- wetlands, FEMA flood information, slope, soils, buildable area, and stated
  method or limitations;
- parcel imagery and visual evidence tied to the exact parcel;
- comparable records and their identity, date, price, acreage, and source;
- relevant Market Matrix and Market Pulse panels;
- county assessor, tax, recorder, GIS, zoning, subdivision, and municipal
  sources.

Prefer official county, municipal, state, and federal sources. Use LandPortal
only under its bounded existing contract. Never infer a missing value from map
appearance, neighboring parcels, a search snippet, or an estimate labeled for a
different concept.

## Workflow

1. Reconcile exact identity before extracting facts. Stop or classify as
   context-only if material identity fields conflict.
2. Build a source plan with the narrow official source needed for each missing
   category. Record an unavailable or blocked source explicitly.
3. Extract facts with grounded citations and source dates. Preserve original
   units and labels; normalize only in a separate stated field.
4. Persist completed categories incrementally through the approved
   `landos-research` boundary. One blocked category must not retract verified
   sibling categories.
5. Reconcile every handback with the assignment address/APN/property id.
   Reject malformed subject URLs, mismatched identifiers, cross-property
   evidence, unsupported evidence types, and missing required category fields.
6. Return a concise coverage matrix of verified, context-only, no-match,
   blocked, and failed categories with citations and freshness.

## Prohibitions

- Do not mutate Deal Card state outside the narrow research admission tools.
- Do not change valuation, strategy, offers, seller CRM, or operator decisions.
- Do not reuse prior-session property facts without re-verifying identity.
- Do not use paid APIs, expose credentials, or bypass public-site access rules.
- Do not present unsourced search results or model memory as verified facts.

## Verification checklist

- [ ] Address/APN/county/property id reconciled before extraction
- [ ] Owner, acreage, frontage/landlocked, environmental, terrain, soil, visual,
      comp, market, county/GIS, zoning, and subdivision categories addressed
- [ ] Every accepted fact has grounded source, source date/freshness, and time
- [ ] Incremental category persistence preserves successful siblings
- [ ] No cross-property, context-only, malformed, or unsupported evidence enters
      the exact-subject handback

