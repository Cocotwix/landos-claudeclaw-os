---
name: landos-government-zoning-planning
description: Recover missing government, zoning, planning, and relevant subdivision evidence for one established LandOS subject after deterministic official-source routes are insufficient.
license: Proprietary
metadata:
  hermes:
    tags: [landos, government, zoning, planning, subdivision]
---

# LandOS government, zoning, and planning recovery

## Boundary

Use only for one bounded assignment from the shared Zoning & Subdivision
capability. LandOS supplies the established subject, controlling-jurisdiction
context, exact missing requirements, and deterministic source attempts. Do not
re-resolve the parcel, change settled acreage, create a second land-use engine,
or answer unrelated development questions.

Run after the deterministic land-use source race, ordinance ladders, cached
county knowledge, and official adapters are insufficient. Do not repeat a
failed route unless the assignment explains why a single retry is useful.

## Required outputs

Core zoning research, where applicable, tries to establish:

- controlling authority and zoning district;
- official map/code source and effective date when shown;
- by-right principal uses and manufactured/mobile-home eligibility;
- minimum lot size, frontage or width, setbacks, overlays, and notable
  restrictions; and
- the ordinance or code section carrying each rule.

Research subdivision only when the assignment says division is materially
relevant. Then target minor/major thresholds, maximum lots when determinable,
frontage, access/road/private-drive standards, utilities, approval authority,
and other decision-changing thresholds. Do not force subdivision analysis onto
an ordinary single-homesite property.

## Source and evidence rules

Prefer the adopting jurisdiction's official map, ordinance, planning page, or
published code. Municode, eCode360, and American Legal are official publication
paths when used by the authority. A reputable secondary or search result may
carry a likely answer when stronger evidence cannot reasonably be obtained, but
label its weight and never present it as official confirmation.

Return structured claims with a source id, URL, source type, retrieved time,
confidence weight, exact scope, and any retained artifact. Separate direct
observations from interpretations. A discovered link is navigation, not
evidence, until its relevant content is read.

## Completion

- `RETURNED`: every material assigned requirement is answered with usable evidence.
- `PARTIAL`: useful evidence landed and exact missing requirements remain.
- `BLOCKED`: valid routes were exhausted by an exact external wall; name it.
- `NEEDS_OPERATOR_ACTION`: CAPTCHA, acknowledgement, or approved-login action
  genuinely needs the operator.
- `FAILED`: execution broke; name the failed step without claiming the question
  was researched to exhaustion.

Never report `BLOCKED` while an allowed source, code ladder, official-site
search, or bounded browser route remains. LandOS admits the returned evidence
and re-plans Research Readiness; this skill never writes Deal Card conclusions.

Validation scenarios: an official zoning-map polygon plus code table can return
the district and standards; a code table without a subject-map match is
`PARTIAL`; subdivision is `NOT_APPLICABLE` when the assignment says it is not
material; a CAPTCHA is `NEEDS_OPERATOR_ACTION`, not `BLOCKED`.
