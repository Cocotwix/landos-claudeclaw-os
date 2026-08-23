// Acquisition Workspace V2 — LAND USE & SUBDIVISION panel.
//
// The legal picture for one parcel: who governs it, what the state
// establishes, whether it is zoned, what may be built by right, what may be
// divided by right, and what is still unresolved.
//
// Two rendering rules carry the whole panel's honesty:
//
//   1. Every rule row renders EITHER a value or a named unresolved state.
//      There is no code path that produces an empty rule row, because an
//      operator reads a blank in a legal panel as "no restriction".
//   2. A classification that is not adopted zoning is shown, labelled, and
//      given a warning block — never dropped and never promoted into the
//      zoning slot.
//
// Retrieval diagnostics stay in the backend evidence record. What surfaces here
// is the rule, who said it, how confident LandOS is, and what is missing.

import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { sectionCitationLabel } from '@/lib/format';
import {
  Conclusion, Disclosure, HistoryWarning, StillNeeded, WhatItMeans,
} from './AcquisitionWorkspaceV2Diligence';
import type { AcquisitionIntelligenceView } from './AcquisitionWorkspaceV2AcquisitionIntelligence';
import '../styles/workspace-v2-diligence.css';

/* ────────────────────────────── view types ───────────────────────────── */

export interface SourceView {
  label: string;
  url: string;
  citation: string | null;
  publisher: string | null;
  tier: string;
  isPrimary: boolean;
  excerpt: string | null;
  effectiveDate: string | null;
}

export interface ValueView {
  value: string | null;
  unresolved: string | null;
  qualityLabel: string;
  quality: string;
  sources: SourceView[];
  conflict: { statement: string; sides: Array<{ label: string; url: string; says: string }> } | null;
}

export interface AuthorityView {
  role: string;
  roleLabel: string;
  body: ValueView;
  unitType: string;
  relationship: string | null;
  officialUrl: string | null;
}

export interface UseView {
  structureType: string;
  structureLabel: string;
  status: string;
  statusLabel: string;
  isByRight: boolean;
  reasoning: string;
  unresolved: string | null;
  qualityLabel: string;
  conditions: Array<{ label: string; requirement: string; sourceUrl: string }>;
  statePreemption: { effectLabel: string; statement: string; interaction: string; sources: SourceView[] } | null;
  sources: SourceView[];
}

export interface ScenarioView {
  name: string;
  support: string;
  supportLabel: string;
  legalStatus: string;
  resultingLotCount: number | null;
  acreageBands: string[];
  improvementStatus: string;
  siteBuiltLabel: string;
  modularLabel: string;
  singleWideLabel: string;
  doubleWideLabel: string;
  accessConstraint: string;
  subdivisionPath: string;
  remainingVerification: string[];
  compsRequests: Array<{ label: string; acreageBand: string; status: string; rationale: string }>;
  compsRestOnVerifiedLaw: boolean;
}

export interface LandUseView {
  present: boolean;
  determinedAt: string | null;
  subject: { address: string | null; county: string | null; state: string | null; acres: number | null; parcelId: string | null };
  governingAuthority: {
    pattern: string; patternLabel: string; patternExplanation: string;
    incorporation: ValueView; authorities: AuthorityView[];
  };
  stateFramework: {
    status: string; statusLabel: string;
    provisions: Array<{ kindLabel: string; summary: string; materiality: string; source: SourceView }>;
    localAuthorityRetained: ValueView; sourcesSearchedCount: number; sourcesReadCount: number;
  };
  zoning: {
    presence: string; presenceLabel: string; code: ValueView; districtName: ValueView;
    classificationLabel: string; governingAuthority: string | null;
    nonZoningClassification: { code: string; description: string | null; kindLabel: string; sourceUrl: string | null; caveat: string } | null;
    sourceDisclaimer: string | null;
  };
  byRightUses: UseView[];
  manufacturedHousing: UseView[];
  privateRestrictions: Array<{ statusLabel: string; statement: string }>;
  dimensionalStandards: Array<{ label: string; originalTerm: string; statedValue: string; qualifier: string | null; source: SourceView }>;
  subdivision: {
    governingBody: string | null; ordinanceLabel: string | null; ordinanceUrl: string | null;
    paths: Array<{
      kindLabel: string; originalTerm: string; isByRight: boolean; maximumLots: ValueView;
      reviewPathLabel: string; discretionaryApprovals: string[]; objectiveApprovals: string[]; definition: ValueView;
    }>;
    parentTract: { applies: ValueView; lookbackPeriod: ValueView; priorDivisionHistoryRequired: boolean; requiredVerificationStep: string | null };
    minimumLotArea: ValueView; minimumLotWidth: ValueView; minimumRoadFrontage: ValueView;
    flagLots: ValueView; sharedDriveways: ValueView; privateRoads: ValueView; newRoadTrigger: ValueView;
    surveyRequirement: ValueView; platRequirement: ValueView; reviewPathSummary: string;
  };
  countySubdivisionFallback: {
    label: string; blocker: string; county: string | null; state: string | null;
    summary: string; authorityAttempts: string[];
    minimumLotArea: ValueView; minimumLotWidth: ValueView; minimumRoadFrontage: ValueView;
    publicRoadFrontageRequired: ValueView; newRoadTrigger: ValueView; surveyRequirement: ValueView;
    platRequirement: ValueView; recordingRequirement: ValueView; septicRequirement: ValueView;
    wellRequirement: ValueView; utilityRequirement: ValueView; applicationFee: ValueView;
    publishedReviewTimeline: ValueView;
    paths: Array<{
      kindLabel: string; originalTerm: string; isByRight: boolean;
      maximumLots: ValueView; reviewPathLabel: string; definition: ValueView;
    }>;
    ordinanceLabel: string | null; ordinanceUrl: string | null; sources: SourceView[];
  } | null;
  access: {
    roadName: string | null; roadType: ValueView; statusLabel: string; authority: AuthorityView | null;
    spacingStandards: ValueView; constraintNotes: string[];
  };
  septicWell: {
    authority: AuthorityView | null; perLotApprovalRequired: ValueView; divisionRequiresHealthReview: ValueView;
    minimumAcreage: ValueView; reserveFieldRequirement: ValueView;
    existingSepticInfluence: string | null; existingWellInfluence: string | null;
    unresolved: string[]; scopeNote: string;
  };
  subjectPotential: {
    legal: { statusLabel: string; maximumLots: number | null; reason: string; constraintsApplied: Array<{ constraint: string; value: string }>; missingInputs: string[] };
    physical: { statusLabel: string; plausibleLots: number | null; limitingFactors: string[]; scopeNote: string };
    carveouts: Array<{ retainedAcres: number; basisLabel: string; viabilityLabel: string; eliminationReason: string | null; checks: Array<{ factor: string; outcome: string; detail: string }> }>;
    scenarios: ScenarioView[];
  };
  discoveryQuestions: Array<{ question: string; because: string; unblocks: string }>;
  whatCouldChangeThis: string[];
  failureStates: Array<{ code: string; label: string }>;
  sources: SourceView[];
  lanes: Array<{ label: string; status: string; detail: string }>;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function qualityClass(quality: string): string {
  if (quality === 'verified_official' || quality === 'verified_multiple_official') return 'verified';
  if (quality === 'provisional_official') return 'provisional';
  if (quality === 'conflicting_official') return 'conflict';
  return 'not_found';
}

function statusClass(status: string): string {
  if (status === 'allowed_by_right') return 'verified';
  if (status === 'allowed_by_right_with_objective_conditions') return 'provisional';
  if (status === 'prohibited' || status === 'lawful_nonconforming_only') return 'conflict';
  if (status === 'conditional_or_special_approval_required') return 'provisional';
  return 'not_found';
}

/**
 * One rule row. Renders the value or the named unresolved state, never a blank,
 * and hangs the sources off the value so "who says so" is one click away.
 */
function Rule({ k, v }: { k: string; v: ValueView }) {
  return (
    <>
      <span class="k">{k}</span>
      <span class="v">
        {v.value ? (
          <>
            {v.value}
            <span class={`awv2-lu-q ${qualityClass(v.quality)}`}>{v.qualityLabel}</span>
            {v.sources.length > 0 && (
              <span class="awv2-lu-cites">
                {v.sources.map((s) => (
                  <a href={s.url} target="_blank" rel="noreferrer" title={s.excerpt || s.label}>
                    {s.citation ? sectionCitationLabel(s.citation) : s.label}
                  </a>
                ))}
              </span>
            )}
          </>
        ) : (
          <span class="awv2-lu-unresolved">{v.unresolved || 'Not established.'}</span>
        )}
        {v.conflict && (
          <div class="awv2-opg-warn">
            <b>Rule conflict — requires verification.</b> {v.conflict.statement}
            {v.conflict.sides.map((side) => (
              <div><a href={side.url} target="_blank" rel="noreferrer">{side.label}</a>: {side.says}</div>
            ))}
          </div>
        )}
      </span>
    </>
  );
}

function UseRow({ use }: { use: UseView }) {
  return (
    <div class="awv2-lu-use">
      <div class="awv2-lu-use-head">
        <span class="awv2-lu-use-name">{use.structureLabel}</span>
        <span class={`awv2-opg-badge ${statusClass(use.status)}`}>{use.statusLabel}</span>
      </div>
      <div class="awv2-pi-note">{use.reasoning}</div>
      {use.conditions.length > 0 && (
        <ul class="awv2-opg-list">
          {use.conditions.map((condition) => (
            <li><b>{condition.label}:</b> {condition.requirement}</li>
          ))}
        </ul>
      )}
      {/* State/local interaction is shown for every manufactured type, in both
          directions: a located preemption AND the honest absence of one. */}
      {use.statePreemption && (
        <div class="awv2-pi-note">
          <b>State law:</b> {use.statePreemption.statement} {use.statePreemption.interaction}
        </div>
      )}
      {use.sources.length > 0 && (
        <div class="awv2-opg-links">
          {use.sources.map((s) => (
            <a href={s.url} target="_blank" rel="noreferrer">{s.citation ? sectionCitationLabel(s.citation) : s.label}</a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────── retained source-racing intelligence ───────────────── */

export interface RetainedLandUseIntelligenceView {
  present: boolean;
  determinedAt: string | null;
  authority: {
    determined: boolean;
    municipality: string | null;
    incorporationStatus: string | null;
    roles: Array<{ role: string; name: string | null; level: string | null; determination: string; determinationLabel: string; basis: string | null }>;
    sources: Array<{ label: string; url: string | null; quote: string | null }>;
  } | null;
  currentZoning: {
    established: boolean; statement: string; districtCode: string | null; confidence: string;
    authorityName: string | null;
    references: Array<{ kindLabel: string; value: string | null; asOf: string | null; quote: string; sourceUrl: string | null }>;
    limitations: string[];
  } | null;
  /** The established district's own standards, from the adopted code. */
  districtStandards: {
    districtCode: string;
    contextOnly: boolean;
    rows: Array<{ label: string; value: string }>;
    principalUses: string[];
    specialConditions: string[];
    documents: Array<{ label: string; url: string | null; adoptedOrAsOf: string | null }>;
    limitations: string[];
  } | null;
  backstory: {
    narrative: string; highlights: string[]; openQuestions: string[];
    documents: Array<{ label: string; url: string | null }>;
  } | null;
  subdivision: {
    authorityName: string | null; authorityDetermination: string;
    likelyPathLabel: string | null; likelyPathWhy: string | null; reviewBody: string | null;
    lotCountStatement: string | null;
    rules: Array<{ label: string; value: string; section: string | null; sourceUrl: string | null; confidence: string }>;
    documents: Array<{ label: string; url: string | null }>;
  } | null;
}

/**
 * The subdivision questions a land investor asks first, matched against the
 * rules this jurisdiction actually published.
 *
 * The lane retains every rule it read — this parcel's jurisdiction returned 27
 * of them — and printing all 27 on the main surface is what made this the
 * longest section on the page. These promote the handful an operator decides
 * on; every rule, promoted or not, stays verbatim under Full rules.
 */
const PROMOTED_RULE_FIELDS: Array<{ label: string; match: RegExp }> = [
  { label: 'Minor / simple split framework', match: /minor subdivision|administrative split|maximum lots before major/i },
  { label: 'Frontage standard', match: /minimum frontage|road frontage/i },
  { label: 'Direct-frontage potential', match: /^access requirement/i },
  { label: 'Private / shared access potential', match: /shared driveway|flag lot|private road|public \/ private road/i },
  { label: 'Lot size standard', match: /minimum lot size|lot area/i },
];

/** A rule value is a verbatim ordinance quote; the field grid shows its lead. */
function ruleLead(value: string, max = 92): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max).replace(/[\s,;]+$/, '')}…`;
}

function determinationClass(determination: string): string {
  if (determination === 'confirmed') return 'verified';
  if (determination === 'likely') return 'provisional';
  if (determination === 'ambiguous') return 'conflict';
  return 'not_found';
}

/**
 * What the source-racing lanes already promoted for this parcel.
 *
 * Rendered whenever those snapshots exist, independently of the legal
 * determination above, because a Deal Card can carry a CONFIRMED controlling
 * authority and a full planning backstory with no determination row at all.
 * Current zoning still renders its own unresolved state, and a historical
 * district is shown under a label that says it is history.
 */
function RetainedIntelligence({ r, read }: {
  r: RetainedLandUseIntelligenceView;
  read?: AcquisitionIntelligenceView | null;
}) {
  const rules = r.subdivision?.rules ?? [];
  const promoted = PROMOTED_RULE_FIELDS
    .map((field) => ({ field, rule: rules.find((rule) => field.match.test(rule.label)) }))
    .filter((entry): entry is { field: typeof PROMOTED_RULE_FIELDS[number]; rule: typeof rules[number] } => !!entry.rule);
  const promotedLabels = new Set(promoted.map((entry) => entry.rule.label));
  const remainingRules = rules.filter((rule) => !promotedLabels.has(rule.label));
  const zoningAuthorityName = r.authority?.roles.find((role) => role.name)?.name ?? null;
  const confirmedRules = rules.filter((rule) => rule.confidence === 'confirmed').length;

  // Established subdivision facts are shown on their own footing. Current
  // zoning can stay unresolved while independently confirmed subdivision
  // rules are real, retained and decision-relevant; suppressing them because
  // one other question is open would throw away work the lane already did.
  const whatWeKnow = [
    zoningAuthorityName ? `${zoningAuthorityName} is the controlling zoning and subdivision authority (${r.authority?.roles[0]?.determinationLabel ?? 'confirmed'}).` : null,
    confirmedRules > 0 ? `${confirmedRules} subdivision rule${confirmedRules === 1 ? '' : 's'} confirmed from the jurisdiction's own adopted regulations.` : null,
    r.subdivision?.likelyPathWhy ?? null,
    r.currentZoning?.established && r.currentZoning.districtCode
      ? `Current zoning district established: ${r.currentZoning.districtCode}.`
      : 'Current zoning is not established: no current, parcel-specific official source has stated the district.',
  ].filter((line): line is string => !!line);

  return (
    <>
      {/* Conclusion first: the one question this section exists to answer. */}
      <Conclusion
        label="Current zoning"
        value={r.currentZoning?.established && r.currentZoning.districtCode ? r.currentZoning.districtCode : 'Unresolved'}
        tone={r.currentZoning?.established ? 'good' : 'warn'}
        note={r.currentZoning?.statement ?? null}
      />

      {/*
        The district's OWN standards, kept distinct from the subdivision rules
        below. The subdivision article says how a tract may be divided; these
        say what the resulting lots must be, and on a form-based code the two
        can disagree in a way that changes the yield.
      */}
      {r.districtStandards && (
        <div class="awv2-lu-fields" aria-label={`${r.districtStandards.districtCode} district standards`}>
          {r.districtStandards.rows.map((row) => (
            <div class="awv2-lu-field" key={row.label}>
              <small>{`${r.districtStandards!.districtCode} · ${row.label}`}</small>
              <b>{row.value}</b>
              {r.districtStandards!.contextOnly && <i>context only — district not confirmed current</i>}
            </div>
          ))}
          {r.districtStandards.principalUses.map((use) => (
            <div class="awv2-lu-field" key={use}>
              <small>{`${r.districtStandards!.districtCode} · Building types`}</small>
              <b>{use}</b>
            </div>
          ))}
        </div>
      )}
      {r.districtStandards?.specialConditions.map((condition) => (
        <p class="awv2-record-note" key={condition}>{condition}</p>
      ))}

      {/* The concise field grid. Long ordinance text stays under Full rules. */}
      <div class="awv2-lu-fields" aria-label="Zoning and subdivision fields">
        <div class="awv2-lu-field">
          <small>Controlling authority</small>
          <b>{zoningAuthorityName || 'Unresolved'}</b>
          {r.authority?.roles[0] && <i>{r.authority.roles[0].determinationLabel}</i>}
        </div>
        <div class="awv2-lu-field">
          <small>Current use / allowance status</small>
          <b>{r.currentZoning?.established ? 'Established' : 'Not established'}</b>
          <i>{r.currentZoning?.established ? 'district on record' : 'by-right uses cannot be stated'}</i>
        </div>
        {promoted.map((entry) => (
          <div class="awv2-lu-field">
            <small>{entry.field.label}</small>
            <b>{ruleLead(entry.rule.value)}</b>
            <i>{entry.rule.confidence.replace(/_/g, ' ')}</i>
          </div>
        ))}
        <div class="awv2-lu-field">
          <small>Subdivision path</small>
          <b>{r.subdivision?.likelyPathLabel && r.subdivision.likelyPathLabel !== 'unknown'
            ? r.subdivision.likelyPathLabel
            : 'Not established'}</b>
          <i>{r.subdivision?.reviewBody || 'review body not established'}</i>
        </div>
        <div class="awv2-lu-field">
          <small>Manufactured-home status</small>
          <b>Not established</b>
          <i>evaluated separately from modular homes</i>
        </div>
      </div>

      <div class="awv2-lu-know">
        <h4>What we know</h4>
        <ul>{whatWeKnow.map((line) => <li>{line}</li>)}</ul>
      </div>

      <WhatItMeans read={read ?? null} topic="zoning" />
      <StillNeeded
        read={read ?? null}
        topic="zoning"
        extra={(r.currentZoning?.limitations ?? []).slice(0, 2)}
      />

      {/* ── PROPERTY DEVELOPMENT HISTORY ──
          Visually separate from the current rules above, because it is a
          different kind of fact. A prior approval is real intelligence and
          never an entitlement. */}
      {r.backstory && (
        <div class="awv2-lu-history" id="property-development-history">
          <h4>Property development history</h4>
          {r.backstory.highlights.length > 0 && (
            <ol class="awv2-lu-timeline">
              {r.backstory.highlights.map((highlight) => <li><span /><div>{highlight}</div></li>)}
            </ol>
          )}
          {r.backstory.highlights.length === 0 && <p class="awv2-pi-note">{r.backstory.narrative}</p>}
          <HistoryWarning />
          <Disclosure label="Timeline narrative and official documents" count={r.backstory.documents.length || null}>
            <div class="awv2-pi-note">{r.backstory.narrative}</div>
            {r.backstory.openQuestions.length > 0 && (
              <>
                <div class="awv2-pi-note" style="margin-top:8px"><b>Open questions the record raises</b></div>
                <ul class="awv2-opg-list">
                  {r.backstory.openQuestions.map((question) => <li>{question}</li>)}
                </ul>
              </>
            )}
            {r.backstory.documents.length > 0 && (
              <div class="awv2-opg-links">
                {r.backstory.documents.map((d) => (
                  d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.label}</a> : <span>{d.label}</span>
                ))}
              </div>
            )}
          </Disclosure>
        </div>
      )}

      {/* ── Evidence, kept whole and kept out of the default scan ── */}

      <Disclosure
        label="Official sources"
        count={(r.authority?.sources.length ?? 0) + (r.currentZoning?.references.length ?? 0) + (r.subdivision?.documents.length ?? 0) || null}
      >
        <div class="awv2-opg-sub">Controlling authority</div>
        {r.authority ? (
          <>
            <div class="awv2-kv">
              {r.authority.roles.map((role) => (
                <>
                  <span class="k">{role.role}</span>
                  <span class="v">
                    {role.name
                      ? <>{role.name}{role.level ? ` (${role.level})` : ''}<span class={`awv2-lu-q ${determinationClass(role.determination)}`}>{role.determinationLabel}</span></>
                      : <span class="awv2-lu-unresolved">Unresolved.</span>}
                  </span>
                </>
              ))}
            </div>
            {r.authority.roles.filter((role) => role.basis).map((role) => (
              <div class="awv2-pi-note"><b>{role.role}:</b> {role.basis}</div>
            ))}
            {r.authority.sources.length > 0 && (
              <div class="awv2-opg-links">
                {r.authority.sources.map((s) => (
                  s.url
                    ? <a href={s.url} target="_blank" rel="noreferrer" title={s.quote || s.label}>{s.label}</a>
                    : <span>{s.label}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div class="awv2-pi-note">No controlling authority has been determined for this parcel.</div>
        )}

        {r.currentZoning && r.currentZoning.references.length > 0 && (
          <>
            <div class="awv2-opg-sub">Historical zoning statements</div>
            <div class="awv2-opg-warn">
              <b>Historical zoning statements — these never establish current zoning.</b>
              {' '}Each states what its own document said on its own date.
            </div>
            <ul class="awv2-opg-list">
              {r.currentZoning.references.map((ref) => (
                <li>
                  <b>{ref.kindLabel}{ref.value ? `: ${ref.value}` : ''}</b>
                  {ref.asOf ? <span class="awv2-lu-term"> (as of {ref.asOf})</span> : null}
                  <div class="awv2-pi-note" style="margin-top:2px">“{ref.quote}”</div>
                  {ref.sourceUrl && (
                    <a class="awv2-lu-cite" href={ref.sourceUrl} target="_blank" rel="noreferrer">Official source</a>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {r.subdivision?.documents.length ? (
          <>
            <div class="awv2-opg-sub">Adopted subdivision documents</div>
            <div class="awv2-opg-links">
              {r.subdivision.documents.map((d) => (
                d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.label}</a> : <span>{d.label}</span>
              ))}
            </div>
          </>
        ) : null}
      </Disclosure>

      <Disclosure label="Full rules" count={rules.length || null}>
        {r.subdivision ? (
          <>
            <div class="awv2-kv">
              <span class="k">Governing body</span>
              <span class="v">
                {r.subdivision.authorityName
                  ? <>{r.subdivision.authorityName}<span class={`awv2-lu-q ${determinationClass(r.subdivision.authorityDetermination)}`}>
                      {r.subdivision.authorityDetermination === 'confirmed' ? 'Confirmed' : r.subdivision.authorityDetermination}
                    </span></>
                  : <span class="awv2-lu-unresolved">Subdivision authority unresolved.</span>}
              </span>
              <span class="k">Likely path</span>
              <span class="v">
                {r.subdivision.likelyPathLabel && r.subdivision.likelyPathLabel !== 'unknown'
                  ? r.subdivision.likelyPathLabel
                  : <span class="awv2-lu-unresolved">Not established.</span>}
              </span>
              <span class="k">Review body</span>
              <span class="v">
                {r.subdivision.reviewBody || <span class="awv2-lu-unresolved">Not established.</span>}
              </span>
              <span class="k">Theoretical lots</span>
              <span class="v">
                {r.subdivision.lotCountStatement || <span class="awv2-lu-unresolved">Not established.</span>}
              </span>
            </div>
            {rules.length > 0 ? (
              <ul class="awv2-opg-list">
                {[...promoted.map((entry) => entry.rule), ...remainingRules].map((rule) => (
                  <li>
                    <b>{rule.label}:</b> {rule.value}
                    <span class={`awv2-lu-q ${rule.confidence === 'confirmed' ? 'verified' : 'provisional'}`}>{rule.confidence.replace(/_/g, ' ')}</span>
                    {rule.sourceUrl && (
                      <a class="awv2-lu-cite" href={rule.sourceUrl} target="_blank" rel="noreferrer">
                        {rule.section ? sectionCitationLabel(rule.section) : 'Adopted regulations'}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div class="awv2-pi-note">
                No subdivision rule was extracted from the sources this run retrieved. That is an absence of retrieved text, not evidence that no rule exists.
              </div>
            )}
          </>
        ) : (
          <div class="awv2-pi-note">No subdivision regulations have been retained for this parcel.</div>
        )}
      </Disclosure>

      {(r.currentZoning?.limitations.length || r.determinedAt) && (
        <Disclosure label="Research diagnostics" count={r.currentZoning?.limitations.length || null}>
          {r.currentZoning && r.currentZoning.limitations.length > 0 && (
            <>
              <div class="awv2-pi-note"><b>Why current zoning is not established</b></div>
              <ul class="awv2-opg-list">
                {r.currentZoning.limitations.map((limitation) => <li>{limitation}</li>)}
              </ul>
            </>
          )}
          {r.determinedAt && (
            <div class="awv2-pi-note" style="margin-top:10px">
              Retained {new Date(r.determinedAt).toLocaleString()}
            </div>
          )}
        </Disclosure>
      )}
    </>
  );
}

/* ─────────────────────────────── the panel ───────────────────────────── */

export function LandUsePanel({ dealId, initial, retained, read }: {
  dealId: number;
  initial: LandUseView | null;
  retained?: RetainedLandUseIntelligenceView | null;
  /** The persisted analyst read, for this section's "what it means" line. */
  read?: AcquisitionIntelligenceView | null;
}) {
  const [view, setView] = useState<LandUseView | null>(initial ?? null);
  const [retainedView, setRetainedView] = useState<RetainedLandUseIntelligenceView | null>(retained ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiPost<{ landUse: LandUseView; landUseIntelligence?: RetainedLandUseIntelligenceView | null }>(
        `/api/landos/deal-cards/${dealId}/land-use/run`,
      );
      setView(res.landUse);
      if (res.landUseIntelligence) setRetainedView(res.landUseIntelligence);
    } catch (err) {
      setError((err as Error)?.message || 'Land use research failed.');
    } finally {
      setRunning(false);
    }
  };

  const v = view;
  const researched = !!v?.present;
  const r = retainedView?.present ? retainedView : null;

  return (
    <section class="awv2-panel" id="land-use-subdivision">
      <div class="awv2-panel-title">
        Zoning / land use &amp; subdivision potential
        {researched && (
          <span class={`awv2-opg-badge ${v!.zoning.presence === 'zoning_established' ? 'verified' : v!.zoning.presence === 'no_conventional_zoning' ? 'provisional' : 'not_found'}`}>
            {v!.zoning.presenceLabel}
          </span>
        )}
        <button class="awv2-opg-run" onClick={run} disabled={running}>
          {running ? 'Researching…' : researched ? 'Re-run' : 'Research land use'}
        </button>
      </div>

      {error && <div class="awv2-opg-warn">{error}</div>}

      {/* Promoted source-racing results, shown whenever they exist. */}
      {r && <RetainedIntelligence r={r} read={read ?? null} />}

      {!researched && !r && !running && (
        <div class="awv2-pi-note">
          Zoning and subdivision are not resolved yet. Run land-use research after parcel identity is established.
        </div>
      )}

      {researched && (
        <>
          <div class="awv2-lu-operator-summary">
            <div class="awv2-lu-summary-row"><span>Governing authority</span><b>{v!.governingAuthority.patternLabel}</b></div>
            <div class="awv2-lu-summary-row"><span>Zoning / land use</span><b>{v!.zoning.presenceLabel}</b></div>
            <div class="awv2-lu-summary-row"><span>Uses with located support</span><b>{[...v!.byRightUses, ...v!.manufacturedHousing].filter((use) => use.isByRight).length}</b></div>
            <div class="awv2-lu-summary-row"><span>Subdivision path</span><b>{v!.subdivision.reviewPathSummary || 'Not yet resolved'}</b></div>
            <div class="awv2-lu-summary-row"><span>Legal lot maximum</span><b>{v!.subjectPotential.legal.maximumLots != null ? `${v!.subjectPotential.legal.maximumLots} lots` : 'Not yet resolved'}</b></div>
            <div class="awv2-lu-summary-row"><span>Septic / well</span><b>{v!.septicWell.authority?.body.value || 'Field and authority review still required'}</b></div>
          </div>
          <div class="awv2-pi-note">A rule LandOS has not located remains unresolved; absence from the retained research is not evidence that no rule exists.</div>
          <details class="awv2-collapse awv2-lu-details">
            <summary>Rules matrix, scenarios, sources and diagnostics</summary>
          {/* ── GOVERNING AUTHORITY ── */}
          <div class="awv2-opg-sub">Governing authority</div>
          <div class="awv2-pi-note"><b>{v!.governingAuthority.patternLabel}.</b> {v!.governingAuthority.patternExplanation}</div>
          <div class="awv2-kv" style="margin-top:10px">
            <Rule k="Incorporation" v={v!.governingAuthority.incorporation} />
            {v!.governingAuthority.authorities.map((a) => (
              <Rule k={a.roleLabel} v={a.body} />
            ))}
          </div>

          {/* ── STATE FRAMEWORK ── */}
          <div class="awv2-opg-sub">State framework</div>
          <div class="awv2-kv">
            <span class="k">Status</span>
            <span class="v">
              {v!.stateFramework.statusLabel}
              <span class="awv2-lu-cites-note">
                {v!.stateFramework.sourcesReadCount} of {v!.stateFramework.sourcesSearchedCount} searched source(s) read
              </span>
            </span>
          </div>
          {v!.stateFramework.provisions.length > 0 ? (
            <ul class="awv2-opg-list" style="margin-top:8px">
              {v!.stateFramework.provisions.map((p) => (
                <li>
                  <b>{p.kindLabel}:</b> {p.summary}
                  <div class="awv2-pi-note" style="margin-top:3px">{p.materiality}</div>
                  <a class="awv2-lu-cite" href={p.source.url} target="_blank" rel="noreferrer">
                    {p.source.citation ? sectionCitationLabel(p.source.citation) : p.source.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div class="awv2-pi-note">
              {v!.stateFramework.status === 'not_found'
                ? 'The state\'s own official publication was read and contained no statewide land-division provision material to this subject. Local ordinance governs.'
                : 'The state\'s official legal publication could not be read, so whether a statewide framework applies is unverified. It is not assumed either way.'}
            </div>
          )}

          {/* ── ZONING ── */}
          <div class="awv2-opg-sub">Zoning</div>
          <div class="awv2-kv">
            <span class="k">Status</span>
            <span class="v">{v!.zoning.presenceLabel}</span>
            <Rule k="District" v={v!.zoning.code} />
            <Rule k="District name" v={v!.zoning.districtName} />
            <span class="k">Authority</span>
            {v!.zoning.governingAuthority
              ? <span class="v">{v!.zoning.governingAuthority}</span>
              : <span class="v"><span class="awv2-lu-unresolved">Zoning authority unresolved.</span></span>}
          </div>
          {/* A value that is NOT adopted zoning. Shown and labelled, because
              dropping it hides real evidence and promoting it states a false
              entitlement conclusion. */}
          {v!.zoning.nonZoningClassification && (
            <div class="awv2-opg-warn">
              <b>{v!.zoning.nonZoningClassification.kindLabel}.</b> The official source publishes
              {' '}<code>{v!.zoning.nonZoningClassification.code}</code>
              {v!.zoning.nonZoningClassification.description ? ` (${v!.zoning.nonZoningClassification.description})` : ''} for this parcel.
              <div>{v!.zoning.nonZoningClassification.caveat}</div>
              {v!.zoning.nonZoningClassification.sourceUrl && (
                <div><a href={v!.zoning.nonZoningClassification.sourceUrl} target="_blank" rel="noreferrer">Official source</a></div>
              )}
            </div>
          )}
          {v!.zoning.sourceDisclaimer && <div class="awv2-pi-note">Source states: “{v!.zoning.sourceDisclaimer}”</div>}

          {/* ── BY-RIGHT RESIDENTIAL USES ── */}
          <div class="awv2-opg-sub">By-right residential uses</div>
          {v!.byRightUses.length > 0 ? (
            v!.byRightUses.map((use) => <UseRow use={use} />)
          ) : (
            <div class="awv2-pi-note">No residential use determination was produced.</div>
          )}

          {/* ── MANUFACTURED HOUSING ── */}
          <div class="awv2-opg-sub">Manufactured housing</div>
          <div class="awv2-pi-note">
            A modular home and a HUD-code manufactured home are different legal categories and are evaluated separately.
          </div>
          {v!.manufacturedHousing.map((use) => <UseRow use={use} />)}

          {/* ── DIMENSIONAL STANDARDS ── */}
          <div class="awv2-opg-sub">Dimensional standards</div>
          {v!.dimensionalStandards.length > 0 ? (
            <ul class="awv2-opg-list">
              {v!.dimensionalStandards.map((s) => (
                <li>
                  <b>{s.label}:</b> {s.statedValue}
                  {s.originalTerm !== s.label.toLowerCase() && <span class="awv2-lu-term"> (ordinance term: {s.originalTerm})</span>}
                  {s.qualifier && <div class="awv2-pi-note" style="margin-top:2px">{s.qualifier}</div>}
                  <a class="awv2-lu-cite" href={s.source.url} target="_blank" rel="noreferrer">
                    {s.source.citation ? sectionCitationLabel(s.source.citation) : s.source.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div class="awv2-pi-note">
              No dimensional standard was located in the adopted law LandOS read. That is not the same as there being none.
            </div>
          )}

          {/* ── SUBDIVISION ── */}
          <div class="awv2-opg-sub">Subdivision</div>
          <div class="awv2-kv">
            <span class="k">Governing body</span>
            {v!.subdivision.governingBody
              ? <span class="v">{v!.subdivision.governingBody}</span>
              : <span class="v"><span class="awv2-lu-unresolved">Subdivision authority unresolved.</span></span>}
            <span class="k">Ordinance</span>
            <span class="v">
              {v!.subdivision.ordinanceUrl
                ? <a href={v!.subdivision.ordinanceUrl} target="_blank" rel="noreferrer">{v!.subdivision.ordinanceLabel || 'Adopted code'}</a>
                : <span class="awv2-lu-unresolved">No adopted code was located.</span>}
            </span>
            <Rule k="Minimum lot area" v={v!.subdivision.minimumLotArea} />
            <Rule k="Minimum lot width" v={v!.subdivision.minimumLotWidth} />
            <Rule k="Minimum road frontage" v={v!.subdivision.minimumRoadFrontage} />
            <Rule k="Flag lots" v={v!.subdivision.flagLots} />
            <Rule k="Shared drives" v={v!.subdivision.sharedDriveways} />
            <Rule k="Private roads" v={v!.subdivision.privateRoads} />
            <Rule k="New-road trigger" v={v!.subdivision.newRoadTrigger} />
            <Rule k="Survey" v={v!.subdivision.surveyRequirement} />
            <Rule k="Plat" v={v!.subdivision.platRequirement} />
          </div>

          {v!.subdivision.paths.length > 0 ? (
            <div class="awv2-lu-paths">
              {v!.subdivision.paths.map((p) => (
                <div class="awv2-lu-path">
                  <div class="awv2-lu-use-head">
                    <span class="awv2-lu-use-name">{p.originalTerm}</span>
                    <span class={`awv2-opg-badge ${p.isByRight ? 'verified' : 'conflict'}`}>
                      {p.isByRight ? 'By right' : 'Discretionary'}
                    </span>
                  </div>
                  <div class="awv2-kv" style="margin-top:8px">
                    <Rule k="Maximum lots" v={p.maximumLots} />
                    <span class="k">Review path</span>
                    <span class="v">{p.reviewPathLabel}</span>
                  </div>
                  {p.discretionaryApprovals.length > 0 && (
                    <div class="awv2-pi-note"><b>Discretionary approvals:</b> {p.discretionaryApprovals.join(', ')}</div>
                  )}
                  {p.objectiveApprovals.length > 0 && (
                    <div class="awv2-pi-note">
                      <b>Objective approvals:</b> {p.objectiveApprovals.join(', ')}. These do not make the path discretionary.
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div class="awv2-pi-note">No division procedure was located in the adopted law LandOS read.</div>
          )}

          {/* Parent tract / lookback. Load-bearing: it is what makes a legal
              maximum unresolvable even when every rule is verified. */}
          <div class="awv2-kv" style="margin-top:12px">
            <Rule k="Parent tract rule" v={v!.subdivision.parentTract.applies} />
            <Rule k="Lookback period" v={v!.subdivision.parentTract.lookbackPeriod} />
          </div>
          {v!.subdivision.parentTract.priorDivisionHistoryRequired && (
            <div class="awv2-opg-warn">
              <b>Prior division history required.</b> The controlling rule counts divisions already taken from the parent tract,
              and that history is not in LandOS. No precise legal maximum is published.
              {v!.subdivision.parentTract.requiredVerificationStep && <div>{v!.subdivision.parentTract.requiredVerificationStep}</div>}
            </div>
          )}

          {/* ── COUNTY FALLBACK RULES ──
              Shown only when the controlling local jurisdiction was not
              confirmed. It exists so the operator is never handed only
              "unknown", and it is labelled so it can never be mistaken for the
              governing rule set. */}
          {v!.countySubdivisionFallback && (
            <>
              <div class="awv2-opg-sub">{v!.countySubdivisionFallback.label}</div>
              <div class="awv2-opg-warn">
                <b>{v!.countySubdivisionFallback.blocker}.</b> {v!.countySubdivisionFallback.summary}
              </div>
              <div class="awv2-kv">
                <span class="k">Source jurisdiction</span>
                <span class="v">
                  {[v!.countySubdivisionFallback.county, v!.countySubdivisionFallback.state].filter(Boolean).join(', ')
                    || <span class="awv2-lu-unresolved">Not established.</span>}
                </span>
                <span class="k">County ordinance</span>
                <span class="v">
                  {v!.countySubdivisionFallback.ordinanceUrl
                    ? <a href={v!.countySubdivisionFallback.ordinanceUrl} target="_blank" rel="noreferrer">{v!.countySubdivisionFallback.ordinanceLabel || 'Adopted county code'}</a>
                    : <span class="awv2-lu-unresolved">No adopted county code was located.</span>}
                </span>
                <Rule k="Minimum lot area" v={v!.countySubdivisionFallback.minimumLotArea} />
                <Rule k="Minimum lot width" v={v!.countySubdivisionFallback.minimumLotWidth} />
                <Rule k="Minimum road frontage" v={v!.countySubdivisionFallback.minimumRoadFrontage} />
                <Rule k="Public road frontage" v={v!.countySubdivisionFallback.publicRoadFrontageRequired} />
                <Rule k="New-road trigger" v={v!.countySubdivisionFallback.newRoadTrigger} />
                <Rule k="Survey" v={v!.countySubdivisionFallback.surveyRequirement} />
                <Rule k="Plat" v={v!.countySubdivisionFallback.platRequirement} />
                <Rule k="Recording" v={v!.countySubdivisionFallback.recordingRequirement} />
                <Rule k="Septic" v={v!.countySubdivisionFallback.septicRequirement} />
                <Rule k="Well" v={v!.countySubdivisionFallback.wellRequirement} />
                <Rule k="Utilities" v={v!.countySubdivisionFallback.utilityRequirement} />
                <Rule k="Application fee" v={v!.countySubdivisionFallback.applicationFee} />
                <Rule k="Published timeline" v={v!.countySubdivisionFallback.publishedReviewTimeline} />
              </div>

              {v!.countySubdivisionFallback.paths.length > 0 ? (
                <div class="awv2-lu-paths">
                  {v!.countySubdivisionFallback.paths.map((p) => (
                    <div class="awv2-lu-path">
                      <div class="awv2-lu-use-head">
                        <span class="awv2-lu-use-name">{p.originalTerm}</span>
                        <span class={`awv2-opg-badge ${p.isByRight ? 'verified' : 'conflict'}`}>
                          {p.isByRight ? 'By right' : 'Discretionary'}
                        </span>
                      </div>
                      <div class="awv2-kv" style="margin-top:8px">
                        <Rule k="Maximum lots" v={p.maximumLots} />
                        <span class="k">Review path</span>
                        <span class="v">{p.reviewPathLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div class="awv2-pi-note">
                  No county division procedure was located in the adopted county law LandOS read.
                </div>
              )}

              {v!.countySubdivisionFallback.authorityAttempts.length > 0 && (
                <div class="awv2-pi-note">
                  <b>Authorities checked:</b>
                  {v!.countySubdivisionFallback.authorityAttempts.map((attempt) => <div>{attempt}</div>)}
                </div>
              )}

              {v!.countySubdivisionFallback.sources.length > 0 && (
                <div class="awv2-pi-note">
                  <b>County sources:</b>{' '}
                  {v!.countySubdivisionFallback.sources.map((s, i) => (
                    <>
                      {i > 0 && ' · '}
                      {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}
                    </>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── SEPTIC / WELL ── */}
          <div class="awv2-opg-sub">Septic / well</div>
          <div class="awv2-kv">
            {v!.septicWell.authority
              ? <Rule k="Authority" v={v!.septicWell.authority.body} />
              : (<><span class="k">Authority</span><span class="v"><span class="awv2-lu-unresolved">Septic authority unresolved.</span></span></>)}
            <Rule k="Per-lot approval" v={v!.septicWell.perLotApprovalRequired} />
            <Rule k="Division needs health review" v={v!.septicWell.divisionRequiresHealthReview} />
            <Rule k="Minimum acreage" v={v!.septicWell.minimumAcreage} />
            <Rule k="Reserve field" v={v!.septicWell.reserveFieldRequirement} />
          </div>
          {v!.septicWell.existingSepticInfluence && <div class="awv2-pi-note">{v!.septicWell.existingSepticInfluence}</div>}
          {v!.septicWell.existingWellInfluence && <div class="awv2-pi-note">{v!.septicWell.existingWellInfluence}</div>}
          <div class="awv2-pi-note">{v!.septicWell.scopeNote}</div>

          {/* ── SUBJECT POTENTIAL ── */}
          <div class="awv2-opg-sub">Subject potential</div>
          <div class="awv2-kv">
            <span class="k">Legal maximum</span>
            <span class="v">
              {v!.subjectPotential.legal.maximumLots != null
                ? <>{v!.subjectPotential.legal.maximumLots} lots <span class={`awv2-lu-q ${v!.subjectPotential.legal.statusLabel === 'Established' ? 'verified' : 'provisional'}`}>{v!.subjectPotential.legal.statusLabel}</span></>
                : <span class="awv2-lu-unresolved">Legal maximum unresolved.</span>}
            </span>
            <span class="k">Physical plausible</span>
            <span class="v">
              {v!.subjectPotential.physical.plausibleLots != null
                ? <>{v!.subjectPotential.physical.plausibleLots} lots <span class={`awv2-lu-q ${v!.subjectPotential.physical.statusLabel === 'Established' ? 'verified' : 'provisional'}`}>{v!.subjectPotential.physical.statusLabel}</span></>
                : <span class="awv2-lu-unresolved">Not established.</span>}
            </span>
          </div>
          <div class="awv2-pi-note">{v!.subjectPotential.legal.reason}</div>
          {v!.subjectPotential.legal.constraintsApplied.length > 0 && (
            <ul class="awv2-opg-list">
              {v!.subjectPotential.legal.constraintsApplied.map((cst) => <li><b>{cst.constraint}:</b> {cst.value}</li>)}
            </ul>
          )}
          {v!.subjectPotential.legal.missingInputs.length > 0 && (
            <div class="awv2-opg-warn">
              <b>Required inputs still missing.</b>
              {v!.subjectPotential.legal.missingInputs.map((m) => <div>{m}</div>)}
            </div>
          )}
          <div class="awv2-pi-note">{v!.subjectPotential.physical.scopeNote}</div>

          {v!.subjectPotential.carveouts.length > 0 && (
            <>
              <div class="awv2-opg-sub">House / improvement carveout concepts</div>
              <ul class="awv2-opg-list">
                {v!.subjectPotential.carveouts.map((concept) => (
                  <li>
                    <b>{concept.retainedAcres} ac retained</b> ({concept.basisLabel}) — {concept.viabilityLabel}
                    {concept.eliminationReason && <div class="awv2-pi-note" style="margin-top:2px">{concept.eliminationReason}</div>}
                  </li>
                ))}
              </ul>
              <div class="awv2-pi-note">
                No lot line is proposed and no boundary is drawn. These are candidate configurations for the valuation sprint.
              </div>
            </>
          )}

          {/* ── SCENARIOS + COMPS HANDOFF ── */}
          <div class="awv2-opg-sub">Candidate scenarios &amp; Comps handoff</div>
          {v!.subjectPotential.scenarios.map((s) => (
            <div class="awv2-lu-scenario">
              <div class="awv2-lu-use-head">
                <span class="awv2-lu-use-name">{s.name}</span>
                <span class={`awv2-opg-badge ${s.support === 'supported_for_comp_research' ? 'verified' : s.support === 'requires_verification' ? 'provisional' : 'not_found'}`}>
                  {s.supportLabel}
                </span>
              </div>
              <div class="awv2-kv" style="margin-top:8px">
                <span class="k">Legal status</span><span class="v">{s.legalStatus}</span>
                <span class="k">Resulting lots</span>
                <span class="v">{s.resultingLotCount != null ? s.resultingLotCount : <span class="awv2-lu-unresolved">Not established.</span>}</span>
                <span class="k">Acreage bands</span>
                <span class="v">{s.acreageBands.length ? s.acreageBands.join(' · ') : <span class="awv2-lu-unresolved">Not established.</span>}</span>
                <span class="k">Improvements</span><span class="v">{s.improvementStatus}</span>
                <span class="k">Site-built</span><span class="v">{s.siteBuiltLabel}</span>
                <span class="k">Modular</span><span class="v">{s.modularLabel}</span>
                <span class="k">Single-wide</span><span class="v">{s.singleWideLabel}</span>
                <span class="k">Double-wide</span><span class="v">{s.doubleWideLabel}</span>
                <span class="k">Subdivision path</span><span class="v">{s.subdivisionPath}</span>
                <span class="k">Access</span><span class="v">{s.accessConstraint}</span>
              </div>
              {s.compsRequests.length > 0 && (
                <>
                  <div class="awv2-pi-note" style="margin-top:10px">
                    <b>Comps research request</b>
                    {!s.compsRestOnVerifiedLaw && ' — this scenario carries unresolved legal inputs; treat the request as exploratory.'}
                  </div>
                  <ul class="awv2-opg-list">
                    {s.compsRequests.map((r) => <li><b>{r.label}</b> ({r.status}) — {r.rationale}</li>)}
                  </ul>
                </>
              )}
              {s.remainingVerification.length > 0 && (
                <>
                  <div class="awv2-pi-note" style="margin-top:8px"><b>Remaining verification</b></div>
                  <ul class="awv2-opg-list">
                    {s.remainingVerification.slice(0, 6).map((r) => <li>{r}</li>)}
                  </ul>
                </>
              )}
            </div>
          ))}

          {/* ── DISCOVERY CALL ── */}
          {v!.discoveryQuestions.length > 0 && (
            <>
              <div class="awv2-opg-sub">Discovery call questions</div>
              <div class="awv2-pi-note">Generated from unresolved property facts. Seller answers remain seller-reported and are never legal verification.</div>
              <ul class="awv2-opg-list">
                {v!.discoveryQuestions.map((q) => (
                  <li><b>{q.question}</b><div class="awv2-pi-note" style="margin-top:2px">{q.because} {q.unblocks}</div></li>
                ))}
              </ul>
            </>
          )}

          {/* ── PRIVATE RESTRICTIONS ── */}
          <div class="awv2-opg-sub">Private restrictions</div>
          {v!.privateRestrictions.map((r) => (
            <div class="awv2-pi-note"><b>{r.statusLabel}.</b> {r.statement}</div>
          ))}

          {/* ── WHAT COULD CHANGE THIS ── */}
          <div class="awv2-opg-sub">What could change this</div>
          {v!.whatCouldChangeThis.length > 0 ? (
            <ul class="awv2-opg-list">
              {v!.whatCouldChangeThis.map((item) => <li>{item}</li>)}
            </ul>
          ) : (
            <div class="awv2-pi-note">Nothing material is outstanding.</div>
          )}

          {v!.failureStates.length > 0 && (
            <>
              <div class="awv2-opg-sub">Named states</div>
              <ul class="awv2-opg-list">
                {v!.failureStates.map((f) => <li>{f.label}</li>)}
              </ul>
            </>
          )}

          {/* ── SOURCES ── */}
          <div class="awv2-opg-sub">Authoritative sources</div>
          {v!.sources.length > 0 ? (
            <div class="awv2-opg-links">
              {v!.sources.map((s) => (
                <a href={s.url} target="_blank" rel="noreferrer" title={s.excerpt || ''}>
                  {s.citation ? `${s.label} ${sectionCitationLabel(s.citation)}` : s.label}
                </a>
              ))}
            </div>
          ) : (
            <div class="awv2-pi-note">No authoritative source was read for this property.</div>
          )}

          {v!.determinedAt && (
            <div class="awv2-pi-note" style="margin-top:10px">
              Determined {new Date(v!.determinedAt).toLocaleString()} ·{' '}
              {v!.lanes.map((l) => `${l.label}: ${l.status}`).join(' · ')}
            </div>
          )}
          </details>
        </>
      )}
    </section>
  );
}
