# LandOS Agent Runtime Rules

## Fresh-session bootstrap

This is the LandOS repository. Before LandOS work, load only
`.landos/PERMANENT_MEMORY.md` and `.landos/CHECKPOINT.md`; they are the
compact automatic operating memory and current checkpoint. Inspect live disk
state because it outranks stale checkpoint implementation facts. Preserve
unrelated dirty work. Retrieve detailed history only when relevant with
`npm run landos:memory:retrieve -- <task-specific query>`.

The primary database is `store/landos.db`; detailed reports are under
`docs/landos/`. Neither is automatically loaded or queried.

## Canonical Windows runtime

Use only: `npm run landos:status`, `landos:start`, `landos:stop`,
`landos:restart`, `landos:logs`, and `landos:health`.

Runtime state and stdout/stderr live under `.runtime/landos/`; application
logs remain in `logs/main.log`. Use `status` for ownership, `start` only
when stopped, `restart` after a rebuild, `stop` for verified shutdown,
`health` for bounded automation, and `logs` for diagnostics.

Do not run `node dist/index.js` as a foreground long-running command, pipe
inline Node launchers through stdin, kill generic Node processes, use unbounded
polling, or improvise restart commands. If process control fails with `EPERM`,
rerun the same canonical command with approved permission.

## Staged sprint lifecycle (mandatory for substantial prompts)

Substantial LandOS prompts run through the enforced staged lifecycle in
`docs/landos/Staged_Sprint_Lifecycle.md`: requirement ledger
(`npm run landos:sprint`), one workstream at a time, independent browser QA
(`npm run landos:operator-qa`) before the next workstream begins, a repair
loop with mandatory retests, a final combined regression and independent
review, and proof-backed completion claims (`[E:<id>]`). Do not declare a
sprint complete outside these gates.

## Live-local finish requirement

After tests and build, restart if needed, confirm `localhost:3141` responds,
verify the changed workflow live, and report the current server PID and exact
URL. Do not leave LandOS stopped.
