import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPPORTUNITY_PIPELINE_STAGES } from './opportunity.js';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/pages/PropertyBoard.tsx', import.meta.url)), 'utf8');

describe('Acquisitions opportunity board UI contract', () => {
  it('loads the canonical opportunity board and opens its legacy workspace alias', () => {
    expect(SRC).toMatch(/\/api\/landos\/board/);
    expect(SRC).toMatch(/card\.dealCardId/);
    expect(SRC).toMatch(/Open Lead Workspace/);
  });

  it('renders only owner-comprehensible business stages', () => {
    for (const stage of OPPORTUNITY_PIPELINE_STAGES) expect(SRC).toContain(`${stage}:`);
    expect(SRC).toContain('Ready for Discovery Call');
    expect(SRC).not.toContain('needs_parcel_verification:');
    expect(SRC).not.toContain('needs_seller_discovery:');
  });

  it('shows research as card context and possible duplicates as review warnings', () => {
    expect(SRC).toMatch(/Research: \{card\.researchStatus/);
    expect(SRC).toMatch(/duplicateCandidates/);
    expect(SRC).toContain('Distinct parcels remain separate');
  });

  it('moves the same opportunity through a durable business-stage route', () => {
    expect(SRC).toMatch(/\/api\/landos\/opportunities\/\$\{id\}\/pipeline-stage/);
    expect(SRC).toMatch(/\{ stage \}/);
    expect(SRC).toContain('Move business stage');
  });

  it('visibly distinguishes the same opportunity after Lead-to-Deal pursuit', () => {
    expect(SRC).toMatch(/card\.lifecycle === 'deal'/);
    expect(SRC).toContain('Deal — pursuing');
  });
});
