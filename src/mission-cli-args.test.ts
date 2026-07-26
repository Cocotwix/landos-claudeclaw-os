/**
 * Mission CLI argument-parsing regression suite.
 *
 * The defect being pinned: the old parser stripped known flag pairs and treated
 * everything left over as the positional prompt. `--body "text"` was neither
 * recognised nor stripped, so the literal string `--body` became the task's
 * prompt — the misspelling was accepted and the real instruction was dropped.
 *
 * These tests run against the pure parser, so they prove the rejection happens
 * before anything can be written. mission-cli.test.ts additionally proves the
 * process-level behaviour (exit code, and that no task is created).
 */

import { describe, it, expect } from 'vitest';

import { parseMissionArgs, USAGE, type MissionArgs } from './mission-cli-args.js';

function ok(argv: string[]): MissionArgs {
  const result = parseMissionArgs(argv);
  if (!result.ok) throw new Error(`expected parse to succeed, got:\n${result.failure.errors.join('\n')}`);
  return result.args;
}

function errors(argv: string[]): string {
  const result = parseMissionArgs(argv);
  if (result.ok) throw new Error(`expected parse to fail for: ${argv.join(' ')}`);
  expect(result.failure.exitCode).not.toBe(0);
  return result.failure.errors.join('\n');
}

describe('valid invocations still work', () => {
  it('parses a full create', () => {
    const args = ok(['create', '--agent', 'research', '--title', 'Label', '--priority', '10', 'Full prompt text']);
    expect(args.command).toBe('create');
    expect(args.agent).toBe('research');
    expect(args.title).toBe('Label');
    expect(args.priority).toBe(10);
    expect(args.positionals).toEqual(['Full prompt text']);
  });

  it('parses a create with only a prompt', () => {
    const args = ok(['create', 'just the prompt']);
    expect(args.agent).toBeNull();
    expect(args.title).toBe('');
    expect(args.priority).toBe(5);
    expect(args.positionals).toEqual(['just the prompt']);
  });

  it('parses list with and without a status filter', () => {
    expect(ok(['list']).status).toBeUndefined();
    expect(ok(['list', '--status', 'queued']).status).toBe('queued');
  });

  it('parses result and cancel with an id', () => {
    expect(ok(['result', 'abc123']).positionals).toEqual(['abc123']);
    expect(ok(['cancel', 'abc123']).positionals).toEqual(['abc123']);
  });

  it('accepts flags in any order relative to the prompt', () => {
    const args = ok(['create', 'the prompt', '--agent', 'ops']);
    expect(args.agent).toBe('ops');
    expect(args.positionals).toEqual(['the prompt']);
  });

  it('accepts a negative priority', () => {
    expect(ok(['create', '--priority', '-3', 'p']).priority).toBe(-3);
  });

  it('treats everything after `--` as positional, so a dash-leading prompt is possible', () => {
    const args = ok(['create', '--agent', 'ops', '--', '--this is really the prompt']);
    expect(args.positionals).toEqual(['--this is really the prompt']);
    expect(args.agent).toBe('ops');
  });

  it('supports --help on any command', () => {
    expect(ok(['--help']).command).toBe('help');
    expect(ok(['create', '--help']).command).toBe('help');
    expect(ok(['-h']).command).toBe('help');
  });
});

describe('unknown long flags are rejected', () => {
  it('rejects the exact regression case: --body swallowed as the prompt', () => {
    const out = errors(['create', '--agent', 'main', '--title', 'X', '--body', 'oops', 'real prompt']);
    expect(out).toContain('Unknown flag: --body');
    expect(out).toContain('Known flags:');
    expect(out).toContain('No mission task was created or modified.');
  });

  it('names every unknown flag, not just the first', () => {
    const out = errors(['create', '--body', 'x', '--payload', 'y', 'p']);
    expect(out).toContain('--body');
    expect(out).toContain('--payload');
  });

  it('rejects an unknown flag on list, result and cancel too', () => {
    expect(errors(['list', '--bogus'])).toContain('--bogus');
    expect(errors(['result', 'abc', '--bogus'])).toContain('--bogus');
    expect(errors(['cancel', 'abc', '--bogus'])).toContain('--bogus');
  });
});

describe('unknown short flags are rejected', () => {
  it('rejects a bare short flag that would otherwise become the prompt', () => {
    const out = errors(['create', '-a', 'research', 'the prompt']);
    expect(out).toContain('-a');
    expect(out).toContain('Known flags:');
  });

  it('rejects a clustered short flag', () => {
    expect(errors(['create', '-vv', 'p'])).toContain('-vv');
  });
});

describe('misspelled supported flags are rejected with a suggestion', () => {
  it('suggests --agent for --agnt', () => {
    const out = errors(['create', '--agnt', 'research', 'p']);
    expect(out).toContain('--agnt');
    expect(out).toContain('Did you mean --agent?');
  });

  it('suggests --priority for --priorty', () => {
    expect(errors(['create', '--priorty', '3', 'p'])).toContain('Did you mean --priority?');
  });

  it('suggests --status for --statuses', () => {
    expect(errors(['list', '--statuses', 'queued'])).toContain('Did you mean --status?');
  });
});

describe('unsupported values are rejected', () => {
  it('rejects an unknown --status value instead of silently listing nothing', () => {
    const out = errors(['list', '--status', 'quued']);
    expect(out).toContain('Unsupported --status value: "quued"');
    expect(out).toContain('Known statuses:');
  });

  it('rejects a non-integer --priority instead of coercing it to NaN', () => {
    expect(errors(['create', '--priority', 'high', 'p'])).toContain('--priority must be an integer');
  });

  it('rejects a value flag with no value', () => {
    expect(errors(['create', '--agent'])).toContain('Flag --agent requires a value.');
  });

  it('rejects a value flag immediately followed by another flag', () => {
    expect(errors(['create', '--agent', '--title', 'X', 'p'])).toContain('Flag --agent requires a value.');
  });

  it('rejects a repeated flag rather than silently taking one of them', () => {
    expect(errors(['create', '--agent', 'a', '--agent', 'b', 'p'])).toContain('given more than once');
  });
});

describe('positional argument mistakes are rejected', () => {
  it('rejects an unquoted multi-word prompt that split into several positionals', () => {
    const out = errors(['create', '--agent', 'main', 'these', 'are', 'four', 'words']);
    expect(out).toContain('at most 1 positional argument');
    expect(out).toContain('Quote the whole prompt as a single argument.');
  });

  it('rejects a positional on list, which takes none', () => {
    expect(errors(['list', 'queued'])).toContain('takes no positional arguments');
  });

  it('rejects two ids on result', () => {
    expect(errors(['result', 'abc', 'def'])).toContain('at most 1 positional argument');
  });
});

describe('command-level mistakes are rejected', () => {
  it('rejects an unknown command', () => {
    const out = errors(['creat', '--agent', 'main', 'p']);
    expect(out).toContain('Unknown command: "creat"');
    expect(out).toContain('Commands:');
  });

  it('rejects a flag used where the command belongs', () => {
    expect(errors(['--agent', 'main', 'create', 'p'])).toContain('Expected a command, got the flag "--agent"');
  });

  it('rejects an empty command line', () => {
    expect(errors([])).toContain('No command given.');
  });
});

describe('every failure prints usage guidance', () => {
  const badInvocations = [
    ['create', '--body', 'x', 'p'],
    ['create', '-a', 'x', 'p'],
    ['list', '--status', 'nope'],
    ['create', '--priority', 'x', 'p'],
    ['creat'],
    [],
  ];

  for (const argv of badInvocations) {
    it(`includes usage for: ${argv.join(' ') || '(empty)'}`, () => {
      const out = errors(argv);
      expect(out).toContain(USAGE.split('\n')[0]);
      expect(out).toContain('mission-cli create --agent');
    });
  }
});
