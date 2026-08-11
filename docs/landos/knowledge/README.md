# LandOS governed operating knowledge

This directory is the searchable, local-first operating index for the governed
LandOS multi-agent system. It documents architecture, sources, workflows,
decisions, defects, and acceptance history. It is not a second business-data
store.

LandOS remains canonical for every Deal Card, Property Card, identity, seller,
fact, comp, visual, document, market record, valuation, strategy, and workflow
state. Knowledge entries link to repository modules or stable canonical record
references; they do not copy accepted records into these files.

## Retrieval order

1. Search this directory and the named operating documents with repository
   Markdown search.
2. Use the existing local SQLite FTS5 layer in
   `src/landos/rag-knowledge.ts` for admitted long-form context.
3. Read canonical LandOS records through bounded read interfaces when business
   data is needed.
4. Never write a retrieved answer directly into canonical state. Research
   output must pass identity reconciliation and the existing admission boundary.

The configured repository query is:

```text
node scripts/knowledge/query-landos-knowledge.mjs <terms>
```

Use `--json` for machine-readable results. The validator is:

```text
node scripts/knowledge/validate-landos-knowledge.mjs
```

## QMD status

The installed Hermes Agent v0.19.1 includes QMD skill 1.0.0, but that skill
declares only macOS and Linux support. This host is Windows and has no `qmd`
executable. QMD is therefore recorded as blocked, not silently substituted or
partially installed. No global package or approximately 2 GB first-run model
download was attempted. Repository Markdown and the existing FTS5 retrieval
layer are the approved working path until an audited Windows-compatible QMD
release or an explicitly approved supported runtime exists.

## Searchable maps and registries

- [Architecture map](architecture-map.md)
- [Module map](module-map.md)
- [Provider and source registry](provider-and-source-registry.md)
- [Browser workflow registry](browser-workflow-registry.md)
- [Skill registry](skill-registry.md)
- [MCP registry](mcp-registry.md)
- [Decision records](decisions.md)
- [Defect and acceptance history](defect-and-acceptance-history.md)
- [Research and monitoring governance](research-and-monitoring.md)

The machine-readable sources live under `config/landos-knowledge/registries`.
Source freshness belongs on every external source entry. A stale source may be
used only with an explicit freshness disclosure and never to override fresher
canonical evidence.

## Related SOPs

- `docs/landos/property-intelligence-sop.md`
- `.landos/CODING_SESSION_PROTOCOL.md`
- `.landos/PERMANENT_MEMORY.md`
- `.landos/CHECKPOINT.md`

