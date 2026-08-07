// Operator control for the dedicated LandOS automation browser.
//
//   npm run landos:browser status   what LandOS owns, and whether it owns it
//   npm run landos:browser start    launch the owned browser (always offscreen)
//   npm run landos:browser reap     close orphan automation tabs
//   npm run landos:browser stop     shut the owned browser down
//
// Every subcommand refuses to act unless the ownership guard proves the process
// behind the endpoint is OUR Chrome on OUR profile. Nothing here can reach the
// operator's browser. Target URLs are never printed: a leaked dashboard tab
// carries a token in its query string.

import {
  automationBrowserConfig,
  launchAutomationBrowser,
  reapOrphanAutomationTabs,
  verifyAutomationOwnership,
  type AutomationTarget,
} from './automation-browser.js';

const DASHBOARD_ORIGIN = `http://localhost:${process.env.PORT ?? 3141}`;

async function targets(endpoint: string): Promise<AutomationTarget[]> {
  try { return await (await fetch(`${endpoint}/json/list`)).json() as AutomationTarget[]; } catch { return []; }
}

async function status(): Promise<number> {
  const config = automationBrowserConfig();
  const ownership = await verifyAutomationOwnership(config);
  console.log(`Endpoint     : ${config.endpoint}`);
  console.log(`Profile      : ${config.profileDir}`);
  console.log(`Chrome       : ${config.chromePath ?? 'NOT FOUND'}`);
  console.log(`Owned        : ${ownership.owned ? 'YES' : 'NO'}`);
  console.log(`Browser      : ${ownership.browser || '—'}`);
  console.log(`PID          : ${ownership.pid ?? '—'}`);
  if (!ownership.owned) {
    console.log(`Reason       : ${ownership.reason}`);
    return 1;
  }
  const list = await targets(config.endpoint);
  const pages = list.filter((t) => t.type === 'page');
  console.log(`Targets      : ${list.length} (${pages.length} page(s))`);
  return 0;
}

async function start(): Promise<number> {
  const result = await launchAutomationBrowser();
  console.log(`Endpoint     : ${result.endpoint}`);
  console.log(`Profile      : ${result.profileDir}`);
  console.log(`Chrome       : ${result.chromePath ?? 'NOT FOUND'}`);
  console.log(`PID          : ${result.pid ?? '—'}`);
  console.log(`Result       : ${result.launched ? 'LAUNCHED' : result.reused ? 'REUSED (already owned)' : 'NOT STARTED'}`);
  if (result.error) { console.log(`Error        : ${result.error}`); return 1; }
  return 0;
}

async function reap(): Promise<number> {
  const config = automationBrowserConfig();
  const result = await reapOrphanAutomationTabs({ config, dashboardOrigin: DASHBOARD_ORIGIN });
  console.log(`Inspected    : ${result.inspected} target(s)`);
  console.log(`Closed       : ${result.closed}`);
  console.log(`Failed       : ${result.failed}`);
  console.log(`Still open   : ${result.remaining}`);
  return result.remaining === 0 ? 0 : 1;
}

async function stop(): Promise<number> {
  const config = automationBrowserConfig();
  const ownership = await verifyAutomationOwnership(config);
  if (!ownership.owned) { console.log(`Not stopping: ${ownership.reason}`); return 1; }
  // Terminate the EXACT pid the ownership guard proved is ours. Never by
  // process name — `taskkill /IM chrome.exe` would take the operator's browser
  // with it, which is the precise failure this whole module exists to prevent.
  const pid = ownership.pid;
  if (pid == null) { console.log('Not stopping: the owned process id could not be resolved.'); return 1; }
  try {
    process.kill(pid);
  } catch (err) {
    console.log(`Could not stop pid ${pid}: ${(err as Error)?.message ?? 'unknown'}`);
    return 1;
  }
  for (let i = 0; i < 20; i++) {
    const still = await verifyAutomationOwnership(config);
    if (!still.answering) { console.log(`Automation browser (pid ${pid}) stopped.`); return 0; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`Requested shutdown of pid ${pid}; the endpoint is still answering.`);
  return 1;
}

const command = (process.argv[2] ?? 'status').toLowerCase();
const run = command === 'start' ? start
  : command === 'reap' ? reap
    : command === 'stop' ? stop
      : status;
run().then((code) => process.exit(code)).catch((err: unknown) => {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
});
