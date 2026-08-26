// Contract tests for the LandOS OS Spine v1 dashboard API. Same pattern as
// src/dashboard.contract.test.ts: Hono app.request(), no real port, token
// auth from src/test-env-setup.ts, in-memory DBs.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { logger } from '../logger.js';
import { _initTestLandosDb, getLandosDb, logModelCall } from './db.js';
import { emptyLpPropertySummary } from './landportal-client.js';
import { createOpportunity, getOpportunityByDealCardId, listOpportunityHistory } from './opportunity.js';
import { linkPropertyToDeal } from './deal-card.js';
import { PropertyIntelligenceStore } from './property-intelligence-store.js';
import { initialSpecialistRecords, type PropertyIntelligenceSnapshot } from './property-intelligence-snapshot.js';

// The live DD routes now default to the parcel-identity CAPABILITY. These route
// tests exercise the verification BRIDGE mapping, so delegate the capability to
// the real LandPortal resolver (its no-network arg-validation paths) for
// deterministic, network-free behavior. Capability *selection* is covered by
// parcel-capability.test.ts.
// The resolver delegates to the real no-network LandPortal arg-validation paths
// by DEFAULT; individual tests can install a verified override (RESOLVER.override)
// to exercise the verified branch without a live call.
const RESOLVER = vi.hoisted(() => ({ override: null as null | ((args: unknown, t: unknown) => unknown) }));
vi.mock('./parcel-capability.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const { lpResolveForPreflight } = await import('./landportal-client.js');
  return {
    ...actual,
    resolveParcelIdentityResult: (args: unknown, t: unknown) =>
      RESOLVER.override ? RESOLVER.override(args, t) : (lpResolveForPreflight as any)(args, t),
  };
});

describe('LandOS routes - erroneous duplicate visibility', () => {
  it('keeps a linked erroneous intake out of normal property and board views', async () => {
    const canonical = (await (await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 Camp Davidson Road, Vonore, TN 37885',
      apn: '062 059G A 03400 000 2026', county: 'Monroe', state: 'TN', verified: true,
      verificationSource: 'Tennessee Comptroller public parcel layer',
    })).json()) as any;
    const erroneous = (await (await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '171 Davidson Road, Venore, TN 37885',
    })).json()) as any;
    getLandosDb().prepare(`INSERT INTO landos_property_correction_link (erroneous_card_id, canonical_card_id, relationship, note) VALUES (?, ?, 'erroneous_duplicate', 'bad automated instruction')`)
      .run(erroneous.card.id, canonical.card.id);
    const deal = (await (await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Canonical duplicate-visibility lead' })).json()) as any;

    const properties = (await (await get('/api/landos/property-cards')).json()) as any;
    expect(properties.cards.map((card: any) => card.id)).toEqual([canonical.card.id]);
    const board = (await (await get('/api/landos/board')).json()) as any;
    const boardCards = Object.values(board.columns).flat() as any[];
    expect(boardCards).toHaveLength(1);
    expect(boardCards[0].dealCardId).toBe(deal.dealCard.id);
    expect(boardCards[0].address).not.toContain('Venore');
  });
});

// Keep the Property Resolution Engine's free provider lanes hermetic: the engine
// now derives county via the Census geocoder and corroborates via the address
// suggest providers. Stub both so acquire/run + resolve routes never hit the net.
const CENSUS = vi.hoisted(() => ({ county: { county: 'White', state: 'GA', zip: '30528', fips: '13311', lat: 34.597, lng: -83.766 } as null | Record<string, unknown> }));
vi.mock('./providers/county-geocode.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, deriveCounty: async () => CENSUS.county };
});
const SUGGEST = vi.hoisted(() => ({
  result: {
    query: '', source: 'Photon', cached: false,
    suggestions: [{ label: '388 Gilstrap Rd, Cleveland, GA 30528', line1: '388 Gilstrap Rd', city: 'Cleveland', state: 'GA', zip: '30528', county: 'White', coordinates: { lat: 34.597, lng: -83.766 }, source: 'Photon', confidence: 0.8 }],
  } as Record<string, unknown>,
}));
vi.mock('./address-suggest.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, suggestAddresses: async (q: string) => ({ ...SUGGEST.result, query: q }) };
});

// Keep the persistent browser session inert in tests: NEVER launch Chrome or
// connect, regardless of any local .env BROWSER_INTEL_LIVE flag. Live execution
// is covered by browser-session.test.ts with injected fakes.
vi.mock('./browser-session.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const health = { healthy: false, status: 'disabled', cdpUrl: 'http://127.0.0.1:9222', connectedAtIso: null, lastCheckIso: null, screenshotDir: '/tmp/shots', landportalAuthenticated: null, landportalAuthCheckedIso: null, note: 'disabled in test' };
  return {
    ...actual,
    ensureBrowserSession: async () => 'disabled',
    browserSessionHealth: async () => health,
    startBrowserSession: async () => ({ status: 'disabled', launched: false, reused: false, chromePath: null, profileDir: '/tmp/profile', error: 'Live mode disabled', health }),
    openLandPortalInSession: async () => ({ connected: false, authenticated: false, status: 'disabled', url: null, note: 'No live Chrome session.', health }),
    // The parallel-escalation path (acquire/run + parallel-resolve) attempts the
    // Chrome/CDP attachment + LandPortal auto-login first — keep it inert too.
    ensureLandPortalAuthenticated: async () => ({ phase: 'session_unavailable', ready: false, sessionStatus: 'disabled', authenticated: false, reason: 'Live mode disabled in test', missingEnv: [], attempted: false, note: 'disabled in test' }),
  };
});

// Stub the free government DD fetchers so verified-parcel routes (which now have
// coordinates) stay hermetic and fast — no FEMA/NWI/USGS network calls in tests.
vi.mock('./providers/gov-dd-providers.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const stub = (capability: string, provider: string) => async () => ({ capability, provider, status: 'needs_verification', value: null, confidence: 'none', timestamp: new Date().toISOString(), sourceUrl: null, note: 'stubbed in test (no network)' });
  return { ...actual, fetchFemaFlood: stub('flood', 'fema_flood'), fetchNwiWetlands: stub('wetlands', 'nwi_wetlands'), fetchUsgsSlope: stub('slope', 'usgs_slope') };
});

const TOKEN = 'test-contract-token';

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  RESOLVER.override = null; // default: real no-network arg-validation paths
});

async function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}

async function post(path: string, body?: unknown) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('LandOS routes - Phase 1B owner identity controls', () => {
  async function identityFixture() {
    const propertyResponse = await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '1023 Baysinger Rd',
      city: 'Newport', county: 'Cocke', state: 'TN',
      apn: '015 027 04512 000 2026', owner: 'JOINES TRAVIS',
      verified: true, verificationSource: 'Tennessee Comptroller public parcel layer',
    });
    expect(propertyResponse.status).toBe(201);
    const property = ((await propertyResponse.json()) as any).card;
    const dealResponse = await post('/api/landos/deal-cards', {
      entity: 'TY_LAND_BIZ', title: '1023 Baysinger Rd', sellerNotes: 'Original intake: 1023 Baysinger Rd', leadType: 'manual',
    });
    expect(dealResponse.status).toBe(201);
    const deal = ((await dealResponse.json()) as any).dealCard;
    expect(linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' }).error).toBeUndefined();
    const opportunity = getOpportunityByDealCardId(deal.id);
    return { property, deal, opportunity };
  }

  it('synchronizes the Property Card, Deal Card, and Opportunity title while retaining prior intake history', async () => {
    const { property, deal, opportunity } = await identityFixture();
    const priorRawInput = opportunity.rawInput;
    const response = await post(`/api/landos/property-cards/${property.id}/verified-parcel-reconciliation`, {
      address: 'TALLEY RD, Newport, TN 37843', city: 'Newport', county: 'Cocke', state: 'TN',
      apn: '015 027 04512 000 2026', owner: 'JOINES TRAVIS', acres: 5.82,
      sourceUrl: 'https://tnmap.tn.gov/assessment/', sourceLabel: 'Tennessee Comptroller public parcel layer',
      confirmAcceptedIdentityReplacement: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.card.active_input_address).toBe('TALLEY RD, Newport, TN 37843');
    expect(body.card.acres).toBe(5.82);
    expect(body.dealCard.title).toBe('TALLEY RD, Newport, TN 37843');
    expect(body.opportunity).toMatchObject({ id: opportunity.id, title: 'TALLEY RD, Newport, TN 37843', rawInput: priorRawInput });
    const resolution = ((await (await get(`/api/landos/deal-cards/${deal.id}/resolution`)).json()) as any).parcelIdentity;
    expect(resolution).toMatchObject({
      subjectCardId: property.id,
      state: 'confirmed',
      confidence: 1,
      confirmedBy: 'owner-verified-parcel-reconciliation',
    });
    const summary = ((await (await get(`/api/landos/deal-cards/${deal.id}/property-summary`)).json()) as any).propertySummary;
    expect(summary.identity).toMatchObject({
      propertyCardId: property.id,
      status: 'confirmed',
      apn: '015 027 04512 000 2026',
      owner: 'JOINES TRAVIS',
      acreage: 5.82,
    });
    const acreageCorrection = await post(`/api/landos/property-cards/${property.id}/verified-parcel-reconciliation`, {
      address: 'TALLEY RD, Newport, TN 37843', city: 'Newport', county: 'Cocke', state: 'TN',
      apn: '015 027 04512 000 2026', owner: 'JOINES TRAVIS', acres: 6.1,
      sourceUrl: 'https://tnmap.tn.gov/assessment/', sourceLabel: 'Tennessee Comptroller public parcel layer',
      confirmAcceptedIdentityReplacement: true,
    });
    expect(acreageCorrection.status).toBe(200);
    const correctedSummary = ((await (await get(`/api/landos/deal-cards/${deal.id}/property-summary`)).json()) as any).propertySummary;
    expect(correctedSummary.identity).toMatchObject({ status: 'confirmed', acreage: 6.1 });

    const history = listOpportunityHistory(opportunity.id);
    expect(history.some((event) => event.eventType === 'canonical_identity_updated' && /1023 Baysinger Rd/.test(event.note))).toBe(true);
    const activity = (await (await get(`/api/landos/deal-cards/${deal.id}/activity`)).json()) as any;
    expect(activity.events.some((event: any) => event.kind === 'verified_parcel_reconciled' && /1023 Baysinger Rd/.test(event.summary))).toBe(true);
  });

  it('adds one idempotent lead without altering the parcel owner or inventing contact details', async () => {
    const { property, deal } = await identityFixture();
    const first = await post(`/api/landos/deal-cards/${deal.id}/people`, { name: 'Travis Jones', role: 'lead' });
    const second = await post(`/api/landos/deal-cards/${deal.id}/people`, { name: 'Travis Jones', role: 'lead' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await first.json() as any).created).toBe(true);
    expect((await second.json() as any).created).toBe(false);

    const savedDeal = ((await (await get(`/api/landos/deal-cards/${deal.id}`)).json()) as any).dealCard;
    const leads = savedDeal.people.filter((person: any) => person.name === 'Travis Jones' && person.role === 'lead_contact');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ phone: '', email: '', mailing_address: '', authority_status: 'unknown' });
    const savedProperty = ((await (await get(`/api/landos/property-cards/${property.id}`)).json()) as any).card;
    expect(savedProperty.owner).toBe('JOINES TRAVIS');
  });

  it('records a seller-workspace task as a meaningful Deal Card activity event', async () => {
    const { property, deal } = await identityFixture();
    const task = await post(`/api/landos/property-cards/${property.id}/next-action`, {
      action: 'Confirm trustee authority and asking price',
      createdBy: 'landos/deal-card',
    });
    expect(task.status).toBe(201);

    const activity = (await (await get(`/api/landos/deal-cards/${deal.id}/activity`)).json()) as any;
    expect(activity.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'task_created',
        summary: 'Task created: Confirm trustee authority and asking price',
        agentId: 'landos/deal-card',
      }),
    ]));
  });
});

describe('LandOS routes - Phase 1E living Deal Card', () => {
  async function livingCardFixture() {
    const property = ((await (await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: 'TALLEY RD', city: 'Newport', county: 'Cocke', state: 'TN',
      apn: '015 027 04512 000 2026', owner: 'JOINES TRAVIS', acres: 5.82,
      verified: true, verificationSource: 'Tennessee Comptroller public parcel layer',
    })).json()) as any).card;
    const deal = ((await (await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Talley Rd Phase 1E' })).json()) as any).dealCard;
    linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
    await post(`/api/landos/deal-cards/${deal.id}/people`, { name: 'Travis Jones', role: 'lead', phone: '423-555-0100', email: 'travis@example.test' });
    return { property, deal };
  }

  it('reconciles identity once and exposes durable intake, resources, hierarchy, and plain public-record outcomes', async () => {
    const { deal } = await livingCardFixture();
    const reconciled = await post(`/api/landos/deal-cards/${deal.id}/identity/reconcile`, {
      canonicalName: 'Travis Joines', officialName: 'JOINES TRAVIS', knownIncorrectNames: ['Travis Jones'],
    });
    expect(reconciled.status).toBe(200);
    const reconciledBody = (await reconciled.json()) as any;
    expect(reconciledBody.dealCard.people).toHaveLength(1);
    expect(reconciledBody.dealCard.people[0]).toMatchObject({ name: 'Travis Joines', phone: '423-555-0100', email: 'travis@example.test' });
    expect(reconciledBody.dealCard.people[0].roles).toEqual(expect.arrayContaining(['lead_contact', 'record_owner']));

    const intake = await post(`/api/landos/deal-cards/${deal.id}/intake`, {
      submissionType: 'general', source: 'route test', text: 'Seller stated that power availability is unknown. Follow-up: call the utility.',
    });
    expect(intake.status).toBe(201);
    const intakeBody = (await intake.json()) as any;
    expect(intakeBody.submission).toMatchObject({ originalText: 'Seller stated that power availability is unknown. Follow-up: call the utility.', status: 'complete', transcript: null });
    expect(intakeBody.submission.sections).toEqual(expect.arrayContaining(['seller_contact', 'utilities_septic_access', 'activity']));
    expect((await (await get(`/api/landos/deal-cards/${deal.id}/intake`)).json()) as any).toMatchObject({ submissions: [{ originalText: intakeBody.submission.originalText }] });

    const resource = await post(`/api/landos/deal-cards/${deal.id}/resources`, {
      category: 'planning_zoning', organization: 'Cocke County', department: 'Zoning Department', representative: 'Ashley Shelton', phone: '423-237-7600',
    });
    expect(resource.status).toBe(201);
    expect(((await resource.json()) as any).contacts).toHaveLength(1);

    const publicRecord = await post(`/api/landos/deal-cards/${deal.id}/public-records`, {
      category: 'deed_title_easement', title: 'Deed review', jurisdiction: 'Cocke County, TN', authority: 'Cocke County Register of Deeds',
      retrievalStatus: 'retrieved_no', summary: 'The latest deed image was not available from the free public page.', sourceUrl: 'https://county.example/register',
    });
    expect(publicRecord.status).toBe(201);
    const records = (await (await get(`/api/landos/deal-cards/${deal.id}/public-records`)).json()) as any;
    expect(records.hierarchy).toMatchObject({ subjectReady: true, roadOnlyAccepted: true, ownerIsDiscoveryOnly: true });
    expect(records.records[0]).toMatchObject({ retrieval_status: 'retrieved_no', source_url: 'https://county.example/register' });
    expect(JSON.stringify(records)).not.toMatch(/no liens|clear title|provider attempt|orchestration/i);
  });
});

describe('LandOS routes - Phase 1 transcript reconciliation', () => {
  it('supports pasted JSON and text-file multipart upload and exposes the latest durable reconciliation', async () => {
    const opportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Transcript route lead' });
    const pasted = await post(`/api/landos/opportunities/${opportunity.id}/transcripts`, {
      content: 'Seller inherited the parcel. Asking price is $90,000 and wants to sell within 45 days.',
      sourceType: 'paste',
    });
    expect(pasted.status).toBe(201);
    const pastedBody = (await pasted.json()) as any;
    expect(pastedBody.transcript.sourceType).toBe('paste');
    expect(pastedBody.reconciliation.version).toBe(1);
    expect(pastedBody.reconciliation.safety).toMatchObject({ outboundAllowed: false, paidActionsAllowed: false, offerOrContractSendingAllowed: false });

    const form = new FormData();
    form.append('file', new File(['Seller says asking price is $85,000. Call me back tomorrow.'], '../unsafe/call-two.txt', { type: 'text/plain' }));
    const uploaded = await app.request(`/api/landos/opportunities/${opportunity.id}/transcripts?token=${TOKEN}`, { method: 'POST', body: form });
    expect(uploaded.status).toBe(201);
    const uploadedBody = (await uploaded.json()) as any;
    expect(uploadedBody.transcript).toMatchObject({ sourceType: 'upload', fileName: 'call-two.txt' });
    expect(uploadedBody.reconciliation.version).toBe(2);
    expect(uploadedBody.reconciliation.followUpTasks.some((task: any) => /call me back tomorrow/i.test(task.title))).toBe(true);

    const transcripts = (await (await get(`/api/landos/opportunities/${opportunity.id}/transcripts`)).json()) as any;
    expect(transcripts.transcripts).toHaveLength(2);
    const latest = (await (await get(`/api/landos/opportunities/${opportunity.id}/reconciliation`)).json()) as any;
    expect(latest.reconciliation.id).toBe(uploadedBody.reconciliation.id);
    expect(latest.tasks.some((task: any) => task.status === 'open' && task.assignedRole === 'Acquisitions Agent')).toBe(true);
  });
});

describe('LandOS routes - Lead Workspace', () => {
  it('composes the versioned workspace from existing canonical records', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Lead workspace route' });
    const id = ((await created.json()) as any).dealCard.id;
    const res = await get(`/api/landos/lead-workspace/${id}`);
    expect(res.status).toBe(200);
    const workspace = (await res.json()) as any;
    expect(workspace.contract).toMatchObject({ type: 'lead-workspace', version: '1.0' });
    expect(workspace.lead.id).toBe(id);
    expect(workspace.work.recommendedNextAction).toBeDefined();
    expect(workspace.strategies.entries).toHaveLength(5);
    expect(workspace.evidence.documents).toBeDefined();
  });

  it('rejects invalid and missing Lead Workspace ids', async () => {
    expect((await get('/api/landos/lead-workspace/not-a-number')).status).toBe(400);
    expect((await get('/api/landos/lead-workspace/999999')).status).toBe(404);
  });
});

describe('LandOS routes - Phase 1 manual opportunity workflow', () => {
  it('accepts one conversational dump, preserves it exactly, and does not require structured fields', async () => {
    const rawInput = 'Seller: Conversational QA Seller\nPhone: 704-555-0119\nAbout 4 acres near Testville, NC. They inherited it and want a call next week.';
    const created = await post('/api/landos/leads/manual', { entity: 'TY_LAND_BIZ', rawInput });
    expect(created.status).toBe(201);
    const body = (await created.json()) as any;
    expect(body.dealCardId).toBeGreaterThan(0);
    expect(body.opportunity.rawInput).toBe(rawInput);
    expect(body.extraction).toMatchObject({ sellerName: 'Conversational QA Seller', phone: '704-555-0119', acreage: 4 });
    expect(body.researchStatus).toBe('queued');
    const dealRead = (await (await get(`/api/landos/deal-cards/${body.dealCardId}`)).json()) as any;
    expect(dealRead.opportunity.id).toBe(body.opportunityId);
    const propertyResolution = (await (await get(`/api/landos/deal-cards/${body.dealCardId}/property-resolution`)).json()) as any;
    expect(propertyResolution.result).toMatchObject({ capability: { id: 'property-resolution' }, subjectResolution: 'UNRESOLVED' });

    const thinRaw = 'Caller inherited land but did not know the parcel number or address yet.';
    const thin = await post('/api/landos/leads/manual', { rawInput: thinRaw });
    expect(thin.status).toBe(201);
    const thinBody = (await thin.json()) as any;
    expect(thinBody.opportunity.rawInput).toBe(thinRaw);
    expect(thinBody.extraction.sellerName).toBeNull();
  });

  it('creates one durable lead immediately, starts research, and reconciles every count surface', async () => {
    const created = await post('/api/landos/leads/manual', {
      entity: 'TY_LAND_BIZ', sellerName: 'Synthetic Route Seller',
      address: '101 QA Isolation Road, Testville, NC', county: 'Test', state: 'NC',
      acreage: 7.5, sellerClues: 'Synthetic acceptance fixture only.', leadSource: 'operator_qa',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as any;
    expect(body).toMatchObject({ researchStatus: 'queued' });
    expect(body.dealCardId).toBeGreaterThan(0);
    expect(body.opportunityId).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const workspace = (await (await get(`/api/landos/lead-workspace/${body.dealCardId}`)).json()) as any;
    expect(workspace.opportunity.id).toBe(body.opportunityId);
    expect(workspace.opportunity.lifecycleStatus).toBe('lead');
    expect(['queued', 'running', 'partial']).toContain(workspace.opportunity.researchStatus);
    expect(workspace.lead.id).toBe(body.dealCardId);
    expect(workspace.discoveryPackage.callPrep.ready).toBe(false);
    expect(workspace.discoveryPackage.callPrep.status).toBe('incomplete');
    expect(workspace.discoveryPackage.strategyMode).toBe('validation_hypotheses');
    expect(workspace.discoveryPackage.strategies).toHaveLength(2);
    expect(workspace.discoveryPackage.preliminaryValue.offerPreparationAllowed).toBe(false);

    const rebuilt = await post(`/api/landos/opportunities/${body.opportunityId}/discovery-package/run`, {});
    expect(rebuilt.status).toBe(200);
    const rebuiltBody = (await rebuilt.json()) as any;
    const packageRead = (await (await get(`/api/landos/opportunities/${body.opportunityId}/discovery-package`)).json()) as any;
    expect(packageRead.discoveryPackage.contentHash).toBe(rebuiltBody.discoveryPackage.contentHash);
    const markdown = await get(`/api/landos/opportunities/${body.opportunityId}/discovery-package/download?format=md`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('content-type')).toContain('text/markdown');
    expect(await markdown.text()).toContain(body.publicUid);

    const metrics = (await (await get('/api/landos/opportunities/metrics')).json()) as any;
    const jarvis = (await (await get('/api/landos/jarvis/opportunity-counts')).json()) as any;
    const overview = (await (await get('/api/landos/overview')).json()) as any;
    expect(metrics.counts.total).toBe(metrics.records.length);
    expect(jarvis.counts).toEqual(metrics.counts);
    expect(overview.opportunityMetrics.totalOpportunities).toBe(metrics.counts.total);
  });

  it('promotes the same opportunity and rejects prohibited disposition values', async () => {
    const body = (await (await post('/api/landos/leads/manual', {
      sellerName: 'Synthetic Promotion Seller', apn: 'QA-ONLY-001', state: 'NC',
    })).json()) as any;
    const before = (await (await get(`/api/landos/opportunities/${body.opportunityId}`)).json()) as any;
    const pursued = await post(`/api/landos/opportunities/${body.opportunityId}/decision`, { decision: 'pursue' });
    expect(pursued.status).toBe(200);
    const after = (await pursued.json()) as any;
    expect(after.opportunity).toMatchObject({ id: before.opportunity.id, publicUid: before.opportunity.publicUid, lifecycle: 'deal' });
    expect((await post(`/api/landos/opportunities/${body.opportunityId}/decision`, { decision: 'disposition', disposition: 'paid_offer_sent' })).status).toBe(400);
  });
});

describe('LandOS routes — auth', () => {
  it('rejects /api/landos/overview without a token', async () => {
    const res = await app.request('/api/landos/overview');
    expect(res.status).toBe(401);
  });
});

describe('LandOS routes — cost board (actual recorded spend)', () => {
  it('aggregates recorded model_call rows by department/provider/runtime/model — never a fake number', async () => {
    logModelCall({ agentId: 'duke', provider: 'anthropic', model: 'claude', taskClass: 'strategy', estCostUsd: 0.02, workflow: 'research_due_diligence', inputTokens: 1000, outputTokens: 500 });
    logModelCall({ agentId: 'duke', provider: 'google', model: 'gemma-4-e4b', taskClass: 'parse', estCostUsd: 0, workflow: 'research_due_diligence' });
    const res = await get('/api/landos/cost-board');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.totalCalls).toBe(2);
    expect(b.totalUsd).toBeCloseTo(0.02, 6);
    // Runtime derived from the neutral registry: claude=cloud, gemma=local.
    expect(b.byRuntime.cloud).toBeCloseTo(0.02, 6);
    expect(b.byRuntime.local).toBe(0);
    // Records the ACTUAL model that ran (claude), not a suggestion.
    expect(b.byModel.find((m: any) => m.modelId === 'claude').usd).toBeCloseTo(0.02, 6);
    expect(b.byDepartment.find((d: any) => d.department === 'research_due_diligence').calls).toBe(2);
  });

  it('returns an honest empty board when no spend is recorded (no fabricated rows)', async () => {
    const res = await get('/api/landos/cost-board');
    const b = (await res.json()) as any;
    expect(b.totalCalls).toBe(0);
    expect(b.totalUsd).toBe(0);
    expect(b.byModel).toEqual([]);
  });
});

describe('LandOS routes — verified-gate (Deal Card only after verified identity)', () => {
  it('REJECTS creation when the parcel is unverified — even if the client claims verified:true — and writes NO card', async () => {
    // Non-identifier text => runDukeVerification returns unverified WITHOUT any
    // LandPortal call (no network). The endpoint never reads a client 'verified'
    // flag; it re-verifies server-side, so a lying flag cannot create a card.
    const res = await post('/api/landos/deal-cards/from-verification', {
      text: 'tell me something interesting about clouds',
      entity: 'TY_LAND_BIZ',
      verified: true, // lying client flag — must be ignored
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(false);
    expect(body.parcelVerified).toBe(false);
    expect(body.reason).toMatch(/Local Area Context — Not Parcel Verified/);

    // NO Deal Card and NO property card were written.
    const deals = (await (await get('/api/landos/deal-cards')).json()) as any;
    expect(deals.dealCards).toHaveLength(0);
    const props = (await (await get('/api/landos/property-cards')).json()) as any;
    expect(props.cards).toHaveLength(0);
  });

  it('rejects an invalid entity and writes no card', async () => {
    const res = await post('/api/landos/deal-cards/from-verification', { text: 'anything', entity: 'NOPE' });
    expect(res.status).toBe(400);
    const deals = (await (await get('/api/landos/deal-cards')).json()) as any;
    expect(deals.dealCards).toHaveLength(0);
  });
});

describe('LandOS routes — overview and registries', () => {
  it('returns overview with counts, departments, and pending approvals', async () => {
    const res = await get('/api/landos/overview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.counts).toBeTypeOf('object');
    expect(body.counts.lead).toBe(0);
    expect(Array.isArray(body.departments)).toBe(true);
    expect(body.departments.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(body.pendingApprovalList)).toBe(true);
  });

  it('lists both business entities', async () => {
    const res = await get('/api/landos/entities');
    const body = (await res.json()) as any;
    expect(body.entities.map((e: any) => e.id)).toEqual(['LAND_ALLY', 'TY_LAND_BIZ']);
  });

  it('serves the rubric config from Duke Section 7', async () => {
    const res = await get('/api/landos/rubric');
    const body = (await res.json()) as any;
    expect(body.status).toBe('approved');
    expect(body.factors).toHaveLength(6);
    expect(body.factors.reduce((s: number, f: any) => s + f.maxPoints, 0)).toBe(100);
  });

  it('serves the strategy registry', async () => {
    const res = await get('/api/landos/strategies');
    const body = (await res.json()) as any;
    expect(body.strategies.length).toBe(13);
  });
});

describe('LandOS routes — entity filter', () => {
  it('filters leads by entity', async () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('LAND_ALLY', 'web')`).run();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('TY_LAND_BIZ', 'mail')`).run();

    const all = (await (await get('/api/landos/leads')).json()) as any;
    expect(all.leads).toHaveLength(2);

    const la = (await (await get('/api/landos/leads?entity=LAND_ALLY')).json()) as any;
    expect(la.leads).toHaveLength(1);
    expect(la.leads[0].entity).toBe('LAND_ALLY');

    const ty = (await (await get('/api/landos/leads?entity=TY_LAND_BIZ')).json()) as any;
    expect(ty.leads).toHaveLength(1);
    expect(ty.leads[0].entity).toBe('TY_LAND_BIZ');
  });
});

describe('LandOS routes — approval workflow', () => {
  it('absolutely rejects paid-action approval requests in Phase 1', async () => {
    const response = await post('/api/landos/approvals', {
      actionType: 'paid_credit',
      title: 'Use 1 LandPortal comp credit for test parcel',
      requestedBy: 'duke-due-diligence',
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error).toContain('prohibited');

    const pending = (await (await get('/api/landos/approvals?status=pending')).json()) as any;
    expect(pending.approvals).toHaveLength(0);
  });

  it('rejects approval creation without required fields', async () => {
    const res = await post('/api/landos/approvals', { title: 'no action type' });
    expect(res.status).toBe(400);
  });
});

describe('LandOS routes — rules, playbooks, research', () => {
  it('creates rules as draft only', async () => {
    const created = (await (await post('/api/landos/rules', {
      name: 'Minimum net profit baseline',
      body: 'Global minimum net profit is $10,000.',
      scope: 'global',
    })).json()) as any;
    expect(created.status).toBe('draft');

    const rules = (await (await get('/api/landos/rules')).json()) as any;
    expect(rules.rules[0].status).toBe('draft');
  });

  it('creates playbooks at raw_training by default and exposes the lifecycle', async () => {
    const created = (await (await post('/api/landos/playbooks', { name: 'Seller call openings' })).json()) as any;
    expect(created.stage).toBe('raw_training');

    const list = (await (await get('/api/landos/playbooks')).json()) as any;
    expect(list.lifecycle[0]).toBe('raw_training');
    expect(list.lifecycle[list.lifecycle.length - 1]).toBe('agent_instruction_update');
  });

  it('creates and filters research items by kind', async () => {
    await post('/api/landos/research', { kind: 'market', title: 'County absorption check' });
    await post('/api/landos/research', { kind: 'ai_change', title: 'New model release' });

    const market = (await (await get('/api/landos/research?kind=market')).json()) as any;
    expect(market.research).toHaveLength(1);
    expect(market.research[0].kind).toBe('market');

    const bad = await post('/api/landos/research', { kind: 'gossip', title: 'nope' });
    expect(bad.status).toBe(400);
  });
});

describe('LandOS routes — intake orchestrator auth', () => {
  const INTAKE_BODY = { transport: 'manual_api', text: 'APN: 051-012-05, Colleton County, SC' };

  it('accepts POST /api/landos/intake with the ?token= query param (same mechanism as other dashboard routes)', async () => {
    const res = await post('/api/landos/intake', INTAKE_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.plan).toBeTypeOf('object');
    expect(body.plan.classification.classification).toBe('parcel_level');
  });

  it('rejects POST /api/landos/intake without a token', async () => {
    const res = await app.request('/api/landos/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(INTAKE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /api/landos/intake when the token is sent as a header instead of the query param', async () => {
    // Reproduces the 401 seen from the browser console: the dashboard auth
    // middleware reads c.req.query('token') only — Authorization/x-dashboard-token
    // headers are ignored. The fix is to send ?token=, not a header.
    const res = await app.request('/api/landos/intake', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-dashboard-token': TOKEN,
      },
      body: JSON.stringify(INTAKE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('gates /api/landos/intake identically to an existing dashboard route', async () => {
    // Same auth behavior as a known-good route: no token -> 401 for both.
    const intakeNoToken = await app.request('/api/landos/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(INTAKE_BODY) });
    const overviewNoToken = await app.request('/api/landos/overview');
    expect(intakeNoToken.status).toBe(overviewNoToken.status);
    expect(intakeNoToken.status).toBe(401);
  });
});

describe('SPA shell is served no-store (stale-bundle regression)', () => {
  // Root cause of "the new button does nothing": the SPA HTML shell was cached
  // by the browser while assets are content-hashed + immutable, pinning the user
  // to an old bundle. The shell MUST be no-store so new frontend builds load.
  it('GET / sets Cache-Control: no-store on the SPA shell', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect((res.headers.get('cache-control') ?? '').toLowerCase()).toContain('no-store');
  });

  it('GET a SPA deep link (/landos) sets Cache-Control: no-store', async () => {
    const res = await app.request('/landos');
    expect(res.status).toBe(200);
    expect((res.headers.get('cache-control') ?? '').toLowerCase()).toContain('no-store');
  });

  it('hashed assets stay immutable (only the shell is no-store)', async () => {
    // Sanity: the immutable policy on /assets/* is correct and unchanged.
    const res = await app.request('/');
    const html = await res.text();
    const m = html.match(/assets\/[A-Za-z0-9_.-]+\.js/);
    if (m) {
      const asset = await app.request('/' + m[0]);
      expect((asset.headers.get('cache-control') ?? '').toLowerCase()).toContain('immutable');
    }
  });
});

describe('LandOS routes — Duke execution bridge auth + safety', () => {
  // Use non-identity text so the route takes the preflight "skip" path and makes
  // NO live LandPortal call (verification never starts without an identifier).
  const NO_IDENTITY = { text: 'what should we do with this?' };

  it('rejects POST /api/landos/intake/duke-verification without a token', async () => {
    const res = await app.request('/api/landos/intake/duke-verification', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(NO_IDENTITY),
    });
    expect(res.status).toBe(401);
  });

  it('accepts the route with ?token= and returns a read-only verification result', async () => {
    const res = await post('/api/landos/intake/duke-verification', NO_IDENTITY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.executionMode).toBe('duke_verification_read_only');
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.strategyUnderwritingBlocked).toBe(true);
    expect(body.dealCardUpdatePlan.persistedNow).toBe(false);
  });

  it('returns the FULL product contract shape the UI renders (verification + analysis + ace + market + deal)', async () => {
    const res = await post('/api/landos/intake/duke-verification', NO_IDENTITY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification).toBeTypeOf('object');
    expect(body.verification.status).toBeTypeOf('string');
    expect(Array.isArray(body.verification.sourceAttempts)).toBe(true);
    expect(Array.isArray(body.verification.dataGaps)).toBe(true);
    expect(body.dukeAnalysis).toBeTypeOf('object');
    expect(body.dukeAnalysis.strategyStatus).toBe('blocked_unverified_parcel');
    expect(body.acePrep).toBeTypeOf('object');
    expect(Array.isArray(body.acePrep.questions)).toBe(true);
    expect(body.marketPulse).toBeTypeOf('object');
    expect(body.dealCardUpdatePlan).toBeTypeOf('object');
    expect(body.dealCardUpdatePlan.matchStatus).toBeTypeOf('string');
    expect(Array.isArray(body.dealCardUpdatePlan.timeline)).toBe(true);
  });

  it('a coordinate-pair input is never verified (no coordinate parcel identity)', async () => {
    const res = await post('/api/landos/intake/duke-verification', { text: '34.0522, -118.2437' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.identity).toBeUndefined();
  });

  it('a FULL street address is a valid identifier — never no_parcel_identifier_in_input', async () => {
    // 731 Filter Plant Dr, Fayetteville, NC 28301 parses to an address with no
    // FIPS -> LandPortal returns ambiguous_fips offline (no network). The route
    // must attempt the lookup and report needs-county/FIPS, not "no identifier".
    const res = await post('/api/landos/intake/duke-verification', { text: '731 Filter Plant Dr, Fayetteville, NC 28301' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.dataGaps).not.toContain('no_parcel_identifier_in_input');
    expect(body.verification.dataGaps).toContain('needs_county_or_fips');
    expect(body.verification.sourceAttempts[0].status).not.toBe('skipped');
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.strategyUnderwritingBlocked).toBe(true);
    // Market Pulse v1 runs as labeled local-area context.
    expect(body.marketPulse.eligible).toBe(true);
    expect(body.marketPulse.label).toBe('Local Area Context, Not Parcel Verified');
    const pop = body.marketPulse.signals.find((s: any) => s.signal === 'population_growth_direction');
    expect(pop.status).toBe('source_available');
    expect(pop.sourceUrl).toMatch(/census\.gov/);
  });

  it('requires text', async () => {
    const res = await post('/api/landos/intake/duke-verification', {});
    expect(res.status).toBe(400);
  });
});

describe('LandOS routes — Duke property data (propertyid + FIPS, non-comp)', () => {
  // Proves the propertyid+FIPS path bypasses /search, pulls /property-data, and
  // returns a verified dashboard contract with normalized property data. global
  // fetch is stubbed (no real network / no real token / no comp credit).
  const PROP_BODY = { text: 'propertyid 173393466, FIPS 47031' };
  let fetchCalls: string[] = [];

  beforeEach(() => {
    fetchCalls = [];
    process.env.LP_JWT_TOKEN = 'test-fake-token'; // fake; the stub ignores it
    vi.stubGlobal('fetch', async (url: unknown) => {
      fetchCalls.push(String(url));
      const property = {
        propertyid: '173393466', apn: '076-022.02', situsfullstreetaddress: '123 Smoke Rd',
        situscity: 'Manchester', situsstate: 'TN', situszip5: '37355', situscounty: 'Coffee',
        ownername1full: 'Smoke Owner LLC', landusecodedescription: 'Vacant', lotsizeacres: '12.5',
        road_frontage: '210', land_locked: 'false', wetlands_cover_percentage: '3', fema_cover_percentage: '0',
        buildability_total_perc: '88', buildability_area: '11', slope_average: '4',
        markettotalvalue: '60000', tlp_estimate: '75000', tlp_ppa: '6000',
        // Individual embedded similar-sale rows in the non-comp response.
        similars: JSON.stringify([
          { sold_year: 2024, sold_price: 45000, price_acres: 9000, apn: '076-001.00', propertyid: '999001' },
          { sold_year: 2023, price_acres: 6000 },
        ]),
      };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { property }, meta: { requests_left: '100' } }) } as unknown as Response;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LP_JWT_TOKEN;
  });

  it('bypasses /search, pulls /property-data, and returns normalized verified property data', async () => {
    const res = await post('/api/landos/intake/duke-verification', PROP_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verification.parcelVerified).toBe(true);
    expect(body.verification.propertyData.sourceName).toBe('LandPortal');
    expect(body.verification.propertyData.identity.propertyId).toBe('173393466');
    expect(body.verification.propertyData.identity.fips).toBe('47031');
    expect(body.verification.propertyData.landFacts.acres).toBe(12.5);
    expect(body.verification.propertyData.valuation.marketTotal).toBe(60000);
    expect(body.dukeAnalysis.strategyStatus).toBe('ready_for_preliminary_review');
    expect(body.acePrep.status).toBe('ready');
    // Market Pulse derives local area from VERIFIED county/state (no area words
    // in a propertyid+FIPS input) — Coffee County, TN, not "unknown area".
    expect(body.marketPulse.eligible).toBe(true);
    expect(body.marketPulse.localArea.descriptor).toMatch(/Coffee/);
    expect(body.marketPulse.localArea.descriptor).toMatch(/TN/);
    // Individual embedded similar-sale rows are surfaced (no comp credit).
    expect(body.verification.propertyData.similarRowsAvailable).toBe(true);
    expect(body.verification.propertyData.similarSales.length).toBe(2);
    expect(body.verification.propertyData.similarSales[0].salePrice).toBe(45000);
    expect(body.verification.propertyData.similarSales[0].apn).toBe('076-001.00');
    // Bypassed search: hit /property-data, never /search.
    expect(fetchCalls.some((u) => u.includes('/property-data'))).toBe(true);
    expect(fetchCalls.some((u) => u.includes('/search'))).toBe(false);
    // Never a comp report tool / comp credit.
    expect(fetchCalls.some((u) => /comp_report|comp-report|lp_comp/.test(u))).toBe(false);
  });

});

describe('LandOS routes — offer scenarios', () => {
  it('evaluates strategies and labels DRAFT output', async () => {
    const res = await post('/api/landos/strategies/evaluate', { expectedValueUsd: 100000 });
    const body = (await res.json()) as any;
    const flip = body.scenarios.find((s: any) => s.strategy === 'quick_flip');
    expect(flip.offerLowUsd).toBe(40000);
    expect(flip.offerHighUsd).toBe(60000);
    expect(flip.outputLabel).toBe('CONFIRMED PARAMETERS');

    const landHome = body.scenarios.find((s: any) => s.strategy === 'land_home_package');
    expect(landHome.feasible).toBe(false);

    const wholesale = body.scenarios.find((s: any) => s.strategy === 'wholesale_assignment');
    expect(wholesale.outputLabel).toBe('DRAFT (UNCONFIRMED PARAMETERS)');
  });

  it('rejects a non-positive EV', async () => {
    const res = await post('/api/landos/strategies/evaluate', { expectedValueUsd: -5 });
    expect(res.status).toBe(400);
  });
});

describe('LandOS routes — Deal Card create/edit/save/reload/update', () => {
  it('creates a Deal Card via POST and reads it back via GET (reload)', async () => {
    const create = await post('/api/landos/deal-cards', {
      entity: 'TY_LAND_BIZ', title: 'Generic seller lead', sellerNotes: 'placeholder note',
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as any;
    const id = created.dealCard.id;
    expect(id).toBeGreaterThan(0);
    expect(created.dealCard.title).toBe('Generic seller lead');

    // "Reload": fresh GET hits the DB and recovers the saved card.
    const reload = await get(`/api/landos/deal-cards/${id}`);
    expect(reload.status).toBe(200);
    const reloaded = (await reload.json()) as any;
    expect(reloaded.dealCard.title).toBe('Generic seller lead');
    expect(reloaded.dealCard.seller_notes).toBe('placeholder note');
    expect(reloaded.dealCard.entity).toBe('TY_LAND_BIZ');
    expect(reloaded.dealCard.status).toBe('new');
  });

  it('rejects a create with no/invalid entity', async () => {
    const res = await post('/api/landos/deal-cards', { title: 'no entity' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid status on create', async () => {
    const res = await post('/api/landos/deal-cards', { entity: 'LAND_ALLY', status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('updates the SAME card via PATCH (no duplicate) and persists across reload', async () => {
    const create = await post('/api/landos/deal-cards', { entity: 'LAND_ALLY', title: 'Before' });
    const id = ((await create.json()) as any).dealCard.id;

    const before = await get('/api/landos/deal-cards');
    const beforeCount = ((await before.json()) as any).dealCards.length;

    const patch = await app.request(`/api/landos/deal-cards/${id}?token=${TOKEN}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'After', status: 'researching', askingPrice: 42000 }),
    });
    expect(patch.status).toBe(200);

    const reload = await get(`/api/landos/deal-cards/${id}`);
    const reloaded = (await reload.json()) as any;
    expect(reloaded.dealCard.title).toBe('After');
    expect(reloaded.dealCard.status).toBe('researching');
    expect(reloaded.dealCard.asking_price).toBe(42000);

    // No duplicate record was created by the update.
    const after = await get('/api/landos/deal-cards');
    expect(((await after.json()) as any).dealCards.length).toBe(beforeCount);
  });

  it('PATCH of a missing card returns 404', async () => {
    const res = await app.request(`/api/landos/deal-cards/999999?token=${TOKEN}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ghost' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('LandOS routes — removed Deal Card compatibility endpoints', () => {
  it('leaves every obsolete worksheet, report, Acquire, and Public Intelligence route non-callable', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Canonical route fixture' });
    const id = ((await created.json()) as any).dealCard.id as number;
    const canonical = await get(`/api/landos/deal-cards/${id}/property-intelligence`);
    expect(canonical.status).toBe(200);
    const canonicalBody = (await canonical.json()) as any;
    expect(canonicalBody.propertyIntelligence).toBeDefined();
    expect(canonicalBody.documentRegistry).toBeDefined();
    expect(canonicalBody.parcelRoster).toEqual([]);
    const request = (path: string, method: 'GET' | 'POST' | 'PUT') =>
      app.request(`${path}?token=${TOKEN}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
    const removed: Array<[string, 'GET' | 'POST' | 'PUT']> = [
      [`/api/landos/deal-cards/${id}/dd`, 'GET'],
      [`/api/landos/deal-cards/${id}/dd`, 'PUT'],
      [`/api/landos/deal-cards/${id}/strategy`, 'GET'],
      [`/api/landos/deal-cards/${id}/strategy`, 'PUT'],
      [`/api/landos/deal-cards/${id}/market`, 'GET'],
      [`/api/landos/deal-cards/${id}/market`, 'PUT'],
      [`/api/landos/deal-cards/${id}/report`, 'GET'],
      [`/api/landos/deal-cards/${id}/report/run`, 'POST'],
      ['/api/landos/acquire/run', 'POST'],
      [`/api/landos/deal-cards/${id}/public-intelligence`, 'GET'],
      [`/api/landos/deal-cards/${id}/public-intelligence/run`, 'POST'],
    ];
    for (const [path, method] of removed) {
      expect((await request(path, method)).status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('LandOS routes — knowledge layer + data providers (presence-only)', () => {
  it('knowledge/status reports backend selection + provider config without secret values', async () => {
    const res = await get('/api/landos/knowledge/status');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(['local-fs', 'r2']).toContain(b.knowledgeStore.selected);
    expect(typeof b.knowledgeStore.reason).toBe('string');
    // r2.missing carries env KEY NAMES only, never values
    expect(Array.isArray(b.knowledgeStore.r2.missing)).toBe(true);
    const ids = b.dataProviders.parcelProviders.map((p: any) => p.id).sort();
    expect(ids).toEqual(['realie']);
    expect(ids).not.toContain('landportal');
    const realie = b.dataProviders.parcelProviders.find((p: any) => p.id === 'realie');
    expect(typeof realie.configured).toBe('boolean');
    // No secret VALUE leaks into the payload (key NAMES like
    // LANDOS_R2_SECRET_ACCESS_KEY are fine; an actual bearer/value is not).
    expect(JSON.stringify(b)).not.toMatch(/Bearer\s+\S/i);
  });

  it('agent knowledge manifest: 404 for unknown agent, empty list for a known fresh agent', async () => {
    const bad = await get('/api/landos/knowledge/agents/nope_bot');
    expect(bad.status).toBe(404);
    const ok = await get('/api/landos/knowledge/agents/market_bot');
    expect(ok.status).toBe(200);
    const b = (await ok.json()) as any;
    expect(b.agentKey).toBe('market_bot');
    expect(Array.isArray(b.items)).toBe(true);
  });

  it('market/scorecard returns a scorecard shape (metrics unavailable until a source connects)', async () => {
    const res = await get('/api/landos/market/scorecard');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.scorecard.version).toBe(1);
    expect(Array.isArray(b.scorecard.counties)).toBe(true);
  });
});

describe('LandOS routes — Browser Intelligence operator control', () => {
  const noSecrets = (body: unknown) => {
    const s = JSON.stringify(body).toLowerCase();
    expect(s).not.toContain('cookie');
    expect(s).not.toContain('token');
    expect(s).not.toContain('password');
  };

  it('GET /browser/session returns status (no cookies/tokens)', async () => {
    const res = await get('/api/landos/browser/session');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.session.status).toBe('disabled');
    expect(body.session).not.toHaveProperty('cookies');
    noSecrets(body);
  });

  it('POST /browser/start never launches Chrome in tests and reports status', async () => {
    const res = await post('/api/landos/browser/start', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.start.launched).toBe(false); // disabled in test → no spawn
    expect(typeof body.start.status).toBe('string');
    noSecrets(body);
  });

  it('POST /browser/open-landportal reports no session when not connected', async () => {
    const res = await post('/api/landos/browser/open-landportal', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.landportal.connected).toBe(false);
    noSecrets(body);
  });
});

describe('LandOS routes — Acquisition Intelligence Platform (learning engine)', () => {
  it('register asset -> add/approve knowledge -> generate/publish playbook -> coaching (approved only)', async () => {
    const a = ((await (await post('/api/landos/aip/assets', { sourceType: 'mp3', title: 'Objections', author: 'JM', ext: 'mp3', metadata: { tags: ['obj'] } })).json()) as any).asset;
    expect(a.r2Key).toContain('agents/acquisitions/training/raw/mp3/');
    const k = ((await (await post('/api/landos/aip/knowledge', { category: 'objection_category', content: 'Anchor on recent sales.', citations: [{ assetId: a.id, sourceTitle: 'Objections' }] })).json()) as any).knowledge;
    expect(k.status).toBe('proposed');
    // unapproved excluded from generated playbook
    let gen = ((await (await post('/api/landos/aip/playbook/generate', { section: 'objection_handling' })).json()) as any).result;
    expect(gen.record.content).not.toContain('Anchor on recent sales');
    await post(`/api/landos/aip/knowledge/${k.id}/approve`, {});
    gen = ((await (await post('/api/landos/aip/playbook/generate', { section: 'objection_handling' })).json()) as any).result;
    expect(gen.record.content).toContain('Anchor on recent sales');
    const pub = ((await (await post(`/api/landos/aip/playbook/${gen.record.id}/publish`, {})).json()) as any).playbook;
    expect(pub.status).toBe('published');
    const coach = (await (await post('/api/landos/aip/coaching', { mode: 'negotiation_review', query: 'price objection' })).json()) as any;
    expect(coach.insights.every((x: any) => x.status === 'approved')).toBe(true);
    // reload: published section is retrievable
    const pb = (await (await get('/api/landos/aip/playbook?section=objection_handling')).json()) as any;
    expect(pb.published.id).toBe(pub.id);
  });
});

describe('LandOS routes — Acquisitions department (CRM-independent, never sends)', () => {
  it('serves the bounded Workspace V2 Overview projection without rebuilding deep workspace data', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Lean Acq deal', leadType: 'test' });
    const id = ((await created.json()) as any).dealCard.id;
    const view = (await (await get(`/api/landos/deal-cards/${id}/acquisition?view=workspace-v2-overview`)).json()) as any;
    expect(view.acquisition).toBeDefined();
    expect(view.stageLabel).toBeDefined();
    expect(view.nextAction).toBeDefined();
    expect(view.compsValuation).toBeUndefined();
    expect(view.marketContext).toBeUndefined();
    expect(view.canonicalState).toBeUndefined();
  });

  it('seller profile + discovery + stage persist/reload; follow-up is a draft only', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Acq deal', leadType: 'test' });
    const id = ((await created.json()) as any).dealCard.id;

    await post(`/api/landos/deal-cards/${id}/acquisition/profile`, { profile: { name: 'Jane Doe', motivation: 'inherited' } });
    let v = (await (await get(`/api/landos/deal-cards/${id}/acquisition`)).json()) as any;
    expect(v.acquisition.profile.name).toBe('Jane Doe');
    expect(v.nextAction.action).toBe('needs_discovery_call');
    expect(v.playbook.status).toBe('foundational');
    expect(v.trainingReadiness.ingestionImplemented).toBe(false);

    // discovery extraction stores seller-claimed facts as seller-stated
    await post(`/api/landos/deal-cards/${id}/acquisition/discovery`, { notes: 'Inherited, wants to sell within 30 days, 10 acres with road access, brother on the deed.' });
    v = (await (await get(`/api/landos/deal-cards/${id}/acquisition`)).json()) as any;
    expect(v.acquisition.discovery.length).toBe(1);
    expect(v.acquisition.profile.sellerStatedFacts.some((f: string) => /acre|road/i.test(f))).toBe(true);
    expect(v.acquisition.stage).toBe('discovery_complete');

    // follow-up draft — produced but NEVER sent
    const fu = (await (await post(`/api/landos/deal-cards/${id}/acquisition/followup`, { format: 'sms' })).json()) as any;
    expect(fu.draft.sent).toBe(false);
    expect(fu.draft.draft.length).toBeGreaterThan(10);

    // stage update persists
    await post(`/api/landos/deal-cards/${id}/acquisition/stage`, { stage: 'needs_follow_up' });
    v = (await (await get(`/api/landos/deal-cards/${id}/acquisition`)).json()) as any;
    expect(v.acquisition.stage).toBe('needs_follow_up');
  });
});

describe('LandOS routes — post-discovery DD layer', () => {
  it('lead type: a TEST LEAD deal persists and stays out of operating inventory', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Acceptance test lead', leadType: 'test' });
    const dc = ((await created.json()) as any).dealCard;
    expect(dc.lead_type).toBe('test');
    const detail = (await (await get(`/api/landos/deal-cards/${dc.id}`)).json()) as any;
    expect(detail.dealCard.lead_type).toBe('test');
    // Operating lists must not present synthetic TEST LEAD records as real inventory.
    const list = await get('/api/landos/deal-cards');
    const item = ((await list.json()) as any).dealCards.find((d: any) => d.id === dc.id);
    expect(item).toBeUndefined();
  });

  it('dd-providers status: free gov providers dormant by default', async () => {
    const res = await get('/api/landos/dd-providers/status');
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.liveEnabled).toBe(false);
    expect(b.providers.map((p: any) => p.capability).sort()).toEqual(['demographics', 'flood', 'slope', 'wetlands']);
  });

  it('seller-stated facts: add (Seller-stated) + list + summary', async () => {
    const { upsertCardFromDukeRun } = await import('./property-card.js');
    const { linkPropertyToDeal } = await import('./deal-card.js');
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Seller deal' });
    const id = ((await created.json()) as any).dealCard.id;
    const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA', apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v' });
    linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
    const bad = await post(`/api/landos/deal-cards/${id}/seller-facts`, { kind: 'nope', value: 'x' });
    expect(bad.status).toBe(400);
    const add = await post(`/api/landos/deal-cards/${id}/seller-facts`, { kind: 'liens', value: 'maybe a tax lien' });
    expect(add.status).toBe(201);
    const list = await get(`/api/landos/deal-cards/${id}/seller-facts`);
    const lb = (await list.json()) as any;
    expect(lb.facts).toHaveLength(1);
    expect(lb.summary.discoveryCaptured).toBe(true);
    expect(lb.summary.riskFlags.some((f: string) => /Seller-stated/i.test(f))).toBe(true);
  });

  it('county verification: plan (no browsing) + manual mark (agent dormant)', async () => {
    const { upsertCardFromDukeRun } = await import('./property-card.js');
    const { linkPropertyToDeal } = await import('./deal-card.js');
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'County deal' });
    const id = ((await created.json()) as any).dealCard.id;
    const { card } = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA', apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v' });
    linkPropertyToDeal({ dealCardId: id, cardId: card.id, role: 'subject' });
    const plan = await post(`/api/landos/deal-cards/${id}/county-verification/plan`, { task: 'verify_owner' });
    expect(plan.status).toBe(200);
    const pb = (await plan.json()) as any;
    expect(pb.note).toMatch(/dormant/i);
    // exact identifier (APN+county/state) present -> plan allowed (bounded)
    expect(pb.plan.allowed).toBe(true);
    const mark = await post(`/api/landos/deal-cards/${id}/county-verification/mark`, { task: 'verify_owner', status: 'needs_human_or_county_call', note: 'call county' });
    expect(mark.status).toBe(201);
    const listed = await get(`/api/landos/deal-cards/${id}/county-verification`);
    const lb = (await listed.json()) as any;
    expect(lb.records).toHaveLength(1);
    expect(lb.availableTasks).toContain('verify_apn');
  });

  it('underwriting prep is blocked on an unverified deal (no offer computed)', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'UW deal' });
    const id = ((await created.json()) as any).dealCard.id;
    const res = await get(`/api/landos/deal-cards/${id}/underwriting-prep`);
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.underwritingPrep.state).toBe('blocked');
    expect(b.underwritingPrep.minimumProfitRules.length).toBeGreaterThan(0);
  });
});

describe('LandOS routes — visual image serving + capture gating (no Google call)', () => {
  it('serves a stored captured image by card+service; 404 when none; 400 on bad service', async () => {
    const fsm = await import('fs');
    const pathm = await import('path');
    const { upsertCardFromDukeRun, saveCardVisualCapture } = await import('./property-card.js');
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA',
      apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v',
    });
    const dir = pathm.join(process.cwd(), 'store', 'visuals');
    fsm.mkdirSync(dir, { recursive: true });
    const file = pathm.join(dir, `test_${card.id}_maps.png`);
    fsm.writeFileSync(file, Buffer.from([137, 80, 78, 71])); // PNG magic bytes
    // Association-proven asset (verified parcel coordinates) — the route serves
    // ONLY eligibility-passing assets; a bare filename would be refused.
    saveCardVisualCapture(card.id, { maps_static: { storedPath: file, timestamp: 't', association: { targetKind: 'parcel', cardId: card.id, apn: '00830-054-000', sourceCoords: { lat: 31.4983, lng: -83.7721 }, basis: 'verified_parcel_coordinates', captureQuery: '31.4983,-83.7721' } } }, { provider: 'google' });

    const ok = await get(`/api/landos/visual/image?cardId=${card.id}&service=maps_static`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('image/png');

    const noCap = await get(`/api/landos/visual/image?cardId=${card.id}&service=street_view_static`);
    expect(noCap.status).toBe(404);

    const badSvc = await get(`/api/landos/visual/image?cardId=${card.id}&service=evil`);
    expect(badSvc.status).toBe(400);

    fsm.unlinkSync(file);
  });

  it('capture route is gated: 400 when Google is not configured (no call made)', async () => {
    // hermetic test env (LANDOS_DISABLE_DOTENV_FALLBACK) → key not resolvable → gated off.
    const res = await post('/api/landos/property-cards/1/visual-capture', {});
    expect(res.status).toBe(400);
    const b = (await res.json()) as any;
    expect(String(b.error)).toMatch(/not configured/i);
  });

});

describe('LandOS routes - canonical comp-map projection', () => {
  it('is read-only, preserves provider coordinates, and excludes impossible sale dates from sold valuation evidence', async () => {
    const created = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Comp map route fixture' });
    const id = ((await created.json()) as any).dealCard.id as number;
    const add = (over: Record<string, unknown>) => post(`/api/landos/deal-cards/${id}/comps`, {
      sourceLabel: 'Zillow', sourceUrl: 'https://zillow.example/fixture', addressDesc: '101 Route Fixture Rd, Cleveland, GA',
      county: 'White', state: 'GA', price: 60_000, priceKind: 'sale', saleOrListDate: '2026-02-01', acres: 6,
      status: 'verified_sale', lat: 34.597, lng: -83.766, ...over,
    });
    expect((await add({})).status).toBe(201);
    expect((await add({ addressDesc: '102 Route Fixture Rd, Cleveland, GA', sourceUrl: 'https://zillow.example/impossible-date', saleOrListDate: '2026-02-30', lat: 34.598, lng: -83.767 })).status).toBe(201);

    const db = getLandosDb();
    const before = {
      comps: (db.prepare('SELECT COUNT(*) AS count FROM landos_comp WHERE deal_card_id = ?').get(id) as { count: number }).count,
      geocodes: (db.prepare('SELECT COUNT(*) AS count FROM landos_geocode_cache').get() as { count: number }).count,
    };
    const fetchSpy = vi.fn(async () => { throw new Error('comp-map GET must not perform external enrichment'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const response = await get(`/api/landos/deal-cards/${id}/comp-map`);
      expect(response.status).toBe(200);
      const map = ((await response.json()) as any).compMap;
      expect(map.counts.sold).toBe(1);
      expect(map.counts.context).toBe(1);
      expect(map.counts.rejected).toBe(0);
      expect(map.markers.find((marker: any) => marker.address === '101 Route Fixture Rd, Cleveland, GA')).toMatchObject({ lat: 34.597, lng: -83.766, status: 'sold' });
      expect(map.markers.find((marker: any) => marker.address === '102 Route Fixture Rd, Cleveland, GA')).toMatchObject({ status: 'context', why: expect.stringMatching(/missing sale_date evidence/) });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((db.prepare('SELECT COUNT(*) AS count FROM landos_comp WHERE deal_card_id = ?').get(id) as { count: number }).count).toBe(before.comps);
      expect((db.prepare('SELECT COUNT(*) AS count FROM landos_geocode_cache').get() as { count: number }).count).toBe(before.geocodes);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('LandOS routes - current Property Intelligence report compatibility', () => {
  it('downloads Markdown and PDF from a promoted V2 snapshot without a legacy report row or research call', async () => {
    const propertyResponse = await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '100 Current Truth Rd, Fairview, TN 37062',
      city: 'Fairview', county: 'Williamson', state: 'TN', apn: '042-123.00-TEST', owner: 'CURRENT OWNER',
      acres: 10, verified: true, verificationSource: 'Official parcel fixture',
    });
    const property = ((await propertyResponse.json()) as any).card;
    const dealResponse = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title: 'Current report fixture' });
    const deal = ((await dealResponse.json()) as any).dealCard;
    expect(linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' }).error).toBeUndefined();

    const addComp = (index: number, price: number) => post(`/api/landos/deal-cards/${deal.id}/comps`, {
      sourceLabel: 'Other', canonicalSource: 'Recorded sale fixture', sourceUrl: `https://example.test/sale-${index}`,
      addressDesc: `${index} Accepted Sale Rd, Fairview, TN 37062`, county: 'Williamson', state: 'TN',
      price, priceKind: 'sale', saleOrListDate: '2026-02-01', acres: 10, status: 'verified_sale',
      propertyClass: 'vacant_land', classification: 'accepted_closed_sale',
    });
    expect((await addComp(1, 90_000)).status).toBe(201);
    expect((await addComp(2, 100_000)).status).toBe(201);
    expect((await addComp(3, 110_000)).status).toBe(201);

    const runId = `report-compat-${deal.id}`;
    const startedAt = '2026-08-20T13:00:00.000Z';
    const completedAt = '2026-08-20T13:05:00.000Z';
    const snapshot: PropertyIntelligenceSnapshot = {
      snapshotVersion: 5, dealCardId: deal.id, runId, sequence: 1, isPrimary: true, status: 'complete',
      startedAt, completedAt, durationMs: 300_000,
      identity: {
        state: 'confirmed', normalizedAddress: property.active_input_address, county: 'Williamson', state_: 'TN',
        apn: property.apn, apnVariants: [property.apn], owner: property.owner, ownerMailing: null,
        situs: property.active_input_address, acres: 10, acreageBasis: 'assessed', coordinates: null,
        hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed by official parcel fixture.',
      },
      facts: [{
        key: 'market_pulse', label: 'Market Pulse',
        value: 'Persisted area market context. Parcel-level valuation remains separate and is pending accepted closed subject-band evidence.',
        grade: 'likely_indication', source: 'LandOS Market Pulse', sourceUrl: null, retrievedAt: completedAt, note: null,
      }], governmentRecords: [], dueDiligence: [],
      comps: {
        policyExplanation: 'Accepted closed-sale policy.', landPortalUsable: false, landPortalRowsSeen: 0,
        caps: { zillow: 5, redfin: 5 }, sold: [], active: [], landHomeOnly: [], rejected: [],
        duplicatesMerged: 0, totalCollected: 3, summaryLine: 'Three accepted closed sales retained.',
      },
      valuation: {
        priceable: true, range: { low: 1, high: 2 }, pricePerAcreRange: { low: 0.1, high: 0.2 },
        likelyRetail: { low: 1, high: 2 }, dispositionRange: { low: 1, high: 2 },
        basis: 'Deliberately stale snapshot value.', adjustments: [], confidence: 'low',
        uncertainty: [], materialGaps: [], notPriceableReason: null, nextActionToPrice: null, workingValue: 2,
      },
      strategies: [], recommendation: { preferredStrategy: null, why: '', whatWouldChangeIt: [], posture: 'undetermined', postureWhy: '' },
      evidence: [], specialists: [], headline: { keyOpportunity: '', topRisks: [], confidence: 'high', confidenceWhy: 'Current persisted snapshot.' },
      blockers: [], missingInformation: [], nextActions: [],
    };
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId, dealCardId: deal.id, trigger: 'operator', startedAt, specialists: initialSpecialistRecords() });
    store.completeRun({ runId, dealCardId: deal.id, status: 'complete', completedAt, snapshot });

    const db = getLandosDb();
    expect((db.prepare('SELECT COUNT(*) AS count FROM landos_deal_card_report WHERE deal_card_id = ?').get(deal.id) as { count: number }).count).toBe(0);
    const fetchSpy = vi.fn(async () => { throw new Error('report download must not start research'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const markdownResponse = await get(`/api/landos/deal-cards/${deal.id}/report/download?format=md`);
      const markdown = await markdownResponse.text();
      expect(markdownResponse.status, markdown).toBe(200);
      expect(markdownResponse.headers.get('content-type')).toContain('text/markdown');
      expect(markdown).toContain('Validated unique: 3 sold');
      expect(markdown).toContain('Accepted valuation set: 3 closed sales');
      expect(markdown).toContain('Supported fair market value: $100,000');
      expect(markdown).not.toContain('Deliberately stale snapshot value');
      expect(markdown).not.toContain('pending accepted closed subject-band evidence');

      const pdfResponse = await get(`/api/landos/deal-cards/${deal.id}/report/download?format=pdf`);
      expect(pdfResponse.status).toBe(200);
      expect(pdfResponse.headers.get('content-type')).toContain('application/pdf');
      expect(Buffer.from(await pdfResponse.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((db.prepare('SELECT COUNT(*) AS count FROM landos_deal_card_report WHERE deal_card_id = ?').get(deal.id) as { count: number }).count).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
