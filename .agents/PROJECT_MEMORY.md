# LandOS Project Memory

This file stores durable lessons, solved problems, and gotchas.

## Durable Lessons

- Do not let Duke become the LandOS brain.
- Do not build one-agent-does-everything patterns.
- Do not use propertyid + FIPS as the main happy path.
- Do not block area market context when parcel verification fails.
- Do not show developer trace as the main operator UI.
- Do not rely on one source as truth.
- Keep coding sprints focused and preserve handoff.

## Gotchas

- Area-level context is useful even when parcel verification is not finished.
- A single source failure should not erase other honest context.
- Product memory must preserve the next action, not just the last command.
- Most LandOS machinery already exists: deal cards persist to the local SQLite
  store (gitignored), the orchestrator is planLandosIntake(), and there are
  already two registries. Check before building; reuse and harden, do not
  rebuild.
- .gitignore already keeps property data/media/reports out of the repo
  (data/, deals/, transcripts/, training/, *.pdf, *.csv, *.xlsx, *.mp3, ...).
  Storage policy formalizes this; it does not need new ignore rules.
- The LandOS structure spine lives in src/landos/landos-structure.ts and
  references existing department-registry IDs via registryRef.

