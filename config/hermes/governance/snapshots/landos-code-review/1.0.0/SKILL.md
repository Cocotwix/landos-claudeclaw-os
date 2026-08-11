---
name: landos-code-review
description: Use when independently reviewing a scoped LandOS diff before completion.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, code-review, security, regression, precommit]
    related_skills: [requesting-code-review, github-code-review, codebase-inspection]
---

# LandOS code review

## Overview

Review a scoped diff for correctness, unintended changes, security, and
regression risk. This role has no implementation authority unless separately
and explicitly assigned. A review does not replace independent visual
acceptance for operator-facing work.

## Scope gate

Obtain the task contract, owned files, current dirty-work warning, base
reference, and exact changed paths. Review only the scoped diff and the minimum
direct dependencies needed to assess it. Treat unrelated uncommitted work as
owner data: account for it and never reset, revert, clean, overwrite, stage, or
reformat it.

## Review sequence

1. Inventory every changed path in scope and identify any path outside declared
   ownership. Completion criterion: no diff hunk is unaccounted for.
2. Compare behavior with the task and stable LandOS rules. Look for incomplete
   branches, false completion claims, identity leakage, cross-property data,
   canonical-store bypass, and implementation/acceptance role collapse.
3. Inspect for secrets, credentials, tokens, cookies, environment values,
   generated credential files, local browser state, absolute machine-local
   paths, temporary artifacts, recordings, caches, and oversized outputs.
4. Inspect dependency and tooling changes. Flag new packages, scripts, network
   installers, lifecycle hooks, lockfile drift, paid-provider paths, or unsafe
   version ranges that were not explicitly authorized.
5. Inspect security boundaries: unrestricted shell or filesystem access,
   arbitrary SQL, destructive operations, validation bypass, unsafe URL or
   identity handling, permissive MCP exposure, and approval-gate bypass.
6. Trace likely regression surfaces and test coverage. A repeated failure
   pattern needs permanent regression coverage. Backend-only tests do not prove
   visible behavior.
7. Check verification evidence: focused tests, typecheck/build when relevant,
   profile/permission checks, targeted diff/secret/forbidden-artifact scans, and
   independent visual acceptance for operator-facing changes.
8. Report actionable findings first, ordered by impact, with tight file/line
   references and a concrete failure scenario. State `PASS` only when no
   blocking finding remains; otherwise state `CHANGES REQUIRED`.

## Prohibitions

- Do not edit code, approve your own implementation, commit, push, or deploy.
- Do not broaden the review into unrelated architecture discovery.
- Do not expose secret-like content in the report; identify only its location
  and class.
- Do not accept tests, logs, APIs, or database state as a substitute for the
  required localhost visual proof.

## Verification checklist

- [ ] Scoped diff and every changed path accounted for
- [ ] Unintended, unrelated, secret, and machine-local artifacts checked
- [ ] Dependency, security, permission, identity, and regression risks checked
- [ ] Required tests/builds/scans and independent acceptance evidence assessed
- [ ] Findings are actionable and review role made no implementation change

