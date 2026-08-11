# Defect, acceptance, and test-address history

## DEFECT-704-BELL-PROJECTION

Status: known open; intentionally excluded from repair in this revamp.

For `704 Bell Rd, Red Creek, NY 13143`, canonical Hermes comp and visual
evidence can exist while the operator-facing Comps & Market, Documents &
Visuals, imagery, specialist result, or displayed count remains empty or zero.
The new acceptance system must visibly inspect those sections, issue FAIL for
every observed mismatch, and block completion.

## ACCEPT-GOVERNED-OS-704-BELL

Status: pending the first independent run. Expected verdict: FAIL. A screenshot
file alone is not proof; the package must contain visible claim results,
screenshots, trace, video, console, network, refresh, restart, contamination,
and report evidence.

## TEST-ADDR-704-BELL

This address is an existing known-defect target, not proof of the normal fresh
New Lead requirement. It is reserved for the initial governed-system
acceptance exception. Future meaningful operator-facing sprints still require a
fresh address unless their accepted contract explicitly records another
authorized exception.

Machine-readable records live in `defect-history.json`,
`acceptance-history.json`, and `test-address-history.json` under
`config/landos-knowledge/registries`.

