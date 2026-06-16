// Tests for the LandPortal MCP paid-comp runtime guard. These import the pure
// guard module directly (no MCP server start, no network) and statically verify
// that the MCP handlers enforce the guard BEFORE any /reports network call.
// No test ever calls a real LandPortal endpoint.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  paidCompDecision,
  isLivePropertyWorkflow,
  isPaidComp,
  PAID_COMP_TOOLS,
  LIVE_PROPERTY_WORKFLOW_MODE,
} from '../../landos-agents/duke-due-diligence/mcp-landportal/comp-guard.js';

const PAID = ['lp_comp_report_create', 'lp_comp_report_get'];
const DENY_MODES = ['unknown', '', 'test', 'build', 'mock', 'smoke', 'seed', 'debug', 'production', 'live'];

describe('paid comp tool list', () => {
  it('is exactly the two LandPortal comp endpoints', () => {
    expect(PAID_COMP_TOOLS).toEqual(['lp_comp_report_create', 'lp_comp_report_get']);
    expect(isPaidComp('lp_comp_report_create')).toBe(true);
    expect(isPaidComp('lp_resolve_property')).toBe(false);
  });
});

describe('paid comp guard — default deny', () => {
  for (const tool of PAID) {
    for (const mode of DENY_MODES) {
      it(`denies ${tool} in mode "${mode || '(empty)'}"`, () => {
        const d = paidCompDecision(tool, mode);
        expect(d.allowed).toBe(false);
        expect(d.error?.blocked).toBe(true);
        expect(d.error?.message).toMatch(/live LandOS property workflow/i);
        expect(d.error?.message).toMatch(/No comp credit was spent/i);
      });
    }
  }

  it('only allows paid comp tools in live_property_workflow mode', () => {
    expect(isLivePropertyWorkflow(LIVE_PROPERTY_WORKFLOW_MODE)).toBe(true);
    for (const tool of PAID) {
      const d = paidCompDecision(tool, 'live_property_workflow');
      expect(d.allowed).toBe(true);
      expect(d.error).toBeUndefined(); // decision only — no LandPortal call here
    }
  });

  it('never blocks non-paid tools regardless of mode', () => {
    expect(paidCompDecision('lp_resolve_property', 'unknown').allowed).toBe(true);
    expect(paidCompDecision('lp_property_data', 'test').allowed).toBe(true);
  });
});

describe('MCP handlers enforce the guard before any network call', () => {
  it('lp_comp_report_create and lp_comp_report_get gate before lpFetch("/reports")', () => {
    const idx = fileURLToPath(new URL('../../landos-agents/duke-due-diligence/mcp-landportal/index.js', import.meta.url));
    const src = fs.readFileSync(idx, 'utf-8');
    for (const tool of PAID) {
      const handlerAt = src.indexOf(`name === '${tool}'`);
      expect(handlerAt, `${tool} handler present`).toBeGreaterThan(-1);
      const guardAt = src.indexOf('paidCompDecision', handlerAt);
      const fetchAt = src.indexOf("lpFetch('/reports'", handlerAt) >= 0
        ? src.indexOf("lpFetch('/reports'", handlerAt)
        : src.indexOf('lpFetch(`/reports', handlerAt);
      expect(guardAt, `${tool} consults the guard`).toBeGreaterThan(-1);
      expect(guardAt, `${tool} guard runs before the network call`).toBeLessThan(fetchAt);
    }
  });
});
