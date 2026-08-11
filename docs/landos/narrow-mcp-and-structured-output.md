# Narrow LandOS MCPs and Hermes structured-output enforcement

## Lane status

Final verification timestamp: **2026-08-02T23:23:23-04:00**. This combined Lane E/H deliverable is live-canonical verified and ready for governed profile activation. It does not claim independent visual acceptance and does not repair the known Deal Card projection defect.

The implementation adds:

- deterministic Zod validation and canonical identity reconciliation for untrusted Hermes worker JSON;
- three FastMCP stdio servers with exactly 7, 8, and 5 tools;
- a second fail-closed tool-registration/call guard inside the servers;
- Hermes `tools.include` and `tools.exclude` filters with resources, prompts, and sampling disabled;
- a profile-governance manifest fragment that keeps visual acceptance separate from research and implementation;
- canonical acceptance v1.0.0 contract/results validation;
- a temp/fixture-only reference adapter and focused tests that never touch live LandOS data;
- a fixed-operation, shell-free Python-to-Node/tsx adapter into existing canonical LandOS services;
- a cross-process-locked acceptance journal that supports correction until submit, then finalizes read-only, with fixed run/property identity and real artifact inspection;
- actual mcporter 0.9.0 schema inspection and denied-tool calls.

All three configured stdio entrypoints explicitly construct `CanonicalBridgeLandosAdapter`. The adapter selects only the 20 compile-time operation names, starts Node with `shell=False`, passes strict JSON on stdin, and validates the single JSON response through strict Pydantic models. It never accepts SQL, commands, arbitrary paths, environment names, or generic method names. Python never reads the LandOS database directly, and the fixture adapter remains test-only.

## Parallel/concurrency evidence

At **2026-08-02T21:45:39-04:00**, the collaboration roster simultaneously showed these active lanes: `/root` (integration), `/root/governance_review`, `/root/mcp_schemas` (this lane), and `/root/visual_gate`. At lane startup the roster likewise showed `/root`, `/root/mcp_schemas`, `/root/profiles_skills`, and `/root/visual_gate` running together. While this lane was implementing Zod validation, `/root/visual_gate` published `config/acceptance/acceptance-contract.schema.json` and `config/acceptance/results.schema.json`; this lane consumed them without editing them. The acceptance lane therefore did not block independent schema/MCP work, and file ownership remained disjoint.

## Structured-output approach

Selected approach: **Zod 4.3.6 at the TypeScript LandOS ingress boundary**, with generated Draft 2020-12 JSON Schema for optional Hermes-side constrained generation. Model-side structured output is advisory; `validateHermesWorkerOutput` is authoritative.

The validator:

- accepts an already-parsed unknown value and never coerces strings into arrays, numbers, or booleans;
- uses strict objects and rejects undeclared fields;
- requires `specialist_category` and `completed_categories` and enforces one assigned category;
- validates APN syntax, then reconciles formatting with LandOS `apnEquivalent`/`normalizeApn`;
- uses the existing canonical address normalizer;
- validates the exact HTTPS LandPortal parcel URL and decodes its APN/FIPS/property id;
- accepts only a numeric property id or the precise `fips=...&apn=...&propertyid=...` tuple and reconciles every supplied id;
- compares address, APN, subject URL, Property Card routing guard, and LandPortal property id with the assignment;
- rejects cross-property subject evidence;
- validates comp identity, positive numeric fields, optional date/source URL, price-per-acre consistency, and duplicates;
- validates safe relative visual paths, timestamps, enums, view/kind consistency, boundary visibility, loaded tiles, known camera scale, clipping, and duplicates;
- accepts only the declared evidence types (`property_subject`, `comparable`, and `visual_artifact`) when the optional marker is present;
- permits non-importable `context_only`, `no_match`, and `failed` handbacks only when they contain no completed categories, comps, visuals, or verified-subject fields.

The generated `HERMES_WORKER_OUTPUT_JSON_SCHEMA` is supplied for Hermes prompts, but admission still runs the deterministic validator.

## Exact MCP surfaces

| Server | Exact exposed tools | Authority |
|---|---|---|
| `landos-read` | `get_property_context`, `get_accepted_evidence`, `get_provider_and_specialist_status`, `get_acceptance_expectations`, `get_visible_and_canonical_counts`, `get_market_research_context`, `get_source_registry_entries` | Read bounded canonical projections only |
| `landos-acceptance` | `begin_acceptance_run`, `record_visual_claim`, `record_screenshot_artifact`, `record_refresh_result`, `record_restart_result`, `record_console_result`, `record_network_result`, `submit_pass_or_fail_report` | Record independent `landos-visual-qa` evidence only |
| `landos-research` | `save_verified_property_fact`, `save_verified_comp`, `save_verified_visual_artifact`, `report_specialist_progress`, `complete_or_fail_research_category` | Save verified property-scoped research through a canonical adapter only |

Every top-level tool input schema now publishes `additionalProperties: false`. Nested Pydantic models are also strict. `GovernedFastMCP.call_tool` rejects undeclared arguments even though MCP 1.28.1 disables low-level input validation for backward compatibility.

The same deny filters exist in server code, the Hermes fragment, and the manifest:

`*sql*`, `*query_database*`, `*filesystem*`, `*read_file*`, `*write_file*`, `*shell*`, `*command*`, `*secret*`, `*credential*`, `*token*`, `*cookie*`, `*environment*`, `*env*`, `*delete*`, `*destroy*`, `*valuation*`, `*strategy*`, `*offer*`, `*mutate_deal*`, `*update_deal*`, and `*implementation*`.

There is no SQL argument, general path argument, shell command, secret/environment read, delete, unrestricted Deal Card update, valuation, strategy, or offer tool. Artifact paths are metadata only and are constrained to safe relative images or the acceptance contract's exact artifact names. The servers expose no resources or prompts and have server-initiated sampling disabled.

`profile-governance-fragment.json` makes only these server assignments eligible:

- `landos-research`: `landos-read`, `landos-research`;
- `landos-visual-qa`: `landos-read`, `landos-acceptance`;
- `landos-debug`: `landos-read`;
- `landos-knowledge`: `landos-read`;
- `landos-automation`: `landos-read`.

`landos-visual-qa` is explicitly denied `landos-research`, and all non-visual profiles are denied `landos-acceptance`. The acceptance server records evidence only; it has no implementation connection or repair capability.

## Acceptance contract reconciliation

The acceptance server consumes, read-only:

- `config/acceptance/acceptance-contract.schema.json` (`1.0.0`);
- `config/acceptance/results.schema.json` (`1.0.0`);
- the concrete 704 Bell contract in tests.

`begin_acceptance_run` validates the complete contract, binds its run and property identity, writes only the fixed package contract, and creates a separate governed journal. The six incremental record tools are cross-process serialized and may replace their own run-scoped record during a normal recapture or correction. Screenshot metadata is accepted only after the fixed package file's bytes, SHA-256, PNG structure, dimensions, and sampled-color count agree. `submit_pass_or_fail_report` binds run/contract/sprint/mode/start time/freshness/property, requires the complete journal, inspects all ten capture files through the repository artifact inspectors, and writes only `results.json` and `acceptance-report.md`. The final package must contain exactly 13 regular non-symlink artifacts; submitted runs are read-only.

## Files added by this lane

Structured output:

- `src/landos/governance/hermes-worker-schema.ts`
- `src/landos/governance/hermes-worker-schema.test.ts`
- `src/landos/governance/mcp-bridge.ts`
- `src/landos/governance/mcp-bridge.test.ts`

FastMCP source and tests:

- `mcp/landos/landos_read.py`
- `mcp/landos/landos_acceptance.py`
- `mcp/landos/landos_research.py`
- `mcp/landos/inspect_servers.py`
- `mcp/landos/run_server.py`
- `mcp/landos/run_checks.py`
- `mcp/landos/landos_mcp/canonical_bridge.py`
- `mcp/landos/landos_mcp/__init__.py`
- `mcp/landos/landos_mcp/acceptance_schema.py`
- `mcp/landos/landos_mcp/adapters.py`
- `mcp/landos/landos_mcp/models.py`
- `mcp/landos/landos_mcp/policy.py`
- `mcp/landos/landos_mcp/servers.py`
- `mcp/landos/tests/test_mcp_servers.py`

Configuration and governance fragments:

- `config/landos-mcp/hermes-mcp-fragment.yaml`
- `config/landos-mcp/mcporter.json`
- `config/landos-mcp/manifest.json`
- `config/landos-mcp/profile-governance-fragment.json`

Report:

- `docs/landos/narrow-mcp-and-structured-output.md`

This lane did not edit shared package files. During integration, `/root` separately added the direct `zod@4.3.6` dependency to `package.json`/`package-lock.json`.

## Runtime and dependency evidence

- Default workspace Python: `fastmcp=False`, `mcp=False`, `pydantic=True`.
- Installed Hermes venv: `mcp==1.28.1`, `mcp.server.fastmcp.FastMCP` available, `pydantic==2.13.4`, `jsonschema`, and `PyYAML==6.0.3` available.
- Standalone `fastmcp` package/CLI is not installed. The selected locally supported API is the FastMCP implementation shipped in the installed official `mcp` runtime; no alternate MCP framework was invented.
- mcporter: `0.9.0`, verified with `npx.cmd -y mcporter --version`.
- Zod: direct `4.3.6` dependency present after integration-owner change.

Clean-machine commands, if the installed Hermes runtime is not reused:

```powershell
python -m pip install "mcp==1.28.1" "pydantic==2.13.4" jsonschema "PyYAML==6.0.3"
npm install --save-exact zod@4.3.6
npm install --global mcporter@0.9.0
```

No dependency installation command should be run from an MCP tool, and no package/lockfile change is made by this lane.

## Verification results

Focused structured-output and canonical bridge suite, final rerun completed **2026-08-02 23:23 EDT**:

```text
npx.cmd vitest run src/landos/governance/hermes-worker-schema.test.ts src/landos/governance/mcp-bridge.test.ts
PASS - 2 files, 44 tests, 0 failures
```

FastMCP/policy/adapter suite, final rerun completed after full capability coverage was added:

```text
python -B mcp/landos/run_checks.py test
PASS - 11 tests, 0 failures
```

Repository typecheck:

```text
npm.cmd run typecheck -- --pretty false
PASS - zero TypeScript diagnostics
```

Offline FastMCP surface inspector:

```text
python -B mcp/landos/run_checks.py inspect
PASS - expected == exposed for all servers; deniedMatches=[]; resourcesExposed=false; promptsExposed=false
```

Actual mcporter schema inspections:

```text
npx.cmd -y mcporter --config config/landos-mcp/mcporter.json --root . list landos-read --schema --json
PASS - status=ok, 7 tools, durationMs=1168

npx.cmd -y mcporter --config config/landos-mcp/mcporter.json --root . list landos-acceptance --schema --json
PASS - status=ok, 8 tools, durationMs=1147

npx.cmd -y mcporter --config config/landos-mcp/mcporter.json --root . list landos-research --schema --json
PASS - status=ok, 5 tools, durationMs=1236
```

Actual mcporter denial calls:

```text
landos-read.execute_sql        -> isError=true, "tool 'execute_sql' is not callable on 'landos-read'"
landos-acceptance.write_file   -> isError=true, "tool 'write_file' is not callable on 'landos-acceptance'"
landos-research.set_valuation  -> isError=true, "tool 'set_valuation' is not callable on 'landos-research'"
```

A final `mcporter list --json` reported all three LandOS servers as `status=ok` with their exact tool counts. The command also discovered an unrelated Codex `node_repl` server as offline; it is not referenced by the LandOS MCP configuration and no LandOS server reported an error.

Fixture tests use `tempfile.TemporaryDirectory`, a `SafeJsonFixtureStore` constrained beneath its explicit allowed root, and only `state.json`. They validate path escape rejection. No live LandOS database, Deal Card, acceptance artifact package, environment file, browser, or provider was mutated.

The first Python import produced `mcp/landos/landos_mcp/__pycache__`; it was removed. Every configured launch now uses `python -B`, entrypoints set `sys.dont_write_bytecode`, and the final forbidden-artifact check returned `NO_PYTHON_BYTECODE_ARTIFACTS`.

Final scoped hygiene checks found no `.pyc`, `.pyo`, SQLite/database artifact, trailing whitespace, or common credential literal signature beneath this lane's owned paths.

## Exact integration changes requested

1. **Hermes admission hook.** The shared Hermes handback path must parse the file once and call `validateHermesWorkerOutput` before `validateHermesLandPortalFileIdentity` or any canonical import. Supply the LandOS-held assignment tuple: address, APN, LandPortal property id, Property Card id, and (after the first reconciled specialist) subject URL. Fail closed if APN or property id is absent; do not infer either from model prose. Retain the existing importer validation as a second control.

2. **Canonical MCP adapter injection (complete).** `CanonicalBridgeLandosAdapter` implements the protocols through one bounded application-owned bridge to existing canonical read/store APIs. Python does not open SQLite, accept arbitrary query/path parameters, or use `FixtureLandosAdapter` in production. All three stdio entrypoints construct the canonical adapter.

3. **Acceptance adapter mapping.** Map acceptance methods to the acceptance lane's package writer/validator, preserving schema version `1.0.0`, immutable contract/run identity, exact artifact filenames, and independent authority. Do not connect this adapter to an implementation profile or implementation RPC.

4. **Research adapter mapping.** Map facts/comps/visuals only through existing canonical Property Research/comp/visual admission functions after exact Property Card identity checks. Progress and terminal category results must use the existing specialist-status store. Do not add a second research store.

5. **Read adapter mapping.** Project the seven bounded responses from existing canonical read APIs/stores. Redact before returning models and reject any adapter output that does not validate the strict response model.

6. **Profile provisioning.** Merge only the eligible servers from `profile-governance-fragment.json` and preserve its denylists. Do not attach `landos-acceptance` to research, debug, knowledge, automation, or implementation. Do not attach `landos-research` to visual QA.

7. **Post-integration verification.** The 55 focused tests, typecheck, all three mcporter schema inspections, a safe canonical read, and the three denial calls pass. Profile checks and independent visual acceptance remain integration-owner responsibilities; backend/MCP proof does not replace the visual verdict.

## Remaining blockers and non-claims

- There is no remaining MCP functional activation blocker: the canonical adapter and all three servers are attested `verified-live-canonical` after current tests, live schema inspection, denial calls, and a safe canonical read.
- The top-level `fastmcp` CLI is absent; this is not an execution blocker because the installed Hermes MCP 1.28.1 FastMCP implementation runs all three stdio servers and mcporter has inspected them successfully.
- This lane does not claim the 704 Bell operator-facing known defect is fixed or visually accepted.
- This lane did not update `.landos/CHECKPOINT.md`; the integration owner owns the shared handoff.
- No commit, push, deployment, live-data mutation, paid API, secret read, or environment-file edit occurred.
