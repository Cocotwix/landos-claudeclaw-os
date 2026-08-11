# Lanes F/G result: knowledge, sources, research, and monitoring

Status: persisted and focused verification passing at
`2026-08-02T21:15:56-04:00`.

## Ownership and interfaces

This lane exclusively created `config/landos-knowledge/**`,
`config/landos-research/**`, `docs/landos/knowledge/**`, and
`scripts/knowledge/**`. It did not edit current Hermes specialist files,
application code, `.env`, the checkpoint, or shared package files.

Inputs were the current LandOS canonical/store boundaries, existing local FTS5
retrieval module, current Hermes v0.19.1 optional-skill metadata, and official
Wayne County NY, NYS, FEMA, USDA, and OpenStreetMap source domains. Outputs are
versioned searchable registries, inert watcher definitions, source policy,
capability decisions, a deterministic validator, and a repository Markdown
query command.

The integration interface is repository-relative JSON under
`config/landos-knowledge/registries`. MCP and profile lanes should reference
the authoritative manifest they produce rather than copying tool or skill
allowlists into this lane.

## Decisions and blockers

- QMD 1.0.0 is blocked: the installed skill declares macOS/Linux only, the
  current host is Windows, and no `qmd` executable is installed. No package or
  model download was attempted.
- DuckDuckGo is the single selected free search path. Pinned `ddgs` 9.14.4 is
  installed in the isolated Hermes runtime for `landos-research` only.
- SearXNG is deferred to avoid an overlapping primary search without an
  approved deployment.
- Parallel CLI is blocked because its vendor authentication can lead to paid
  usage and no credential or charge was authorized.
- Scrapling is blocked and uninstalled. The pinned `domain-intel` helper is
  enabled for approved public-source research in `landos-research`. Broad OSINT
  is blocked by its dangerous scan verdict and excessive scope. Grounded citations remain a
  required LandOS contract even though no supported catalog skill exists.
- Chroma, Qdrant, and FAISS remain evaluated/deferred. Repository Markdown and
  existing local FTS5 meet the immediate local-first requirement.
- All ten watcher templates are disabled with null target, schedule, and
  delivery. No monitoring assignment was invented or activated.

## Verification

```text
node --test scripts/knowledge/validate-landos-knowledge.test.mjs
4 tests passed, 0 failed

node scripts/knowledge/validate-landos-knowledge.mjs --json
ok=true; 11 registries; 25 files checked

node scripts/knowledge/query-landos-knowledge.mjs "visual acceptance" --json --limit=5
4 searchable Markdown hits
```

The validator proves required registries exist, IDs and references are safe,
official URLs use allowlisted HTTPS hosts with freshness metadata, canonical
business data is not duplicated, no watcher is implicitly activated, one free
search is selected, paid Parallel remains blocked, machine-local paths are
absent, and no common token patterns appear.

## Concurrency evidence

At persistence time, the agent tree simultaneously reported `/root`,
`/root/profiles_skills`, `/root/visual_gate`, and `/root/mcp_schemas` as
`running`. This lane completed its focused tests while all three independent
implementation lanes continued; none of their dependency blockers stopped this
work.

## Requested shared integration

Add these package scripts during the single-owner join:

```json
{
  "landos:knowledge:check": "node scripts/knowledge/validate-landos-knowledge.mjs",
  "landos:knowledge:test": "node --test scripts/knowledge/validate-landos-knowledge.test.mjs",
  "landos:knowledge:query": "node scripts/knowledge/query-landos-knowledge.mjs"
}
```
