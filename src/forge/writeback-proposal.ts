// Forge owner-gated writeback proposal — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral, industry-neutral, text/JSON
// only. Given a retrofit (snapshot + reconstruction + gaps) and target-file
// metadata supplied by the host adapter, this previews EXACTLY what Forge would
// change in an existing agent folder before anything is written: target paths,
// create/update/skip actions, current-vs-proposed summaries, diff-like previews,
// and the backup / rollback / validation plans plus the owner and Codex/QA
// gates. It is proposal-only: it writes nothing, applies nothing, creates no
// backups, and reads no files itself. The host adapter supplies file metadata.

import type {
  ExistingAgentSnapshot,
  ReconstructedAgentProfile,
  RetrofitGap,
} from './agent-retrofit.js';

/** A file the proposal would target, with its proposed content. The host
 *  adapter never receives write instructions from this; it only checks paths. */
export interface ProposedTarget {
  /** Path relative to the agent folder. */
  relativeTargetPath: string;
  proposedContent: string;
  reason: string;
}

/** Target metadata the host adapter supplies after a read-only path check. */
export interface TargetFileMeta {
  relativeTargetPath: string;
  exists: boolean;
  /** Current file text, only when it exists and is safe/allowed to read. */
  currentText?: string;
  /** Whether this path would be safe to write to in a future, gated apply. */
  safeToWriteLater: boolean;
  riskFlags?: string[];
}

export type WritebackAction = 'create' | 'update' | 'skip';

export interface TargetFileProposal {
  relativeTargetPath: string;
  action: WritebackAction;
  exists: boolean;
  safeToWriteLater: boolean;
  currentSummary: string;
  proposedSummary: string;
  diffPreview: string;
  reason: string;
  riskFlags: string[];
}

export interface WritebackProposal {
  agentSlug: string;
  relativeFolderPath: string;
  /** Clear statements that nothing has been applied. */
  notApplied: string[];
  targetFiles: TargetFileProposal[];
  /** The per-file diff preview blocks, gathered for convenience. */
  diffPreviews: string[];
  backupPlan: string[];
  rollbackPlan: string[];
  validationPlan: string[];
  ownerApprovalGate: string[];
  codexQaGate: string[];
  blockedActions: string[];
}

const NOT_APPLIED = [
  'Not applied: this is a proposal preview only.',
  'No file is written into the existing agent folder.',
  'No existing file is overwritten.',
  'No backup files are created yet.',
  'No agent is activated or registered.',
  'Owner approval and a Codex/QA review are required before any future writeback.',
];

function summarize(text: string | undefined): string {
  if (text === undefined) return 'does not exist';
  const lines = text.split(/\r?\n/).length;
  return `${lines} line(s), ${text.length} char(s)`;
}

// A coarse, deterministic line diff: lines present only in current are shown as
// removals, lines present only in proposed as additions. Capped so previews stay
// readable. This is a preview aid, not a real patch.
function diffPreview(current: string | undefined, proposed: string, max = 40): string {
  const cur = current === undefined ? [] : current.split(/\r?\n/);
  const next = proposed.split(/\r?\n/);
  if (current === undefined) {
    const shown = next.slice(0, max).map((l) => `+ ${l}`);
    if (next.length > max) shown.push(`+ … (${next.length - max} more line(s))`);
    return shown.join('\n');
  }
  const curSet = new Set(cur);
  const nextSet = new Set(next);
  const removed = cur.filter((l) => l.trim() && !nextSet.has(l));
  const added = next.filter((l) => l.trim() && !curSet.has(l));
  const half = Math.max(1, Math.floor(max / 2));
  const out: string[] = [];
  for (const l of removed.slice(0, half)) out.push(`- ${l}`);
  if (removed.length > half) out.push(`- … (${removed.length - half} more removed)`);
  for (const l of added.slice(0, half)) out.push(`+ ${l}`);
  if (added.length > half) out.push(`+ … (${added.length - half} more added)`);
  return out.length ? out.join('\n') : '(no line-level changes detected)';
}

/**
 * Decide which files a retrofit would propose to write. Pure. Currently:
 *  - agent-profile.json: a complete normalized profile satisfying the standard.
 *  - forge-profile-notes.md: the standard fields the agent does not yet specify
 *    (only when gaps exist).
 * Both live inside the agent folder. Content is a proposal, never written.
 */
export function planWritebackTargets(input: {
  reconstruction: ReconstructedAgentProfile;
  gaps: RetrofitGap[];
}): ProposedTarget[] {
  const targets: ProposedTarget[] = [
    {
      relativeTargetPath: 'agent-profile.json',
      proposedContent: JSON.stringify(input.reconstruction.profile, null, 2) + '\n',
      reason: 'Add a complete normalized profile that satisfies the universal standard.',
    },
  ];

  const missing = input.gaps.filter((g) => !g.present);
  if (missing.length) {
    const body = [
      '# Profile gaps to fill (draft notes)',
      '',
      'These standard fields are not yet specified by this agent. Fill them in,',
      'then regenerate the profile. This file is a proposal preview; nothing is',
      'written until the owner approves a future, gated writeback.',
      '',
      ...missing.map((g) => `- ${g.field} (${g.severity})`),
      '',
    ].join('\n');
    targets.push({
      relativeTargetPath: 'forge-profile-notes.md',
      proposedContent: body,
      reason: 'Document the standard fields the agent does not yet specify.',
    });
  }
  return targets;
}

/** Match proposed targets to host-supplied metadata into full proposals. Pure.
 *  Action: skip when not safe to write, create when absent, update otherwise. */
export function buildTargetProposals(
  proposed: ProposedTarget[],
  metas: TargetFileMeta[],
): TargetFileProposal[] {
  const byPath = new Map(metas.map((m) => [m.relativeTargetPath, m]));
  return proposed.map((t) => {
    const meta = byPath.get(t.relativeTargetPath);
    const exists = meta?.exists ?? false;
    const safe = meta?.safeToWriteLater ?? false;
    const action: WritebackAction = !safe ? 'skip' : exists ? 'update' : 'create';
    return {
      relativeTargetPath: t.relativeTargetPath,
      action,
      exists,
      safeToWriteLater: safe,
      currentSummary: summarize(meta?.currentText),
      proposedSummary: summarize(t.proposedContent),
      diffPreview: action === 'skip'
        ? '(skipped: path is not safe to write later)'
        : diffPreview(meta?.currentText, t.proposedContent),
      reason: t.reason,
      riskFlags: meta?.riskFlags ?? [],
    };
  });
}

/**
 * Generate the full owner-gated writeback proposal. Pure. Produces an artifact
 * set only: it writes nothing, applies nothing, and creates no backups.
 */
export function generateWritebackProposal(input: {
  agentSlug: string;
  relativeFolderPath: string;
  reconstruction: ReconstructedAgentProfile;
  gaps: RetrofitGap[];
  metas: TargetFileMeta[];
  /** Optional pre-planned targets; defaults to planWritebackTargets. */
  proposedTargets?: ProposedTarget[];
}): WritebackProposal {
  const proposed = input.proposedTargets ?? planWritebackTargets({
    reconstruction: input.reconstruction,
    gaps: input.gaps,
  });
  const targetFiles = buildTargetProposals(proposed, input.metas);

  return {
    agentSlug: input.agentSlug,
    relativeFolderPath: input.relativeFolderPath,
    notApplied: [...NOT_APPLIED],
    targetFiles,
    diffPreviews: targetFiles.map(
      (t) => `### ${t.relativeTargetPath} (${t.action})\n${t.diffPreview}`,
    ),
    backupPlan: [
      'Before any future apply, copy each target file that exists to a timestamped backup inside a Forge-owned backup area.',
      'Record the backup location and a checksum of each original file.',
      'Skip backups for files that do not exist (a create has nothing to back up).',
      'No backup files are created in this proposal step.',
    ],
    rollbackPlan: [
      'Restore each target from its recorded backup to undo an applied change.',
      'For a created file with no prior version, the rollback is to delete the created file.',
      'Keep backups until the owner confirms the writeback is good.',
    ],
    validationPlan: [
      'Re-run the retrofit inspection after a future apply and confirm gaps closed.',
      'Run the host project checks (tests, typecheck, build) after any writeback.',
      'Confirm the agent still loads and no existing behavior regressed.',
    ],
    ownerApprovalGate: [
      'The owner must explicitly approve this proposal before any writeback.',
      'Approval is per-proposal and can be withdrawn before apply.',
      'Owner decision: approve / tweak / reject / hold.',
    ],
    codexQaGate: [
      'A Codex/QA review of this proposal is recommended before any writeback.',
      'The review checks the diffs, backup/rollback plan, and validation plan.',
    ],
    blockedActions: [
      'Writing or overwriting any file in the existing agent folder (blocked this sprint).',
      'Creating backup files (blocked; planned, not performed).',
      'Applying the proposal (the apply route is blocked and returns 501 not implemented; it cannot mutate the filesystem).',
      'Activating or registering the agent (blocked; separate owner gate).',
      'Writing outside the allowlisted agents directory (always blocked).',
    ],
  };
}

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)';
}

/** Render the writeback proposal as a copy-ready Markdown packet. */
export function renderWritebackProposalMarkdown(p: WritebackProposal): string {
  const fileRows = p.targetFiles
    .map(
      (t) =>
        `| \`${t.relativeTargetPath}\` | ${t.action} | ${t.exists ? 'yes' : 'no'} | ${t.safeToWriteLater ? 'yes' : 'no'} |`,
    )
    .join('\n');

  const diffSections = p.targetFiles
    .map(
      (t) =>
        `### \`${t.relativeTargetPath}\` — ${t.action}\n` +
        `${t.reason}\n\n` +
        `- Current: ${t.currentSummary}\n- Proposed: ${t.proposedSummary}\n\n` +
        `\`\`\`diff\n${t.diffPreview}\n\`\`\``,
    )
    .join('\n\n');

  return `# Writeback Proposal — ${p.agentSlug}

**Folder:** \`${p.relativeFolderPath}\`
**Target files:** ${p.targetFiles.length}

> ${p.notApplied.join('\n> ')}

## Target files
| Path | Action | Exists | Safe to write later |
|---|---|---|---|
${fileRows}

## Diff previews
${diffSections}

## Backup plan
${mdList(p.backupPlan)}

## Rollback plan
${mdList(p.rollbackPlan)}

## Validation plan
${mdList(p.validationPlan)}

## Owner approval gate
${mdList(p.ownerApprovalGate)}

## Codex / QA gate
${mdList(p.codexQaGate)}

## Blocked actions
${mdList(p.blockedActions)}

---

Not applied. This proposal previews changes only. Forge writes nothing into the
existing agent folder, overwrites nothing, creates no backups, and activates or
registers nothing. Any future writeback is a separate, gated, owner-approved and
Codex/QA-reviewed step.
`;
}

// Re-exported for callers that build proposals from a stored snapshot.
export type { ExistingAgentSnapshot };
