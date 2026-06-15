import { describe, it, expect } from 'vitest';

import {
  generateBuildInterview,
  buildCapabilitySpec,
  generateBuildPacket,
} from './build-interview.js';
import { scanForNeutralityIssues } from './neutrality.js';

describe('generateBuildInterview', () => {
  it('covers outcome, capabilities, inputs, safety, tools, and acceptance', () => {
    const iv = generateBuildInterview({ goal: 'a tool that drafts status updates' });
    const headings = iv.sections.map((s) => s.heading);
    expect(headings).toEqual(
      expect.arrayContaining(['Outcome', 'Capabilities', 'Inputs & data', 'Safety & authority', 'Tools & integration', 'Output & acceptance']),
    );
    expect(iv.intro).toContain('Goal:');
  });
});

describe('buildCapabilitySpec', () => {
  it('fills safe defaults for unspecified fields', () => {
    const spec = buildCapabilitySpec({ goal: 'build X' });
    expect(spec.goal).toBe('build X');
    expect(spec.safetyBoundaries.join(' ')).toContain('secrets');
    expect(spec.outputFormat.length).toBeGreaterThan(0);
    expect(spec.capabilities.length).toBeGreaterThan(0);
  });

  it('honors supplied fields', () => {
    const spec = buildCapabilitySpec({ goal: 'g', capabilities: ['cap1', 'cap2'], toolRequirements: ['Read'] });
    expect(spec.capabilities).toEqual(['cap1', 'cap2']);
    expect(spec.toolRequirements).toEqual(['Read']);
  });
});

describe('generateBuildPacket', () => {
  it('renders every required section', () => {
    const packet = generateBuildPacket({ goal: 'a build that organizes leads' });
    const md = packet.markdown;
    expect(md).toContain('# Forge Build Packet');
    expect(md).toContain('## Build interview');
    expect(md).toContain('## Assumption summary');
    expect(md).toContain('## Capability spec');
    expect(md).toContain('## Safety boundaries');
    expect(md).toContain('## Tool / source requirements');
    expect(md).toContain('## Dashboard behavior');
    expect(md).toContain('## Data / output format');
    expect(md).toContain('## Tests / acceptance criteria');
    expect(md).toContain('## Implementation sprint packet');
    expect(md).toContain('## Codex review checklist');
  });

  it('stays universal and industry-neutral', () => {
    const packet = generateBuildPacket({ goal: 'a generic build goal', capabilities: ['do a thing'] });
    expect(scanForNeutralityIssues(packet.markdown)).toEqual([]);
  });

  it('is deterministic', () => {
    const a = generateBuildPacket({ goal: 'same' }).markdown;
    const b = generateBuildPacket({ goal: 'same' }).markdown;
    expect(a).toBe(b);
  });
});
