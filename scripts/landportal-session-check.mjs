// Read-only check: is the LandOS Chrome profile still authenticated to LandPortal?
//
// Attaches to an already-running Chrome over the DevTools protocol and reports
// what is on screen. Nothing is typed, submitted, navigated, or captured, so
// this is safe to run against the operator's live session at any time.
//
// Usage:
//   node scripts/landportal-session-check.mjs [cdp-port]
//
//   cdp-port   Chrome remote-debugging port (default: LANDOS_CDP_PORT, else 9224)
//
// Exit code 0 when a LandPortal page is open and does not look like a login
// wall, 1 when it looks logged out or no page could be read, 2 on bad
// arguments or when Chrome is not reachable on that port.
import puppeteer from 'puppeteer-core';

const portArg = process.argv[2] ?? process.env.LANDOS_CDP_PORT ?? '9224';
const port = Number(portArg);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`cdp-port must be a valid port number (got "${portArg}")`);
  process.exit(2);
}

let browser;
try {
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
} catch (err) {
  console.error(`Could not attach to Chrome on port ${port}: ${err.message}`);
  console.error('Start Chrome with --remote-debugging-port, or pass the port this profile actually uses.');
  process.exit(2);
}

const pages = await browser.pages();
const page = pages.find((p) => /landportal\.com/i.test(p.url())) ?? pages[0];
if (!page) {
  console.error('Chrome is running but has no readable page.');
  await browser.disconnect();
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 3000));
const state = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  loginLike: /sign in|log in|login|password/i.test(document.body.innerText.slice(0, 4000)),
  hasSearch: !!document.querySelector('input[type="text"], input[type="search"]'),
  headText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500),
}));

const onLandPortal = /landportal\.com/i.test(state.url);
const authenticated = onLandPortal && !state.loginLike;
console.log(JSON.stringify({ ...state, onLandPortal, authenticated }, null, 2));

await browser.disconnect();
process.exit(authenticated ? 0 : 1);
