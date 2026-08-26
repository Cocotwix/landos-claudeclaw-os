// Acquisition Intelligence — the Overview section that interprets the page.
//
// Every other section on Overview reports what one lane established. This one
// reports what an experienced acquisitions operator would SAY about all of it
// together, so it sits directly under the decision band and reads as a
// judgment rather than another data panel.
//
// Three presentation rules follow from that, and each exists because the
// alternative would mislead:
//
//   • It always names who produced the read and on which model. A judgment an
//     operator cannot attribute is a judgment they cannot weigh.
//   • It never hides the conflicts or the coverage gaps. The read is only as
//     good as the file it was formed from, and the operator has to see that.
//   • Rendering NEVER runs the model. The section shows the persisted read; the
//     refresh button is the only thing that produces a new one, and it says so.

import { useState } from 'preact/hooks';
import {
  Brain, RefreshCw, AlertTriangle, Scale, Lightbulb, ShieldAlert,
  Route, HelpCircle, ArrowUpRight, Image as ImageIcon, Clock,
} from 'lucide-preact';

import '../styles/workspace-v2-acquisition-intelligence.css';

export interface AcquisitionIntelligenceView {
  generatedAt?: string;
  runtime?: {
    engine?: string;
    agentProfile?: string;
    provider?: string;
    model?: string;
    modelSource?: string;
    durationMs?: number;
  };
  dealRead?: { headline?: string; judgment?: string; confidence?: string };
  propertyStory?: string[];
  marketStory?: string[];
  opportunities?: Array<{ title?: string; why?: string | null; whatWouldConfirm?: string | null }>;
  constraints?: Array<{ title?: string; why?: string | null; severity?: string }>;
  strategies?: Array<{
    strategy?: string;
    fit?: string;
    whyItFits?: string | null;
    valueCreation?: string | null;
    whatWeakensIt?: string | null;
    whatToConfirm?: string | null;
  }>;
  visualObservations?: Array<{ visual?: string; observation?: string; basis?: string | null }>;
  conflicts?: Array<{ subject?: string; statement?: string; resolution?: string }>;
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  nextActions?: Array<{ action?: string; why?: string | null }>;
  bestCurrentStrategy?: { strategy?: string; why?: string | null } | null;
  highestUpsideHypothesis?: { strategy?: string; why?: string | null; prerequisites?: string[] } | null;
  basis?: { visualsAvailable?: string[]; coveragePresent?: string[]; coverageAbsent?: string[] };
  warnings?: string[];
}

export interface AcquisitionIntelligenceReadiness {
  ok?: boolean;
  reason?: string | null;
  coverage?: { present?: string[]; absent?: string[] };
  conflicts?: Array<{ subject?: string; statement?: string; resolution?: string; reason?: string }>;
  visualsAvailable?: string[];
}

export interface AcquisitionIntelligenceRuntimeStatus {
  engine?: string;
  agentProfile?: string;
  provider?: string;
  model?: string;
  modelSource?: string;
  provisioned?: boolean;
}

interface Props {
  read: AcquisitionIntelligenceView | null;
  readiness: AcquisitionIntelligenceReadiness | null;
  runtime: AcquisitionIntelligenceRuntimeStatus | null;
  /** True when evidence has landed since this read was produced. */
  stale: boolean;
  running: boolean;
  error: string | null;
  onRun: () => void;
}

const FIT_LABEL: Record<string, string> = {
  strong: 'Strong fit',
  possible: 'Possible',
  weak: 'Weak',
  rejected: 'Does not fit',
};

const label = (key: string): string => key.replace(/_/g, ' ');

function runtimeLine(runtime: AcquisitionIntelligenceRuntimeStatus | AcquisitionIntelligenceView['runtime'] | null): string {
  if (!runtime) return 'Acquisition Analyst';
  const agent = runtime.agentProfile || 'Acquisition Analyst';
  const model = [runtime.provider, runtime.model].filter(Boolean).join('/');
  return model ? `${agent} · ${model}` : agent;
}

export function AcquisitionIntelligenceSection({ read, readiness, runtime, stale, running, error, onRun }: Props) {
  const [openStrategy, setOpenStrategy] = useState<string | null>(null);
  const strategies = (read?.strategies ?? []).filter((strategy) => strategy.strategy);
  const conflicts = read?.conflicts ?? readiness?.conflicts ?? [];
  const coverageAbsent = read?.basis?.coverageAbsent ?? readiness?.coverage?.absent ?? [];

  return (
    <section class="awv2-ai" data-domain="action" aria-label="Acquisition Intelligence" id="acquisition-intelligence">
      <header class="awv2-ai-head">
        <div>
          <div class="awv2-dom-eyebrow" data-dom="action"><Brain size={13} /> Acquisition Intelligence</div>
          <h2>{read?.dealRead?.headline || 'No acquisitions read has been produced for this property yet.'}</h2>
          <p class="awv2-ai-attribution">
            {read
              ? <>Read by {runtimeLine(read.runtime ?? runtime)}{read.generatedAt ? ` · ${new Date(read.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</>
              : <>Would be read by {runtimeLine(runtime)}</>}
          </p>
        </div>
        <div class="awv2-ai-actions">
          {read?.dealRead?.confidence && <span class={`awv2-ai-weight w-${(read.dealRead.confidence || '').toLowerCase().replace(/\s+/g, '-')}`}>{read.dealRead.confidence}</span>}
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

      {read && (
        <>
          {read.dealRead?.judgment && <p class="awv2-ai-judgment">{read.dealRead.judgment}</p>}

          <div class="awv2-ai-stories">
            {!!read.propertyStory?.length && (
              <div class="awv2-ai-story" data-kind="property">
                <h3>What this property is</h3>
                <ul>{read.propertyStory.map((point) => <li>{point}</li>)}</ul>
              </div>
            )}
            {!!read.marketStory?.length && (
              <div class="awv2-ai-story" data-kind="market">
                <h3>What the local market means here</h3>
                <ul>{read.marketStory.map((point) => <li>{point}</li>)}</ul>
              </div>
            )}
          </div>

          {!!strategies.length && (
            <div class="awv2-ai-block">
              <h3><Route size={15} /> Strategies for this property</h3>
              <div class="awv2-ai-strategies">
                {strategies.map((strategy) => {
                  const key = strategy.strategy ?? '';
                  const open = openStrategy === key;
                  return (
                    <div class={`awv2-ai-strategy fit-${strategy.fit ?? 'possible'}`}>
                      <button type="button" onClick={() => setOpenStrategy(open ? null : key)}>
                        <b>{key}</b>
                        <span class="fit">{FIT_LABEL[strategy.fit ?? 'possible'] ?? strategy.fit}</span>
                      </button>
                      {open && (
                        <dl>
                          {strategy.whyItFits && <><dt>Why it fits</dt><dd>{strategy.whyItFits}</dd></>}
                          {strategy.valueCreation && <><dt>What creates the value</dt><dd>{strategy.valueCreation}</dd></>}
                          {strategy.whatWeakensIt && <><dt>What weakens or blocks it</dt><dd>{strategy.whatWeakensIt}</dd></>}
                          {strategy.whatToConfirm && <><dt>What would need confirming</dt><dd>{strategy.whatToConfirm}</dd></>}
                        </dl>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div class="awv2-ai-columns">
            {!!read.opportunities?.length && (
              <div class="awv2-ai-block">
                <h3><Lightbulb size={15} /> Opportunities</h3>
                <ul class="awv2-ai-list">
                  {read.opportunities.map((item) => (
                    <li><b>{item.title}</b>{item.why && <span>{item.why}</span>}{item.whatWouldConfirm && <i>Confirm: {item.whatWouldConfirm}</i>}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!read.constraints?.length && (
              <div class="awv2-ai-block">
                <h3><ShieldAlert size={15} /> Constraints and risks</h3>
                <ul class="awv2-ai-list">
                  {read.constraints.map((item) => (
                    <li class={`sev-${item.severity ?? 'medium'}`}><b>{item.title}</b>{item.why && <span>{item.why}</span>}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {!!conflicts.length && (
            <div class="awv2-ai-block">
              <h3><Scale size={15} /> Conflicting evidence</h3>
              <ul class="awv2-ai-list">
                {conflicts.map((conflict) => (
                  <li><b>{label(conflict.subject ?? 'fact')}</b><span>{conflict.statement}</span><i>{conflict.resolution || conflict.reason}</i></li>
                ))}
              </ul>
            </div>
          )}

          {!!read.visualObservations?.length && (
            <div class="awv2-ai-block">
              <h3><ImageIcon size={15} /> What the imagery shows</h3>
              <ul class="awv2-ai-list">
                {read.visualObservations.map((observation) => (
                  <li><b>{label(observation.visual ?? '')}</b><span>{observation.observation}</span>{observation.basis && <i>{observation.basis}</i>}</li>
                ))}
              </ul>
            </div>
          )}

          <div class="awv2-ai-columns">
            {!!read.unknowns?.length && (
              <div class="awv2-ai-block">
                <h3><HelpCircle size={15} /> Unknowns that could change the decision</h3>
                <ul class="awv2-ai-list">
                  {read.unknowns.map((unknown) => (
                    <li><b>{unknown.question}</b>{unknown.whyItMatters && <span>{unknown.whyItMatters}</span>}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!read.nextActions?.length && (
              <div class="awv2-ai-block">
                <h3><ArrowUpRight size={15} /> Next best actions</h3>
                <ol class="awv2-ai-list">
                  {read.nextActions.map((action) => (
                    <li><b>{action.action}</b>{action.why && <span>{action.why}</span>}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {(coverageAbsent.length > 0 || (read.warnings?.length ?? 0) > 0) && (
            <details class="awv2-ai-basis">
              <summary>What this read was formed from</summary>
              {!!read.basis?.coveragePresent?.length && <p><b>Established:</b> {read.basis.coveragePresent.join(', ')}.</p>}
              {!!coverageAbsent.length && <p><b>Not established yet:</b> {coverageAbsent.join(', ')}. The read is bounded by that.</p>}
              {!!read.basis?.visualsAvailable?.length && <p><b>Retained imagery:</b> {read.basis.visualsAvailable.map(label).join(', ')}.</p>}
              {!!read.warnings?.length && <ul>{read.warnings.map((warning) => <li>{warning}</li>)}</ul>}
            </details>
          )}
        </>
      )}
    </section>
  );
}
