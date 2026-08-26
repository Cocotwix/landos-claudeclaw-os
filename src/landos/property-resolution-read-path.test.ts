import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// GET /api/landos/deal-cards/:id/property-resolution answers one question:
// "what is the persisted resolution state for this deal?" It must stay a pure
// SELECT. The moment it acquires live resolution, a provider call, browser
// automation or a write, every workspace load pays for it and an unrelated
// dependency failure can erase a resolution that is on the record.
//
// The active resolution capability is unchanged and still reachable through
// its explicit POST .../property-resolution/run path.

const ROUTES_SRC = fs.readFileSync(fileURLToPath(new URL('./routes.ts', import.meta.url)), 'utf-8');

/** The GET handler body, from its route registration to the POST that follows. */
function propertyResolutionGetBody(): string {
  const start = ROUTES_SRC.indexOf("app.get('/api/landos/deal-cards/:id/property-resolution'");
  expect(start).toBeGreaterThan(-1);
  const end = ROUTES_SRC.indexOf("app.post('/api/landos/deal-cards/:id/property-resolution/run'", start);
  expect(end).toBeGreaterThan(start);
  return ROUTES_SRC.slice(start, end);
}

describe('property resolution read path', () => {
  it('reads persisted capability state and nothing else', () => {
    const body = propertyResolutionGetBody();
    // The whole answer: the deal, its canonical subject card, and the latest
    // persisted property-resolution invocation for that pair.
    expect(body).toContain('getDealCard(id)');
    expect(body).toContain('subjectCardId(deal)');
    expect(body).toContain('latestForProperty(cardId, id)');
    // A synchronous handler cannot await live work.
    expect(body).not.toMatch(/\bawait\b/);
    expect(body).not.toMatch(/\basync\b/);
  });

  it('never performs live resolution, research, model, or browser work on read', () => {
    const body = propertyResolutionGetBody();
    for (const forbidden of [
      'propertyIntelligenceCollectors',
      'parcel_identity',
      'adoptAutomationControlPage',
      'browserSession',
      'runResearch',
      'runIntelligenceStack',
      'createIntelligenceExecutor',
      'invokeCapability',
      'acquireExecutionLock',
      'landPortal',
      'fetch(',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('never writes on read', () => {
    const body = propertyResolutionGetBody();
    for (const forbidden of ['writeDerivedSnapshot', 'appendDerivedEvidence', 'INSERT', 'UPDATE', 'DELETE', 'reconcile']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('keeps the response contract the workspace reads', () => {
    const body = propertyResolutionGetBody();
    expect(body).toContain('capability: PROPERTY_RESOLUTION_CAPABILITY_ID');
    expect(body).toContain('propertyCardId: cardId');
    expect(body).toContain('result:');
  });

  it('fails honestly rather than inventing a resolution it cannot read', () => {
    const body = propertyResolutionGetBody();
    // A missing deal and a missing canonical subject are reported as such; the
    // handler never substitutes a fabricated RESOLVED or a silent NOT RUN.
    expect(body).toContain("'deal card not found'");
    expect(body).toContain("'canonical subject Property Card is missing'");
    expect(body).not.toContain("'RESOLVED'");
    expect(body).not.toContain('catch');
  });

  it('leaves the active resolution capability on its explicit run path', () => {
    // Removing expensive work from the GET must not remove the operator's
    // ability to re-resolve deliberately.
    expect(ROUTES_SRC).toContain("app.post('/api/landos/deal-cards/:id/property-resolution/run'");
  });
});
