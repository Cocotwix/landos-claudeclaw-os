---
name: landos-acquisition-analysis
description: Read a complete LandOS property dossier and produce one structured acquisitions read.
version: 1.0.0
author: LandOS
license: Proprietary
metadata:
  hermes:
    tags: [landos, acquisition, land, analysis]
---

# LandOS acquisition analysis

## When to use

Use this skill for a LandOS Acquisition Intelligence assignment. The assignment
supplies exactly two paths: a dossier JSON file to read and an output JSON file
to write. Nothing else is in scope for the run.

## Authority

LandOS is canonical. This skill produces a JUDGMENT over facts LandOS already
established. It never establishes a fact, never researches, never browses, and
never writes anything except the assigned output file.

If the dossier does not carry something, the answer is that it is not
established. Never supply a missing acre count, frontage, lot yield, easement,
entitlement status, or utility connection from assumption.

## Procedure

Work in this order. It is the reusable method, not a template to paste.

1. **Fix what the property is.** Identity, jurisdiction, acreage and its basis,
   shape, and whether the parcel record is confirmed. If identity is not
   confirmed, say so first and treat every downstream read as provisional.

2. **Read the ground.** Buildable acreage and percentage, slope and the acreage
   under 10% slope, flood, wetlands, water, soils, elevation, improvements.
   Convert percentages into acres wherever the dossier gives you both, because
   an operator buys acres, not percentages.

3. **Read the access.** Frontage, road name and type, landlocked flags, driveway
   permit rules, and the evidence rungs. Access is the single most common thing
   a file gets wrong, so note which rung the dossier actually reached: a parcel
   flag, apparent physical access in imagery, reported legal access, or verified
   legal access from a recorded instrument. Only the last one is legal access.

4. **Read the rules.** Current zoning and its confidence, by-right uses,
   manufactured-home treatment, dimensional standards, subdivision path,
   minimum lot area and width, minimum road frontage, flag lot and shared
   driveway and private road allowances, and what triggers a new road. Note
   which of these are established and which are unresolved.

5. **Look at the pictures.** Open every image the dossier names. For each,
   state what it shows that no field carries: boundary shape and where the
   narrow and wide ends are, where the usable ground sits, roads approaching or
   terminating near boundaries, neighboring subdivisions, adjacent development
   patterns, vacant adjoining acreage, cleared versus wooded ground. Record each
   as a visual observation with the image it came from. Never convert an
   observation into a legal or ownership claim.

6. **Read the market.** Days on market, sell-through, months of supply, median
   price per acre, and how the subject's acreage band compares to faster or
   better-paid bands. The useful question is almost always whether the market
   pays more per acre for smaller parcels than for the tract as it stands.

7. **Reconcile before concluding.** Walk the dossier's conflicts list and any
   contradiction you find yourself. State both values. Resolve only on the
   dossier's own provenance, and say the reason.

8. **Now think.** Combine. A wide frontage plus a low minimum lot width plus a
   market premium on small parcels is a frontage-split read. A long tract with
   one narrow end plus a road terminating near the far boundary is a question
   about a second access path, not a conclusion that one exists. Prior
   development history on or around the parcel makes a nearby pattern more
   meaningful, not less. Say the combination out loud.

9. **Rank strategies.** Only the strongest few that this property actually
   supports. For each: why it fits, what creates the value, what weakens or
   blocks it, and what would need to be confirmed. Explicitly reject the ones
   that do not fit and say why in one line.

10. **Close the loop.** Name only the unknowns that could change the
    acquisition decision, and the smallest set of next actions that would
    resolve them.

## Output contract

Write ONE JSON object to the assigned output path. No prose outside the file,
no markdown fence inside it. Unknown or inapplicable arrays are `[]`; unknown
strings are `null`. Keys exactly as below.

```json
{
  "deal_read": {
    "headline": "one sentence an operator could act on",
    "judgment": "2-5 sentences of overall acquisitions judgment",
    "confidence": "Confirmed | Well supported | Likely | Unresolved"
  },
  "property_story": ["what kind of property this is and what defines it"],
  "market_story": ["only local/market facts that matter to THIS property"],
  "opportunities": [
    { "title": "", "why": "", "what_would_confirm": "" }
  ],
  "constraints": [
    { "title": "", "why": "", "severity": "high | medium | low" }
  ],
  "strategies": [
    {
      "strategy": "",
      "fit": "strong | possible | weak | rejected",
      "why_it_fits": "",
      "value_creation": "",
      "what_weakens_it": "",
      "what_to_confirm": ""
    }
  ],
  "visual_observations": [
    { "visual": "image key from the dossier", "observation": "", "basis": "" }
  ],
  "conflicts": [
    { "subject": "", "statement": "", "resolution": "" }
  ],
  "unknowns": [ { "question": "", "why_it_matters": "" } ],
  "next_actions": [ { "action": "", "why": "" } ]
}
```

Rules for the output:

- `strategies` is ranked, strongest first, and includes the rejections you
  considered with `fit: "rejected"`.
- `visual_observations` may only cite image keys the dossier listed.
- `conflicts` carries every material conflict from the dossier plus any you
  found, each with both values named in `statement`.
- Nothing in the file may assert access, entitlement, yield, or a utility the
  dossier does not establish.

## After the run

Update your own memory only with reusable evaluation method: an ordering that
worked, a fact combination worth checking, a trap to avoid. Never write a
property fact, address, parcel identifier, owner, price, or figure to memory.
