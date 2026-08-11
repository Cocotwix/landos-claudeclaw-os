import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { artifactMetadata, inspectPng, inspectTraceZip, inspectWebm } from '../artifact-inspector.mjs';
import { validateAcceptancePackage } from '../completion-gate.mjs';
import { buildRunContract } from '../contract-builder.mjs';
import {
  evaluateComparison,
  readJsonFile,
  validateAcceptanceContract,
} from '../contract-validator.mjs';
import { startLandosFixtureServer } from '../fixtures/landos-fixture-server.mjs';
import { generateAcceptanceReport } from '../generate-report.mjs';
import {
  createAcceptanceRunDirectory,
  loopbackBaseUrl,
  patternMatches,
  resolveApprovedAuth,
  safeUrlPath,
  sanitizeConsoleText,
  writeJsonAtomic,
} from '../runtime-helpers.mjs';
import { sanitizeTraceArchive } from '../trace-sanitizer.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_CONTRACT = join(REPOSITORY_ROOT, 'config', 'acceptance', '704-bell-known-defect.contract.json');
const TRACE_MARKER = 'LANDOS_OBSERVATION_V1';

type CountObservation = {
  operatorSection: string;
  label: string;
  canonicalAccepted: number;
  displayed: number;
  renderedRows: number;
  emptyStateVisible: boolean;
  timestamp: string;
  visibleText: string;
};

type EvidenceAssociation = {
  kind: 'comp' | 'visual';
  label: string;
  subjectAddress: string | null;
  subjectApn: string | null;
  subjectPropertyId: string | null;
  itemAddress: string | null;
  sourceUrlPath: string | null;
};

type TraceObservation = {
  marker: typeof TRACE_MARKER;
  artifact: string;
  phase: 'entry' | 'initial' | 'refresh' | 'restart';
  ariaSnapshot: string;
  capturedAt: string;
  urlPath: string;
  activePanel: string | null;
  leadInputValue: string | null;
  restartGeneration: number | null;
  bodyText: string;
  subject: { address: string | null; apn: string | null; propertyId: string | null };
  comps: { displayed: number; renderedRows: number; emptyStateVisible: boolean; associations: EvidenceAssociation[] };
  visuals: { displayed: number; renderedRows: number; emptyStateVisible: boolean; associations: EvidenceAssociation[] };
};

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLocaleLowerCase('en-US') === 'true';
}

async function preparedContract(mode: 'fixture' | 'live', startedAt: string) {
  const source = process.env.LANDOS_ACCEPTANCE_CONTRACT
    ? resolve(process.env.LANDOS_ACCEPTANCE_CONTRACT)
    : DEFAULT_CONTRACT;
  const template = await readJsonFile(source);
  const contract = buildRunContract(template, { mode, startedAt, environment: process.env });
  const errors = validateAcceptanceContract(contract);
  if (errors.length > 0) throw new Error(`Acceptance contract is invalid before browser launch:\n${errors.join('\n')}`);
  if (mode === 'live' && contract.runPolicy.entryFlow === 'new-lead' && process.env.LANDOS_ACCEPTANCE_ALLOW_NEW_LEAD !== '1') {
    throw new Error('Live New Lead creation is an explicit mutation and requires LANDOS_ACCEPTANCE_ALLOW_NEW_LEAD=1');
  }
  return contract;
}

function parseDisplayedCount(text: string): number {
  const values = text.match(/\b\d[\d,]*\b/g) ?? [];
  if (values.length === 0) return 0;
  return Number(values.at(-1)!.replaceAll(',', ''));
}

async function observeCount(
  panel: Locator,
  kind: 'comps' | 'visuals',
  canonicalAccepted: number,
): Promise<CountObservation> {
  const isComps = kind === 'comps';
  const title = isComps ? 'Accepted sold comps' : 'Hero property imagery';
  const operatorSection = isComps ? 'Comps & Market' : 'Documents & Visuals';
  const emptyPattern = isComps
    ? /No closed sale survived the comp source policy/i
    : /No clean subject-centered parcel or aerial image was retained/i;
  const fixtureCount = panel.locator(`[data-visible-count="${kind}"]`);
  const fixtureRows = panel.locator(`[data-rendered-rows="${kind}"] [role="listitem"]`);
  let displayed: number;
  let renderedRows: number;
  let section: Locator;
  if (await fixtureCount.count()) {
    displayed = parseDisplayedCount(await fixtureCount.first().innerText());
    renderedRows = await fixtureRows.count();
    section = panel.locator(`[data-acceptance-section="${kind}"]`).first();
  } else {
    const titleLocator = panel.getByText(title, { exact: true }).first();
    await expect(titleLocator).toBeVisible();
    const headingRow = titleLocator.locator('xpath=..');
    section = titleLocator.locator('xpath=../..');
    displayed = parseDisplayedCount(await headingRow.innerText());
    renderedRows = isComps ? await section.locator('article').count() : await section.locator('img').count();
  }
  const emptyStateVisible = await panel.getByText(emptyPattern).first().isVisible().catch(() => false);
  return {
    operatorSection,
    label: title,
    canonicalAccepted,
    displayed,
    renderedRows,
    emptyStateVisible,
    timestamp: new Date().toISOString(),
    visibleText: sanitizeConsoleText(await section.innerText()),
  };
}

function buildClaimValues(
  comps: CountObservation,
  visuals: CountObservation,
  contaminationValues: string[],
  subject: TraceObservation['subject'],
) {
  return new Map<string, string | number | boolean | null>([
    ['property-identity-visible', subject.address],
    ['property-apn-visible', subject.apn],
    ['property-id-visible', subject.propertyId],
    ['canonical-comps-visible', comps.displayed],
    ['comp-count-matches-rows', comps.renderedRows],
    ['canonical-visual-visible', visuals.displayed],
    ['imagery-not-empty', visuals.renderedRows > 0 && !visuals.emptyStateVisible],
    ['specialist-results-rendered', comps.displayed === comps.canonicalAccepted && visuals.displayed === visuals.canonicalAccepted],
    ['no-cross-property-contamination', contaminationValues.length === 0],
  ]);
}

async function getWorkspacePanel(page: Page, name: 'Comps & Market' | 'Documents & Visuals'): Promise<Locator> {
  await page.getByRole('tab', { name, exact: true }).click();
  const panel = page.getByRole('tabpanel', { name, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function managedRestart(
  mode: 'fixture' | 'live',
  page: Page,
  context: BrowserContext,
  contractId: string,
) {
  await context.tracing.group(`LANDOS_RESTART_V1|${mode}|${contractId}`);
  try {
    if (mode === 'fixture') {
      const value = await page.evaluate(async (marker) => {
        const response = await fetch('/__fixture/restart', { method: 'POST' });
        return JSON.stringify({ marker, status: response.status });
      }, 'LANDOS_MANAGED_RESTART_V1');
      const result = JSON.parse(value);
      if (result.marker !== 'LANDOS_MANAGED_RESTART_V1' || result.status !== 204) {
        throw new Error(`fixture restart marker returned ${result.status}`);
      }
      return;
    }
    if (process.env.LANDOS_ACCEPTANCE_ALLOW_MANAGED_RESTART !== '1') {
      throw new Error('Live restart proof requires LANDOS_ACCEPTANCE_ALLOW_MANAGED_RESTART=1');
    }
    await execFileAsync(process.execPath, [join(REPOSITORY_ROOT, 'scripts', 'runtime', 'landos-runtime.mjs'), 'restart'], {
      cwd: REPOSITORY_ROOT,
      timeout: 240_000,
      windowsHide: true,
      maxBuffer: 1_000_000,
    });
    await page.evaluate((marker) => JSON.stringify({ marker, completedAt: new Date().toISOString() }), 'LANDOS_MANAGED_RESTART_V1');
  } finally {
    await context.tracing.groupEnd();
  }
}

async function waitForDeal(page: Page, property: { normalizedAddress: string; apn: string }) {
  const streetAddress = property.normalizedAddress.split(',')[0]?.trim() || property.normalizedAddress;
  await expect(page.getByText(streetAddress, { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(property.apn, { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Comps & Market', exact: true })).toBeVisible();
}

async function collectRenderedObservation(
  page: Page,
  input: Omit<TraceObservation, 'marker' | 'capturedAt' | 'urlPath' | 'activePanel' | 'leadInputValue' | 'restartGeneration' | 'bodyText' | 'subject' | 'comps' | 'visuals'>,
  visibleSubjectAddress: string | null,
): Promise<TraceObservation> {
  const value = await page.evaluate(({ markerInput, visibleAddress }) => {
    const clean = (candidate: string | null | undefined) => candidate?.replace(/\s+/g, ' ').trim() || null;
    const visibleCount = (kind: string) => {
      const text = document.querySelector(`[data-visible-count="${kind}"]`)?.textContent ?? '';
      const values = text.match(/\b\d[\d,]*\b/g) ?? [];
      return values.length ? Number(values.at(-1)!.replaceAll(',', '')) : 0;
    };
    const urlPath = (candidate: string | null) => {
      if (!candidate) return null;
      try {
        const parsed = new URL(candidate, location.href);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.pathname : null;
      } catch {
        return null;
      }
    };
    const association = (node: Element, kind: 'comp' | 'visual') => {
      const element = node as HTMLElement;
      const image = element.querySelector('img');
      const anchor = element.matches('a[href]') ? element as HTMLAnchorElement : element.querySelector('a[href]');
      return {
        kind,
        label: clean(element.innerText) ?? clean(image?.getAttribute('alt')) ?? `${kind} evidence`,
        subjectAddress: clean(element.dataset.subjectAddress),
        subjectApn: clean(element.dataset.subjectApn),
        subjectPropertyId: clean(element.dataset.subjectPropertyId),
        itemAddress: clean(element.dataset.itemAddress),
        sourceUrlPath: urlPath(element.dataset.sourceUrl ?? anchor?.getAttribute('href') ?? image?.getAttribute('src') ?? null),
      };
    };
    const evidence = (kind: 'comp' | 'visual') => {
      const explicit = Array.from(document.querySelectorAll(`[data-acceptance-evidence-kind="${kind}"]`));
      const fallback = kind === 'comp'
        ? Array.from(document.querySelectorAll('[data-rendered-rows="comps"] article'))
        : Array.from(document.querySelectorAll('[data-rendered-rows="visuals"] [role="listitem"], [data-rendered-rows="visuals"] img'));
      const rows = explicit.length ? explicit : fallback;
      const empty = document.querySelector(`[data-empty-state="${kind}s"], [data-empty-state="${kind}"]`) as HTMLElement | null;
      const emptyText = kind === 'comp'
        ? /No closed sale survived the comp source policy/i
        : /No clean subject-centered parcel or aerial image was retained/i;
      return {
        displayed: visibleCount(`${kind}s`),
        renderedRows: rows.length,
        emptyStateVisible: Boolean(empty && !empty.hidden && empty.getClientRects().length > 0)
          || emptyText.test(document.body?.innerText ?? ''),
        associations: rows.map((row) => association(row, kind)),
      };
    };
    const subjectRoot = document.querySelector('[data-acceptance-subject]') as HTMLElement | null;
    const bodyText = (document.body?.innerText ?? '').slice(0, 20_000);
    const apnMatch = bodyText.match(/\bAPN\s*[:#-]?\s*([^\r\n]+)/i);
    const propertyIdMatch = bodyText.match(/\bProperty ID\b\s*[:#-]?\s*([A-Za-z0-9._-]+)/i);
    const activePanel = document.querySelector('[role="tabpanel"]:not([hidden])') as HTMLElement | null;
    const activeTab = activePanel?.getAttribute('aria-labelledby')
      ? document.getElementById(activePanel.getAttribute('aria-labelledby')!)
      : null;
    const leadInput = document.querySelector('textarea[aria-label="Lead information"], input[aria-label="Lead information"]') as HTMLInputElement | HTMLTextAreaElement | null;
    const generation = Number(document.querySelector('[data-restart-generation]')?.textContent);
    return JSON.stringify({
      marker: 'LANDOS_OBSERVATION_V1',
      ...markerInput,
      capturedAt: new Date().toISOString(),
      urlPath: location.pathname,
      activePanel: clean(activeTab?.textContent ?? activePanel?.getAttribute('aria-label') ?? null),
      leadInputValue: clean(leadInput?.value),
      restartGeneration: Number.isInteger(generation) ? generation : null,
      bodyText,
      subject: {
        address: clean(subjectRoot?.dataset.subjectAddress ?? document.querySelector('#deal-address')?.textContent ?? visibleAddress),
        apn: clean(subjectRoot?.dataset.subjectApn ?? apnMatch?.[1]),
        propertyId: clean(subjectRoot?.dataset.subjectPropertyId ?? propertyIdMatch?.[1]),
      },
      comps: evidence('comp'),
      visuals: evidence('visual'),
    });
  }, { markerInput: input, visibleAddress: visibleSubjectAddress });
  return JSON.parse(value) as TraceObservation;
}

function identityKey(value: string | null) {
  return value?.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLocaleLowerCase('en-US') ?? '';
}

function renderedAddressMatches(expectedAddress: string, renderedAddress: string | null) {
  const rendered = identityKey(renderedAddress);
  const full = identityKey(expectedAddress);
  const street = identityKey(expectedAddress.split(',')[0]?.trim() ?? expectedAddress);
  return rendered === full || rendered === street;
}

function contaminationFromObservations(contract: Record<string, any>, observations: TraceObservation[]) {
  const detected: string[] = [];
  const expected = {
    address: identityKey(contract.property.normalizedAddress),
    apn: identityKey(contract.property.apn),
    propertyId: identityKey(contract.property.canonicalPropertyId),
  };
  for (const observation of observations.filter((entry) => entry.phase !== 'entry')) {
    const renderedApnMatches = identityKey(observation.subject.apn) === expected.apn;
    for (const field of ['address', 'apn', 'propertyId'] as const) {
      const actual = identityKey(observation.subject[field]);
      const matches = field === 'address'
        ? renderedAddressMatches(contract.property.normalizedAddress, observation.subject.address)
        : field === 'propertyId' && actual === '' && renderedApnMatches
          ? true
        : actual === expected[field];
      if (!matches) detected.push(`${observation.phase}: rendered subject ${field} ${observation.subject[field] ?? '[missing]'}`);
    }
    for (const group of [observation.comps, observation.visuals]) {
      for (const association of group.associations) {
        for (const [field, actual] of [
          ['address', association.subjectAddress],
          ['apn', association.subjectApn],
          ['propertyId', association.subjectPropertyId],
        ] as const) {
          if (identityKey(actual) !== expected[field]) detected.push(`${observation.phase}: ${association.kind} ${field} association ${actual ?? '[missing]'}`);
        }
      }
    }
  }
  return [...new Set(detected)];
}

test('704 Bell Rd known projection mismatch produces a complete independent FAIL package', async ({ browser }: { browser: Browser }, testInfo) => {
  const mode = (process.env.LANDOS_ACCEPTANCE_MODE ?? 'fixture') as 'fixture' | 'live';
  if (!['fixture', 'live'].includes(mode)) throw new Error('LANDOS_ACCEPTANCE_MODE must be fixture or live');
  testInfo.setTimeout(mode === 'live' ? 420_000 : 120_000);
  const startedAt = new Date().toISOString();
  const contract = await preparedContract(mode, startedAt);
  const runDirectory = await createAcceptanceRunDirectory(
    REPOSITORY_ROOT,
    contract.sprintName,
    process.env.LANDOS_ACCEPTANCE_OUTPUT_DIR,
  );
  await writeJsonAtomic(join(runDirectory, 'acceptance-contract.json'), contract);

  const fixture = mode === 'fixture' ? await startLandosFixtureServer({
    property: contract.property,
    projection: envFlag('LANDOS_ACCEPTANCE_FIXTURE_PROJECTION_PASS', false) ? 'pass' : 'mismatch',
  }) : null;
  const baseUrl = mode === 'fixture' ? fixture!.baseUrl : loopbackBaseUrl(process.env.LANDOS_ACCEPTANCE_BASE_URL || 'http://localhost:3141');
  const auth = await resolveApprovedAuth({ repositoryRoot: REPOSITORY_ROOT, mode });
  const videoDirectory = await mkdtemp(join(tmpdir(), 'landos-acceptance-video-'));
  const baselineContexts = browser.contexts().length;
  let contextsCreated = 0;
  let contextsClosed = 0;
  let pagesCreated = 0;
  let pagesClosed = 0;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let video: ReturnType<Page['video']> = null;
  const screenshotObservations = new Map<string, TraceObservation>();
  const consoleEntries: Array<Record<string, unknown>> = [];
  const networkFailures: Array<Record<string, unknown>> = [];
  const allowedConsolePatterns = contract.runPolicy.allowedConsoleErrorPatterns;
  const requiredNetworkPatterns = contract.runPolicy.requiredNetworkPatterns;

  const attachPageCapture = (capturePage: Page) => {
    pagesCreated += 1;
    capturePage.once('close', () => { pagesClosed += 1; });
    capturePage.on('console', (message) => {
      const originalType = message.type();
      const type = originalType === 'error' ? 'error'
        : originalType === 'warning' ? 'warning'
          : originalType === 'debug' ? 'debug'
            : originalType === 'info' ? 'info' : 'log';
      const text = sanitizeConsoleText(message.text());
      consoleEntries.push({
        type,
        text,
        timestamp: new Date().toISOString(),
        location: { urlPath: safeUrlPath(message.location().url || baseUrl), line: message.location().lineNumber ?? 0, column: message.location().columnNumber ?? 0 },
        relevant: type === 'error' && !patternMatches(text, allowedConsolePatterns),
      });
    });
    capturePage.on('pageerror', (error) => {
      const text = sanitizeConsoleText(error.message);
      consoleEntries.push({ type: 'error', text, timestamp: new Date().toISOString(), location: { urlPath: '/pageerror', line: 0, column: 0 }, relevant: !patternMatches(text, allowedConsolePatterns) });
    });
    capturePage.on('requestfailed', (request) => {
      const urlPath = safeUrlPath(request.url());
      networkFailures.push({ method: request.method(), urlPath, failure: sanitizeConsoleText(request.failure()?.errorText ?? 'request failed'), resourceType: request.resourceType(), status: null, timestamp: new Date().toISOString(), required: patternMatches(urlPath, requiredNetworkPatterns) });
    });
    capturePage.on('response', (response) => {
      if (response.status() < 400) return;
      const request = response.request();
      const urlPath = safeUrlPath(response.url());
      networkFailures.push({ method: request.method(), urlPath, failure: `HTTP ${response.status()}`, resourceType: request.resourceType(), status: response.status(), timestamp: new Date().toISOString(), required: patternMatches(urlPath, requiredNetworkPatterns) });
    });
  };

  const capture = async (
    name: string,
    phase: TraceObservation['phase'],
    section?: Locator,
  ) => {
    await context!.tracing.group(`LANDOS_EVIDENCE_V1|${name}|${phase}|${contract.contractId}`);
    try {
      if (section) {
        await section.scrollIntoViewIfNeeded();
        const clip = await section.boundingBox();
        if (!clip || clip.width < 1 || clip.height < 1) throw new Error(`${name}: section has no inspectable bounding box`);
        await page!.screenshot({ path: join(runDirectory, name), clip, animations: 'disabled' });
      } else {
        await page!.screenshot({ path: join(runDirectory, name), fullPage: true, animations: 'disabled' });
      }
      const ariaSnapshot = await page!.locator('body').ariaSnapshot();
      const streetAddress = contract.property.normalizedAddress.split(',')[0]?.trim() || contract.property.normalizedAddress;
      const visibleAddressLocator = page!.getByText(streetAddress, { exact: false }).filter({ visible: true });
      const visibleSubjectAddress = await visibleAddressLocator.count() > 0 ? streetAddress : null;
      const observation = await collectRenderedObservation(page!, {
        artifact: name,
        phase,
        ariaSnapshot,
      }, visibleSubjectAddress);
      screenshotObservations.set(name, observation);
    } finally {
      await context!.tracing.groupEnd();
    }
  };

  let initialComps!: CountObservation;
  let initialVisuals!: CountObservation;
  let refreshedComps!: CountObservation;
  let refreshedVisuals!: CountObservation;
  let restartedComps!: CountObservation;
  let restartedVisuals!: CountObservation;
  let targetUrl = '';
  let freshnessEvidence = '';
  let cleanupError: Error | null = null;

  try {
    context = await browser.newContext({
      storageState: auth.storageState,
      recordVideo: { dir: videoDirectory, size: { width: 1440, height: 1000 } },
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    contextsCreated += 1;
    context.once('close', () => { contextsClosed += 1; });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
      title: `landos-acceptance-v1:${contract.contractId}`,
    });
    page = await context.newPage();
    attachPageCapture(page);
    video = page.video();

    if (auth.connectUrl) {
      try {
        await page.goto(auth.connectUrl, { waitUntil: 'domcontentloaded' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/ERR_ABORTED|interrupted by another navigation/i.test(message)) throw error;
      }
      await page.waitForURL((url) => url.pathname !== '/connect', { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'New Lead', exact: true })).toBeVisible({ timeout: 30_000 });
    }
    await page.goto(`${baseUrl}/dept/acquisitions?section=new`, { waitUntil: 'domcontentloaded' });
    const newLeadButton = page.getByRole('button', { name: 'New Lead', exact: true });
    if (await newLeadButton.count()) await newLeadButton.click();
    const leadInformation = page.getByRole('textbox', { name: 'Lead information', exact: true });
    await expect(leadInformation).toBeVisible();
    await leadInformation.fill(contract.property.address);
    await expect(leadInformation).toHaveValue(contract.property.address);
    await capture('new-lead.png', 'entry');

    if (contract.runPolicy.entryFlow === 'new-lead') {
      await page.getByRole('button', { name: /Create Lead Card.*start research/i }).click();
      await waitForDeal(page, contract.property);
      targetUrl = page.url();
      freshnessEvidence = mode === 'fixture'
        ? 'A synthetic fixture lead was entered and created inside this isolated, non-production run.'
        : 'A fresh Deal Card was visibly created from New Lead during this isolated acceptance run.';
    } else {
      const dealId = process.env.LANDOS_ACCEPTANCE_DEAL_ID?.trim();
      if (!dealId || !/^\d+$/.test(dealId)) throw new Error('Existing-deal live acceptance requires LANDOS_ACCEPTANCE_DEAL_ID');
      targetUrl = `${baseUrl}/dept/acquisitions?deal=${dealId}`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await waitForDeal(page, contract.property);
      freshnessEvidence = 'The target address was visibly entered through New Lead, then the pre-existing canonical Deal Card was reopened without submitting a duplicate; freshness is therefore false for this documented known-defect exception.';
    }
    await capture('deal-card-loaded.png', 'initial');

    let marketPanel = await getWorkspacePanel(page, 'Comps & Market');
    initialComps = await observeCount(marketPanel, 'comps', contract.property.canonicalCounts.comps);
    await capture('changed-section.png', 'initial', marketPanel);
    let documentsPanel = await getWorkspacePanel(page, 'Documents & Visuals');
    initialVisuals = await observeCount(documentsPanel, 'visuals', contract.property.canonicalCounts.visuals);
    await capture('relevant-tab-or-panel.png', 'initial', documentsPanel);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDeal(page, contract.property);
    marketPanel = await getWorkspacePanel(page, 'Comps & Market');
    refreshedComps = await observeCount(marketPanel, 'comps', contract.property.canonicalCounts.comps);
    documentsPanel = await getWorkspacePanel(page, 'Documents & Visuals');
    refreshedVisuals = await observeCount(documentsPanel, 'visuals', contract.property.canonicalCounts.visuals);
    await capture('after-refresh.png', 'refresh');

    await managedRestart(mode, page, context, contract.contractId);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await waitForDeal(page, contract.property);
    marketPanel = await getWorkspacePanel(page, 'Comps & Market');
    restartedComps = await observeCount(marketPanel, 'comps', contract.property.canonicalCounts.comps);
    documentsPanel = await getWorkspacePanel(page, 'Documents & Visuals');
    restartedVisuals = await observeCount(documentsPanel, 'visuals', contract.property.canonicalCounts.visuals);
    await capture('after-restart.png', 'restart');

    await page.close();
    const rawTracePath = join(videoDirectory, 'raw-trace.zip');
    await context.tracing.stop({ path: rawTracePath });
    await sanitizeTraceArchive(rawTracePath, join(runDirectory, 'trace.zip'));
  } finally {
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (video) {
        await video.saveAs(join(runDirectory, 'video.webm'));
        await video.delete().catch(() => undefined);
      }
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error));
    }
    if (fixture) await fixture.close().catch((error) => { cleanupError ??= error instanceof Error ? error : new Error(String(error)); });
    const videoRoot = resolve(tmpdir());
    const resolvedVideoDirectory = resolve(videoDirectory);
    if (!resolvedVideoDirectory.startsWith(`${videoRoot}${process.platform === 'win32' ? '\\' : '/'}`) || !basename(resolvedVideoDirectory).startsWith('landos-acceptance-video-')) {
      cleanupError ??= new Error('Refused to clean unexpected video temporary directory');
    } else {
      await rm(resolvedVideoDirectory, { recursive: true, force: true }).catch((error) => { cleanupError ??= error instanceof Error ? error : new Error(String(error)); });
    }
  }
  if (cleanupError) throw cleanupError;

  const completedAt = new Date().toISOString();
  const evidenceObservations = [...screenshotObservations.values()];
  const contaminationValues = contaminationFromObservations(contract, evidenceObservations);
  const emptySubject = { address: null, apn: null, propertyId: null };
  const initialValues = buildClaimValues(initialComps, initialVisuals, contaminationValues, screenshotObservations.get('deal-card-loaded.png')?.subject ?? emptySubject);
  const refreshValues = buildClaimValues(refreshedComps, refreshedVisuals, contaminationValues, screenshotObservations.get('after-refresh.png')?.subject ?? emptySubject);
  const restartValues = buildClaimValues(restartedComps, restartedVisuals, contaminationValues, screenshotObservations.get('after-restart.png')?.subject ?? emptySubject);
  const refreshRetained = [...initialValues].every(([id, value]) => Object.is(refreshValues.get(id), value));
  const restartRetained = [...initialValues].every(([id, value]) => Object.is(restartValues.get(id), value));

  const claimResults = contract.claims.map((claim: Record<string, any>) => {
    const visibleValue = initialValues.get(claim.id) ?? null;
    return {
      claimId: claim.id,
      operatorSection: claim.operatorSection,
      propertyAddress: contract.property.normalizedAddress,
      claim: claim.claim,
      expectedValue: claim.expectedValue,
      visibleValue,
      status: evaluateComparison(claim.comparison, claim.expectedValue, visibleValue) ? 'PASS' : 'FAIL',
      evidencePath: claim.evidenceArtifacts[0],
      timestamp: completedAt,
      refreshResult: Object.is(refreshValues.get(claim.id), visibleValue) ? 'PASS' : 'FAIL',
      restartResult: Object.is(restartValues.get(claim.id), visibleValue) ? 'PASS' : 'FAIL',
      contaminationResult: contaminationValues.length === 0 ? 'PASS' : 'FAIL',
    };
  });

  const consoleCapture = { schemaVersion: '1.0.0', capturedAt: completedAt, entries: consoleEntries };
  const networkCapture = { schemaVersion: '1.0.0', capturedAt: completedAt, failures: networkFailures };
  await writeJsonAtomic(join(runDirectory, 'console.json'), consoleCapture);
  await writeJsonAtomic(join(runDirectory, 'network-failures.json'), networkCapture);

  const artifacts = [];
  for (const [name, observation] of screenshotObservations) {
    const inspection = inspectPng(await readFile(join(runDirectory, name)));
    if (!inspection.valid) throw new Error(`${name} failed content inspection: ${inspection.errors.join('; ')}`);
    artifacts.push(await artifactMetadata(join(runDirectory, name), name, {
      validated: true,
      kind: 'screenshot',
      width: inspection.width,
      height: inspection.height,
      uniqueColorSamples: inspection.uniqueColorSamples,
    }, observation.capturedAt));
  }
  const traceInspection = inspectTraceZip(await readFile(join(runDirectory, 'trace.zip')));
  if (!traceInspection.valid) throw new Error(`trace.zip failed content inspection: ${traceInspection.errors.join('; ')}`);
  artifacts.push(await artifactMetadata(join(runDirectory, 'trace.zip'), 'trace.zip', { validated: true, kind: 'trace' }, completedAt));
  const videoInspection = inspectWebm(await readFile(join(runDirectory, 'video.webm')));
  if (!videoInspection.valid) throw new Error(`video.webm failed content inspection: ${videoInspection.errors.join('; ')}`);
  artifacts.push(await artifactMetadata(join(runDirectory, 'video.webm'), 'video.webm', { validated: true, kind: 'video' }, completedAt));
  artifacts.push(await artifactMetadata(join(runDirectory, 'console.json'), 'console.json', { validated: true, kind: 'console' }, completedAt));
  artifacts.push(await artifactMetadata(join(runDirectory, 'network-failures.json'), 'network-failures.json', { validated: true, kind: 'network' }, completedAt));

  const relevantErrorCount = consoleEntries.filter((entry) => entry.type === 'error' && entry.relevant === true).length;
  const requiredFailureCount = networkFailures.filter((entry) => entry.required === true).length;
  const cleanupCompleted = contextsCreated === contextsClosed
    && pagesCreated === pagesClosed
    && browser.contexts().length === baselineContexts;
  const systemChecksPass = (!contract.runPolicy.freshnessRequired || contract.runPolicy.entryFlow === 'new-lead')
    && refreshRetained
    && restartRetained
    && contaminationValues.length === 0
    && requiredFailureCount === 0
    && cleanupCompleted;
  const verdict = claimResults.every((claim: { status: string }) => claim.status === 'PASS') && systemChecksPass ? 'PASS' : 'FAIL';
  const results = {
    schemaVersion: '1.0.0',
    runId: basename(runDirectory),
    contractId: contract.contractId,
    sprintName: contract.sprintName,
    mode,
    startedAt,
    completedAt,
    propertyAddress: contract.property.normalizedAddress,
    authStateImported: auth.imported,
    freshness: { required: contract.runPolicy.freshnessRequired, isFresh: contract.runPolicy.entryFlow === 'new-lead', evidence: freshnessEvidence },
    claims: claimResults,
    counts: [
      (({ visibleText: _visibleText, ...count }) => count)(initialComps),
      (({ visibleText: _visibleText, ...count }) => count)(initialVisuals),
    ],
    lifecycle: {
      isolatedContext: true,
      contextsCreated,
      contextsClosed,
      pagesCreated,
      pagesClosed,
      normalOperatorBrowserUntouched: browser.contexts().length === baselineContexts,
      cleanupCompleted,
      verifiedAt: completedAt,
    },
    refresh: { status: refreshRetained ? 'PASS' : 'FAIL', visibleValuesRetained: refreshRetained, timestamp: completedAt },
    restart: { status: restartRetained ? 'PASS' : 'FAIL', visibleValuesRetained: restartRetained, timestamp: completedAt },
    contamination: { status: contaminationValues.length === 0 ? 'PASS' : 'FAIL', detectedValues: contaminationValues, timestamp: completedAt },
    console: { path: 'console.json', relevantErrorCount, timestamp: completedAt },
    network: { path: 'network-failures.json', requiredFailureCount, timestamp: completedAt },
    artifacts,
    verdict,
  };
  await writeJsonAtomic(join(runDirectory, 'results.json'), results);
  await generateAcceptanceReport(runDirectory);
  await testInfo.attach('acceptance-report', { path: join(runDirectory, 'acceptance-report.md'), contentType: 'text/markdown' });

  const gate = await validateAcceptancePackage(runDirectory);
  const expectedVerdict = process.env.LANDOS_ACCEPTANCE_EXPECT_VERDICT ?? (mode === 'fixture' ? 'FAIL' : 'PASS');
  expect(results.verdict).toBe(expectedVerdict);
  if (expectedVerdict === 'PASS') expect(gate.ok, gate.errors.join('\n')).toBe(true);
  else {
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((error) => /visual claim verdict is FAIL|visual verdict is FAIL/.test(error))).toBe(true);
  }
});
