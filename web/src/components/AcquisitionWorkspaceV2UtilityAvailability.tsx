// Acquisition Workspace V2 — Deal Card → Public water and public sewer.
//
// The panel exists because "Utilities: not established" was a true sentence
// that cost the operator the whole question. Water and sewer are separate
// acquisitions questions, each with six dimensions that different evidence
// answers at different strengths, and a surface that collapses them into one
// chip has thrown away the part that decides whether a subdivision pencils.
//
// Three rendering rules carry this panel's honesty:
//
//   1. EVERY DIMENSION SHOWS ITS EVIDENCE LEVEL. Area context, corridor
//      infrastructure and subject availability are visually distinct, because
//      the operator's whole risk here is reading one as another.
//   2. CONTEXT IS LABELLED AS CONTEXT. The neighborhood service pattern and any
//      traced adjacent development render under a heading that says they are
//      surrounding evidence, never under the subject's own answer.
//   3. WHEN ONLY THE PROVIDER CAN ANSWER, THE PANEL SAYS SO AND HANDS THE
//      OPERATOR THE REQUEST. "Unresolved" with no next move is the failure this
//      replaces; the written inquiry, already carrying what we established, is
//      the product.
//
// The panel READS. It never runs research: everything below is a pure
// projection of retained observations, which is why a hard refresh costs
// nothing and calls nothing.
import { useEffect, useState } from 'preact/hooks';

import { apiGet, dashboardToken } from '@/lib/api';

import { Disclosure } from './AcquisitionWorkspaceV2Diligence';
import '../styles/workspace-v2-utility-availability.css';

type EvidenceLevel = 'area_service' | 'corridor_infrastructure' | 'subject_availability';

interface Dimension {
  state: string;
  basis: EvidenceLevel | null;
  statement: string;
  sources: string[];
}

interface UtilityResolution {
  kind: 'water' | 'sewer';
  provider: Dimension & { name: string | null; providerType: string | null };
  territory: Dimension;
  infrastructure: Dimension & {
    layerName: string | null;
    mainSizeInches: number | null;
    pressureZone: string | null;
    lineType: string | null;
    liftStationObserved: boolean | null;
    screenshotPath: string | null;
  };
  connection: Dimension;
  capacity: Dimension;
  extension: Dimension;
  areaContext: Array<{ statement: string; source: string; sourceUrl: string | null }>;
  highestEvidenceLevel: EvidenceLevel | null;
  doesNotEstablish: string[];
  confirmationRequired: boolean;
  laneOutcome: string;
  headline: string;
}

interface ConfirmationRequest {
  kind: 'water' | 'sewer';
  subjectLine: string;
  contact: { name: string; phone?: string | null; email?: string | null; formUrl?: string | null; websiteUrl?: string | null; department?: string | null } | null;
  knownEvidence: string[];
  questions: string[];
  messageBody: string;
  whyRequired: string;
}

interface ResearchPlan {
  nextStep: string | null;
  rationale: string;
  researchExhausted: boolean;
  withheldSteps: Array<{ step: string; reason: string }>;
}

export interface UtilityAvailabilityProjection {
  depth: string;
  water: UtilityResolution;
  sewer: UtilityResolution;
  waterPlan: ResearchPlan;
  sewerPlan: ResearchPlan;
  neighborhoodPattern: {
    established: boolean;
    water: string;
    wastewater: string;
    observedLotCount: number | null;
    statement: string;
    source: string;
    sourceUrl: string | null;
  } | null;
  admittedLeads: Array<{ lead: { kind: string; label: string }; reason: string }>;
  refusedLeads: Array<{ lead: { kind: string; label: string }; reason: string }>;
  developmentFindings: Array<{
    kind: string;
    projectName: string;
    reachesSubjectCorridor: boolean;
    statement: string;
    details: Array<{ label: string; value: string }>;
    source: string;
    sourceUrl: string | null;
  }>;
  historicalReadings: Array<{
    kind: string;
    projectName: string;
    proposedInfrastructure: string[];
    statement: string;
    useInConfirmation: string;
    source: string;
    sourceUrl: string | null;
  }>;
  waterConfirmation: ConfirmationRequest | null;
  sewerConfirmation: ConfirmationRequest | null;
  researchNotes: string[];
  researchedAt: string;
}

const LEVEL_LABEL: Record<EvidenceLevel, string> = {
  area_service: 'Level 1 · area context',
  corridor_infrastructure: 'Level 2 · corridor infrastructure',
  subject_availability: 'Level 3 · subject availability',
};

const STATE_LABEL: Record<string, string> = {
  // Infrastructure relationship.
  AT_SUBJECT: 'Mapped at the parcel',
  ON_SUBJECT_ROAD: 'Mapped on the subject road',
  ADJACENT: 'Mapped adjacent',
  NEARBY: 'Mapped nearby only',
  NOT_SHOWN: 'Not shown on the layer read',
  UNKNOWN: 'Unresolved',
  // Provider and territory.
  identified: 'Identified',
  inside: 'Inside the service territory',
  outside: 'Outside the service territory',
  not_mapped: 'No published territory',
  // Connection, capacity, extension.
  available: 'Available',
  conditionally_available: 'Conditionally available',
  written_confirmation_required: 'Written confirmation required',
  not_available: 'Not available',
  unresolved: 'Unresolved',
  confirmed: 'Confirmed',
  limited: 'Limited',
  not_confirmed: 'Not confirmed',
  not_indicated: 'Not indicated',
  likely_required: 'Likely required',
  confirmed_required: 'Confirmed required',
};

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/** Tone communicates certainty, never optimism about the answer. */
function toneFor(basis: EvidenceLevel | null, state: string): string {
  if (state === 'not_available') return 'bad';
  if (state === 'available' || state === 'confirmed') return 'good';
  if (basis === 'subject_availability') return 'good';
  if (basis === 'corridor_infrastructure') return 'neutral';
  if (basis === 'area_service') return 'warn';
  return 'muted';
}

function Row({ label, dimension, extra }: { label: string; dimension: Dimension; extra?: string | null }) {
  return (
    <div class={`awv2-util-row tone-${toneFor(dimension.basis, dimension.state)}`}>
      <div class="awv2-util-row-head">
        <span class="k">{label}</span>
        <b class="v">{stateLabel(dimension.state)}{extra ? ` · ${extra}` : ''}</b>
        <span class="lvl">{dimension.basis ? LEVEL_LABEL[dimension.basis] : 'Not established'}</span>
      </div>
      <p class="awv2-util-row-note">{dimension.statement}</p>
      {dimension.sources.length > 0 && (
        <div class="awv2-util-row-src">{dimension.sources.map((source) => <span>{source}</span>)}</div>
      )}
    </div>
  );
}

function UtilityBlock({ resolution, plan, confirmation, context }: {
  resolution: UtilityResolution;
  plan: ResearchPlan;
  confirmation: ConfirmationRequest | null;
  context: {
    pattern: UtilityAvailabilityProjection['neighborhoodPattern'];
    development: UtilityAvailabilityProjection['developmentFindings'];
    historical: UtilityAvailabilityProjection['historicalReadings'];
  };
}) {
  const kindLabel = resolution.kind === 'water' ? 'Public water' : 'Public sewer';
  const infra = resolution.infrastructure;
  const infraExtra = [
    infra.mainSizeInches ? `${infra.mainSizeInches}-inch main` : null,
    infra.pressureZone ? `pressure zone ${infra.pressureZone}` : null,
    resolution.kind === 'sewer' && infra.lineType && infra.lineType !== 'unknown' ? infra.lineType.replace('_', ' ') : null,
    infra.liftStationObserved ? 'lift station observed' : null,
  ].filter(Boolean).join(', ') || null;

  return (
    <div class="awv2-util-block" data-utility={resolution.kind} data-lane={resolution.laneOutcome}>
      <div class={`awv2-util-headline tone-${toneFor(resolution.highestEvidenceLevel, resolution.connection.state)}`}>
        <small>{kindLabel}</small>
        <b data-testid={`utility-headline-${resolution.kind}`}>{resolution.headline}</b>
        <span class="lane">Research lane: {resolution.laneOutcome}</span>
      </div>

      <div class="awv2-util-rows">
        <Row
          label="Provider"
          dimension={resolution.provider}
          extra={resolution.provider.name ?? null}
        />
        <Row label="Service territory" dimension={resolution.territory} />
        <Row
          label={resolution.kind === 'water' ? 'Water infrastructure' : 'Sewer infrastructure'}
          dimension={infra}
          extra={infraExtra}
        />
        <Row label="Connection" dimension={resolution.connection} />
        <Row label={resolution.kind === 'water' ? 'Capacity & fire flow' : 'Capacity'} dimension={resolution.capacity} />
        <Row label="Extension" dimension={resolution.extension} />
      </div>

      {infra.screenshotPath && (
        <div class="awv2-util-shot">
          {/* The capture is served by the dashboard, which authenticates every
              request; an <img> cannot carry a header, so the token rides the
              query string the same way every other retained image here does. */}
          <img
            src={`${infra.screenshotPath}?token=${encodeURIComponent(dashboardToken)}`}
            alt={`${kindLabel} layer at the subject parcel`}
            loading="lazy"
          />
          <small>{infra.layerName ? `Layer: ${infra.layerName}` : 'Official utility map capture'}</small>
        </div>
      )}

      {(context.pattern?.established || context.development.length > 0 || context.historical.length > 0) && (
        <div class="awv2-util-context">
          <h4>Surrounding evidence — context, not a finding about this parcel</h4>
          {context.pattern?.established && (
            <p data-testid={`utility-neighborhood-${resolution.kind}`}>
              {context.pattern.statement}
              <span class="src">{context.pattern.source}</span>
            </p>
          )}
          {context.development.filter((entry) => entry.kind === resolution.kind).map((entry) => (
            <p>
              {entry.statement}
              {entry.details.length > 0 && (
                <span class="det">{entry.details.map((detail) => `${detail.label}: ${detail.value}`).join(' · ')}</span>
              )}
              <span class="src">{entry.source}</span>
            </p>
          ))}
          {context.historical.filter((entry) => entry.kind === resolution.kind).map((entry) => (
            <p data-testid={`utility-historical-${resolution.kind}`}>
              {entry.statement}
              <span class="src">{entry.source}</span>
            </p>
          ))}
        </div>
      )}

      <div class="awv2-util-next">
        <small>Next</small>
        <b>{plan.nextStep ? plan.rationale : plan.rationale}</b>
      </div>

      {confirmation && (
        <Disclosure label={`Written ${resolution.kind} availability request — ready to send`} count={confirmation.questions.length}>
          <p class="awv2-util-why">{confirmation.whyRequired}</p>
          {confirmation.contact && (
            <div class="awv2-util-contact">
              <b>{confirmation.contact.name}</b>
              {confirmation.contact.department && <span>{confirmation.contact.department}</span>}
              {confirmation.contact.phone && <span>{confirmation.contact.phone}</span>}
              {confirmation.contact.email && <span>{confirmation.contact.email}</span>}
              {confirmation.contact.formUrl && <a href={confirmation.contact.formUrl} target="_blank" rel="noreferrer">Service request form</a>}
              {confirmation.contact.websiteUrl && <a href={confirmation.contact.websiteUrl} target="_blank" rel="noreferrer">Provider site</a>}
            </div>
          )}
          {confirmation.knownEvidence.length > 0 && (
            <>
              <h5>Context to give them</h5>
              <ul>{confirmation.knownEvidence.map((line) => <li>{line}</li>)}</ul>
            </>
          )}
          <h5>Questions to ask</h5>
          <ol>{confirmation.questions.map((question) => <li>{question}</li>)}</ol>
          <h5>Ready to send</h5>
          <pre class="awv2-util-message">{confirmation.messageBody}</pre>
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Load the retained utility read once per Deal Card.
 *
 * Exported because more than one block on Property & Market has to answer
 * "does this parcel have public water", and two blocks reading two different
 * stores is precisely how a confirmed finding ends up under a contradicting
 * header. One fetch, one value, both renderers.
 */
export function useUtilityAvailability(dealId?: number): {
  projection: UtilityAvailabilityProjection | null;
  loaded: boolean;
} {
  const [projection, setProjection] = useState<UtilityAvailabilityProjection | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (dealId == null) return;
    let live = true;
    apiGet<{ availability: UtilityAvailabilityProjection | null }>(`/api/landos/deal-cards/${dealId}/utility-availability`)
      .then((response) => { if (live) { setProjection(response.availability); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [dealId]);

  return { projection, loaded };
}

/** The one-line read the coarser Utilities section shows, from this same source. */
export function utilityMetricValue(projection: UtilityAvailabilityProjection | null): string | null {
  if (!projection) return null;
  const label = (resolution: UtilityAvailabilityProjection['water']) => (
    resolution.connection.state === 'available' || resolution.connection.state === 'conditionally_available'
      ? stateLabel(resolution.connection.state)
      : `${stateLabel(resolution.infrastructure.state)} · ${stateLabel(resolution.connection.state).toLowerCase()}`
  );
  return `Water: ${label(projection.water)} — Sewer: ${label(projection.sewer)}`;
}

export function UtilityAvailabilityPanel({ projection }: { projection: UtilityAvailabilityProjection | null }) {
  // Nothing retained is not a finding. Rendering an empty resolution here would
  // read as "we looked and found nothing", which is a different claim.
  if (!projection) return null;

  const refused = projection.refusedLeads;

  return (
    <section data-domain="risk" class="awv2-panel" id="utility-availability" data-testid="utility-availability-panel">
      <div class="awv2-panel-title">
        Public water &amp; public sewer availability
        <span class="awv2-src-tag">{projection.depth === 'DEEP_DEVELOPMENT' ? 'deep development depth' : 'standard depth'} · retained research</span>
      </div>

      <p class="awv2-util-doctrine">
        Provider, service territory, infrastructure, connection, capacity and extension are separate
        questions. Nearby service never establishes a line on this road, and a mapped line never
        establishes the right to connect, the capacity to serve, or fire flow.
      </p>

      <div class="awv2-util-grid">
        <UtilityBlock
          resolution={projection.water}
          plan={projection.waterPlan}
          confirmation={projection.waterConfirmation}
          context={{
            pattern: projection.neighborhoodPattern,
            development: projection.developmentFindings,
            historical: projection.historicalReadings,
          }}
        />
        <UtilityBlock
          resolution={projection.sewer}
          plan={projection.sewerPlan}
          confirmation={projection.sewerConfirmation}
          context={{
            pattern: projection.neighborhoodPattern,
            development: projection.developmentFindings,
            historical: projection.historicalReadings,
          }}
        />
      </div>

      <Disclosure label="Research routes taken, and the leads deliberately not chased" count={projection.researchNotes.length + refused.length}>
        {projection.researchNotes.length > 0 && (
          <>
            <h5>What the research did</h5>
            <ul>{projection.researchNotes.map((note) => <li>{note}</li>)}</ul>
          </>
        )}
        {projection.admittedLeads.length > 0 && (
          <>
            <h5>Leads researched</h5>
            <ul>{projection.admittedLeads.map((entry) => <li><b>{entry.lead.label}</b> — {entry.reason}</li>)}</ul>
          </>
        )}
        {refused.length > 0 && (
          <>
            <h5>Leads deliberately not researched</h5>
            <ul>{refused.map((entry) => <li><b>{entry.lead.label}</b> — {entry.reason}</li>)}</ul>
          </>
        )}
        {projection.waterPlan.withheldSteps.length > 0 && (
          <>
            <h5>Withheld by research depth</h5>
            <ul>{projection.waterPlan.withheldSteps.map((entry) => <li>{entry.reason}</li>)}</ul>
          </>
        )}
        <p class="awv2-util-asof">Research retained {new Date(projection.researchedAt).toLocaleString()}.</p>
      </Disclosure>
    </section>
  );
}
