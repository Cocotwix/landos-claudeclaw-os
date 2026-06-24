// Org/Agents dashboard representation: source-scan of the UI wiring + a live
// check that /api/landos/org serves the Executive + 14-agent roster + workflow.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Hono } from 'hono';
import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
const ORG = read('../../web/src/components/landos/OrgRoster.tsx');
const PAGE = read('../../web/src/pages/LandOS.tsx');

describe('Org/Agents UI wiring', () => {
  it('LandOS page adds an Org/Agents tab and renders OrgRoster', () => {
    expect(PAGE).toMatch(/import \{ OrgRoster \} from '@\/components\/landos\/OrgRoster'/);
    expect(PAGE).toMatch(/label="Org \/ Agents"/);
    expect(PAGE).toMatch(/view === 'org' && <OrgRoster/);
  });

  it('OrgRoster fetches the org endpoint and shows Executive + workflow', () => {
    expect(ORG).toMatch(/apiGet<[^>]*>\('\/api\/landos\/org'\)/);
    expect(ORG).toMatch(/Executive Agent/);
    expect(ORG).toMatch(/Discovery Workflow/);
  });

  it('uses no coordinate/proximity parcel-identity language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|centroid/i.test(ORG)).toBe(false);
  });
});

describe('GET /api/landos/org', () => {
  let app: Hono;
  beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
  beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

  it('serves the executive, the 14-agent roster, groups, and the workflow', async () => {
    const res = await app.request('/api/landos/org?token=' + TOKEN);
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.executive.key).toBe('exec_bot');
    expect(b.roster).toHaveLength(14);
    expect(b.groups.acquisitions).toContain('dd_bot');
    expect(b.workflow.primary).toEqual(['Lead', 'DD Report', 'Discovery Call', 'Underwriting', 'Offer']);
    expect(b.workflow.alternate).toContain('Deeper DD');
    // dashboard-safe: no secret/token values in the payload
    expect(JSON.stringify(b)).not.toMatch(/Bearer |APIFY_TOKEN|DASHBOARD_TOKEN/);
  });
});
