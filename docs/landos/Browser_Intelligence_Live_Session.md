# Browser Intelligence — Live Persistent Session

LandOS activates live browser execution by **connecting to a Chrome you launch and
log into once**. Your cookies stay in your own Chrome profile; LandOS connects
over the DevTools (CDP) protocol, reuses that session across every lead, and
**disconnects** (never closes) so the window stays open all day. LandOS never
stores, reads, or prints credentials/cookies/tokens.

Engine: **Puppeteer** (`puppeteer-core`, already installed). Playwright is not used.

## 1. Launch the persistent browser (once per day)

Use a **dedicated profile** so the LandPortal login persists. Run in PowerShell:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\Users\tbutt\.landos-chrome"
```

- `--remote-debugging-port=9222` opens the local CDP endpoint LandOS connects to
  (bound to `127.0.0.1` only — do **not** expose port 9222 to the network).
- `--user-data-dir=...\.landos-chrome` is a separate, persistent profile. Its
  cookies survive restarts, so you log into LandPortal once and stay logged in.

In that Chrome window, go to landportal.com and **log in manually**. Leave the
window open. That's the whole "keep it open all day" step — don't close it.

## 2. Enable live mode and (re)start LandOS

Set the flag (shell env wins; `.env` also works), then start the server:

```powershell
$env:BROWSER_INTEL_LIVE = "1"          # optional: $env:BROWSER_INTEL_CDP_URL = "http://127.0.0.1:9222"
npm run landos:restart
```

Or add to `.env`:

```
BROWSER_INTEL_LIVE=1
BROWSER_INTEL_CDP_URL=http://127.0.0.1:9222
```

Screenshots are saved to `%TEMP%\landos-browser-shots` (override with
`BROWSER_INTEL_SHOT_DIR`). They are property work product, never committed to the repo.

## 3. Confirm the session is live

```
GET /api/landos/browser/session
```

Returns one of:

- `live` — connected and reused across leads (ready).
- `disabled` — `BROWSER_INTEL_LIVE` is not set.
- `unreachable` — no Chrome answering on the CDP endpoint (launch step 1).
- `auth_needed` — connected, but a manual login is still required (do step 1's login).

No cookies/tokens are ever in this response.

## 4. How reuse works

The first lead connects to your Chrome and caches the connection + one working
tab. Every later lead **reuses** the same connection and tab — no reconnect, no
re-login. If you close Chrome, the next call reports `unreachable` until you
relaunch. LandOS only ever disconnects, so your browser stays open.

## Safety (enforced)

Read-only only: open / navigate / read visible fields / one proof screenshot.
Forbidden and never performed (recorded as blocked): paid reports, credit-
consuming actions, billing, account/settings changes, paid exports, purchases,
writes/edits/deletes. No credential storage. No cookie/token printing. County
public records need no login; LandPortal uses your existing logged-in session.
