# Independent Browser-QA Brief — ws2-research-completeness: Research completeness and evidence language

- Sprint: sprint-2026-07-15-dealcard-v2
- Live URL: http://localhost:3141
- Ledger: C:\Users\tbutt\claudeclaw-os\.landos\sprints\sprint-2026-07-15-dealcard-v2\ledger.json
- Persistence checks: refresh=true restart=false

Operator outcome under test: Research lane counts and wording separate provider-attempted, provider-retrieved, partial evidence, business-question-resolved, legal-confirmation-complete, and external-confirmation-required; partial proximity is not completed access research; a county flood query is not complete FEMA research; FEMA/road/soils/utilities/red-flag copy is correctly qualified.

## Requirements to disprove
- ws2-r1: Research counts separate provider-attempted, provider-retrieved, partial, business-resolved, legal-complete, external-required.
- ws2-r2: Partial proximity evidence is not counted as completed access research.
- ws2-r3: A county flood query is not counted as complete FEMA research when material FEMA tasks remain.
- ws2-r4: FEMA Zone X result, coverage basis, panel status, effective date, and BFE availability are separate; no unsupported BFE claim; county-layer vs FIRM distinguished; overlays use mapped geometry acreage.
- ws2-r5: Road: proximity is not frontage; unknown ownership is not called private; classification/contact/ROW/physical/driveway/legal/maintenance are separated; no unsupported recorded-private-road-rights claim.
- ws2-r6: Soils: single component not described as split/mixed; SSURGO limitation vs site septic feasibility distinguished; map-unit slope vs measured mean slope separated.
- ws2-r7: Utilities: absent mapped line is not proof of unavailability; well/septic labeled preliminary; provider research vs remaining confirmation separated.
- ws2-r8: Critical red flags: incomplete screening is not favorable; access/title/acreage/zoning uncertainty affects critical-risk completeness; no-all-clear language matches unresolved categories.

## Required operator journey
1. Open the verified Deal Card and read the research-status summary
2. Confirm the evidenced-lane count does not count zoning, legal access, deed/easement review, or FEMA panel as complete when they are not
3. Open FEMA detail and confirm Zone X / coverage basis / panel status / effective date / BFE availability are separate and county-layer vs FIRM is distinguished
4. Open road/access detail and confirm proximity is not called frontage and unknown ownership is not called private
5. Open soils/septic and utilities detail and confirm qualified wording
6. Refresh and confirm wording and counts persist

## Prohibited outcomes
- Must NOT occur: Evidenced-lane count includes lanes that have not genuinely resolved
- Must NOT occur: BFE screened stated with no BFE retrieved, or exact-acreage+BFE marked complete unsupported
- Must NOT occur: Road proximity shown as frontage, or unknown ownership shown as private
- Must NOT occur: Single soil component described as split/mixed, or utility absence shown as unavailable
- Must NOT occur: Incomplete screening presented favorably or no-all-clear language contradicts unresolved categories

## Accepted operator facts (must not be contradicted)
- none supplied

## Known historical failure patterns
- frontend-missing-value: 1 occurrence(s) (single occurrence)
- overlay-uses-wrong-acreage-basis: 3 occurrence(s) (reviewed)
- reconciliation-ignores-acreage-conflict: 2 occurrence(s) (reviewed)

## Mandate
- Actively attempt to prove the implementation wrong; never repeat the builder's conclusions.
- Open the actual running localhost dashboard in a real browser.
- Navigate the full affected workflow; click every relevant control and open every affected tab.
- Exercise relevant forms, maps, filters, tables, links, and actions.
- Compare visible frontend output with API responses and, when appropriate, database records.
- Compare visible output with accepted operator facts.
- Refresh the browser and verify persistence; when restart persistence is required, restart via npm run landos:restart and reopen the workflow.
- Capture fresh screenshots and exact reproduction steps for every failure.
- Judge business meaning and operator usability, not merely whether pages load.
- Return a non-passing result whenever an internally fixable issue remains.
- After repairs, run the exact same journey again.
