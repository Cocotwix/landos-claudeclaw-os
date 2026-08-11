# LandOS deterministic visual acceptance

Implementation ready for independent visual acceptance.

This lane adds the Playwright Test harness and the read-only completion gate. It does not repair or certify the known Deal Card projection defect. The independent `landos-visual-qa` role owns the real localhost verdict.

## Implemented boundary

The versioned shared contract is defined by:

- `config/acceptance/acceptance-contract.schema.json`
- `config/acceptance/results.schema.json`
- `config/acceptance/704-bell-known-defect.contract.json`

Schema version `1.0.0` predeclares the property, canonical counts, run policy, independent authority, every visible claim, comparison rule, operator-facing section, and allowed screenshot evidence. A result cannot add an undeclared claim or redirect a claim to an undeclared screenshot.

Every result claim records the required property address, claim, expected value, visible value, `PASS` or `FAIL`, evidence path, timestamp, refresh result, restart result, and contamination result. Top-level results also record visible/canonical/rendered counts, empty-state observations, console and required-network counts, freshness, context/page lifecycle, and the independent verdict.

The package gate in `scripts/acceptance/completion-gate.mjs` is non-destructive. It reads evidence and exits nonzero without editing the package. It validates:

- all 13 exact required artifact names and regular-file containment;
- both schemas and contract/result identity;
- every predeclared claim, comparison, visible value, timestamp, and linked visual artifact;
- PNG signature, chunk CRCs, decoded dimensions, sampled color diversity, byte length, captured visible text, locator/section description, SHA-256, and metadata consistency;
- Playwright ZIP structure and a readable `trace.trace` entry;
- WebM EBML, Segment, Tracks, and Cluster structure;
- report content against the current contract and results;
- canonical accepted counts against displayed counts and rendered rows;
- an empty state when canonical accepted records exist;
- freshness when required, refresh retention, restart retention, contamination, relevant console errors, required network failures, verdict, and browser cleanup;
- unredacted cookies, authorization values, bearer tokens, sessions, JWTs, secrets, and sensitive query values in textual trace entries.

The trace is first written under a unique OS temporary directory, sanitized entry-by-entry, and only then written as `trace.zip` in the evidence package. The raw trace and Playwright video temporary directory are removed after the isolated context closes. Console text is redacted and truncated; captured network URLs contain only paths, never query strings, headers, or bodies.

## Browser lifecycle and authentication

Each run creates its own Playwright Chromium context from the runner-owned browser process. The normal operator Chrome process is never attached to or mutated. The run closes its page and context in `finally`, verifies created/closed counts and the browser-context baseline, saves the final video, removes its bounded temporary directory, and records cleanup in `results.json`.

### Diagnostic browser tooling

No supported Chrome DevTools MCP is installed in this workspace. The selected
installed equivalent is official Playwright Test with isolated Chromium,
trace capture, console capture, failed-request capture, screenshots, and video.
Those facilities may support diagnosis, but they do not confer repair or
acceptance authority. A deterministic Playwright result and an independent
operator-facing visual inspection must agree before a verdict can be `PASS`.

For live localhost acceptance, the preferred authentication bootstrap is the single-use, credential-free connect URL printed by:

```text
npm run landos:visual-ready
```

Pass that URL only as `LANDOS_ACCEPTANCE_CONNECT_URL`. The disposable context consumes it and is then destroyed. The URL is never copied to results, logs, screenshots, reports, or trace metadata.

An external Playwright storage-state file is supported only when both `LANDOS_ACCEPTANCE_AUTH_STATE` and `LANDOS_ACCEPTANCE_AUTH_STATE_APPROVED=1` are set. The helper rejects repository-local files, symbolic links, malformed state documents, and files larger than 1 MB. It never copies or reports the path or contents. Do not place a storage-state file under this repository.

## Execution modes

The safe default is the local synthetic fixture. It uses no credentials, providers, external assets, or application data:

```text
npx playwright test scripts/acceptance/specs/landos-704-bell.visual.spec.ts --config=playwright.config.ts
```

Live known-target mode uses `http://localhost:3141` by default and requires an explicit Deal Card ID, the visual-ready connect URL, and restart authorization:

```text
LANDOS_ACCEPTANCE_MODE=live
LANDOS_ACCEPTANCE_CONNECT_URL=<single-use URL from landos:visual-ready>
LANDOS_ACCEPTANCE_DEAL_ID=<Deal Card ID>
LANDOS_ACCEPTANCE_ALLOW_MANAGED_RESTART=1
LANDOS_ACCEPTANCE_EXPECT_VERDICT=FAIL
```

Set those environment values in the calling shell, run the same Playwright command, and clear them after the run. The live restart step invokes only `npm run landos:restart` with fixed arguments.

Fresh-address mode is also configurable with `LANDOS_ACCEPTANCE_ENTRY_FLOW=new-lead`, `LANDOS_ACCEPTANCE_FRESHNESS_REQUIRED=1`, a new `LANDOS_ACCEPTANCE_PROPERTY_ADDRESS`, canonical expected counts, and the explicit mutation guard `LANDOS_ACCEPTANCE_ALLOW_NEW_LEAD=1`. It enters the property through the accessible `Lead information` textbox and `Create Lead Card & start research` button. The guard prevents an accidental live lead creation.

Operator navigation prefers accessible roles and names: `New Lead`, `Lead information`, the `Comps & Market` and `Documents & Visuals` tabs, their tabpanels, the visible `Accepted sold comps` label, and `Hero property imagery`. Narrow fixture-only attributes are used only as an offline fallback for count rows.

## 704 Bell Rd fixture proof

The retained package is:

`.landos/acceptance/2026-08-03T01-47-47-731Z-governed-multi-agent-os-known-defect-proof/`

The run began at `2026-08-03T01:47:47.729Z` and completed at `2026-08-03T01:47:51.281Z`. It produced every required artifact:

- `acceptance-contract.json`
- `acceptance-report.md`
- `results.json`
- `new-lead.png`
- `deal-card-loaded.png`
- `changed-section.png`
- `relevant-tab-or-panel.png`
- `after-refresh.png`
- `after-restart.png`
- `trace.zip`
- `video.webm`
- `console.json`
- `network-failures.json`

The fixture intentionally models the accepted canonical handback and the known operator projection mismatch:

| Operator section | Canonical accepted | Displayed | Rendered rows | Empty state | Claim result |
| --- | ---: | ---: | ---: | --- | --- |
| Comps & Market | 4 | 0 | 0 | visible | FAIL |
| Documents & Visuals | 1 | 0 | 0 | visible | FAIL |

The property identity and contamination claims passed. Refresh and synthetic restart reinspection retained the same visible observations. Relevant console errors were `0`; required network failures were `0`. Browser cleanup recorded contexts `1/1` closed and pages `1/1` closed. The independent fixture verdict is `FAIL` and the completion gate exits `1`, as required for the known defect. This is successful detection by the acceptance system, not a claim that the Deal Card defect is fixed.

The fixture restart is explicitly synthetic and exists for safe offline harness testing. It does not substitute for Lane J's managed localhost restart and independent visual reinspection.

## Verification performed

| Command | Result |
| --- | --- |
| `node --test scripts/acceptance/*.test.mjs` | PASS: 31/31, including all gate mutations and trace-redaction canaries. |
| `npx playwright test scripts/acceptance/specs/landos-704-bell.visual.spec.ts --config=playwright.config.ts` | PASS: 1/1; complete expected-FAIL evidence package generated. |
| focused TypeScript check for `playwright.config.ts` and the acceptance spec | PASS with strict NodeNext settings. |
| strict Ajv 2020 validation of both published schemas, the source contract, and retained run documents | PASS. |
| `node scripts/acceptance/completion-gate.mjs <fixture-package>` | Expected FAIL, exit `1`; all five known visual projection claims blocked completion. |

Gate mutation tests prove a nonzero CLI exit for invalid screenshot content, displayed/rendered count mismatch, canonical data absent from the UI, empty state with canonical data, refresh loss, restart loss, cross-property contamination, relevant console error, required network failure, non-PASS verdict, undeclared/missing claim evidence, incomplete context/page cleanup, required freshness failure, missing trace, missing video, and unsanitized trace secrets. A fully consistent synthetic PASS package also proves the gate's zero-exit path and report generation.

## Package integration request

The official package is `@playwright/test`. The npm registry reported current version `1.62.1`, and the integration lane installed `@playwright/test` with lockfile version `1.62.1` plus the matching Chromium/FFmpeg/headless-shell runtime. The project follows the [official Playwright Test installation guidance](https://playwright.dev/docs/intro).

No `package.json` or lockfile change was made by this lane. The remaining shared-file request is to add these scripts through the integration owner:

```json
{
  "landos:acceptance:unit": "node --test scripts/acceptance/*.test.mjs",
  "landos:acceptance:run": "playwright test scripts/acceptance/specs/landos-704-bell.visual.spec.ts --config=playwright.config.ts",
  "landos:acceptance:report": "node scripts/acceptance/generate-report.mjs",
  "landos:acceptance:gate": "node scripts/acceptance/completion-gate.mjs"
}
```

Pass a package directory after `--` to the report and gate scripts. Meaningful operator-facing work must not be treated as complete or committed as finished until the independent live package verdict is `PASS` and `landos:acceptance:gate` exits zero.

## Lane files and concurrency evidence

This lane exclusively added or edited:

- `playwright.config.ts`
- `config/acceptance/**`
- `scripts/acceptance/**`
- `.landos/acceptance/.gitkeep`
- the retained fixture package under `.landos/acceptance/`
- `docs/landos/visual-acceptance.md`

The schema boundary was sent to the MCP lane while this lane continued implementing the gate and browser harness. In parallel, the integration lane installed Playwright and browser binaries, allowing this lane to move directly from dependency-independent tests to the browser run without editing shared package files. The MCP lane consumes the versioned schemas read-only. No existing application, UI, runtime, Hermes specialist, checkpoint, environment, profile, MCP, package, or lockfile file was edited by this lane.

## Remaining independent work

Lane J must run the same workflow against the real authenticated localhost Deal Card for 704 Bell Rd, inspect the visible screenshots/trace/video without an implementation conclusion, perform the managed restart, and issue the authoritative `PASS` or `FAIL`. The known comp/visual projection defect remains intentionally unfixed.
