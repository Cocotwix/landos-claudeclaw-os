const LANDOS_ORIGIN = 'http://localhost:3141';

export function isConnectionRefusedPage(page) {
  const title = String(page?.title || '');
  const rawUrl = String(page?.url || '');
  let decodedUrl = rawUrl;
  try { decodedUrl = decodeURIComponent(rawUrl); } catch { /* keep the raw URL */ }
  return rawUrl.startsWith('data:text/html')
    && (
      /ERR_CONNECTION_REFUSED/iu.test(decodedUrl)
      || /This site can(?:'|&#39;|%26%2339%3B)t be reached/iu.test(decodedUrl)
      || /This site can't be reached/iu.test(title)
    );
}

export function validateVisualLaunchUrl(value) {
  const url = new URL(value);
  if (url.origin !== LANDOS_ORIGIN || url.pathname !== '/connect') {
    throw new Error('Visual recovery requires the managed LandOS loopback connect URL.');
  }
  if (url.searchParams.get('visualReady') !== '1' || url.hash) {
    throw new Error('Visual recovery received an invalid or credential-bearing launch URL.');
  }
  const returnTo = url.searchParams.get('returnTo') || '/dept/acquisitions';
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    throw new Error('Visual recovery received an invalid return path.');
  }
  return { launchUrl: url.toString(), expectedUrl: new URL(returnTo, LANDOS_ORIGIN).toString() };
}

async function closeFailedControlledTabs(browser) {
  const closed = new Set();
  for (const info of await browser.tabs.list()) {
    if (!isConnectionRefusedPage(info)) continue;
    const failed = await browser.tabs.get(info.id);
    await failed.close();
    closed.add(info.id);
  }
  for (const info of await browser.user.openTabs()) {
    if (closed.has(info.id) || !isConnectionRefusedPage(info)) continue;
    const failed = await browser.user.claimTab(info);
    await failed.close();
    closed.add(info.id);
  }
  return closed.size;
}

/**
 * Recover visual acceptance after a managed restart.
 *
 * The failed Chrome-generated page is closed and never reloaded or navigated.
 * A brand-new in-app Browser tab consumes the server's short-lived visual-ready
 * arm, receives an HttpOnly local session, and verifies both acceptance APIs.
 */
export async function recoverLandosVisualAcceptance(browser, launchUrl, options = {}) {
  const { launchUrl: safeLaunchUrl, expectedUrl } = validateVisualLaunchUrl(launchUrl);
  const endpoints = options.verifiedEndpoints;
  if (endpoints?.healthStatus !== 200 || endpoints?.boardStatus !== 200) {
    throw new Error('Visual recovery requires the outside-browser health and board checks to pass first.');
  }
  const closedFailedTabs = await closeFailedControlledTabs(browser);
  const tab = await browser.tabs.new();
  await tab.goto(safeLaunchUrl);
  await tab.playwright.waitForURL(expectedUrl, {
    timeoutMs: options.timeoutMs ?? 30_000,
    waitUntil: 'domcontentloaded',
  });
  return { tab, closedFailedTabs, expectedUrl, ...endpoints };
}
