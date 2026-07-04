# 03 LandOS Roadmap

Owner: Shared
Update Rule: CC/Codex update after major milestones. Frame in business
capabilities, not engineering tasks.

## Governance Standard

Default is autonomy. Roadmap work proceeds until the business outcome is
complete unless it reaches one of the only approval gates:

- secrets
- `.env`
- API keys/passwords
- paid APIs
- external accounts
- money
- destructive deletes
- `git push`
- deployments

Operator QA and Business QA are required before claiming a sprint complete.
Passing tests alone is not roadmap completion.

## Current Business Milestone

**Operationalize Lead -> Deal Card -> Property Inspection -> Market
Intelligence -> Discovery Call Intelligence on real dashboard-backed leads.**

The current frontline milestone is the Acquisition Specialist dashboard-visible
Property Card acceptance sprint. Tyler should be able to open the real LandOS
dashboard and use the verified Property Card as a seller discovery-call
workspace.

## Capability Status

| Business capability | State |
|---|---|
| Smart Intake | Raw lead intake is the source; autocomplete is optional and non-authoritative |
| Property Resolution | Owns normalization, ambiguity, provider lookup, browser escalation, and parcel identity |
| Property Inspection | Reusable capability; persists inspection packages to Property Card memory |
| Browser/LandPortal inspection | Uses live browser only; paid reports and credits remain gated |
| Comparable Intelligence | Implemented structurally; dashboard-visible normalized comp rendering remains active sprint work |
| Market Intelligence | Reusable capability exists; must be shown in operator workflow |
| Discovery Call Intelligence | Pre-call briefing exists; must be dashboard-visible and operator-readable |
| Property Board | Current blocker: verified card must become a large usable acquisition workspace |
| Operator QA memory | `.landos/OPERATOR_QA.md` |
| Business QA memory | `.landos/BUSINESS_QA.md` |
| Reference UI artifacts | `docs/reference-ui/` |

## Next Business Milestones

1. **Finish Property Card operator workspace.**
   Render verified property facts, visuals, overlays, normalized comps, Market
   Intelligence, Discovery Call Intelligence, seller questions, and approved
   acquisition strategies in the real dashboard.
2. **Run dashboard-backed Operator QA.**
   Ask whether Tyler would actually use the card instead of the existing tool.
3. **Run Business QA for Acquisition Specialist.**
   Confirm whether the employee creates measurable seller-call prep value.
4. **Harden Property Inspection fallback.**
   LandPortal failure should fall through to official county/browser lanes
   without blocking useful pre-call intelligence.
5. **Improve Market Intelligence evidence.**
   Keep it reusable and separate from Property Inspection and the Acquisition
   Specialist.
6. **Continue department buildout only after reusable capabilities are stable.**

## Deferred / Later

- Underwriting final offer decisions.
- Finance.
- CRM/GHL live sync.
- Marketing automation.
- Transactions.
- Dispositions.
- Jarvis/future departments.
- Production deployments.

These are not part of the current Acquisition Specialist sprint.

