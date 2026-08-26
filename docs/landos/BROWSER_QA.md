# LandOS browser QA

LandOS browser acceptance has a repository-native path and does not depend on
an agent session receiving a browser MCP connection.

## Canonical entrypoint

Run a named acceptance scenario when one exists:

    npm run landos:browser:qa -- --scenario gods-eye-view

For a generic local route smoke and refresh check:

    npm run landos:browser:qa -- --route /dept/acquisitions

The command waits for `http://localhost:3141/api/health`, connects to the owned
Chrome DevTools endpoint on port 9224 when healthy, or starts the existing
managed LandOS Chrome when necessary. It uses Puppeteer already present in the
repository dependency graph; do not install another browser or framework.

Each run creates one marked page, keeps navigation on localhost, applies
bounded timeouts, captures console errors, page errors, failed requests and
HTTP failures, and writes `report.json`, `report.md`, and screenshots beneath
`.runtime/landos/qa/browser-<scenario>-<timestamp>/`. It closes only its own
page and disconnects its own CDP client. The managed browser remains available;
the operator's personal Chrome and unrelated pages are never cleanup targets.

## Required fallback order

1. Use a native browser-control tool only when it is connected and healthy.
2. Otherwise invoke `landos:browser:qa`, which prefers the approved persistent
   CDP session on port 9224.
3. If that endpoint is absent, the same command launches managed Chrome using
   the repository ownership checks, profile and installed executable.
4. Treat `PASS` as acceptance, `FAIL` as a product or assertion defect to fix,
   and `BLOCKED` as a browser infrastructure failure with actionable evidence.

The absence of a native tool is not a valid blocker. Do not stop or kill Chrome
by process name. `npm run landos:browser status` is the read-only ownership
diagnostic; `start`, `reap`, and `stop` remain explicit operational commands.
