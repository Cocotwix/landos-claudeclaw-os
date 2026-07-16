# LandOS Windows Runtime

These scripts are the only supported local Windows process workflow for the LandOS dashboard.

Plain `npm start` is a compatibility alias for `npm run landos:start` on Windows. Named-agent and non-Windows startup retain their existing foreground behavior.

| Operation | Command | Use |
| --- | --- | --- |
| Status | `npm run landos:status` | Inspect identity, metadata, port ownership, and HTTP state. |
| Start | `npm run landos:start` | Start only when stopped; a healthy running instance is left unchanged. |
| Stop | `npm run landos:stop` | Stop only verified repository-owned instances. |
| Restart | `npm run landos:restart` | Put a rebuilt backend live with bounded stop/start verification. |
| Logs | `npm run landos:logs` | Print recent runtime stdout, stderr, and application log lines. |
| Health | `npm run landos:health` | Run the bounded automation-friendly HTTP check. |

## Safety Model

- The backend is launched from the repository root with the absolute `dist/index.js` path and `process.execPath`.
- A native `CreateProcessW` helper uses a detached process group, breaks away from the caller's Windows job, and restricts inherited handles to `NUL`, stdout, and stderr.
- Environment keys are deduplicated case-insensitively. Exactly one `Path` value is passed to the backend.
- Runtime metadata records only process identity: PID, start time, repository, entry point, executable, and instance ID. Dashboard authentication stays in the existing local configuration and is never copied into runtime files or logs.
- Status and stop require matching metadata or repository startup evidence plus process start time. PID reuse fails closed.
- The backend PID lock never kills an existing PID. A live owner blocks duplicate startup; a dead lock is quarantined atomically.
- Port 3141 ownership is checked before launch. An unrelated owner is reported and never terminated.
- Start has a 45-second startup deadline, HTTP requests have a 3-second timeout, and stop uses bounded graceful and forced phases.
- Failed startup terminates only the PID created by that attempt and prints recent stdout/stderr diagnostics.

## Local Files

Ignored runtime state lives in `.runtime/landos/`:

- `runtime.json`: current instance identity
- `history.json`: recent instance PIDs/start times for orphan detection
- `stdout.log`: current launch stdout; truncated on each launch
- `stderr.log`: current launch stderr; truncated on each launch
- `operation.lock`: short-lived start/stop/restart concurrency lock

`npm run landos:logs` also tails the application-owned `logs/main.log`. On a stopped-to-start transition, the runtime keeps its newest 5 MB when it exceeds 10 MB; no other logs are modified.

Managed agent sandboxes may reject Windows process inspection or creation with `EPERM`. Grant process-control permission and rerun the same npm command; do not replace it with an inline launcher or generic process command.

If start fails, run `npm run landos:status` and `npm run landos:logs`. The start command also prints recent stdout/stderr and removes only the failed process it launched. Every HTTP probe, process command, stop phase, and startup poll has an explicit deadline.

## Live-Local Finish

After tests and build, rebuild if needed, restart the local `:3141` dashboard if needed, confirm localhost responds, verify the changed operator workflow is live in the running dashboard, and report the server PID and exact URL. Do not leave LandOS stopped.
