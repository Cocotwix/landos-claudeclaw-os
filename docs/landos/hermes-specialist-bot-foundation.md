# Hermes Bot Mode Foundation — Persistent Specialist Profiles (Slice 5)

Established 2026-08-21. This is the foundation record for the four persistent
LandOS specialist Hermes profiles. Production intelligence execution has NOT
been migrated onto them (that is Slice 6); the War Room roster is unchanged
(Slice 7).

## Runtime baseline

- Before: Hermes v0.20.0 (2026.8.3), git install, local main at `715d26cd`
  (2026-08-12, pre-Bot-Mode-in-core).
- After: **Hermes v0.20.5**, official stable tag `v2026.8.19`, commit
  `fcbd1076a93841fa88855acce810e342a5b78101`. Bot Mode has been a default-on
  core plugin since v0.20.3.
- Method: `hermes update` was deliberately NOT used — it fast-forwards the
  current branch to rolling `origin/main` (92 commits past the stable tag at
  execution time). Instead: state snapshot, branch moved to the stable tag
  (upstream had rewritten main history, so this was a ref move, not a
  fast-forward), then the same dependency step the official updater runs
  (`uv pip install -e .[all]` into the existing venv).
- Rollback: pre-upgrade commit is tagged `landos-pre-v0.20.5` in the Hermes
  clone; full state snapshot (profiles, memories, skills, SOULs, state DBs,
  config — caches excluded) at
  `%LOCALAPPDATA%\hermes-backups\pre-v0.20.5-20260821\hermes-state.tar` (149 MB).
  Rollback = move the branch back to the tag, reinstall deps, restore the tar
  if state were ever damaged. Structurally verified; not exercised.
- Config schema stayed at v33; no config migration ran. All 7 pre-existing
  profiles (landos, landos-acquisition-analyst, 5 governed) survived intact,
  and `hermes --version`, `profile list`, oneshot (`-z/--oneshot`, the
  production analyst transport) all verified working after the move.

## The four specialists

A LandOS "Bot" IS a Hermes profile — no custom bot abstraction exists.
Provisioned by `npm run landos:hermes:specialists` (idempotent; `--check`
verifies) from repo-owned templates under `config/hermes/specialists/`:

| Profile | Title | Model | Vision aux |
|---|---|---|---|
| `landos-property` | Property Intelligence | openai-codex / gpt-5.6-sol | ollama / gemma4:12b |
| `landos-market` | Market + Area Intelligence | openai-codex / gpt-5.6-sol | — |
| `landos-seller` | Seller Intelligence | openai-codex / gpt-5.6-sol | — |
| `landos-deal-brain` | Deal Brain | openai-codex / gpt-5.6-sol | — |

The model pin is the existing primary reasoning pair the acquisition analyst
already uses — no new provider, no credential duplication (provider auth stays
in Hermes' existing per-profile/auth store; nothing was copied). SOUL.md is
overwritten on every provision (repo is source of truth for the mandate);
`memories/MEMORY.md` and `memories/USER.md` are seeds written once, so learned
reasoning survives reprovisioning. Profiles are created `--no-skills`
(least capability; no bundled skill dump) and invoked with the `clarify`
toolset only — a specialist structurally cannot browse, research, run
commands, or write files.

## Ownership boundary

LandOS remains authoritative for canonical property facts, deal identity,
seller/contact records, the operational DB, evidence, provenance, Research
Readiness, deterministic calculations, valuation, capability execution and
permissions, intelligence products, deal stage, actions/decisions, and War
Room scope. Hermes profiles own persistent specialist identity, reasoning
style, working memory, validated reasoning lessons, specialist skills, and
Bot Chat continuity. Every SOUL and memory seed states this: bot memory is
cognitive, never factual; when memory disagrees with LandOS evidence, the
evidence wins. A bot remembering "Fairview had a removed structure" can never
outrank canonical Deal 89 evidence.

## Memory / anti-drift doctrine (Levels 1–5)

1. **Deal observation** — belongs to LandOS deal/evidence state, not bot memory.
2. **Pattern / hypothesis** — may live in a bot's MEMORY.md, tagged as
   hypothesis with deal references.
3. **Validated recurring pattern** — durable specialist memory only after
   validation across several deals or Tyler's confirmation.
4. **Promoted specialist skill** — explicit durable behavior; goes through the
   existing governed skill provenance manifest (review + repin), and Hermes'
   own `skills.write_approval` staging when self-improvement proposes changes.
5. **Deterministic LandOS rule** — stable enough to be code; leaves bot
   doctrine and enters LandOS source through normal development acceptance.

Promotion is proposed, never self-applied. One strange deal never becomes
acquisition doctrine. The seeds encode this ladder in every profile.

## Canonical Bot Chats

The canonical persistent Bot Chat is the profile session titled `Bot Chat`
(Hermes' own bot-messaging contract). All four exist and were proven: a fresh
process reopening `landos-property`'s Bot Chat recalled the prior exchange
verbatim. Isolation was proven at the database level: each profile's
`state.db` contains only its own sessions, with no cross-profile content.
Bot Chats are continuity, never LandOS truth storage.

## Programmatic invocation seam

Proven now (no new secrets required):

    npm run landos:hermes:specialist:invoke -- landos-property "<message>"

which runs the supported local contract
`hermes --profile <bot> chat -c "Bot Chat" --create-if-missing -t clarify -q …`.

Identified for Slice 6 production migration: the Hermes gateway `api_server`
platform (OpenAI-compatible, 127.0.0.1:8642) with per-profile routing
(`/p/<profile>/api/sessions`, `/v1/chat/completions`, SSE). Already
configured: `gateway.multiplex_profiles: true` and
`gateway.multiplex_profile_allowlist` restricted to exactly the four
specialists (least privilege — no other profile is reachable over that
listener). **Blocked pending approval:** named-profile API routes fail closed
by design unless `API_SERVER_KEY` exists in each profile's own secret store;
writing that new secret into profile `.env` files is approval-gated
(PERMANENT_MEMORY invariant 8). Tyler must approve key provisioning before
Slice 6 uses the API server.

## Capability boundary (future loop)

Bots request; LandOS executes. The governed MCP bridge
(`mcp-bridge.ts` / `policy.py`) remains the seam — narrow reads plus governed
evidence write-back today, with the one allowlisted `invoke_capability` verb
still to be added in Slice 6. No specialist has terminal, browser, database,
or web tools. The production bounded-capability loop is unchanged.

## Governance / provenance

`config/hermes/governance/approved-capabilities.json` `runtimeAudit` now pins
the actual verified runtime (0.20.5 / `fcbd1076…` / tag `v2026.8.19`,
verified 2026-08-21) with a Bot Mode baseline record. Four bundled skills that
drifted upstream since the 0.19.1 review were re-reviewed and repinned, all
benign: `domain-intel` (frontmatter/doc changes; entrypoint digest unchanged),
`docx` 1.0.0→1.1.0 and `xlsx` 1.0.0→1.1.0 and `powerpoint` 2.0.0→1.1.0
(upstream Nous MIT rewrites with tests), `hermes-agent-skill-authoring`
1.1.0→2.0.0 (doc restructure). `hermes:governed:check` and
`hermes:governed:audit` both pass clean.

## Known issues / deferred

- `test:hermes:governed` has 5 pre-existing unit-test failures whose fixtures
  pin 0.19.1-era runtime behavior (e.g. "browser/CDP scope differs from the
  profile contract" on the fixture landos-research). Identical before and
  after this slice's repo changes; the live `check`/`audit` gates pass.
  Deferred: refresh the test fixtures to the 0.20.5 baseline.
- `landos:hermes:profile:check` reports pre-existing template drift on the
  `landos` worker profile (MEMORY.md / USER.md / landos-landportal SKILL.md
  differ from templates) — recorded exiting 1 before this slice too; the
  profile's learned memory has legitimately evolved past its seed. Deferred:
  decide whether the check should treat seeds as must-match.
- Upstream `hermes update` remains a rolling-main updater; staying on stable
  tags requires the controlled move documented above. Upstream also rewrote
  main history between 2026-08-12 and 2026-08-21 (16k+ commit divergence),
  which is why the upgrade was a ref move.
- Two stray CLI sessions exist in `landos-property` from the first (wrongly
  flagged) invocation attempt during this slice's proof; harmless test
  residue, left in place rather than deleting DB rows.
