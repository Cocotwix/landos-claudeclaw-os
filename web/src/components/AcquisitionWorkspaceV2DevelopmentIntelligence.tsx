import { ExternalLink, FileWarning, ShieldAlert } from 'lucide-preact';

export interface DevelopmentIntelligenceView {
  researchDepth: 'STANDARD' | 'DEEP_DEVELOPMENT';
  researchStatus: { run: 'complete'; underwriting: 'resolved' | 'material_items_unresolved'; note: string };
  currentTruth: {
    owner: string | null; acreage: number | null; improvementStatus: string; improvementNote: string | null;
    providerAccessSignal: string; recordedLegalAccess: string; surveyedFrontage: string; physicalEntrance: string;
  };
  acquisitionHistory: Array<{ date: string | null; event: string; owner: string | null; acreage: number | null; instrument: string | null; consideration: string | null; confidence: string; sourceTitle: string }>;
  documents: Array<{ category: string; title: string; authority: string; instrument: string | null; summary: string; retrievalStatus: string; imageStatus: 'available' | 'not_publicly_available' | 'not_applicable'; sourceUrl: string | null; artifactUrl: string | null }>;
  zoning: { currentStatus: string; lastConfirmed: string | null; transition: string | null; underwritingRule: string | null } | null;
  authorities: Array<{ role: string; authority: string; responsibility: string }>;
  infrastructure: Array<{ system: string; status: string; authority: string | null }>;
  developmentHistory: Array<{ date: string | null; event: string; status: string; significance: string | null }>;
  paths: Array<{ path: string; practicalYield: string; process: string; economics: string; decision: string }>;
  recommendation: { strategy: string; basis: string; quickFlip: string; majorDevelopment: string; maximumBasis: string } | null;
  unknowns: string[];
}

const acres = (value: number | null) => value == null ? 'Unresolved' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} AC`;

export function OwnerAcquisitionCard({ dossier }: { dossier: DevelopmentIntelligenceView }) {
  const current = dossier.currentTruth;
  return (
    <section class="awv2-panel" data-domain="evidence" data-testid="owner-acquisition-card">
      <div class="awv2-panel-title">Owner acquisition &amp; current property truth</div>
      <div class="awv2-kv">
        <div><span>Current owner</span><b>{current.owner || 'Unresolved'}</b></div>
        <div><span>Current holding</span><b>{acres(current.acreage)}</b></div>
        <div><span>Current improvement read</span><b>{current.improvementStatus.replace(/_/g, ' ')}</b>{current.improvementNote && <small>{current.improvementNote}</small>}</div>
        <div><span>Research depth</span><b>{dossier.researchDepth.replace('_', ' ')}</b><small>{dossier.researchStatus.note}</small></div>
      </div>
      {dossier.acquisitionHistory.map((event) => (
        <div class="awv2-pi-note"><b>{event.date || 'Date unresolved'} · {event.event}</b> — {event.owner || 'party unresolved'} · {acres(event.acreage)}{event.instrument ? ` · ${event.instrument}` : ''}{event.consideration ? ` · ${event.consideration}` : ''} <i>({event.confidence})</i></div>
      ))}
    </section>
  );
}

export function DevelopmentIntelligencePanel({ dossier }: { dossier: DevelopmentIntelligenceView }) {
  const current = dossier.currentTruth;
  return (
    <section class="awv2-panel" data-domain="property" id="development-intelligence" data-testid="development-intelligence">
      <div class="awv2-panel-title">Recorded documents &amp; decisive development underwriting</div>
      <div class="awv2-pi-note"><b>{dossier.researchStatus.note}</b> Completion of the research run is not a claim that every underwriting item is resolved.</div>

      <h3>Four separate access questions</h3>
      <div class="awv2-kv">
        <div><span>Provider / physical signal</span><b>{current.providerAccessSignal}</b></div>
        <div><span>Recorded legal access</span><b>{current.recordedLegalAccess}</b></div>
        <div><span>Surveyed frontage</span><b>{current.surveyedFrontage}</b></div>
        <div><span>Confirmed entrance</span><b>{current.physicalEntrance}</b></div>
      </div>

      {dossier.zoning && <>
        <h3>Zoning transition</h3>
        <div class="awv2-kv">
          <div><span>Current status</span><b>{dossier.zoning.currentStatus}</b></div>
          <div><span>Last parcel-specific designation</span><b>{dossier.zoning.lastConfirmed || 'Not retained'}</b></div>
          <div><span>Code transition</span><b>{dossier.zoning.transition || 'Not retained'}</b></div>
          <div><span>Underwriting rule</span><b>{dossier.zoning.underwritingRule || 'Agency confirmation required'}</b></div>
        </div>
      </>}

      <h3>Recorded document findings</h3>
      {dossier.documents.map((document) => (
        <article class="awv2-pi-note">
          <b>{document.title}</b>{document.instrument ? ` · ${document.instrument}` : ''} · {document.authority}
          <p>{document.summary}</p>
          {document.imageStatus === 'not_publicly_available' && <p><FileWarning size={14} /> <b>DOCUMENT IMAGE NOT PUBLICLY AVAILABLE</b> — the official reference is retained; no thumbnail is fabricated.</p>}
          {document.artifactUrl && <a href={document.artifactUrl} target="_blank" rel="noreferrer">View retained artifact <ExternalLink size={12} /></a>}
          {!document.artifactUrl && document.sourceUrl && <a href={document.sourceUrl} target="_blank" rel="noreferrer">Open official source <ExternalLink size={12} /></a>}
        </article>
      ))}

      <h3>Who controls what</h3>
      <div class="awv2-kv">{dossier.authorities.map((item) => <div><span>{item.role}</span><b>{item.authority}</b><small>{item.responsibility}</small></div>)}</div>

      <h3>Infrastructure</h3>
      <div class="awv2-kv">{dossier.infrastructure.map((item) => <div><span>{item.system}</span><b>{item.status}</b>{item.authority && <small>{item.authority}</small>}</div>)}</div>

      <h3>Historical development record</h3>
      {dossier.developmentHistory.map((item) => <div class="awv2-pi-note"><b>{item.date || 'Date unresolved'} · {item.event}</b> — {item.status}{item.significance ? ` · ${item.significance}` : ''}</div>)}

      <h3>As-is, minor, and major paths</h3>
      <div class="awv2-kv">{dossier.paths.map((item) => <div><span>{item.path}</span><b>{item.decision}</b><small>Yield: {item.practicalYield}<br />Process: {item.process}<br />Economics: {item.economics}</small></div>)}</div>

      {dossier.recommendation && <div class="awv2-pi-note"><b>Recommended: {dossier.recommendation.strategy}</b><p>{dossier.recommendation.basis}</p><p>Quick flip: {dossier.recommendation.quickFlip}</p><p>Major development: {dossier.recommendation.majorDevelopment}</p><p>Maximum basis: {dossier.recommendation.maximumBasis}</p></div>}
      {dossier.unknowns.length > 0 && <details class="awv2-collapse" open><summary><ShieldAlert size={14} /> Material unknowns ({dossier.unknowns.length})</summary>{dossier.unknowns.map((item) => <div class="awv2-pi-note">{item}</div>)}</details>}
    </section>
  );
}
