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
