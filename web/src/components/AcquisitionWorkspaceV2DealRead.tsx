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

interface Props {
  read: AcquisitionIntelligenceView | null;
  readiness: AcquisitionIntelligenceReadiness | null;
  runtime: AcquisitionIntelligenceRuntimeStatus | null;
  /** True when evidence has landed since this read was produced. */
  stale: boolean;
  running: boolean;
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
  read, readiness, runtime, stale, running, error, onRun, onOpenFullIntelligence,
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
      {running && (
        <div class="awv2-ai-note">
          <Clock size={14} /> The analyst is inspecting the retained imagery and reasoning across the property file. This runs locally and takes a few minutes.
        </div>
      )}
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
