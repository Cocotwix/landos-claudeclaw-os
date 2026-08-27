// Smart Intake supervisor + operator LandPortal entry-point handoff.
//
// These prove the two claims the feature rests on: an operator's own LandPortal
// link survives intake and is usable as a direct entry point, and the model that
// talks back to the operator can explain a real failure without being able to
// invent facts or workflows.

import { describe, it, expect } from 'vitest';

import {
  operatorLandPortalEntryUrl,
  isOperatorEntryOnlyLandPortalUrl,
  isVerifiedLandPortalSubjectUrl,
} from './landportal-operating-rules.js';
import {
  buildSupervisorEvidence,
  parseSupervisorPlan,
  supervisorPrompt,
  runSmartIntakeSupervisor,
  SUPERVISOR_STEPS,
} from './smart-intake-supervisor.js';
import { buildSmartIntake } from './smart-intake.js';

const SAVED_MAP_URL = 'https://landportal.com/?map=c40db262-40b0-4de4-b5a9-b1d4c3b1ad00';

describe('operator LandPortal entry URL', () => {
  it('accepts a saved-map link as an entry point but never as parcel identity', () => {
    expect(operatorLandPortalEntryUrl(SAVED_MAP_URL)).toBe(SAVED_MAP_URL);
    // The whole point: openable, but it proves nothing about which parcel it is.
    expect(isVerifiedLandPortalSubjectUrl(SAVED_MAP_URL)).toBe(false);
    expect(isOperatorEntryOnlyLandPortalUrl(SAVED_MAP_URL)).toBe(true);
  });

  it('refuses links that are not LandPortal, not https, or a known non-parcel surface', () => {
    expect(operatorLandPortalEntryUrl('http://landportal.com/?map=c40db262-40b0')).toBeNull();
    expect(operatorLandPortalEntryUrl('https://evil.example.com/?map=c40db262-40b0')).toBeNull();
    expect(operatorLandPortalEntryUrl('https://landportal.com/login?map=c40db262-40b0')).toBeNull();
    expect(operatorLandPortalEntryUrl('https://landportal.com/')).toBeNull();
    expect(operatorLandPortalEntryUrl(null)).toBeNull();
  });
});

describe('intake carries the operator LandPortal link', () => {
  it('parses a supplied link out of the operator paste as a strong identifier', () => {
    const si = buildSmartIntake(`Owner: HILL EUGENE W\n19554 NW 137TH LN, LAKE BUTLER, FL\n${SAVED_MAP_URL}`);
    expect(si.fields.lpUrl).toBe(SAVED_MAP_URL);
    // A direct link is the strongest pre-resolution signal the scorer recognizes.
    expect(si.confidence.percent).toBeGreaterThanOrEqual(80);
    expect(si.confidence.reasons.join(' ')).toMatch(/LandPortal/i);
  });
});

describe('supervisor plan parsing', () => {
  it('keeps only real capability steps and reports invented ones', () => {
    const plan = parseSupervisorPlan(JSON.stringify({
      explanation: 'Multiple adjoining parcels matched the owner.',
      needFromOperator: ['The APN of the parcel being sold'],
      steps: ['property-resolution', 'summon-the-parcel-oracle', 'landportal-research'],
      reasoning: 'Resolution never established a subject, so nothing downstream can run.',
    }));
    expect(plan.steps).toEqual(['property-resolution', 'landportal-research']);
    expect(plan.rejectedSteps).toEqual(['summon-the-parcel-oracle']);
    expect(plan.explanation).toMatch(/adjoining parcels/);
  });

  it('survives a fenced or malformed model reply without inventing a plan', () => {
    const fenced = parseSupervisorPlan('```json\n{"explanation":"ok","steps":["comps-valuation"]}\n```');
    expect(fenced.steps).toEqual(['comps-valuation']);

    const junk = parseSupervisorPlan('the model rambled and produced no json');
    expect(junk.steps).toEqual([]);
    expect(junk.explanation).toBeTruthy();
  });

  it('only ever exposes steps that are registered capabilities', () => {
    for (const step of SUPERVISOR_STEPS) {
      expect(parseSupervisorPlan(JSON.stringify({ steps: [step] })).steps).toEqual([step]);
    }
  });
});

describe('supervisor evidence and prompt', () => {
  const evidence = () => buildSupervisorEvidence(90, 80, `Use the link I gave you: ${SAVED_MAP_URL}`, {
    store: {
      latestForProperty: () => ({
        status: 'UNRESOLVED',
        warnings: ['Owner search returned three adjoining parcels.'],
        missingInformation: ['A parcel identifier from an official parcel source'],
        facts: {
          identityState: 'unresolved',
          identityBasis: 'A subject was supplied, but no exact parcel-level source agreed on its APN and jurisdiction.',
          canonicalIdentity: {},
          candidates: [{ apn: '00083-A-03400', owner: 'HILL EUGENE W' }, { apn: '00083-A-03300', owner: 'HILL EUGENE W' }],
          lanes: [{ id: 'realie_landportal', status: 'no_match' }],
        },
      }),
    } as never,
    readCard: (() => ({ lp_url: SAVED_MAP_URL })) as never,
    readThread: () => [],
  });

  it('reads the real persisted failure state rather than recomputing it', () => {
    const e = evidence();
    expect(e.resolution?.status).toBe('UNRESOLVED');
    expect(e.resolution?.candidates).toHaveLength(2);
    expect(e.resolution?.missingInformation[0]).toMatch(/parcel identifier/i);
    expect(e.landPortal.openable).toBe(true);
    expect(e.landPortal.carriesParcelIdentity).toBe(false);
  });

  it('gives the model the real failure data and forbids asserting facts', () => {
    const prompt = supervisorPrompt(evidence(), 'They own three adjoining parcels.');
    expect(prompt).toContain('00083-A-03400');
    expect(prompt).toContain('no exact parcel-level source agreed');
    expect(prompt).toMatch(/do NOT establish property facts/i);
    expect(prompt).toMatch(/GUIDANCE, not evidence/i);
    // The allowed step list is stated explicitly so the model cannot free-form.
    for (const step of SUPERVISOR_STEPS) expect(prompt).toContain(step);
  });
});

describe('supervisor turn', () => {
  it('stores the operator turn, explains the failure, and plans only needed steps', async () => {
    const stored: Array<{ role: string; text: string }> = [];
    const result = await runSmartIntakeSupervisor({
      dealCardId: 90,
      propertyCardId: null,
      operatorText: 'They own three adjoining parcels. The home is on the middle one. Use the LandPortal link.',
      model: async () => JSON.stringify({
        explanation: 'I could not tell which of the adjoining parcels is the subject.',
        needFromOperator: ['The APN of the vacant parcel'],
        steps: ['property-resolution'],
        reasoning: 'Only resolution needs to rerun; nothing downstream ever ran.',
      }),
      appendGuidance: ((_id: number, role: string, text: string) => {
        stored.push({ role, text });
        return { id: stored.length, dealCardId: 90, role, text, createdAt: 0 };
      }) as never,
    });

    expect(result.plan.steps).toEqual(['property-resolution']);
    expect(result.plan.explanation).toMatch(/adjoining parcels/);
    // Operator words persisted first, then the reply, on one thread.
    expect(stored[0].role).toBe('operator');
    expect(stored[0].text).toMatch(/three adjoining parcels/);
    expect(stored[1].role).toBe('deal_brain');
  });

  it('still tells the operator something true when the model is unavailable', async () => {
    const result = await runSmartIntakeSupervisor({
      dealCardId: 90,
      propertyCardId: null,
      operatorText: 'what happened?',
      model: async () => { throw new Error('LLM_SPAWN_ENABLED is off'); },
      appendGuidance: ((_id: number, role: string, text: string) =>
        ({ id: 1, dealCardId: 90, role, text, createdAt: 0 })) as never,
    });
    // No fabricated plan, and no bare "FAILED".
    expect(result.plan.steps).toEqual([]);
    expect(result.plan.explanation.length).toBeGreaterThan(20);
  });
});
