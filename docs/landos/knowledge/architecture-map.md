# Governed LandOS architecture map

```text
Operator on localhost
  -> New Lead / Deal Card UI
  -> LandOS API projection
  -> canonical LandOS stores
       ^
       | deterministic admission only
       |
  bounded research handbacks

Implementation -> independent visual acceptance -> PASS/FAIL -> completion gate
                       |
                       -> immutable evidence package

Knowledge and automation reference canonical records; they never replace them.
```

## Authority boundaries

- LandOS owns business records, projections, valuation, strategy, offers, and
  operator workflow.
- `landos-research` gathers public evidence and returns property-scoped output.
- `landos-visual-qa` operates and inspects localhost, records visible evidence,
  and alone issues the independent PASS or FAIL. It cannot edit the application
  or repair the inspected defect.
- `landos-debug` reproduces and traces defects but cannot certify its own repair.
- `landos-knowledge` maintains searchable operating documentation and
  registries, not canonical property data.
- `landos-automation` may run only explicitly approved watcher assignments.
- Implementation can report only that work is ready for independent acceptance.

The machine-readable map is
`config/landos-knowledge/registries/architecture-map.json`.

