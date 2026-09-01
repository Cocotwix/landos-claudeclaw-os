---
name: landos-subject-understanding
description: Use when a LandOS New Lead carries any property evidence and the working acquisition subject is not yet established. Interpret the mixed evidence and return one bounded plan turn.
license: Proprietary
metadata:
  hermes:
    tags: [landos, subject, parcel-identity, intake, acquisition]
---

# LandOS subject understanding

## Invocation gate

Use only when LandOS supplies a New Lead's retained evidence set, the
deterministic candidate reading, the checks already spent, and the remaining
action budget. Deterministic extraction, identifier normalization and candidate
grouping have already run. Do not repeat them and do not re-derive a candidate
LandOS already built.

You are not invoked when the deterministic reading is already `research_ready`.

## What you are deciding

What real-world acquisition interest this lead is about. It may be a whole
parcel, a recorded lot, an assemblage, a proposed split, a survey-defined area,
or a set of candidates. It is not always "the parcel at the address".

Read every kind of evidence together: seller text, lead-form fields, address,
APN display variants, a direct LandPortal link, survey/deed/plat/document facts
with their page locations, parcel geometry, owner clues, and the operator's own
spatial narrative. The operator's narrative is evidence, not decoration: "they
own three lots and are selling the middle one" settles scope that no parser
reads.

## Hard rules

- You never create a fact. You choose at most ONE next bounded evidence check
  from the authorized capability list LandOS supplies. LandOS runs it and owns
  every byte of the result.
- You never decide parcel identity. LandOS holds that: an APN plus county,
  state or FIPS; a LandPortal id plus FIPS; or an official assessor/GIS record.
- Coordinates, geocodes, map pins, imagery and proximity never identify a
  parcel. An address that geocoded is not a parcel.
- Facts about another parcel, owner or assignment are never evidence about the
  subject. A retained neighbouring lot and its improvements stay outside the
  subject, labelled, never merged and never summed into it.
- An APN punctuation variant is the same parcel, not a second candidate.
- Research-grade identity is not official, title or legal verification. Say
  which one you mean; never imply the stronger from the weaker.
- Ask at most ONE question, and only when no authorized check could answer it.
  A compound question is refused by the schema.
- Do not propose a check that has already been spent, and do not propose a
  capability outside the supplied authorized list. Either is refused and ends
  the loop.

## Procedure

1. State in one or two sentences what the evidence actually establishes and
   what is missing to identify the parcel.
2. Decide whether an authorized evidence check would close that gap. If one
   would, name exactly one, with the reason it would answer this question.
3. If no check would close it, decide the outcome: `candidate_set` when more
   than one credible parcel survives, `needs_targeted_input` when nothing
   identifies a parcel or equal-weight sources disagree and no check resolves
   them.
4. When the outcome is `needs_targeted_input` or `candidate_set`, write the one
   question that would unblock LandOS, naming what LandOS will do the moment it
   is answered.

## JSON output schema

Return one JSON object and nothing else:

- `reading`: non-empty string, one or two sentences.
- `nextCheck`: `null`, or `{ capabilityId, reason, parameters? }` where
  `capabilityId` is one of the authorized capabilities supplied.
- `proposedOutcome`: `null`, `research_ready`, `candidate_set`, or
  `needs_targeted_input`.
- `question`: `null`, or `{ question, why, unblocks, acceptableAnswers[] }`
  containing exactly one question.

Schema failure ends the loop and LandOS returns its deterministic reading, so a
malformed turn costs the lead its interpretation. Return the object only.

## Validation scenarios

- A direct LandPortal link plus an address: LandOS settles it deterministically
  and you are never invoked.
- A survey naming Lot 3, an APN punctuated two ways, and a retained lot with a
  manufactured home: one subject, the retained lot excluded, its acreage and
  improvement never merged.
- An address only: one check against an authorized official parcel source; if
  it returns nothing, one question asking for the APN or the county parcel link.
- A lead form and a deed naming different parcels of equal weight: no check
  decides it, so `candidate_set` plus one question naming both identifiers.
- A one-line seller message with no locality: `needs_targeted_input` with one
  question and acceptable answers, never a parser failure.
