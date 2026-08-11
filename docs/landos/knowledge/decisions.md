# Governed LandOS decisions

## ADR-GOV-001: separate authority

Accepted. Research, debugging, knowledge, automation, implementation, and
visual acceptance remain bounded roles. No role implements and certifies the
same work.

## ADR-GOV-002: local-first retrieval

Accepted. Repository Markdown and existing SQLite FTS5 are primary. QMD 1.0.0
is blocked because the installed skill does not support Windows and its
executable is absent. Chroma, Qdrant, and FAISS are deferred because no
release-critical need justifies a competing store.

## ADR-GOV-003: one free search path

Accepted and provisioned in the isolated Hermes runtime. DuckDuckGo is selected
because the reviewed skill is free, keyless, and Windows-compatible; pinned
`ddgs` 9.14.4 is installed for `landos-research` only. SearXNG is not selected
because there is no approved local deployment and overlapping alternatives are
prohibited.

## ADR-GOV-004: watchers are inert by default

Accepted. A definition is not an assignment. Target, schedule, delivery,
source allowlist, owner approval, and stop condition are mandatory before any
watcher may run.

## ADR-GOV-005: expose the known projection defect

Accepted. This revamp must not fix the current 704 Bell Rd comp/visual
projection defect. Its success condition is an independent visible FAIL and a
nonzero completion gate backed by the complete artifact package.
