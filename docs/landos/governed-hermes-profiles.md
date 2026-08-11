# Governed Hermes profiles for LandOS

## Operating model

LandOS has five isolated Hermes `0.19.1` profiles. Governance is practical and
role-scoped: each profile receives the normal native tools its job needs. There
is no blanket terminal/file/browser denylist and no custom runtime-operation
broker. MCP configuration remains owned by the narrow MCP lane and is empty
unless the existing explicit `--activate-mcp` integration gate passes.

The machine-readable source is
`config/hermes/governance/approved-capabilities.json`; profile contracts are in
`config/hermes/governed-profiles/`.

## Retained protections

Exactly seven governance protections remain:

1. no secret or `.env` exposure;
2. no arbitrary SQL or destructive deletes;
3. no unrestricted Deal Card mutation;
4. isolated visual acceptance;
5. no self-certification;
6. preservation of unrelated dirty state; and
7. rejection of cross-property evidence.

Paid APIs are not authorized. Hermes secret redaction and native file-safety
remain enabled. The supported `approvals.deny` policy unconditionally blocks
terminal attempts such as `Get-Content .env`, `cat .env`, direct database CLIs,
destructive delete/reset commands, and direct unrestricted Deal Card mutation,
while normal bounded commands such as `git status --short`, `node --version`,
log reads, and Playwright listing remain usable. Filesystem checkpoints are
enabled for dirty-state recovery, and the provisioner refuses to overwrite
changed managed files.

## Profile capabilities

| Profile | Native toolsets | Operational scope |
| --- | --- | --- |
| `landos-research` | `terminal`, `web`, `browser`, `vision`, `file`, `skills`, `memory`, `session_search`, `todo`, `clarify` | Keyless public research, authenticated LandPortal/public browser and CDP, bounded public-source commands, scoped research artifacts, exact-property evidence |
| `landos-visual-qa` | `terminal`, `browser`, `vision`, `skills`, `memory`, `session_search`, `todo`, `clarify` | Run the repository Playwright workflow in a fresh isolated context; inspect screenshots, DOM/a11y, console, network, trace/video and scoped acceptance artifacts |
| `landos-debug` | `terminal`, `browser`, `vision`, `skills`, `memory`, `session_search`, `todo`, `clarify` | Bounded shell/log/Node/Python/browser/CDP diagnostics; repository and runtime stay read-only; diagnostic output stays in the profile workspace |
| `landos-knowledge` | `file`, `vision`, `skills`, `memory`, `session_search`, `todo`, `clarify` | Approved repository reads and updates only to the assigned knowledge, registry, documentation, or governed-skill output |
| `landos-automation` | `browser`, `cronjob`, `skills`, `memory`, `session_search`, `todo`, `clarify` | Create/change/run only a named watcher with explicit `enabled: true`, target, source, schedule, owner, watermark, destination, and stop condition |

Hermes attributes `web_search` included by the browser toolset to the `web`
group in CLI diagnostics. Nonresearch profiles still have no web provider, so
this does not enable `web_extract` or a paid fallback. Only research enables
the keyless `ddgs` provider, pinned to `9.14.4`.

Research may attach to an explicitly selected authenticated browser using
`/browser connect`, `BROWSER_CDP_URL`, or a configured CDP endpoint. It must not
extract cookies, tokens, credentials, or browser storage. Visual QA must never
reuse that shared session: its browser/CDP access is limited by contract to the
fresh Playwright acceptance context. Debug may use CDP for diagnostics but may
not write repository/runtime files.

Automation provisioning creates no schedule. Scheduler authority becomes
usable only for a complete definition explicitly marked enabled. Knowledge can
make normal governed output updates and leaves them as a reviewable dirty
worktree; it cannot edit application code or canonical Deal Cards.

## Skills and research capabilities

Six LandOS custom skills and the selected bundled/optional skills retain source,
version, owner, audit, and hash provenance. Provisioning writes
`.landos-governance/skill-provenance.json`. Installed skill edits use the normal
governed dirty-worktree workflow: there is no mandatory staging, approval, or
installed-directory digest gate, and reprovisioning preserves local skill
improvements rather than overwriting them.

`duckduckgo-search` is research-only and uses installed `ddgs` `9.14.4`.
`domain-intel` is installed and enabled for passive commands against approved
public domains; its pinned source and standard-library entrypoint still receive
an offline smoke. `grounded-citations` remains a required evidence policy
because no supported skill exists. Scrapling and OSINT remain unavailable based
on their actual dependency/scan state; no broader restriction is inferred from
that. No paid provider is selected.

## Provisioning and verification

The manager creates missing files atomically, preserves existing user changes,
and records the complete production `landos` profile digest before and after
every provision attempt.

```powershell
node scripts/hermes/governed-profile-manager.mjs audit
node scripts/hermes/governed-profile-manager.mjs validate-capabilities
node scripts/hermes/governed-profile-manager.mjs provision --dry-run

# Isolated integration root
node scripts/hermes/governed-profile-manager.mjs provision --target-root <profiles-root>
node scripts/hermes/governed-profile-manager.mjs check --target-root <profiles-root>
node scripts/hermes/governed-profile-manager.mjs smoke --target-root <profiles-root>

# Authorized installed-runtime action after MCP integration is ready
node scripts/hermes/governed-profile-manager.mjs provision --apply-external --activate-mcp
node scripts/hermes/governed-profile-manager.mjs check --activate-mcp
node scripts/hermes/governed-profile-manager.mjs smoke --activate-mcp
```

The provider-free smoke invokes
`hermes --profile <id> prompt-size --json` for all five profiles, loads/views
every installed skill through the actual Hermes loader, verifies native toolset
resolution, imports `ddgs` without searching, loads domain-intel with network
denied, and exercises the native command policy. The negative smoke proves
`.env` reads, arbitrary SQL, destructive deletion, and unrestricted Deal Card
mutation are denied; its positive controls prove normal bounded commands remain
available.

Tests:

```powershell
node --test scripts/hermes/governed-profile-manager.test.mjs
```

External provisioning, MCP activation, restart, and independent acceptance are
root integration actions. The existing production `landos` profile is never a
seed or target for these five profiles.
