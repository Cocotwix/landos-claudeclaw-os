# LandOS Known Limitations

Purpose: track intentionally unfinished work, why it is unfinished, ownership,
when to revisit it, and whether it blocks current business use.

Do not store secrets, private seller data, real APNs, private addresses, or raw
property work product here.

| Limitation | Why Unfinished | Owner / Department | Revisit When | Blocks Current Business Use |
|---|---|---|---|---|
| Property Board workspace is not yet operator-usable | UI/persistence wiring still needs to render persisted inspection, comps, market, and discovery output visibly | Acquisition Specialist / Property Board | Current sprint | Yes |
| Weak duplicate Property Cards may appear for same property | Earlier raw-intake runs created unverified duplicates before verified-card suppression was fully wired | Property Resolution / Property Board | Current sprint | Yes |
| Old Duke/LandPortal paid-credit UI may still appear in new Property Card flow | Legacy UI was not fully removed from Property Board | Property Board | Current sprint | Yes |
| Market Intelligence must remain reusable and separate | Capability exists structurally, but dashboard-visible integration is still being hardened | Market Intelligence | After Property Card workspace is usable | Partially |
| County Records fallback not fully validated live | Routing exists structurally; needs live failure-path acceptance without paid tools | Property Inspection / County Records Browser | After Property Card acceptance | No, unless LandPortal fails |
| Reference UI artifact library is newly formalized | Folders exist; real redacted screenshots must be added during Operator QA | Operator QA | Next dashboard QA run | No |
| Land Score depends on how complete the LandPortal read was | Mostly resolved 2026-07-04: the rubric now consumes the LandPortal parcel fact sheet (road frontage, wetlands, FEMA, buildability, acreage, valuation) + gov-DD cross-check, so a fully-read parcel scores fully (card #5 → 77/100 PURSUE). USGS 3DEP slope is now wired into Buildability, so a thin read that lacks LandPortal buildability still scores it from terrain (card #1 → 8/10). A thin read still gaps fields NO approved provider returned (e.g. FEMA unmapped) — honest, never fabricated. | Due Diligence / Land Score | When a parcel needs a fuller read | Minor — score is real and useful; only genuinely-absent fields gap |
| USGS slope is a coarse point estimate | The USGS 3DEP Buildability signal comes from a 33 m EPQS 5-point cross (a single average slope at the parcel point), not a full-parcel DEM slope distribution. It can over/under-state slope near band boundaries (e.g. card #5's 10.3% just crosses the 10% caution threshold). It is a cross-check, not a survey. | Due Diligence / Land Score | Deeper-DD terrain sprint | No — conflicts are surfaced; LandPortal remains the primary buildability source |
| Pre-existing failing test: property-card weak-duplicate merge | `src/landos/property-card.test.ts > "weak/address-only input does NOT merge into a verified card by address_key"` fails at commit 60c8378 (confirmed by stashing the DD-report changes). Unrelated to the DD-report/Land-Score/docs work; no change to property-card.ts/db.ts in these sprints. | Property Resolution / Property Board | Next Property Board sprint | No — isolated to the weak-duplicate-merge path |

Resolved 2026-07-04: "Compiled server must be restarted to compute Land Score on /report/run" — service restarted (PID 235948 on the fresh `dist`); POST `/report/run` and GET `/report` both return the inline `landScore` for verified cards #1 (15/100) and #5 (9/100).

## Template

```markdown
### <limitation>

- Why unfinished:
- Owner / department:
- Revisit when:
- Blocks current business use:
- Current workaround:
- What not to repeat:
```
