# Deferred: LandPortal Parcel Neighborhood Inspection

Recorded during Slice 4C (canonical acreage dependent-state refresh). NOT built.

## Desired future behavior

A Property Intelligence visual-curiosity enhancement. When LandPortal subject
verification is complete:

- Parcel Boundaries remain enabled.
- Property Intelligence may use Parcel Number labels and/or Parcel Owner Name
  labels to inspect the immediate subject surroundings.
- It notices adjoining/nearby parcels sharing the same owner as the subject.
- It selectively clicks materially relevant nearby parcels.
- It captures each parcel's APN, acreage, owner, and relationship to the
  subject.
- It asks whether the parcels represent: an assemblage, a remainder tract,
  related ownership, a potential access relationship, a development
  relationship, or merely unrelated adjacent ownership.

## Hard rules

- The capability must discover such relationships from LandPortal/official
  evidence itself. Nothing is injected from operator prompts as canonical fact.
- The operator has observed a nearby parcel associated with LANDSOUTH LLC of
  approximately 8+ acres. That observation is a pointer for what this
  capability should be able to find on its own — it is NOT canonical fact and
  was NOT investigated in Slice 4C.
- Parcel-identity invariants (PERMANENT_MEMORY invariants 2–4) apply in full:
  neighboring-parcel facts are never evidence about the subject.
