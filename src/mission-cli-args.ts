/**
 * Argument parsing for the LandOS mission CLI.
 *
 * Extracted from mission-cli.ts so it can be tested exhaustively without
 * spawning a process, and — more importantly — so parsing happens BEFORE the
 * database is opened. A rejected command line must never create, mutate or
 * execute anything.
 *
 * WHY THIS IS STRICT: the old parser located known flags with
 * `process.argv.indexOf('--agent')`, stripped those pairs, and treated whatever
 * remained as the positional prompt. An unrecognised flag was neither matched
 * nor stripped, so `mission-cli create --agent main --body "text" "real prompt"`
 * silently produced a task whose prompt was the literal string `--body`. The
 * misspelling was accepted, the real prompt was dropped, and the agent ran the
 * wrong instruction. Unknown options now fail fast instead.
 *
 * The parsing style (hand-rolled over argv) is unchanged; only the validation
 * is new. No CLI framework was introduced.
 */

export type MissionCommand = 'create' | 'list' | 'result' | 'cancel' | 'help';

export interface MissionArgs {
  command: MissionCommand;
  /** Positional arguments after the command, with all flags removed. */
  positionals: string[];
  agent: string | null;
  title: string;
  status: string | undefined;
  priority: number;
}

export interface ParseFailure {
  /** Lines written to stderr, in order. */
  errors: string[];
  exitCode: number;
}

export type ParseResult =
  | { ok: true; args: MissionArgs }
  | { ok: false; failure: ParseFailure };

/** Flags that take a following value. */
const VALUE_FLAGS = ['--agent', '--title', '--status', '--priority'] as const;
/** Flags that stand alone. */
const BOOLEAN_FLAGS = ['--help'] as const;

const KNOWN_FLAGS: readonly string[] = [...VALUE_FLAGS, ...BOOLEAN_FLAGS];

const COMMANDS: readonly MissionCommand[] = ['create', 'list', 'result', 'cancel', 'help'];

/** Statuses the store actually uses. A typo here would silently list nothing. */
const KNOWN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

/** How many positionals each command accepts after the command word. */
const MAX_POSITIONALS: Record<MissionCommand, number> = {
  create: 1,
  list: 0,
  result: 1,
  cancel: 1,
  help: 1,
};

export const USAGE = [
  'LandOS mission CLI — queue one-shot tasks for an agent to execute.',
  '',
  'Usage:',
  '  mission-cli create --agent <id> [--title "Label"] [--priority N] "Full prompt text"',
  '  mission-cli list [--status <queued|running|completed|failed|cancelled>]',
  '  mission-cli result <id>',
  '  mission-cli cancel <id>',
  '  mission-cli help',
  '',
  'Flags:',
  '  --agent <id>       Target agent. Omit to leave the task unassigned.',
  '  --title "Label"    Short label. Defaults to the first 60 chars of the prompt.',
  '  --priority N       Integer priority; higher runs first. Default 5.',
  '  --status <s>       Filter for `list`.',
  '  --help             Show this help.',
  '',
  'Unknown flags are rejected: a misspelled option used to be swallowed as the',
  'prompt body, producing a task that ran the wrong instruction.',
].join('\n');

/** Levenshtein distance. Small enough to inline; no dependency needed. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const curr = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[cols - 1];
}

/**
 * Nearest known flag to a rejected one, so `--agnt` points at `--agent` instead
 * of just being refused. Returns undefined when nothing is close enough — a
 * confidently wrong suggestion is worse than none.
 */
function suggest(flag: string): string | undefined {
  const bare = flag.replace(/^-+/, '').toLowerCase();
  if (!bare) return undefined;
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const known of KNOWN_FLAGS) {
    const kBare = known.replace(/^-+/, '');
    const distance = editDistance(bare, kBare);
    // Allow a larger budget for longer names: one typo in "priority" is a
    // smaller relative error than one typo in "task".
    const budget = Math.max(1, Math.floor(kBare.length / 3));
    if (distance <= budget && distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }
  return best;
}

function fail(errors: string[]): ParseResult {
  return { ok: false, failure: { errors, exitCode: 1 } };
}

/**
 * Parse a mission CLI invocation.
 *
 * @param argv Arguments after the node executable and script path — i.e.
 *             `process.argv.slice(2)`.
 */
export function parseMissionArgs(argv: string[]): ParseResult {
  if (argv.length === 0) {
    return fail(['No command given.', '', USAGE]);
  }

  // `--help` anywhere wins, so `mission-cli create --help` explains itself
  // rather than complaining about a missing prompt.
  if (argv.includes('--help') || argv.includes('-h')) {
    return { ok: true, args: { command: 'help', positionals: [], agent: null, title: '', status: undefined, priority: 5 } };
  }

  const commandToken = argv[0];
  if (commandToken.startsWith('-')) {
    return fail([
      `Expected a command, got the flag "${commandToken}".`,
      `Commands: ${COMMANDS.join(' | ')}`,
      '',
      USAGE,
    ]);
  }
  if (!(COMMANDS as readonly string[]).includes(commandToken)) {
    return fail([
      `Unknown command: "${commandToken}"`,
      `Commands: ${COMMANDS.join(' | ')}`,
      '',
      USAGE,
    ]);
  }
  const command = commandToken as MissionCommand;

  const positionals: string[] = [];
  const values = new Map<string, string>();
  const unknown: string[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];

    // `--` ends option parsing; everything after it is positional, which is how
    // a prompt that genuinely begins with a dash is passed.
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if ((VALUE_FLAGS as readonly string[]).includes(token)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return fail([
          `Flag ${token} requires a value.`,
          '',
          USAGE,
        ]);
      }
      if (values.has(token)) {
        return fail([`Flag ${token} was given more than once.`, '', USAGE]);
      }
      values.set(token, value);
      i += 1;
      continue;
    }

    if ((BOOLEAN_FLAGS as readonly string[]).includes(token)) continue;

    // Anything else that looks like an option is unsupported. This covers both
    // long flags (`--body`) and short ones (`-a`), which the old parser never
    // examined at all.
    if (token.startsWith('-') && token !== '-') {
      unknown.push(token);
      continue;
    }

    positionals.push(token);
  }

  if (unknown.length > 0) {
    const lines = [
      `Unknown flag${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      `Known flags: ${KNOWN_FLAGS.join(', ')}`,
    ];
    for (const flag of unknown) {
      const hint = suggest(flag);
      if (hint) lines.push(`Did you mean ${hint}? (got ${flag})`);
    }
    lines.push('If this was meant as prompt text, drop the leading dashes or put it after "--".');
    lines.push('No mission task was created or modified.');
    lines.push('', USAGE);
    return fail(lines);
  }

  const max = MAX_POSITIONALS[command];
  if (positionals.length > max) {
    return fail([
      max === 0
        ? `The "${command}" command takes no positional arguments, got ${positionals.length}: ${positionals.map((p) => JSON.stringify(p)).join(', ')}`
        : `The "${command}" command takes at most ${max} positional argument, got ${positionals.length}: ${positionals.map((p) => JSON.stringify(p)).join(', ')}`,
      max === 1 ? 'Quote the whole prompt as a single argument.' : '',
      '',
      USAGE,
    ].filter((l, idx, all) => !(l === '' && all[idx - 1] === '')));
  }

  const status = values.get('--status');
  if (status !== undefined && !(KNOWN_STATUSES as readonly string[]).includes(status)) {
    return fail([
      `Unsupported --status value: "${status}"`,
      `Known statuses: ${KNOWN_STATUSES.join(', ')}`,
      '',
      USAGE,
    ]);
  }

  let priority = 5;
  const rawPriority = values.get('--priority');
  if (rawPriority !== undefined) {
    if (!/^-?\d+$/.test(rawPriority)) {
      return fail([
        `--priority must be an integer, got "${rawPriority}"`,
        '',
        USAGE,
      ]);
    }
    priority = parseInt(rawPriority, 10);
  }

  return {
    ok: true,
    args: {
      command,
      positionals,
      agent: values.get('--agent') ?? null,
      title: values.get('--title') ?? '',
      status,
      priority,
    },
  };
}
