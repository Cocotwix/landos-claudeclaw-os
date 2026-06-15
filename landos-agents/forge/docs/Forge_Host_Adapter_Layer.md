# Forge Host Adapter Layer

Forge is split into a portable **Core** and a host-specific **Adapter**. This
boundary is what lets Forge move beyond LandOS/ClaudeClaw later. Keep it clean.

---

## Forge Core (portable, pure)

Lives in `src/forge/`. Pure, deterministic, dependency-free, host-neutral. No
network, no `.env`, no secrets, no database, no business-specific concepts.

| Module | Responsibility |
|---|---|
| `engagement.ts` | Lane gate (SAFE/STOP), assumption summary, build plan, review packet scaffold, Markdown render. |
| `review-packet.ts` | Generate a copy-ready Codex review packet (text only). |
| `command-planner.ts` | Generate a Claude Code execution plan with hard safety rails (text only). |

Core takes plain inputs and returns plain data/text. It never persists, routes,
renders UI, or executes anything. The same Core would drop into a creator OS,
agency OS, or any future host unchanged.

## Forge Host Adapter (this host: ClaudeClaw + LandOS)

Everything host-specific. Replaceable per host.

| Layer | Where | Responsibility |
|---|---|---|
| Persistence | `src/forge/host-store.ts` → `store/forge.db` | Save/list/get/update engagements. Dedicated SQLite file (gitignored) so Forge data never mixes with the framework DB or the LandOS business DB. |
| Routing | `src/dashboard.ts` (`/api/forge/*`) | HTTP endpoints that call Core + Adapter. Generate-only, save, list, get, patch, review-packet, command-plan. |
| UI | `web/src/pages/Forge.tsx` | The `/forge` Mission Control panel: create, save, history, reopen, status, copy review packet / command plan. |

The adapter is allowed to be impure (it owns the DB and HTTP). It depends on
Core; Core never depends on it.

---

## Portability rules

- Business-specific rules (Duke, LandPortal, parcel, comp-credit, land
  investing) stay out of Forge Core. They belong to the host's own agents/docs.
- A new host reuses `src/forge/engagement.ts`, `review-packet.ts`, and
  `command-planner.ts` verbatim, and provides its own store, routes, and UI.
- The store is a clean swap point: any host can back `saveEngagement` /
  `listEngagements` / `getEngagement` / `updateEngagement` with its own
  storage as long as it returns the same shapes.
- Nothing in the adapter executes Forge output. Review packets and command
  plans are text for a human to run; the host displays and copies them only.

## Extraction path (future, not this sprint)

When Forge graduates to its own repo (`forge-core`), move the three pure Core
modules and the `docs/` set. Each host then keeps only its adapter (store +
routes + UI). No Core change is required to extract; that is the whole point of
this boundary.
