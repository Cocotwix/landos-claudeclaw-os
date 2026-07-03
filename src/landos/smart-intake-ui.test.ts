import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/SmartIntake.tsx', import.meta.url)), 'utf-8');

describe('SmartIntake UI contract', () => {
  it('submits raw typed input only and has no suggestion selection path', () => {
    expect(SRC).toMatch(/onInput\(\(e\.target as HTMLTextAreaElement\)\.value\)/);
    expect(SRC).not.toMatch(/selectedSuggestion/);
    expect(SRC).not.toMatch(/onSelectSuggestion/);
    expect(SRC).not.toMatch(/onMouseDown/);
  });

  it('does not auto-select a suggestion on Enter', () => {
    expect(SRC).not.toMatch(/ArrowDown/);
    expect(SRC).not.toMatch(/ArrowUp/);
    expect(SRC).toMatch(/if \(e\.key === 'Enter' && !e\.shiftKey\)/);
    expect(SRC).toMatch(/onSubmit\(\)/);
  });

  it('shows suggestions as passive helper hints only', () => {
    expect(SRC).toMatch(/Helper hints only/);
    expect(SRC).not.toMatch(/cursor-pointer/);
  });
});
