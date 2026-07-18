import { describe, expect, it } from 'vitest';
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
const DENY_MODES = ['unknown', '', 'test', 'build', 'mock', 'smoke', 'seed', 'debug', 'production', 'live', LIVE_PROPERTY_WORKFLOW_MODE];

describe('paid LandPortal actions are absolutely prohibited', () => {
  it('recognizes the legacy paid tools without allowing them', () => {
    expect(PAID_COMP_TOOLS).toEqual(PAID);
    expect(isPaidComp(PAID[0])).toBe(true);
    expect(isLivePropertyWorkflow(LIVE_PROPERTY_WORKFLOW_MODE)).toBe(false);
  });

  for (const tool of PAID) {
    for (const mode of DENY_MODES) {
      it(`denies ${tool} in mode "${mode || '(empty)'}"`, () => {
        const decision = paidCompDecision(tool, mode);
        expect(decision.allowed).toBe(false);
        expect(decision.error?.blocked).toBe(true);
        expect(decision.error?.message).toMatch(/prohibited in every runtime mode/i);
        expect(decision.error?.message).toMatch(/No comp credit was spent/i);
      });
    }
  }
});

describe('LandPortal MCP tombstone', () => {
  it('contains no network client or tool handler', () => {
    const idx = fileURLToPath(new URL('../../landos-agents/duke-due-diligence/mcp-landportal/index.js', import.meta.url));
    const src = fs.readFileSync(idx, 'utf-8');
    expect(src).toMatch(/disabled: authenticated browser workflow only/i);
    expect(src).not.toMatch(/fetch\(|tools\/call|wp-json|api\.landportal/i);
  });
});
