// LandOS Deal Read — the Overview face of Acquisition Intelligence.
//
// The analyst produces one judgment across the whole property file. Printing
// that judgment WHOLE onto the Overview is what turned the acquisition command
// center into an analyst report: seven property-story bullets, five market
// bullets, eight constraints, six conflicts, eight unknowns and six next
// actions, above the property the operator came to look at.
//
// This card answers the Overview's one question — "what do I need to know
// about this deal right now?" — in a single scan: the read, why it is
// interesting, what is still open, the strongest exits, the next move. Nothing
// is discarded. The full structured read lives on Property & Market behind its
// own expansion, and this card links straight to it and says how much more is
// there.
//
// Two rules carried over from the full section, because the alternative would
// mislead either way:
//   • It always names who produced the read and on which model.
//   • Rendering NEVER runs the model. The refresh control is the only thing
//     that produces a new read, and it says so.

import { useEffect, useState } from 'preact/hooks';
import { Brain, RefreshCw, AlertTriangle, Clock, Lightbulb, HelpCircle, ArrowUpRight } from 'lucide-preact';

import type {
  AcquisitionIntelligenceView,
  AcquisitionIntelligenceReadiness,
  AcquisitionIntelligenceRuntimeStatus,
} from './AcquisitionWorkspaceV2AcquisitionIntelligence';
import { digestDealRead } from '../lib/acquisition-intelligence-digest';
import { UpdatedOutlookBadge, leadThesis, outlookIsUpdated } from './AcquisitionWorkspaceV2SpecialistReads';
import '../styles/workspace-v2-acquisition-intelligence.css';
import '../styles/workspace-v2-deal-read.css';

export interface IntelligenceRunStageView {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  startedAt?: string | null;
  completedAt?: string | null;
  note?: string | null;
}

export interface IntelligenceRunProgressView {
  runId: string;
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  finishedAt?: string | null;
  currentStage?: string | null;
  stages: IntelligenceRunStageView[];
  layersComplete: number;
  layersPlanned: number;
  error?: string | null;
}

/** Elapsed, in the operator's terms. Never an estimate of what remains: LandOS
 *  does not know how long a specialist will reason, and must not imply it. */
export function elapsedLabel(fromIso: string, nowMs: number): string {
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.round((nowMs - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s elapsed` : `${seconds}s elapsed`;
}

const STAGE_GLYPH: Record<IntelligenceRunStageView['state'], string> = {
  pending: '○', running: '●', complete: '✓', failed: '×', skipped: '–',
};

/**
 * What LandOS is doing, while it is doing it.
 *
 * A finalization run legitimately takes minutes, and until the run published
 * its stages the section showed one static sentence for the whole pass — which
 * is how a healthy run came to be read as a hang. This is a cockpit strip, not
 * a log: the planned layers, which one is working, which have settled, and how
 * long it has been going. No percentage and no ETA, because the run does not
 * know either.
 */
export function IntelligenceRunProgressStrip({ progress }: { progress: IntelligenceRunProgressView }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const live = progress.status === 'running';
  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);

  const layers = progress.stages.filter((stage) => stage.id !== 'preparing' && stage.id !== 'finalizing');
  const current = progress.stages.find((stage) => stage.id === progress.currentStage) ?? null;
  const failed = progress.stages.find((stage) => stage.state === 'failed') ?? null;

  return (
    <div class="awv2-ai-progress" role="status" aria-live="polite">
      <div class="awv2-ai-progress-head">
        <Clock size={14} class={live ? 'spin-slow' : undefined} />
        <strong>{live ? 'Building Deal Intelligence' : progress.status === 'failed' ? 'Intelligence run stopped' : 'Intelligence run complete'}</strong>
      </div>
      {layers.length > 0 && (
        <ol class="awv2-ai-progress-stages">
          {layers.map((stage) => (
            <li key={stage.id} class="awv2-ai-progress-stage" data-state={stage.state} title={stage.note ?? undefined}>
              <span class="awv2-ai-progress-glyph" aria-hidden="true">{STAGE_GLYPH[stage.state]}</span>
              <span>{stage.label.replace(/ Intelligence$/, '')}</span>
            </li>
          ))}
        </ol>
      )}
      <p class="awv2-ai-progress-line">
        {failed
          ? <>{failed.label} — failed{failed.note ? `. ${failed.note}` : ''}</>
          : current
            ? <>{current.label} running</>
            : <>{progress.status === 'running' ? 'Starting' : 'Finished'}</>}
        {' · '}{elapsedLabel(progress.startedAt, live ? nowMs : Date.parse(progress.finishedAt ?? progress.startedAt))}
        {progress.layersPlanned > 0 && <> · {progress.layersComplete} of {progress.layersPlanned} intelligence {progress.layersPlanned === 1 ? 'layer' : 'layers'} complete</>}
      </p>
    </div>
  );
}

interface Props {
  read: AcquisitionIntelligenceView | null;
  readiness: AcquisitionIntelligenceReadiness | null;
  runtime: AcquisitionIntelligenceRuntimeStatus | null;
  /** True when evidence has landed since this read was produced. */
  stale: boolean;
  running: boolean;
  /** Live stage projection for the run in flight. Server-held, so refreshing
   *  or leaving and returning rejoins the same run. */
  progress: IntelligenceRunProgressView | null;
  error: string | null;
  onRun: () => void;
  /** Opens the full read, which lives on Property & Market. */
  onOpenFullIntelligence: () => void;
}

function runtimeLine(
  runtime: AcquisitionIntelligenceRuntimeStatus | AcquisitionIntelligenceView['runtime'] | null,
): string {
  if (!runtime) return 'Acquisition Analyst';
  const agent = runtime.agentProfile || 'Acquisition Analyst';
  const model = [runtime.provider, runtime.model].filter(Boolean).join('/');
  return model ? `${agent} · ${model}` : agent;
}

export function DealReadCard({
  read, readiness, runtime, stale, running, progress, error, onRun, onOpenFullIntelligence,
}: Props) {
  const digest = digestDealRead(read);

  return (
    <section class="awv2-ai awv2-dealread" data-domain="action" aria-label="LandOS Deal Read" id="acquisition-intelligence" data-outlook={outlookIsUpdated(read?.outlook) ? 'UPDATED' : undefined}>
      <header class="awv2-ai-head">
        <div>
          <div class="awv2-dom-eyebrow" data-dom="action"><Brain size={13} /> LandOS Deal Read</div>
          <h2>{digest?.headline ?? 'No acquisitions read has been produced for this property yet.'}</h2>
          <p class="awv2-ai-attribution">
            {read
              ? <>Read by {runtimeLine(read.runtime ?? runtime)}{read.generatedAt ? ` · ${new Date(read.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</>
              : <>Would be read by {runtimeLine(runtime)}</>}
          </p>
        </div>
        <div class="awv2-ai-actions">
          {digest?.confidence && <span class={`awv2-ai-weight w-${digest.confidence.toLowerCase().replace(/\s+/g, '-')}`}>{digest.confidence}</span>}
          <button type="button" class="awv2-ai-run" disabled={running} onClick={onRun}>
            <RefreshCw size={14} class={running ? 'spin' : undefined} />
            {running ? 'Reading the property file…' : read ? 'Re-read the property file' : 'Read the property file'}
          </button>
        </div>
      </header>

      {error && <div class="awv2-ai-note bad"><AlertTriangle size={14} /> {error}</div>}
      {running && (progress
        ? <IntelligenceRunProgressStrip progress={progress} />
        : (
          <div class="awv2-ai-note">
            <Clock size={14} /> The analyst is inspecting the retained imagery and reasoning across the property file. This runs locally and takes a few minutes.
          </div>
        ))}
      {!read && !running && readiness && readiness.ok === false && (
        <div class="awv2-ai-note bad"><AlertTriangle size={14} /> {readiness.reason}</div>
      )}
      {!read && !running && readiness?.ok && (
        <div class="awv2-ai-note">
          The property file is ready to read. Nothing runs until you ask for it, so this section stays empty until then.
        </div>
      )}
      {read && stale && (
        <div class="awv2-ai-note warn">
          <AlertTriangle size={14} /> New property evidence has landed since this read was produced. Re-read it to reason over the current file.
        </div>
      )}
      {runtime?.provisioned === false && (
        <div class="awv2-ai-note warn">
          <AlertTriangle size={14} /> The Acquisition Analyst is not provisioned on this machine. Run <code>npm run landos:hermes:analyst</code>.
        </div>
      )}

      {digest && (
        <>
          {/* The persisted Current Deal Read is the Deal Brain's own brief and
              supersedes the deterministic digest judgment when present.
              Rendering never generates it. */}
          <UpdatedOutlookBadge outlook={read?.outlook} testid="deal-outlook" />
          {/* The verdict, not the memo. The Deal Brain's own lead paragraph
              carries the conclusion; three persisted items say what the
              opportunity, the risk and the next move are. The whole Current
              Deal Read stays verbatim below, collapsed. Nothing is generated
              here and no strategy, risk or action is restated twice. */}
          {(leadThesis(read?.currentDealRead) ?? digest.judgment) && (
            <p class="awv2-dealread-verdict" data-testid="deal-verdict">
              {leadThesis(read?.currentDealRead) ?? digest.judgment}
            </p>
          )}

          <div class="awv2-dealread-verdictgrid" data-testid="deal-verdict-grid">
            {(read?.bestCurrentStrategy?.strategy || digest.strategies[0]) && (
              <div class="awv2-dealread-tile t-good" data-kind="opportunity" data-testid="best-current-executable-strategy">
                <b><Lightbulb size={13} /> Current opportunity</b>
                <strong>{read?.bestCurrentStrategy?.strategy ?? digest.strategies[0]?.strategy}</strong>
                <span>{read?.bestCurrentStrategy?.why ?? digest.strategies[0]?.whyItFits ?? ''}</span>
              </div>
            )}
            {digest.questions[0] && (
              <div class="awv2-dealread-tile t-open" data-kind="risk">
                <b><HelpCircle size={13} /> Biggest risk / unknown</b>
                <strong>{digest.questions[0].title}</strong>
                <span>{digest.questions[0].why ?? ''}</span>
              </div>
            )}
            {digest.nextMove && (
              <div class="awv2-dealread-tile t-next" data-kind="next">
                <b><ArrowUpRight size={13} /> Next move</b>
                <strong>{digest.nextMove.action}</strong>
                <span>{digest.nextMove.why ?? ''}</span>
              </div>
            )}
          </div>

          {read?.highestUpsideHypothesis?.strategy && (
            <p class="awv2-specialist-line" data-testid="highest-upside-hypothesis"><b>Highest-upside hypothesis</b> {read.highestUpsideHypothesis.strategy}{read.highestUpsideHypothesis.why ? ` — ${read.highestUpsideHypothesis.why}` : ''}</p>
          )}

          {read?.currentDealRead && (
            <details class="awv2-specialist-details awv2-fullread">
              <summary>Current Deal Read</summary>
              <div class="awv2-ai-judgment" data-testid="deal-current-read">
                {read.currentDealRead.split(/\n{2,}/).map((paragraph) => <p>{paragraph}</p>)}
              </div>
            </details>
          )}

          <button type="button" class="awv2-dealread-open" onClick={onOpenFullIntelligence}>
            View full property intelligence →
            <small>
              {digest.depth.insights} retained insight{digest.depth.insights === 1 ? '' : 's'}
              {digest.depth.strategies > digest.strategies.length ? ` · ${digest.depth.strategies} strategies assessed` : ''}
              {digest.depth.questions > digest.questions.length ? ` · ${digest.depth.questions} open questions` : ''}
            </small>
          </button>
        </>
      )}
    </section>
  );
}
