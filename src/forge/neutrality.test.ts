// Tests for the Forge neutrality scanner.
//
// Focus: prove the scanner catches negative self-framing and domain leakage,
// leaves legitimate technical caveats alone, and that Forge's generated output
// and the universal department-agent standard doc stay neutral. The doc scan is
// a regression guard so a future edit cannot quietly reintroduce a
// business-specific example or "Forge is not X" framing.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { scanForNeutralityIssues, isNeutral } from './neutrality.js';
import { buildAgentProfile, generateAgentBuildPacket } from './agent-profile.js';

describe('scanForNeutralityIssues — flags issues', () => {
  it('flags Forge defined by negation', () => {
    const issues = scanForNeutralityIssues('Forge is not a chatbot.');
    expect(issues.some((i) => i.kind === 'negative_framing')).toBe(true);
  });

  it('flags "not just a persona/prompt" framing', () => {
    const issues = scanForNeutralityIssues('A profile is not just a persona prompt.');
    expect(issues.some((i) => i.kind === 'negative_framing')).toBe(true);
  });

  it('flags business/industry-specific terms', () => {
    expect(scanForNeutralityIssues('build a parcel report').some((i) => i.kind === 'domain_specific')).toBe(true);
    expect(scanForNeutralityIssues('handle the patient intake').some((i) => i.kind === 'domain_specific')).toBe(true);
  });

  it('flags legacy project / personal names', () => {
    expect(scanForNeutralityIssues('wire this into LandOS').some((i) => i.kind === 'named_entity')).toBe(true);
  });
});

describe('scanForNeutralityIssues — leaves neutral text alone', () => {
  it('allows positive universal wording', () => {
    expect(isNeutral('Forge builds department agents for any host operating system.')).toBe(true);
  });

  it('does not flag a precise technical caveat', () => {
    // "not a security boundary" is a legitimate caveat, not negative framing.
    expect(isNeutral('The lane gate is a triage aid, not a security boundary.')).toBe(true);
  });

  it('does not flag ordinary software words', () => {
    expect(isNeutral('Add a date helper to src/utils with a unit test.')).toBe(true);
  });
});

describe('generated Forge output stays neutral', () => {
  it('a default agent build packet is neutral', () => {
    const packet = generateAgentBuildPacket(
      buildAgentProfile({ rawRequest: 'an agent that organizes status updates', createdAt: 'x' }),
    );
    expect(scanForNeutralityIssues(packet)).toEqual([]);
  });
});

describe('the universal department-agent standard doc stays neutral', () => {
  it('contains no negative framing or domain leakage', () => {
    const docPath = fileURLToPath(
      new URL(
        '../../landos-agents/forge/docs/Forge_Universal_Department_Agent_Profile_Standard.md',
        import.meta.url,
      ),
    );
    const text = fs.readFileSync(docPath, 'utf-8');
    expect(scanForNeutralityIssues(text)).toEqual([]);
  });
});
