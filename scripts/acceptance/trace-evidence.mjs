import { SCREENSHOT_ARTIFACTS } from './contract-validator.mjs';
import { sha256 } from './artifact-inspector.mjs';
import { readZipEntries } from './trace-sanitizer.mjs';

export const TRACE_OBSERVATION_MARKER = 'LANDOS_OBSERVATION_V1';

export const EVIDENCE_PHASES = Object.freeze({
  'new-lead.png': 'entry',
  'deal-card-loaded.png': 'initial',
  'changed-section.png': 'initial',
  'relevant-tab-or-panel.png': 'initial',
  'after-refresh.png': 'refresh',
  'after-restart.png': 'restart',
});

const FULL_PAGE_ARTIFACTS = new Set([
  'new-lead.png',
  'deal-card-loaded.png',
  'after-refresh.png',
  'after-restart.png',
]);

function identityKey(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLocaleLowerCase('en-US')
    : '';
}

function renderedAddressMatches(expectedAddress, renderedAddress) {
  const rendered = identityKey(renderedAddress);
  const full = identityKey(expectedAddress);
  const street = identityKey(expectedAddress.split(',')[0]?.trim() ?? expectedAddress);
  return rendered === full || rendered === street;
}

function canonicalTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function timestampWithin(value, start, end) {
  if (!canonicalTimestamp(value)) return false;
  const instant = Date.parse(value);
  return instant >= Date.parse(start) && instant <= Date.parse(end) + 60_000;
}

function string(value, path, errors, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path}: expected ${nullable ? 'a non-empty string or null' : 'a non-empty string'}`);
    return false;
  }
  return true;
}

function integer(value, path, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${path}: expected a non-negative integer`);
    return false;
  }
  return true;
}

function parseJsonLines(data, label, errors) {
  const output = [];
  const lines = data.toString('utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      output.push(JSON.parse(line));
    } catch (error) {
      errors.push(`${label}:${index + 1}: invalid JSON event (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return output;
}

function inspectJpeg(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 5_000 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return { valid: false };
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return { valid: false };
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return { valid: false };
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return { valid: false };
      return {
        valid: buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9,
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return { valid: false };
}

function parseObservation(value, path, errors) {
  if (typeof value !== 'string' || !value.startsWith(`{"marker":"${TRACE_OBSERVATION_MARKER}"`)) {
    errors.push(`${path}: trace evaluate result is not a ${TRACE_OBSERVATION_MARKER} document`);
    return null;
  }
  let observation;
  try {
    observation = JSON.parse(value);
  } catch (error) {
    errors.push(`${path}: observation JSON is invalid (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
  const rootKeys = [
    'marker', 'artifact', 'phase', 'ariaSnapshot', 'capturedAt',
    'urlPath', 'activePanel', 'leadInputValue', 'restartGeneration', 'bodyText',
    'subject', 'comps', 'visuals',
  ];
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    errors.push(`${path}: observation root must be an object`);
    return null;
  }
  for (const key of rootKeys) if (!Object.hasOwn(observation, key)) errors.push(`${path}.${key}: required trace observation field is missing`);
  for (const key of Object.keys(observation)) if (!rootKeys.includes(key)) errors.push(`${path}.${key}: unexpected trace observation field`);
  if (observation.marker !== TRACE_OBSERVATION_MARKER) errors.push(`${path}.marker: unexpected marker`);
  string(observation.artifact, `${path}.artifact`, errors);
  if (!['entry', 'initial', 'refresh', 'restart'].includes(observation.phase)) errors.push(`${path}.phase: invalid evidence phase`);
  if (typeof observation.ariaSnapshot !== 'string' || observation.ariaSnapshot.length < 20) errors.push(`${path}.ariaSnapshot: expected a rendered accessibility snapshot`);
  if (!canonicalTimestamp(observation.capturedAt)) errors.push(`${path}.capturedAt: expected canonical ISO-8601 UTC timestamp`);
  if (typeof observation.urlPath !== 'string' || !observation.urlPath.startsWith('/') || observation.urlPath.includes('?')) errors.push(`${path}.urlPath: expected a query-free path`);
  string(observation.activePanel, `${path}.activePanel`, errors, { nullable: true });
  string(observation.leadInputValue, `${path}.leadInputValue`, errors, { nullable: true });
  if (observation.restartGeneration !== null) integer(observation.restartGeneration, `${path}.restartGeneration`, errors);
  if (typeof observation.bodyText !== 'string' || observation.bodyText.length === 0 || observation.bodyText.length > 20_000) errors.push(`${path}.bodyText: expected inspectable bounded rendered text`);

  const identityKeys = ['address', 'apn', 'propertyId'];
  if (!observation.subject || typeof observation.subject !== 'object' || Array.isArray(observation.subject)) {
    errors.push(`${path}.subject: expected object`);
  } else {
    for (const key of identityKeys) {
      if (!Object.hasOwn(observation.subject, key)) errors.push(`${path}.subject.${key}: required field is missing`);
      else string(observation.subject[key], `${path}.subject.${key}`, errors, { nullable: true });
    }
    for (const key of Object.keys(observation.subject)) if (!identityKeys.includes(key)) errors.push(`${path}.subject.${key}: unexpected field`);
  }

  for (const kind of ['comps', 'visuals']) {
    const group = observation[kind];
    const groupPath = `${path}.${kind}`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      errors.push(`${groupPath}: expected object`);
      continue;
    }
    for (const key of ['displayed', 'renderedRows']) integer(group[key], `${groupPath}.${key}`, errors);
    if (typeof group.emptyStateVisible !== 'boolean') errors.push(`${groupPath}.emptyStateVisible: expected boolean`);
    if (!Array.isArray(group.associations)) {
      errors.push(`${groupPath}.associations: expected array`);
      continue;
    }
    if (group.associations.length !== group.renderedRows) errors.push(`${groupPath}.associations: expected one identity/provenance record per rendered row`);
    group.associations.forEach((association, index) => {
      const associationPath = `${groupPath}.associations[${index}]`;
      if (!association || typeof association !== 'object' || Array.isArray(association)) {
        errors.push(`${associationPath}: expected object`);
        return;
      }
      if (association.kind !== (kind === 'comps' ? 'comp' : 'visual')) errors.push(`${associationPath}.kind: contradicts evidence group`);
      string(association.label, `${associationPath}.label`, errors);
      for (const key of ['subjectAddress', 'subjectApn', 'subjectPropertyId', 'itemAddress', 'sourceUrlPath']) {
        string(association[key], `${associationPath}.${key}`, errors, { nullable: true });
      }
      if (association.sourceUrlPath !== null && (!association.sourceUrlPath.startsWith('/') || association.sourceUrlPath.includes('?'))) {
        errors.push(`${associationPath}.sourceUrlPath: expected query-free path or null`);
      }
      if (association.itemAddress === null && association.sourceUrlPath === null) {
        errors.push(`${associationPath}: rendered evidence lacks item identity or source provenance`);
      }
    });
  }
  return observation;
}

export function detectTraceContamination(contract, observations) {
  const detected = [];
  const expected = {
    address: identityKey(contract.property.normalizedAddress),
    apn: identityKey(contract.property.apn),
    propertyId: identityKey(contract.property.canonicalPropertyId),
  };
  for (const observation of observations.filter((entry) => entry.phase !== 'entry')) {
    const renderedApnMatches = identityKey(observation.subject?.apn) === expected.apn;
    for (const field of ['address', 'apn', 'propertyId']) {
      const matches = field === 'address'
        ? renderedAddressMatches(contract.property.normalizedAddress, observation.subject?.address)
        : field === 'propertyId' && identityKey(observation.subject?.propertyId) === '' && renderedApnMatches
          ? true
        : identityKey(observation.subject?.[field]) === expected[field];
      if (!matches) {
        detected.push(`${observation.artifact}: rendered subject ${field} ${observation.subject?.[field] ?? '[missing]'}`);
      }
    }
    for (const group of [observation.comps, observation.visuals]) {
      for (const association of group?.associations ?? []) {
        for (const [field, actual] of [
          ['address', association.subjectAddress],
          ['apn', association.subjectApn],
          ['propertyId', association.subjectPropertyId],
        ]) {
          if (identityKey(actual) !== expected[field]) detected.push(`${observation.artifact}: ${association.kind} subject ${field} ${actual ?? '[missing]'}`);
        }
        if (association.kind === 'visual' && association.itemAddress !== null && identityKey(association.itemAddress) !== expected.address) {
          detected.push(`${observation.artifact}: visual item address ${association.itemAddress}`);
        }
      }
    }
  }
  return [...new Set(detected)];
}

export function valuesFromTrace(contract, observations) {
  const byArtifact = new Map(observations.map((observation) => [observation.artifact, observation]));
  const deal = byArtifact.get('deal-card-loaded.png');
  const comps = byArtifact.get('changed-section.png')?.comps;
  const visuals = byArtifact.get('relevant-tab-or-panel.png')?.visuals;
  const contamination = detectTraceContamination(contract, observations);
  return new Map([
    ['property-identity-visible', deal?.subject.address ?? null],
    ['property-apn-visible', deal?.subject.apn ?? null],
    ['property-id-visible', deal?.subject.propertyId ?? null],
    ['canonical-comps-visible', comps?.displayed ?? null],
    ['comp-count-matches-rows', comps?.renderedRows ?? null],
    ['canonical-visual-visible', visuals?.displayed ?? null],
    ['imagery-not-empty', Boolean(visuals && visuals.renderedRows > 0 && !visuals.emptyStateVisible)],
    ['specialist-results-rendered', Boolean(
      comps
      && visuals
      && comps.displayed === contract.property.canonicalCounts.comps
      && visuals.displayed === contract.property.canonicalCounts.visuals
    )],
    ['no-cross-property-contamination', contamination.length === 0],
  ]);
}

export function valuesForPhase(contract, observation, contamination = []) {
  const comps = observation?.comps;
  const visuals = observation?.visuals;
  return new Map([
    ['property-identity-visible', observation?.subject?.address ?? null],
    ['property-apn-visible', observation?.subject?.apn ?? null],
    ['property-id-visible', observation?.subject?.propertyId ?? null],
    ['canonical-comps-visible', comps?.displayed ?? null],
    ['comp-count-matches-rows', comps?.renderedRows ?? null],
    ['canonical-visual-visible', visuals?.displayed ?? null],
    ['imagery-not-empty', Boolean(visuals && visuals.renderedRows > 0 && !visuals.emptyStateVisible)],
    ['specialist-results-rendered', Boolean(
      comps
      && visuals
      && comps.displayed === contract.property.canonicalCounts.comps
      && visuals.displayed === contract.property.canonicalCounts.visuals
    )],
    ['no-cross-property-contamination', contamination.length === 0],
  ]);
}

function traceClick(events, pattern, start, end, pageId) {
  return events.some((event) => event.type === 'before'
    && event.pageId === pageId
    && event.method === 'click'
    && event.startTime >= start
    && event.startTime <= end
    && pattern.test(String(event.params?.selector ?? '')));
}

export function inspectPlaywrightTrace(buffer, {
  contract,
  results,
}) {
  const errors = [];
  let entries;
  try {
    entries = readZipEntries(buffer);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], observations: [], lifecycle: null };
  }
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) errors.push(`duplicate ZIP entry ${entry.name}`);
    names.add(entry.name);
  }
  for (const name of ['trace.trace', 'trace.network', 'trace.stacks']) {
    if (!names.has(name)) errors.push(`Playwright trace is missing ${name}`);
  }
  const traceEntry = entries.find((entry) => entry.name === 'trace.trace');
  const networkEntry = entries.find((entry) => entry.name === 'trace.network');
  if (!traceEntry || !networkEntry) return { valid: false, errors, observations: [], lifecycle: null };
  if (traceEntry.data.length < 50_000) errors.push('trace.trace is too small for the required operator workflow');
  const events = parseJsonLines(traceEntry.data, 'trace.trace', errors);
  const networkEvents = parseJsonLines(networkEntry.data, 'trace.network', errors);
  if (events.length < 100) errors.push(`trace.trace has only ${events.length} events; expected an inspectable Playwright workflow`);

  const contexts = events.filter((event) => event.type === 'context-options');
  if (contexts.length !== 1) errors.push(`trace must contain exactly one context-options event; found ${contexts.length}`);
  const context = contexts[0];
  if (context) {
    if (context.version !== 8 || context.origin !== 'library' || context.browserName !== 'chromium') errors.push('trace context is not a supported Playwright Chromium library trace');
    if (!/^1\.\d+\.\d+$/.test(context.playwrightVersion ?? '')) errors.push('trace context lacks a valid Playwright version');
    if (context.sdkLanguage !== 'javascript' || typeof context.contextId !== 'string' || !context.contextId.startsWith('browser-context@')) errors.push('trace context lacks native JavaScript context identity');
    if (context.title !== `landos-acceptance-v1:${contract.contractId}`) errors.push('trace context title does not identify the acceptance contract');
    if (context.options?.recordVideo?.size?.width !== 1440 || context.options?.recordVideo?.size?.height !== 1000) errors.push('trace context does not prove the required 1440x1000 video lifecycle');
    if (context.options?.viewport?.width !== 1440 || context.options?.viewport?.height !== 1000) errors.push('trace context viewport is not the acceptance viewport');
    if (context.options?.serviceWorkers !== 'block' || context.options?.acceptDownloads !== 'deny') errors.push('trace context isolation options are incomplete');
    if (!Number.isFinite(context.wallTime) || context.wallTime < Date.parse(results.startedAt) - 5_000 || context.wallTime > Date.parse(results.completedAt) + 60_000) errors.push('trace context wall time falls outside the acceptance run');
  }

  const beforeEvents = events.filter((event) => event.type === 'before');
  const beforeById = new Map();
  const afterById = new Map();
  for (const event of beforeEvents) {
    if (beforeById.has(event.callId)) errors.push(`trace has duplicate before call ${event.callId}`);
    beforeById.set(event.callId, event);
  }
  for (const event of events.filter((candidate) => candidate.type === 'after')) {
    if (afterById.has(event.callId)) errors.push(`trace has duplicate after call ${event.callId}`);
    afterById.set(event.callId, event);
  }
  for (const event of beforeEvents.filter((candidate) => candidate.method !== 'tracingGroup')) {
    const after = afterById.get(event.callId);
    if (!after) errors.push(`trace call ${event.callId} (${event.class}.${event.method}) has no correlated after event`);
    else if (!(Number.isFinite(event.startTime) && Number.isFinite(after.endTime) && after.endTime >= event.startTime)) errors.push(`trace call ${event.callId} has invalid monotonic timing`);
  }

  const newPages = beforeEvents.filter((event) => event.class === 'BrowserContext' && event.method === 'newPage');
  const pageEvents = events.filter((event) => event.type === 'event' && event.class === 'BrowserContext' && event.method === 'page');
  if (newPages.length !== 1 || pageEvents.length !== 1) errors.push(`trace must prove exactly one created page; found ${newPages.length} newPage calls and ${pageEvents.length} page events`);
  const pageId = pageEvents[0]?.params?.pageId;
  if (typeof pageId !== 'string' || !pageId.startsWith('page@')) errors.push('trace page event lacks a native Playwright page ID');
  const pageIds = new Set(events.map((event) => event.pageId ?? event.snapshot?.pageId).filter(Boolean));
  if (pageIds.size !== 1 || (pageId && !pageIds.has(pageId))) errors.push(`trace crosses ${pageIds.size} page identities; isolated evidence requires one`);
  const pageCloses = beforeEvents.filter((event) => event.class === 'Page' && event.method === 'close' && event.pageId === pageId);
  if (pageCloses.length !== 1 || !afterById.has(pageCloses[0]?.callId)) errors.push('trace does not prove exactly one completed close for its test-created page');

  const frameSnapshots = events.filter((event) => event.type === 'frame-snapshot' && event.snapshot?.isMainFrame && event.snapshot?.pageId === pageId);
  if (frameSnapshots.length < 20) errors.push(`trace has only ${frameSnapshots.length} main-frame DOM snapshots`);
  const snapshotNames = new Set(frameSnapshots.map((event) => event.snapshot.snapshotName));

  const entryMap = new Map(entries.map((entry) => [entry.name, entry.data]));
  const screencastFrames = events.filter((event) => event.type === 'screencast-frame');
  if (screencastFrames.length < 10) errors.push(`trace has only ${screencastFrames.length} screencast frames`);
  const uniqueFrames = new Set();
  for (const [index, frame] of screencastFrames.entries()) {
    if (frame.pageId !== pageId || !Number.isFinite(frame.timestamp) || !Number.isFinite(frame.frameSwapWallTime)) errors.push(`screencast frame ${index} lacks native page/timing linkage`);
    const resource = entryMap.get(`resources/${frame.sha1}`);
    if (!resource) {
      errors.push(`screencast frame ${index} is missing resource ${frame.sha1}`);
      continue;
    }
    const jpeg = inspectJpeg(resource);
    if (!jpeg.valid
      || jpeg.width < 240
      || jpeg.height < 120
      || jpeg.width > frame.width
      || jpeg.height > frame.height) {
      errors.push(`screencast frame ${index} is not a complete viewport-bounded JPEG resource`);
    }
    uniqueFrames.add(sha256(resource));
  }
  if (uniqueFrames.size < 4) errors.push(`trace screencast has only ${uniqueFrames.size} distinct rendered frames`);

  const groups = beforeEvents.filter((event) => event.class === 'Tracing' && event.method === 'tracingGroup');
  const evidenceGroups = groups.filter((event) => event.title?.startsWith('LANDOS_EVIDENCE_V1|'));
  const observations = [];
  const observationByArtifact = new Map();
  const screenshotCalls = beforeEvents.filter((event) => event.class === 'Page' && event.method === 'screenshot');
  if (screenshotCalls.length !== SCREENSHOT_ARTIFACTS.length) errors.push(`trace must contain exactly ${SCREENSHOT_ARTIFACTS.length} native Page.screenshot calls; found ${screenshotCalls.length}`);

  for (const artifact of SCREENSHOT_ARTIFACTS) {
    const expectedTitle = `LANDOS_EVIDENCE_V1|${artifact}|${EVIDENCE_PHASES[artifact]}|${contract.contractId}`;
    const matchingGroups = evidenceGroups.filter((group) => group.title === expectedTitle);
    if (matchingGroups.length !== 1) {
      errors.push(`${artifact}: trace must contain exactly one contract-bound ${EVIDENCE_PHASES[artifact]} evidence group; found ${matchingGroups.length}`);
      continue;
    }
    const group = matchingGroups[0];
    const childScreenshots = screenshotCalls.filter((call) => call.parentId === group.callId && call.pageId === pageId);
    if (childScreenshots.length !== 1) {
      errors.push(`${artifact}: evidence group must contain exactly one native screenshot action; found ${childScreenshots.length}`);
      continue;
    }
    const screenshotCall = childScreenshots[0];
    const screenshotAfter = afterById.get(screenshotCall.callId);
    if (!screenshotAfter || screenshotAfter.result?.binary !== '<Buffer>') errors.push(`${artifact}: native screenshot action has no binary completion`);
    if (!snapshotNames.has(screenshotCall.beforeSnapshot) || !snapshotNames.has(screenshotAfter?.afterSnapshot)) errors.push(`${artifact}: native screenshot lacks linked before/after DOM snapshots`);
    if (FULL_PAGE_ARTIFACTS.has(artifact)) {
      if (screenshotCall.params?.fullPage !== true || screenshotCall.params?.type !== 'png') errors.push(`${artifact}: trace does not prove a full-page PNG capture`);
    } else if (!screenshotCall.params?.clip || screenshotCall.params.clip.width < 240 || screenshotCall.params.clip.height < 120) {
      errors.push(`${artifact}: trace does not prove an inspectable changed-section clip`);
    }
    const takingScreenshot = events.some((event) => event.type === 'log' && event.callId === screenshotCall.callId && event.message === 'taking page screenshot');
    if (!takingScreenshot) errors.push(`${artifact}: trace lacks the native screenshot execution log`);
    if (!screencastFrames.some((frame) => Math.abs(frame.timestamp - screenshotCall.startTime) <= 1_500)) errors.push(`${artifact}: screenshot action is not temporally linked to a trace screencast frame`);

    const ariaCalls = beforeEvents.filter((call) => call.parentId === group.callId && call.class === 'Frame' && call.method === 'ariaSnapshot');
    if (ariaCalls.length !== 1 || !afterById.has(ariaCalls[0]?.callId)) errors.push(`${artifact}: evidence group lacks one completed native accessibility snapshot`);

    const markerCalls = beforeEvents.filter((call) => call.parentId === group.callId && call.class === 'Frame' && call.method === 'evaluateExpression');
    const markerResults = markerCalls
      .map((call) => {
        const after = afterById.get(call.callId);
        const value = after?.result?.value?.s ?? after?.result?.value;
        return { call, after, value };
      })
      .filter(({ value }) => typeof value === 'string' && value.startsWith(`{"marker":"${TRACE_OBSERVATION_MARKER}"`));
    if (markerResults.length !== 1) {
      errors.push(`${artifact}: evidence group must contain exactly one trace-recorded rendered observation; found ${markerResults.length}`);
      continue;
    }
    const { call: markerCall, after: markerAfter, value: markerValue } = markerResults[0];
    if (markerCall.startTime < screenshotAfter?.endTime) errors.push(`${artifact}: rendered observation was recorded before screenshot completion`);
    if (!snapshotNames.has(markerCall.beforeSnapshot) || !snapshotNames.has(markerAfter?.afterSnapshot)) errors.push(`${artifact}: rendered observation lacks linked DOM snapshots`);
    const observation = parseObservation(markerValue, `${artifact} trace observation`, errors);
    if (!observation) continue;
    if (observation.artifact !== artifact || observation.phase !== EVIDENCE_PHASES[artifact]) errors.push(`${artifact}: trace observation artifact/phase binding is wrong`);
    if (!timestampWithin(observation.capturedAt, results.startedAt, results.completedAt)) errors.push(`${artifact}: trace observation timestamp falls outside the run`);
    observations.push(observation);
    observationByArtifact.set(artifact, { observation, group, screenshotCall, markerCall, markerAfter });
  }

  const evidenceOrder = SCREENSHOT_ARTIFACTS.map((artifact) => observationByArtifact.get(artifact)?.group.startTime);
  for (let index = 1; index < evidenceOrder.length; index += 1) {
    if (!(evidenceOrder[index] > evidenceOrder[index - 1])) errors.push('trace evidence groups are missing or out of workflow order');
  }
  const entry = observationByArtifact.get('new-lead.png')?.observation;
  if (entry?.leadInputValue !== contract.property.address) errors.push('new-lead.png: trace DOM does not prove the target address was entered before capture');
  if (!/New Lead|Tell LandOS what you know/i.test(entry?.bodyText ?? '')) errors.push('new-lead.png: trace DOM does not show the operator-facing New Lead surface');
  if (!/Lead information|textbox/i.test(entry?.ariaSnapshot ?? '')) errors.push('new-lead.png: accessibility snapshot does not expose the New Lead input');
  const changed = observationByArtifact.get('changed-section.png')?.observation;
  if (changed?.activePanel !== 'Comps & Market') errors.push('changed-section.png: trace DOM does not show the Comps & Market panel active');
  const relevant = observationByArtifact.get('relevant-tab-or-panel.png')?.observation;
  if (relevant?.activePanel !== 'Documents & Visuals') errors.push('relevant-tab-or-panel.png: trace DOM does not show Documents & Visuals active');

  const initialEnd = observationByArtifact.get('relevant-tab-or-panel.png')?.markerAfter.endTime ?? Number.NaN;
  const refreshStart = observationByArtifact.get('after-refresh.png')?.group.startTime ?? Number.NaN;
  const refreshCalls = beforeEvents.filter((event) => event.class === 'Page' && event.method === 'reload' && event.pageId === pageId && event.startTime > initialEnd && event.startTime < refreshStart);
  if (refreshCalls.length !== 1 || !afterById.has(refreshCalls[0]?.callId)) errors.push('trace does not prove exactly one completed browser refresh before after-refresh.png');
  if (!traceClick(events, /Comps & Market/, refreshCalls[0]?.startTime ?? 0, refreshStart, pageId)
    || !traceClick(events, /Documents & Visuals/, refreshCalls[0]?.startTime ?? 0, refreshStart, pageId)) {
    errors.push('trace does not prove both changed operator sections were visibly reinspected after refresh');
  }

  const restartGroups = groups.filter((event) => event.title === `LANDOS_RESTART_V1|${contract.runPolicy.mode}|${contract.contractId}`);
  const restartStart = observationByArtifact.get('after-restart.png')?.group.startTime ?? Number.NaN;
  if (restartGroups.length !== 1 || !(restartGroups[0].startTime > refreshStart && restartGroups[0].startTime < restartStart)) errors.push('trace does not contain one contract-bound managed-restart boundary in workflow order');
  const restartMarker = beforeEvents.find((event) => event.parentId === restartGroups[0]?.callId && event.class === 'Frame' && event.method === 'evaluateExpression');
  const restartMarkerResult = afterById.get(restartMarker?.callId)?.result?.value;
  const restartMarkerValue = restartMarkerResult?.s ?? restartMarkerResult;
  if (typeof restartMarkerValue !== 'string' || !restartMarkerValue.includes('LANDOS_MANAGED_RESTART_V1')) errors.push('trace managed-restart boundary lacks a completed browser-recorded restart marker');
  const reopenCalls = beforeEvents.filter((event) => event.class === 'Frame' && event.method === 'goto' && event.pageId === pageId && event.startTime > (restartGroups[0]?.startTime ?? Number.POSITIVE_INFINITY) && event.startTime < restartStart);
  if (reopenCalls.length !== 1 || !afterById.has(reopenCalls[0]?.callId)) errors.push('trace does not prove exactly one completed Deal Card reopen after managed restart');
  if (!traceClick(events, /Comps & Market/, reopenCalls[0]?.startTime ?? 0, restartStart, pageId)
    || !traceClick(events, /Documents & Visuals/, reopenCalls[0]?.startTime ?? 0, restartStart, pageId)) {
    errors.push('trace does not prove both changed operator sections were visibly reinspected after restart');
  }
  const initialGeneration = observationByArtifact.get('deal-card-loaded.png')?.observation.restartGeneration;
  const restartGeneration = observationByArtifact.get('after-restart.png')?.observation.restartGeneration;
  if (contract.runPolicy.mode === 'fixture' && !(Number.isInteger(initialGeneration) && restartGeneration > initialGeneration)) errors.push('fixture trace DOM does not prove a newer managed-restart generation');

  const contamination = detectTraceContamination(contract, observations);
  for (const value of contamination) errors.push(`cross-property contamination in trace-rendered evidence: ${value}`);

  for (const networkEvent of networkEvents) {
    if (networkEvent.type !== 'resource-snapshot' || networkEvent.snapshot?.pageref !== pageId) errors.push('trace.network contains a non-Playwright or cross-page resource event');
    const sha1 = networkEvent.snapshot?.response?.content?._sha1;
    if (sha1 && !entryMap.has(`resources/${sha1}`)) errors.push(`trace.network response resource ${sha1} is missing`);
  }
  if (networkEvents.length < 3) errors.push(`trace.network has only ${networkEvents.length} resource snapshots`);

  if (pageCloses[0]?.startTime <= Math.max(...evidenceOrder.filter(Number.isFinite))) errors.push('trace page close occurred before all evidence captures completed');
  return {
    valid: errors.length === 0,
    errors,
    observations,
    contamination,
    context,
    lifecycle: {
      pageId,
      pagesCreated: newPages.length,
      pagesClosed: pageCloses.length,
      contextId: context?.contextId,
      screencastFrames: screencastFrames.length,
    },
  };
}
