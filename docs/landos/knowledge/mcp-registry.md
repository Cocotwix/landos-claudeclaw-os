# Narrow LandOS MCP registry

Only three local servers are approved:

- `landos-read`: property context, accepted evidence, provider/specialist
  status, acceptance expectations, visible/canonical counts, market context,
  and source-registry entries.
- `landos-acceptance`: begin a run; record a visual claim, screenshot, refresh,
  restart, console, or network result; submit PASS or FAIL.
- `landos-research`: save a verified property fact, comp, or visual; report
  progress; complete or fail a research category.

They expose no arbitrary SQL, filesystem writes, shell, environment, secrets,
deletes, unrestricted Deal Card mutation, valuation, strategy, or offers.
Explicit include and deny filters are inspected before a server is added to a
profile. Visual QA is never directly connected to an implementation agent.

The machine-readable index is
`config/landos-knowledge/registries/mcp-registry.json`. The MCP implementation
lane owns the detailed tool manifest; integration links that single manifest
instead of copying it here.

