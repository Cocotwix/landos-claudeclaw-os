import { useEffect, useState } from 'preact/hooks';
import { Hammer, Copy, RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api';
import { renderMarkdown } from '@/lib/markdown';

// Forge engagement panel. Display-only operator surface over the Forge host
// endpoints (engagement generate, save/list/get/patch, review packet, command
// plan). It NEVER executes anything from an artifact, review packet, or command
// plan: no shell, commits, pushes, deploys, installs, paid APIs, secret reads,
// or account connections. Everything here generates, saves, or displays text.

const FORGE_STATUSES = [
  'draft',
  'planned',
  'in_progress',
  'needs_review',
  'ready_to_push',
  'pushed',
  'blocked',
] as const;
type ForgeStatus = (typeof FORGE_STATUSES)[number];

const OWNER_DECISIONS = ['pending', 'approved', 'tweak_requested', 'rejected', 'hold'] as const;
type OwnerDecision = (typeof OWNER_DECISIONS)[number];

// Saved department-agent profile lifecycle. Distinct from engagement statuses.
const PROFILE_STATUSES = [
  'draft',
  'review_ready',
  'approved',
  'needs_revision',
  'held',
  'rejected',
  'promoted',
] as const;
type ProfileStatus = (typeof PROFILE_STATUSES)[number];

interface StoredProfile {
  id: string;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  department: string;
  request: string;
  status: ProfileStatus;
  ownerDecision: OwnerDecision;
  profile: { displayName: string; agentName: string; activationMode: string };
  buildPacket: string;
  interview: string;
  authoritySummary: string;
  activationMode: string;
  notes: string;
}

// Draft promotion scaffold lifecycle. A scaffold is a draft artifact set, never
// an active or registered agent.
const SCAFFOLD_STATUSES = [
  'draft',
  'review_ready',
  'approved_for_generation',
  'needs_revision',
  'held',
  'rejected',
  'generated_draft_files',
] as const;
type ScaffoldStatus = (typeof SCAFFOLD_STATUSES)[number];

interface ScaffoldFileMeta {
  path: string;
  purpose: string;
  content: string;
}

interface StoredScaffold {
  id: string;
  createdAt: number;
  updatedAt: number;
  savedProfileId: string;
  displayName: string;
  department: string;
  proposedSlug: string;
  status: ScaffoldStatus;
  ownerDecision: OwnerDecision;
  scaffold: {
    proposedFolder: string;
    readyForGeneration: boolean;
    readinessNote: string;
    files: ScaffoldFileMeta[];
  };
  markdown: string;
  notes: string;
}

// Existing-agent retrofit lifecycle. Inspection + upgrade artifacts only; never
// modifies the inspected agent.
const RETROFIT_STATUSES = [
  'inspected',
  'review_ready',
  'needs_revision',
  'approved_for_upgrade',
  'held',
  'rejected',
  'upgrade_scaffolded',
] as const;
type RetrofitStatus = (typeof RETROFIT_STATUSES)[number];

interface ExistingAgentCandidate {
  slug: string;
  displayName: string;
  folderPath: string;
  detectedFiles: string[];
  detectedPrimaryFile?: string;
  safeToInspect: boolean;
  warnings: string[];
}

interface RetrofitGapView {
  field: string;
  present: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface StoredRetrofit {
  id: string;
  createdAt: number;
  updatedAt: number;
  agentSlug: string;
  relativeFolderPath: string;
  displayName: string;
  status: RetrofitStatus;
  ownerDecision: OwnerDecision;
  readinessScore: number;
  gapAnalysis: RetrofitGapView[];
  reviewPacket: string;
}

// Owner-gated writeback proposal lifecycle. Preview-only; never applied.
const WRITEBACK_STATUSES = [
  'draft',
  'review_ready',
  'needs_revision',
  'approved_for_writeback',
  'held',
  'rejected',
  'superseded',
] as const;
type WritebackStatus = (typeof WRITEBACK_STATUSES)[number];

interface TargetFileView {
  relativeTargetPath: string;
  action: 'create' | 'update' | 'skip';
  exists: boolean;
  safeToWriteLater: boolean;
}

interface StoredWriteback {
  id: string;
  createdAt: number;
  updatedAt: number;
  retrofitId: string;
  agentSlug: string;
  relativeFolderPath: string;
  status: WritebackStatus;
  ownerDecision: OwnerDecision;
  proposal: { targetFiles: TargetFileView[]; notApplied: string[] };
  markdown: string;
}

interface ForgeHit {
  category: string;
  label: string;
  matchedText: string;
}

interface StoredEngagement {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  rawRequest: string;
  host: string;
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: ForgeHit[];
  notice: string;
  decisionsNeeded: string[];
  markdown: string;
  status: ForgeStatus;
  ownerDecision: OwnerDecision;
  notes: string;
  source: string;
}

// A unified view model for either a fresh (unsaved) preview or a loaded record.
interface ForgeView {
  id?: string;
  title: string;
  rawRequest?: string;
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: ForgeHit[];
  notice: string;
  decisionsNeeded: string[];
  markdown: string;
  status?: ForgeStatus;
  ownerDecision?: OwnerDecision;
}

interface GenerateResponse {
  verdict: 'SAFE' | 'STOP';
  title: string;
  lane: { categories: string[]; hits: ForgeHit[]; notice: string };
  decisionsNeeded: string[];
  markdown: string;
}

function storedToView(s: StoredEngagement): ForgeView {
  return {
    id: s.id,
    title: s.title,
    rawRequest: s.rawRequest,
    verdict: s.verdict,
    categories: s.categories,
    hits: s.hits,
    notice: s.notice,
    decisionsNeeded: s.decisionsNeeded,
    markdown: s.markdown,
    status: s.status,
    ownerDecision: s.ownerDecision,
  };
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const msg =
      err.body && typeof err.body === 'object' && 'error' in err.body
        ? String((err.body as { error: unknown }).error)
        : err.message;
    return `${err.status}: ${msg}`;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

export function Forge() {
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<ForgeView | null>(null);
  const [history, setHistory] = useState<StoredEngagement[]>([]);
  const [output, setOutput] = useState<{ kind: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Forge Build Interview Mode inputs.
  const [buildGoal, setBuildGoal] = useState('');

  // Department-agent builder inputs. Independent of the engagement panel.
  const [agentRequest, setAgentRequest] = useState('');
  const [agentDisplayName, setAgentDisplayName] = useState('');
  const [agentDepartment, setAgentDepartment] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<StoredProfile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<StoredProfile | null>(null);
  const [savedScaffolds, setSavedScaffolds] = useState<StoredScaffold[]>([]);
  const [currentScaffold, setCurrentScaffold] = useState<StoredScaffold | null>(null);
  const [existingAgents, setExistingAgents] = useState<ExistingAgentCandidate[]>([]);
  const [savedRetrofits, setSavedRetrofits] = useState<StoredRetrofit[]>([]);
  const [currentRetrofit, setCurrentRetrofit] = useState<StoredRetrofit | null>(null);
  const [savedWritebacks, setSavedWritebacks] = useState<StoredWriteback[]>([]);
  const [currentWriteback, setCurrentWriteback] = useState<StoredWriteback | null>(null);

  async function loadHistory() {
    try {
      const res = await apiGet<{ engagements: StoredEngagement[] }>('/api/forge/engagements');
      setHistory(res.engagements);
    } catch {
      /* history is best-effort; don't block the page on it */
    }
  }

  async function loadProfiles() {
    try {
      const res = await apiGet<{ profiles: StoredProfile[] }>('/api/forge/agent-profiles');
      setSavedProfiles(res.profiles);
    } catch {
      /* best-effort */
    }
  }

  async function loadScaffolds() {
    try {
      const res = await apiGet<{ scaffolds: StoredScaffold[] }>('/api/forge/promotion-scaffolds');
      setSavedScaffolds(res.scaffolds);
    } catch {
      /* best-effort */
    }
  }

  async function loadExistingAgents() {
    try {
      const res = await apiGet<{ agents: ExistingAgentCandidate[] }>('/api/forge/existing-agents');
      setExistingAgents(res.agents);
    } catch {
      /* best-effort */
    }
  }

  async function loadRetrofits() {
    try {
      const res = await apiGet<{ retrofits: StoredRetrofit[] }>('/api/forge/agent-retrofits');
      setSavedRetrofits(res.retrofits);
    } catch {
      /* best-effort */
    }
  }

  async function loadWritebacks() {
    try {
      const res = await apiGet<{ proposals: StoredWriteback[] }>('/api/forge/writeback-proposals');
      setSavedWritebacks(res.proposals);
    } catch {
      /* best-effort */
    }
  }

  useEffect(() => {
    loadHistory();
    loadProfiles();
    loadScaffolds();
    loadExistingAgents();
    loadRetrofits();
    loadWritebacks();
  }, []);

  async function generate() {
    const trimmed = request.trim();
    if (!trimmed) {
      setCurrent(null);
      setOutput(null);
      setError('Enter a build request first.');
      return;
    }
    setLoading(true);
    setError(null);
    setOutput(null);
    try {
      const body: { request: string; title?: string; host: string } = {
        request: trimmed,
        host: 'Mission Control',
      };
      const t = title.trim();
      if (t) body.title = t;
      const resp = await apiPost<GenerateResponse>('/api/forge/engagement', body);
      setCurrent({
        title: resp.title,
        rawRequest: trimmed,
        verdict: resp.verdict,
        categories: resp.lane.categories,
        hits: resp.lane.hits,
        notice: resp.lane.notice,
        decisionsNeeded: resp.decisionsNeeded,
        markdown: resp.markdown,
      });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrent() {
    const trimmed = request.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const body: { request: string; title?: string; host: string } = {
        request: trimmed,
        host: 'Mission Control',
      };
      const t = title.trim();
      if (t) body.title = t;
      const resp = await apiPost<{ engagement: StoredEngagement }>('/api/forge/engagements', body);
      setCurrent(storedToView(resp.engagement));
      await loadHistory();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reopen(s: StoredEngagement) {
    setCurrent(storedToView(s));
    setOutput(null);
    setError(null);
  }

  async function changeStatus(status: ForgeStatus) {
    if (!current?.id) return;
    setBusy(true);
    try {
      const resp = await apiPatch<{ engagement: StoredEngagement }>(
        `/api/forge/engagements/${current.id}`,
        { status },
      );
      setCurrent(storedToView(resp.engagement));
      await loadHistory();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the text is still shown for manual copy */
    }
  }

  async function reviewPacket() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const text = current.id
        ? (await apiPost<{ packet: string }>(`/api/forge/engagements/${current.id}/review-packet`, {})).packet
        : (
            await apiPost<{ packet: string }>('/api/forge/review-packet', {
              title: current.title,
              verdict: current.verdict,
            })
          ).packet;
      setOutput({ kind: 'Codex review packet', text });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function commandPlan() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ plan: string }>('/api/forge/command-plan', {
        title: current.title,
        verdict: current.verdict,
        categories: current.categories,
      });
      setOutput({ kind: 'Command plan', text: resp.plan });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Body shared by the release-layer generators. Prefer the saved id (so the
  // server can pull the stored request); fall back to the raw request text.
  function releaseBody() {
    return current?.id ? { id: current.id, title: current?.title } : { request: current?.rawRequest, title: current?.title };
  }

  async function runGenerator(path: string, key: string, kind: string) {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<Record<string, string>>(path, releaseBody());
      setOutput({ kind, text: resp[key] });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const setupChecklist = () => runGenerator('/api/forge/setup-checklist', 'checklist', 'Owner setup checklist');
  const completionReport = () => runGenerator('/api/forge/completion-report', 'report', 'Completion report');

  interface SecurityResult {
    lane: string;
    forgeCanProceed: boolean;
    needsOwner: boolean;
    notice: string;
    gates: { label: string; lane: string; ownerAction: string }[];
  }

  async function securityCheck() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ security: SecurityResult }>('/api/forge/security-check', releaseBody());
      const s = resp.security;
      const lines = [
        `# Security / release gates — ${current.title}`,
        '',
        `Lane: ${s.lane}`,
        `Forge can proceed: ${s.forgeCanProceed ? 'yes' : 'no'}`,
        `Needs owner: ${s.needsOwner ? 'yes' : 'no'}`,
        '',
        s.notice,
        '',
        ...(s.gates.length
          ? s.gates.map((g) => `- ${g.label} (${g.lane}): ${g.ownerAction}`)
          : ['- No owner-owned gates detected.']),
      ];
      setOutput({ kind: 'Security gates', text: lines.join('\n') });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function demoRunbook() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ runbook: string }>('/api/forge/demo-runbook', { title: current.title });
      setOutput({ kind: 'Demo / trial runbook', text: resp.runbook });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeDecision(ownerDecision: OwnerDecision) {
    if (!current?.id) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPatch<{ engagement: StoredEngagement }>(
        `/api/forge/engagements/${current.id}/decision`,
        { ownerDecision },
      );
      setCurrent(storedToView(resp.engagement));
      await loadHistory();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Department-agent builder. Builds a universal, industry-neutral agent
  // profile or full build packet from a plain request. Display only: nothing
  // here activates an agent, connects, deploys, or touches secrets. Live
  // actions stay gated in sandbox until the owner scopes them.
  function agentBody() {
    const body: Record<string, string> = { request: agentRequest.trim() };
    const d = agentDisplayName.trim();
    const dept = agentDepartment.trim();
    if (d) body.displayName = d;
    if (dept) body.department = dept;
    return body;
  }

  async function agentInterview() {
    if (!agentRequest.trim()) {
      setError('Describe the department agent first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ markdown: string }>('/api/forge/agent-interview', agentBody());
      setOutput({ kind: 'Agent interview', text: resp.markdown });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function agentBuildPacket() {
    if (!agentRequest.trim()) {
      setError('Describe the department agent first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ packet: string }>('/api/forge/agent-build-packet', agentBody());
      setOutput({ kind: 'Agent build packet', text: resp.packet });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Save the generated profile + build packet to durable history. The server
  // rebuilds the canonical profile from the request, so this never promotes,
  // activates, connects, or touches secrets.
  async function saveProfile() {
    if (!agentRequest.trim()) {
      setError('Describe the department agent first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ profile: StoredProfile }>('/api/forge/agent-profiles', agentBody());
      setCurrentProfile(resp.profile);
      setOutput({ kind: 'Agent build packet', text: resp.profile.buildPacket });
      await loadProfiles();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reopenProfile(p: StoredProfile) {
    setCurrentProfile(p);
    setOutput({ kind: 'Agent build packet', text: p.buildPacket });
    setError(null);
  }

  async function changeProfileStatus(status: ProfileStatus) {
    if (!currentProfile) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPatch<{ profile: StoredProfile }>(
        `/api/forge/agent-profiles/${currentProfile.id}`,
        { status },
      );
      setCurrentProfile(resp.profile);
      await loadProfiles();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeProfileDecision(ownerDecision: OwnerDecision) {
    if (!currentProfile) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPatch<{ profile: StoredProfile }>(
        `/api/forge/agent-profiles/${currentProfile.id}`,
        { ownerDecision },
      );
      setCurrentProfile(resp.profile);
      await loadProfiles();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function profileReviewPacket() {
    if (!currentProfile) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ packet: string }>(
        `/api/forge/agent-profiles/${currentProfile.id}/review-packet`,
        {},
      );
      setOutput({ kind: 'Profile review packet', text: resp.packet });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function profilePromotionChecklist() {
    if (!currentProfile) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ markdown: string }>(
        `/api/forge/agent-profiles/${currentProfile.id}/promotion-checklist`,
        {},
      );
      setOutput({ kind: 'Promotion readiness', text: resp.markdown });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Generate a DRAFT promotion scaffold for the saved profile. Draft artifact
  // only: this activates nothing, registers nothing, and writes no agent files.
  // Generation and activation stay separate owner-owned gates.
  async function generateScaffold() {
    if (!currentProfile) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ scaffold: StoredScaffold }>(
        `/api/forge/agent-profiles/${currentProfile.id}/promotion-scaffold`,
        {},
      );
      setCurrentScaffold(resp.scaffold);
      setOutput({ kind: 'Draft promotion scaffold', text: resp.scaffold.markdown });
      await loadScaffolds();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reopenScaffold(s: StoredScaffold) {
    setCurrentScaffold(s);
    setOutput({ kind: 'Draft promotion scaffold', text: s.markdown });
    setError(null);
  }

  async function patchScaffold(patch: { status?: ScaffoldStatus; ownerDecision?: OwnerDecision }) {
    if (!currentScaffold) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPatch<{ scaffold: StoredScaffold }>(
        `/api/forge/promotion-scaffolds/${currentScaffold.id}`,
        patch,
      );
      setCurrentScaffold(resp.scaffold);
      await loadScaffolds();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Existing Agent Retrofit. Inspect an already-started agent (read-only),
  // reconstruct its profile, compare against the standard, and produce a safe
  // upgrade plan. This never writes into, overwrites, activates, or registers
  // the existing agent.
  async function inspectAgent(slug: string) {
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ retrofit: StoredRetrofit }>('/api/forge/existing-agents/inspect', { slug });
      setCurrentRetrofit(resp.retrofit);
      setOutput({ kind: 'Retrofit review packet', text: resp.retrofit.reviewPacket });
      await loadRetrofits();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reopenRetrofit(r: StoredRetrofit) {
    setCurrentRetrofit(r);
    setOutput({ kind: 'Retrofit review packet', text: r.reviewPacket });
    setError(null);
  }

  async function patchRetrofit(patch: { status?: RetrofitStatus; ownerDecision?: OwnerDecision }) {
    if (!currentRetrofit) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPatch<{ retrofit: StoredRetrofit }>(
        `/api/forge/agent-retrofits/${currentRetrofit.id}`,
        patch,
      );
      setCurrentRetrofit(resp.retrofit);
      await loadRetrofits();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function retrofitUpgradePlan() {
    if (!currentRetrofit) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ plan: { summary: string; nextSafeStep: string; blockedActions: string[]; recommendedProfilePatches: string[] } }>(
        `/api/forge/agent-retrofits/${currentRetrofit.id}/upgrade-plan`,
        {},
      );
      const p = resp.plan;
      const lines = [
        `# Retrofit upgrade plan — ${currentRetrofit.displayName}`,
        '',
        p.summary,
        '',
        '## Recommended profile patches',
        ...p.recommendedProfilePatches.map((x) => `- ${x}`),
        '',
        '## Blocked actions',
        ...p.blockedActions.map((x) => `- ${x}`),
        '',
        '## Next safe step',
        p.nextSafeStep,
      ];
      setOutput({ kind: 'Retrofit upgrade plan', text: lines.join('\n') });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function retrofitReviewPacket() {
    if (!currentRetrofit) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ packet: string }>(
        `/api/forge/agent-retrofits/${currentRetrofit.id}/review-packet`,
        {},
      );
      setOutput({ kind: 'Retrofit review packet', text: resp.packet });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Owner-gated writeback proposal. Previews exactly what a future writeback
  // would change. This applies nothing, writes nothing into the agent folder,
  // and creates no backups.
  async function createWriteback() {
    if (!currentRetrofit) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ proposal: StoredWriteback }>(
        `/api/forge/agent-retrofits/${currentRetrofit.id}/writeback-proposal`,
        {},
      );
      setCurrentWriteback(resp.proposal);
      setOutput({ kind: 'Writeback proposal', text: resp.proposal.markdown });
      await loadWritebacks();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reopenWriteback(p: StoredWriteback) {
    setCurrentWriteback(p);
    setOutput({ kind: 'Writeback proposal', text: p.markdown });
    setError(null);
  }

  async function patchWriteback(patch: { status?: WritebackStatus; ownerDecision?: OwnerDecision }) {
    if (!currentWriteback) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPatch<{ proposal: StoredWriteback }>(
        `/api/forge/writeback-proposals/${currentWriteback.id}`,
        patch,
      );
      setCurrentWriteback(resp.proposal);
      await loadWritebacks();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Forge Build Interview Mode: turn a plain-English goal into an interview or a
  // full build packet. Display only; builds nothing.
  async function buildInterview() {
    if (!buildGoal.trim()) { setError('Describe the build goal first.'); return; }
    setBusy(true); setError(null);
    try {
      const resp = await apiPost<{ interview: { title: string; intro: string; sections: { heading: string; questions: string[] }[] } }>(
        '/api/forge/build-interview', { goal: buildGoal.trim() },
      );
      const iv = resp.interview;
      const text = `# ${iv.title}\n\n${iv.intro}\n\n` +
        iv.sections.map((s) => `## ${s.heading}\n${s.questions.map((q) => `- ${q}`).join('\n')}`).join('\n\n');
      setOutput({ kind: 'Build interview', text });
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  }

  async function buildPacket() {
    if (!buildGoal.trim()) { setError('Describe the build goal first.'); return; }
    setBusy(true); setError(null);
    try {
      const resp = await apiPost<{ markdown: string }>('/api/forge/build-packet', { goal: buildGoal.trim() });
      setOutput({ kind: 'Build packet', text: resp.markdown });
    } catch (err) { setError(errMessage(err)); } finally { setBusy(false); }
  }

  const btn =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const btnAccent = `${btn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]`;
  const btnGhost = `${btn} bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]`;

  return (
    <div class="h-full flex flex-col">
      <PageHeader title="Forge" breadcrumb="Workspace" />
      <div class="flex-1 overflow-y-auto p-6 space-y-5 max-w-3xl">
        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center gap-2">
            <Hammer size={14} class="text-[var(--color-accent)]" />
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Build Interview</h3>
          </div>
          <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
            Describe a build goal in plain English. Forge asks the targeted questions and turns the answer into a
            capability spec, safety boundaries, tests, an implementation sprint packet, and a Codex review checklist.
            Display only: nothing here builds, runs, connects, or touches secrets.
          </p>
          <textarea
            value={buildGoal}
            onInput={(e) => setBuildGoal((e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. A board where every lead becomes a property card I can move through a pipeline"
            rows={3}
            class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-y font-mono"
          />
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onClick={buildPacket} disabled={busy || !buildGoal.trim()} class={btnAccent}>
              Build packet
            </button>
            <button type="button" onClick={buildInterview} disabled={busy || !buildGoal.trim()} class={btnGhost}>
              Interview questions
            </button>
          </div>
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center gap-2">
            <Hammer size={14} class="text-[var(--color-accent)]" />
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Forge Engagement</h3>
          </div>
          <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
            Describe a build in plain words. Forge classifies it SAFE or STOP and returns a structured engagement
            artifact. Display only: nothing here runs, commits, pushes, installs, or touches secrets.
          </p>

          <label class="block">
            <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Title (optional)</span>
            <input
              type="text"
              value={title}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              placeholder="Short label"
              class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label class="block">
            <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Build request</span>
            <textarea
              value={request}
              onInput={(e) => setRequest((e.target as HTMLTextAreaElement).value)}
              placeholder="e.g. Add a date helper to src/utils with a unit test"
              rows={5}
              class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-y font-mono"
            />
          </label>

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onClick={generate} disabled={loading || busy} class={btnAccent}>
              {loading ? 'Starting…' : 'Start Forge Engagement'}
            </button>
            <button type="button" onClick={saveCurrent} disabled={loading || busy || !request.trim()} class={btnGhost}>
              Save to history
            </button>
            {(loading || busy) && <span class="text-[11px] text-[var(--color-text-muted)]">Working…</span>}
          </div>

          {error && (
            <div class="text-[12px] text-[var(--color-status-failed)] bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center gap-2">
            <Hammer size={14} class="text-[var(--color-accent)]" />
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Department Agent Builder</h3>
          </div>
          <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
            Describe a department agent for your operating system. Forge builds a universal, industry-neutral profile and
            an owner-reviewable build packet. The agent stays in sandbox until you scope its authority and approve
            activation. Display only: nothing here activates an agent, connects, deploys, or touches secrets.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label class="block">
              <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Display name (optional)</span>
              <input
                type="text"
                value={agentDisplayName}
                onInput={(e) => setAgentDisplayName((e.target as HTMLInputElement).value)}
                placeholder="e.g. Reporter"
                class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <label class="block">
              <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Department (optional)</span>
              <input
                type="text"
                value={agentDepartment}
                onInput={(e) => setAgentDepartment((e.target as HTMLInputElement).value)}
                placeholder="e.g. Reporting"
                class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>

          <label class="block">
            <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Agent request</span>
            <textarea
              value={agentRequest}
              onInput={(e) => setAgentRequest((e.target as HTMLTextAreaElement).value)}
              placeholder="e.g. An agent that drafts and organizes status updates"
              rows={3}
              class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-y font-mono"
            />
          </label>

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onClick={agentBuildPacket} disabled={busy || !agentRequest.trim()} class={btnAccent}>
              Build agent packet
            </button>
            <button type="button" onClick={agentInterview} disabled={busy || !agentRequest.trim()} class={btnGhost}>
              Interview questions
            </button>
            <button type="button" onClick={saveProfile} disabled={busy || !agentRequest.trim()} class={btnGhost}>
              Save profile
            </button>
          </div>
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Hammer size={14} class="text-[var(--color-accent)]" />
              <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Existing Agent Retrofit</h3>
            </div>
            <button type="button" onClick={loadExistingAgents} class={btnGhost} aria-label="Refresh existing agents">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
            Inspect an already-started agent, reconstruct its profile, compare it against the standard, and get a safe
            upgrade plan. Read-only: nothing here writes into, overwrites, activates, or registers the existing agent.
          </p>
          {existingAgents.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No existing agent candidates found.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {existingAgents.map((a) => (
                <li class="py-2 flex items-center gap-2">
                  <span class="flex-1 min-w-0">
                    <span class="text-[12.5px] text-[var(--color-text)]">{a.displayName}</span>
                    <span class="text-[10px] text-[var(--color-text-faint)]"> · {a.folderPath}</span>
                    {a.warnings.length > 0 && (
                      <span class="text-[10px] text-[var(--color-status-failed)]"> · {a.warnings.length} warning(s)</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => inspectAgent(a.slug)}
                    disabled={busy || !a.safeToInspect}
                    class={btnGhost}
                  >
                    Inspect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {currentRetrofit && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone={currentRetrofit.readinessScore >= 70 ? 'done' : currentRetrofit.readinessScore >= 40 ? 'neutral' : 'failed'}>
                readiness {currentRetrofit.readinessScore}/100
              </Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">
                {currentRetrofit.displayName}
              </span>
              <span class="text-[10px] text-[var(--color-text-faint)]">
                retrofit · {currentRetrofit.id} · {currentRetrofit.relativeFolderPath}
              </span>
            </div>
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Gap analysis</div>
              <div class="flex flex-wrap gap-1.5">
                {currentRetrofit.gapAnalysis.filter((g) => !g.present).map((g) => (
                  <Pill tone={g.severity === 'critical' || g.severity === 'high' ? 'failed' : 'neutral'}>
                    {g.field} ({g.severity})
                  </Pill>
                ))}
                {currentRetrofit.gapAnalysis.every((g) => g.present) && (
                  <span class="text-[11.5px] text-[var(--color-text-muted)]">No gaps — all standard fields present.</span>
                )}
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 pt-1">
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Status
                <select
                  value={currentRetrofit.status}
                  disabled={busy}
                  onChange={(e) => patchRetrofit({ status: (e.target as HTMLSelectElement).value as RetrofitStatus })}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {RETROFIT_STATUSES.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Owner decision
                <select
                  value={currentRetrofit.ownerDecision}
                  disabled={busy}
                  onChange={(e) => patchRetrofit({ ownerDecision: (e.target as HTMLSelectElement).value as OwnerDecision })}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {OWNER_DECISIONS.map((d) => (
                    <option value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={retrofitReviewPacket} disabled={busy} class={btnGhost}>
                Review packet
              </button>
              <button type="button" onClick={retrofitUpgradePlan} disabled={busy} class={btnGhost}>
                Upgrade plan
              </button>
              <button type="button" onClick={createWriteback} disabled={busy} class={btnGhost}>
                Create writeback proposal
              </button>
            </div>
            <p class="text-[10.5px] text-[var(--color-text-faint)]">
              Read-only inspection. Does not modify, activate, or register the existing agent. Any writeback is a
              separate, gated, owner-approved step.
            </p>
          </section>
        )}

        {currentWriteback && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone="neutral">not applied</Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">
                Writeback proposal · {currentWriteback.agentSlug}
              </span>
              <span class="text-[10px] text-[var(--color-text-faint)]">
                {currentWriteback.id} · {currentWriteback.relativeFolderPath}
              </span>
            </div>
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Target files</div>
              <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
                {currentWriteback.proposal.targetFiles.map((t) => (
                  <li>
                    <code class="text-[var(--color-text)]">{t.relativeTargetPath}</code>
                    {' '}
                    <Pill tone={t.action === 'skip' ? 'failed' : t.action === 'create' ? 'done' : 'neutral'}>
                      {t.action}
                    </Pill>
                    {' '}
                    <span class="text-[10px] text-[var(--color-text-faint)]">
                      {t.exists ? 'exists' : 'new'} · {t.safeToWriteLater ? 'safe later' : 'unsafe'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div class="flex flex-wrap items-center gap-2 pt-1">
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Status
                <select
                  value={currentWriteback.status}
                  disabled={busy}
                  onChange={(e) => patchWriteback({ status: (e.target as HTMLSelectElement).value as WritebackStatus })}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {WRITEBACK_STATUSES.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Owner decision
                <select
                  value={currentWriteback.ownerDecision}
                  disabled={busy}
                  onChange={(e) => patchWriteback({ ownerDecision: (e.target as HTMLSelectElement).value as OwnerDecision })}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {OWNER_DECISIONS.map((d) => (
                    <option value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => copyText(currentWriteback.markdown)} class={btnGhost}>
                <Copy size={12} /> {copied ? 'Copied' : 'Copy packet'}
              </button>
            </div>
            <p class="text-[10.5px] text-[var(--color-text-faint)]">
              Not applied. Preview only. No file is written or overwritten, no backups are created, and nothing is
              activated or registered. Apply is blocked behind owner + Codex/QA gates.
            </p>
          </section>
        )}

        {currentProfile && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone="neutral">{currentProfile.activationMode}</Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">
                {currentProfile.displayName}
              </span>
              <span class="text-[10px] text-[var(--color-text-faint)]">
                saved · {currentProfile.id} · {currentProfile.department}
              </span>
            </div>
            <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
              {currentProfile.authoritySummary}
            </p>

            <div class="flex flex-wrap items-center gap-2 pt-1">
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Status
                <select
                  value={currentProfile.status}
                  disabled={busy}
                  onChange={(e) => changeProfileStatus((e.target as HTMLSelectElement).value as ProfileStatus)}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {PROFILE_STATUSES.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Owner decision
                <select
                  value={currentProfile.ownerDecision}
                  disabled={busy}
                  onChange={(e) => changeProfileDecision((e.target as HTMLSelectElement).value as OwnerDecision)}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {OWNER_DECISIONS.map((d) => (
                    <option value={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setOutput({ kind: 'Agent build packet', text: currentProfile.buildPacket })} disabled={busy} class={btnGhost}>
                Build packet
              </button>
              <button type="button" onClick={profileReviewPacket} disabled={busy} class={btnGhost}>
                Review packet
              </button>
              <button type="button" onClick={profilePromotionChecklist} disabled={busy} class={btnGhost}>
                Promotion readiness
              </button>
              <button type="button" onClick={generateScaffold} disabled={busy} class={btnGhost}>
                Draft promotion scaffold
              </button>
            </div>
          </section>
        )}

        {currentScaffold && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone={currentScaffold.scaffold.readyForGeneration ? 'done' : 'neutral'}>
                {currentScaffold.scaffold.readyForGeneration ? 'ready for generation' : 'not active'}
              </Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">
                {currentScaffold.displayName}
              </span>
              <span class="text-[10px] text-[var(--color-text-faint)]">
                draft scaffold · {currentScaffold.id}
              </span>
            </div>
            <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
              {currentScaffold.scaffold.readinessNote}
            </p>
            <div class="text-[11px] text-[var(--color-text-muted)]">
              Proposed folder: <code class="text-[var(--color-text)]">{currentScaffold.scaffold.proposedFolder}</code>
            </div>
            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                Proposed draft files
              </div>
              <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
                {currentScaffold.scaffold.files.map((f) => (
                  <li>
                    <code class="text-[var(--color-text)]">{f.path}</code> — {f.purpose}
                  </li>
                ))}
              </ul>
            </div>

            <div class="flex flex-wrap items-center gap-2 pt-1">
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Status
                <select
                  value={currentScaffold.status}
                  disabled={busy}
                  onChange={(e) => patchScaffold({ status: (e.target as HTMLSelectElement).value as ScaffoldStatus })}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {SCAFFOLD_STATUSES.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                Owner decision
                <select
                  value={currentScaffold.ownerDecision}
                  disabled={busy}
                  onChange={(e) => patchScaffold({ ownerDecision: (e.target as HTMLSelectElement).value as OwnerDecision })}
                  class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                >
                  {OWNER_DECISIONS.map((d) => (
                    <option value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => copyText(currentScaffold.markdown)} class={btnGhost}>
                <Copy size={12} /> {copied ? 'Copied' : 'Copy packet'}
              </button>
            </div>
            <p class="text-[10.5px] text-[var(--color-text-faint)]">
              Draft only. Not active, not registered, not authorized for live actions. Generation and activation are
              separate owner-owned approvals.
            </p>
          </section>
        )}

        {current && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone={current.verdict === 'SAFE' ? 'done' : 'failed'}>{current.verdict}</Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">{current.title}</span>
              {current.id ? (
                <span class="text-[10px] text-[var(--color-text-faint)]">saved · {current.id}</span>
              ) : (
                <span class="text-[10px] text-[var(--color-text-faint)]">unsaved preview</span>
              )}
            </div>
            <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">{current.notice}</p>

            {current.verdict === 'STOP' && current.hits.length > 0 && (
              <div class="space-y-1.5">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                  Owner-owned stop categories
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {current.hits.map((h) => (
                    <Pill tone="failed">
                      {h.label}: {h.matchedText}
                    </Pill>
                  ))}
                </div>
                {current.decisionsNeeded.length > 0 && (
                  <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
                    {current.decisionsNeeded.map((d) => (
                      <li>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div class="flex flex-wrap items-center gap-2 pt-1">
              {current.id && (
                <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                  Status
                  <select
                    value={current.status}
                    disabled={busy}
                    onChange={(e) => changeStatus((e.target as HTMLSelectElement).value as ForgeStatus)}
                    class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                  >
                    {FORGE_STATUSES.map((s) => (
                      <option value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              {current.id && (
                <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                  Owner decision
                  <select
                    value={current.ownerDecision}
                    disabled={busy}
                    onChange={(e) => changeDecision((e.target as HTMLSelectElement).value as OwnerDecision)}
                    class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                  >
                    {OWNER_DECISIONS.map((d) => (
                      <option value={d}>{d}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button type="button" onClick={completionReport} disabled={busy} class={btnGhost}>
                Completion report
              </button>
              <button type="button" onClick={setupChecklist} disabled={busy} class={btnGhost}>
                Owner setup checklist
              </button>
              <button type="button" onClick={demoRunbook} disabled={busy} class={btnGhost}>
                Demo runbook
              </button>
              <button type="button" onClick={securityCheck} disabled={busy} class={btnGhost}>
                Security gates
              </button>
              <button type="button" onClick={reviewPacket} disabled={busy} class={btnGhost}>
                Codex review packet
              </button>
              <button type="button" onClick={commandPlan} disabled={busy} class={btnGhost}>
                Command plan
              </button>
            </div>

            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Engagement artifact</div>
            <div
              class="chat-md text-[12.5px] text-[var(--color-text)] leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(current.markdown) }}
            />
          </section>
        )}

        {output && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{output.kind}</span>
              <button type="button" onClick={() => copyText(output.text)} class={btnGhost}>
                <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre class="text-[11.5px] text-[var(--color-text)] whitespace-pre-wrap break-words font-mono bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-3 max-h-96 overflow-y-auto">
              {output.text}
            </pre>
            <p class="text-[10.5px] text-[var(--color-text-faint)]">
              Copy this text and run it yourself. Forge never executes review packets or command plans.
            </p>
          </section>
        )}

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">History</h3>
            <button type="button" onClick={loadHistory} class={btnGhost} aria-label="Refresh history">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {history.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No saved engagements yet.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {history.map((h) => (
                <li>
                  <button
                    type="button"
                    onClick={() => reopen(h)}
                    class="w-full text-left py-2 flex items-center gap-2 hover:bg-[var(--color-elevated)] rounded-md px-1.5 transition-colors"
                  >
                    <Pill tone={h.verdict === 'SAFE' ? 'done' : 'failed'}>{h.verdict}</Pill>
                    <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">{h.title}</span>
                    {h.ownerDecision && h.ownerDecision !== 'pending' && (
                      <Pill tone={h.ownerDecision === 'approved' ? 'done' : h.ownerDecision === 'rejected' ? 'failed' : 'neutral'}>
                        {h.ownerDecision}
                      </Pill>
                    )}
                    <span class="text-[10px] text-[var(--color-text-faint)]">{h.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Saved department-agent profiles</h3>
            <button type="button" onClick={loadProfiles} class={btnGhost} aria-label="Refresh saved profiles">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {savedProfiles.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No saved profiles yet.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {savedProfiles.map((p) => (
                <li>
                  <button
                    type="button"
                    onClick={() => reopenProfile(p)}
                    class="w-full text-left py-2 flex items-center gap-2 hover:bg-[var(--color-elevated)] rounded-md px-1.5 transition-colors"
                  >
                    <Pill tone="neutral">{p.activationMode}</Pill>
                    <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">
                      {p.displayName}
                      {p.department ? <span class="text-[var(--color-text-faint)]"> · {p.department}</span> : null}
                    </span>
                    {p.ownerDecision && p.ownerDecision !== 'pending' && (
                      <Pill tone={p.ownerDecision === 'approved' ? 'done' : p.ownerDecision === 'rejected' ? 'failed' : 'neutral'}>
                        {p.ownerDecision}
                      </Pill>
                    )}
                    <span class="text-[10px] text-[var(--color-text-faint)]">{p.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Draft promotion scaffolds</h3>
            <button type="button" onClick={loadScaffolds} class={btnGhost} aria-label="Refresh draft scaffolds">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {savedScaffolds.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No draft scaffolds yet.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {savedScaffolds.map((s) => (
                <li>
                  <button
                    type="button"
                    onClick={() => reopenScaffold(s)}
                    class="w-full text-left py-2 flex items-center gap-2 hover:bg-[var(--color-elevated)] rounded-md px-1.5 transition-colors"
                  >
                    <Pill tone={s.scaffold.readyForGeneration ? 'done' : 'neutral'}>
                      {s.scaffold.readyForGeneration ? 'ready' : 'draft'}
                    </Pill>
                    <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">
                      {s.displayName}
                      <span class="text-[var(--color-text-faint)]"> · {s.proposedSlug}</span>
                    </span>
                    {s.ownerDecision && s.ownerDecision !== 'pending' && (
                      <Pill tone={s.ownerDecision === 'approved' ? 'done' : s.ownerDecision === 'rejected' ? 'failed' : 'neutral'}>
                        {s.ownerDecision}
                      </Pill>
                    )}
                    <span class="text-[10px] text-[var(--color-text-faint)]">{s.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Agent retrofits</h3>
            <button type="button" onClick={loadRetrofits} class={btnGhost} aria-label="Refresh retrofits">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {savedRetrofits.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No retrofits yet.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {savedRetrofits.map((r) => (
                <li>
                  <button
                    type="button"
                    onClick={() => reopenRetrofit(r)}
                    class="w-full text-left py-2 flex items-center gap-2 hover:bg-[var(--color-elevated)] rounded-md px-1.5 transition-colors"
                  >
                    <Pill tone={r.readinessScore >= 70 ? 'done' : r.readinessScore >= 40 ? 'neutral' : 'failed'}>
                      {r.readinessScore}/100
                    </Pill>
                    <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">
                      {r.displayName}
                      <span class="text-[var(--color-text-faint)]"> · {r.agentSlug}</span>
                    </span>
                    {r.ownerDecision && r.ownerDecision !== 'pending' && (
                      <Pill tone={r.ownerDecision === 'approved' ? 'done' : r.ownerDecision === 'rejected' ? 'failed' : 'neutral'}>
                        {r.ownerDecision}
                      </Pill>
                    )}
                    <span class="text-[10px] text-[var(--color-text-faint)]">{r.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Writeback proposals</h3>
            <button type="button" onClick={loadWritebacks} class={btnGhost} aria-label="Refresh writeback proposals">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {savedWritebacks.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No writeback proposals yet.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {savedWritebacks.map((p) => (
                <li>
                  <button
                    type="button"
                    onClick={() => reopenWriteback(p)}
                    class="w-full text-left py-2 flex items-center gap-2 hover:bg-[var(--color-elevated)] rounded-md px-1.5 transition-colors"
                  >
                    <Pill tone="neutral">{p.proposal.targetFiles.length} file(s)</Pill>
                    <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">
                      {p.agentSlug}
                      <span class="text-[var(--color-text-faint)]"> · {p.relativeFolderPath}</span>
                    </span>
                    {p.ownerDecision && p.ownerDecision !== 'pending' && (
                      <Pill tone={p.ownerDecision === 'approved' ? 'done' : p.ownerDecision === 'rejected' ? 'failed' : 'neutral'}>
                        {p.ownerDecision}
                      </Pill>
                    )}
                    <span class="text-[10px] text-[var(--color-text-faint)]">{p.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
