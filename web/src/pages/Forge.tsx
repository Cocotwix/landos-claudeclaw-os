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

  // Department-agent builder inputs. Independent of the engagement panel.
  const [agentRequest, setAgentRequest] = useState('');
  const [agentDisplayName, setAgentDisplayName] = useState('');
  const [agentDepartment, setAgentDepartment] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<StoredProfile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<StoredProfile | null>(null);

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

  useEffect(() => {
    loadHistory();
    loadProfiles();
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
            </div>
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
      </div>
    </div>
  );
}
