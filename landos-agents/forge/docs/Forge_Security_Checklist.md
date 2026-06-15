# Forge Security Checklist

Two parts. Part A runs on changed files for every milestone. Part B runs whenever a new dependency, package, or MCP server is being considered. Produce a clear PASS or FAIL. Forge has veto: a FAIL blocks promotion until resolved or explicitly overridden by the owner with a documented reason.

Forge never reads, prints, or exposes secret values. Inspect posture and config names only.

---

## Part A: Changed-Files Review (every milestone)

- [ ] No secrets, tokens, API keys, JWTs, or credentials added to any changed file.
- [ ] No `.env` values read, printed, logged, or echoed.
- [ ] No private business data or domain-specific records written into the repo.
- [ ] No new outbound network calls introduced without a clear, reviewed reason.
- [ ] No new file-system writes outside the approved scope.
- [ ] No new code that reads environment variables it does not need.
- [ ] Logging does not capture sensitive values.
- [ ] Staged file set excludes `.env`, logs, private files, and unrelated untracked files.

## Part B: Dependency / Package / MCP Review (when adding one)

- [ ] **Maintainer:** reputable, active, identifiable?
- [ ] **Last release / commit:** maintained, not abandoned?
- [ ] **Install scripts:** does it run code at install time? What does it do?
- [ ] **Network access:** outbound calls? To where? Necessary?
- [ ] **File-system access:** reads/writes outside expected scope?
- [ ] **Environment access:** reads env vars or secrets?
- [ ] **Telemetry:** phones home? Opt-out or off?
- [ ] **CVEs / advisories:** known vulnerabilities? (`npm audit`, GitHub advisories.)
- [ ] **License:** compatible with private use?
- [ ] **Sandbox-first:** can it be evaluated in isolation before being trusted?
- [ ] **Open-source-first:** is this the lowest-risk option that meets the need? If a paid route was chosen over open source, that is the owner's business decision, not a Forge one.

Forge evaluates and recommends. Forge never installs. Installation is the owner's call (or the host OS security gate's), after this checklist clears.

## Verdict

- Result: PASS / FAIL
- Veto reasons (if any):
- Override (if the owner explicitly approves with documented reason):
