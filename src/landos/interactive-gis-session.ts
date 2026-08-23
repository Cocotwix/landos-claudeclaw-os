// LandOS — the governed INTERACTIVE GIS research session.
//
// WHY THIS EXISTS. A government GIS is an APPLICATION, not a document. The
// previous slice gave LandOS a browser escalation rung that can READ an
// official page; it cannot operate a map. But the answers that decide a land
// deal — which district contains this parcel, whether a water main reaches the
// frontage, where the sewer runs — live in map layers that no amount of
// fetching a URL will reveal. A competent researcher opens the map, finds the
// parcel, turns on the one layer that answers the question, reads the popup and
// the legend, and captures what they saw.
//
// This module is that behaviour as a contract.
//
// WHAT IT IS NOT. It is not a Fairview script. Nothing here names a city, a
// selector, or a pixel. The session states the ORDER of operations and the
// rules that make a reading admissible; a `GisBrowserExecutor` supplies the
// mechanics for whatever application is in front of it, and the ArcGIS-shaped
// implementation is one executor among the several these applications need.
//
// THE TWO RULES THAT MATTER.
//
//   1. IDENTITY BEFORE READING. A layer is never read until the session has
//      confirmed that the feature it is about to read IS the subject parcel.
//      A map that is merely centred on the right place proves nothing: pins,
//      extents and coordinates never establish parcel identity (PERMANENT
//      MEMORY invariants 2-4). Confirmation comes from the parcel identifier
//      the layer itself carries.
//
//   2. VINTAGE BEFORE CURRENCY. A zoning layer answers "what district is this
//      parcel in" only if the layer is at least as new as the regime it claims
//      to represent. A published, official, parcel-specific layer that predates
//      the ordinance in force is evidence of the PREVIOUS regime, and saying
//      otherwise is the most expensive mistake this module could make.
//
// Pure orchestration. No I/O — the executor does that, so the whole contract is
// testable without a browser.

import { apnEquivalent } from './property-intelligence-snapshot.js';

// ── Subject and identity ──────────────────────────────────────────────────

export interface GisSubject {
  dealCardId: number;
  apn: string | null;
  address: string | null;
  municipality: string | null;
  county: string | null;
  state: string | null;
  /** Canonical current owner, used only to CORROBORATE an APN match. */
  ownerName?: string | null;
}

/** How the session tied a map feature to the canonical subject. */
export type GisIdentityBasis =
  /** The layer carries a parcel identifier equivalent to the subject APN. */
  | 'parcel_identifier'
  /** The identifier matched AND the layer's owner agrees with canonical. */
  | 'parcel_identifier_owner_corroborated'
  /** Nothing admissible. */
  | 'unconfirmed';

export interface GisSubjectConfirmation {
  confirmed: boolean;
  basis: GisIdentityBasis;
  /** The identifier the layer actually carried, verbatim. */
  observedIdentifier: string | null;
  observedOwner: string | null;
  /** Plain statement for the operator and the evidence record. */
  statement: string;
}

/**
 * Match an Esri parcel key against an APN.
 *
 * County parcel layers rarely store the APN as the assessor prints it. A TN
 * parcel keyed `042-123.00-000` is commonly published as the token triple
 * `042    12300 00001042`: map, map-and-parcel, then a county-internal
 * suffix. Digit-string equality fails on that, and loose "contains" matching
 * is worse than useless — the adjoining parcel `042 12310` shares every digit
 * that a sloppy comparison would look at.
 *
 * So the comparison is made on the tokens that actually identify the parcel:
 * the map and the map-and-parcel key must both match exactly. The suffix is
 * ignored because it is bookkeeping, not identity.
 */
export function esriParcelKeyMatchesApn(apn: string, identifier: string): boolean {
  const tokens = identifier.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const parts = apn.trim().toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
  if (parts.length < 2) return false;

  // `123.00` is parcel 123 sub-00, published as the single key `12300`.
  const candidates = new Set<string>([parts[1]]);
  if (parts.length >= 3) candidates.add(`${parts[1]}${parts[2]}`);

  return tokens[0] === parts[0] && candidates.has(tokens[1]);
}

/**
 * Confirm a map feature IS the subject.
 *
 * Deliberately strict and deliberately narrow. Owner agreement strengthens a
 * match; it can never create one, because owner strings drift and two parcels
 * can share an owner. Geometry, centroid and map position are not arguments
 * here at all — they cannot be, or the invariant would be negotiable.
 */
export function confirmGisSubject(input: {
  subject: GisSubject;
  featureIdentifier: string | null;
  featureOwner?: string | null;
}): GisSubjectConfirmation {
  const wanted = (input.subject.apn ?? '').trim();
  const observed = (input.featureIdentifier ?? '').trim();
  const owner = (input.featureOwner ?? '').trim() || null;

  const matches = !!wanted && !!observed
    && (apnEquivalent(wanted, observed) || esriParcelKeyMatchesApn(wanted, observed));

  if (!matches) {
    return {
      confirmed: false,
      basis: 'unconfirmed',
      observedIdentifier: observed || null,
      observedOwner: owner,
      statement: observed
        ? `The map feature carries parcel identifier ${observed}, which is not the subject parcel ${wanted || '(unknown)'}. It is not evidence for this property.`
        : `The map feature carried no parcel identifier, so it cannot be tied to the subject parcel. Position on the map never establishes parcel identity.`,
    };
  }

  const canonicalOwner = (input.subject.ownerName ?? '').trim();
  const ownerAgrees = !!canonicalOwner && !!owner
    && normalizeOwner(owner).includes(normalizeOwner(canonicalOwner).slice(0, 12));

  return {
    confirmed: true,
    basis: ownerAgrees ? 'parcel_identifier_owner_corroborated' : 'parcel_identifier',
    observedIdentifier: observed,
    observedOwner: owner,
    statement: ownerAgrees
      ? `The layer feature carries parcel identifier ${observed}, equivalent to the subject APN ${wanted}, and names owner ${owner}, which agrees with the canonical owner of record.`
      : `The layer feature carries parcel identifier ${observed}, equivalent to the subject APN ${wanted}.`,
  };
}

function normalizeOwner(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// ── Layers ────────────────────────────────────────────────────────────────

export interface GisLayerRef {
  id: string;
  title: string;
  /**
   * The group the application nests this layer under.
   *
   * Load-bearing, not decorative: real web maps routinely publish the zoning
   * layer as a generic "Parcels" inside a group named "… Public Zoning". The
   * question signal lives on the group, so selection that reads only the leaf
   * title misses the very layer it is looking for.
   */
  groupTitle?: string | null;
  /** The queryable service URL, when the application exposes one. */
  url?: string | null;
  /** The attribute the layer symbolizes on — the district/class field. */
  rendererField?: string | null;
  /** When the layer's data was last edited, if the service reports it. */
  lastEditedAt?: string | null;
  visible?: boolean;
}

/** The research questions this session knows how to aim at a layer. */
export type GisQuestion = 'current_zoning' | 'public_water' | 'public_sewer';

const QUESTION_LAYER_PATTERNS: Readonly<Record<GisQuestion, RegExp>> = {
  // Character districts, zoning districts, land-use districts, overlays.
  current_zoning: /\b(zoning|zone|character\s*district|land\s*use|district|overlay|nzm)\b/i,
  public_water: /\b(water|potable|hydrant|main)\b/i,
  public_sewer: /\b(sewer|sanitary|wastewater|force\s*main|lift\s*station|pump\s*station)\b/i,
};

/**
 * The QUESTION chooses the layers — never "turn everything on".
 *
 * Toggling every layer on a county map is slow, visually unreadable, and
 * produces screenshots that prove nothing. It is also how an interactive GIS
 * session turns into the rabbit hole `gis-escalation` exists to prevent.
 */
export function selectLayersForQuestion(question: GisQuestion, layers: readonly GisLayerRef[]): GisLayerRef[] {
  const pattern = QUESTION_LAYER_PATTERNS[question];
  return layers.filter((layer) => pattern.test(layer.title)
    || pattern.test(layer.id)
    || (!!layer.groupTitle && pattern.test(layer.groupTitle)));
}

// ── Zoning currency ───────────────────────────────────────────────────────

export type ZoningCurrencyVerdict = 'current_regime' | 'predates_regime' | 'vintage_unknown';

export interface ZoningCurrencyAssessment {
  verdict: ZoningCurrencyVerdict;
  establishesCurrent: boolean;
  statement: string;
}

/**
 * Can this layer establish CURRENT zoning?
 *
 * The governing comparison is layer vintage against the date the zoning regime
 * in force was adopted. A layer last edited before that date is a picture of
 * the previous regime — official, parcel-specific, and still not current. When
 * the vintage cannot be read, the layer may support a finding but never
 * establishes currency on its own.
 */
export function assessZoningCurrency(input: {
  layerLastEditedAt: string | null | undefined;
  regimeAdoptedAt: string | null | undefined;
}): ZoningCurrencyAssessment {
  const adopted = input.regimeAdoptedAt ? Date.parse(input.regimeAdoptedAt) : NaN;
  const edited = input.layerLastEditedAt ? Date.parse(input.layerLastEditedAt) : NaN;

  if (!Number.isFinite(adopted) || !Number.isFinite(edited)) {
    return {
      verdict: 'vintage_unknown',
      establishesCurrent: false,
      statement: 'The layer vintage or the adoption date of the governing regime could not be read, so this layer does not by itself establish the CURRENT district.',
    };
  }
  if (edited < adopted) {
    return {
      verdict: 'predates_regime',
      establishesCurrent: false,
      statement: `The layer was last edited ${input.layerLastEditedAt} — before the governing zoning regime was adopted on ${input.regimeAdoptedAt}. It depicts the PREVIOUS regime and cannot establish the current district.`,
    };
  }
  return {
    verdict: 'current_regime',
    establishesCurrent: true,
    statement: `The layer was last edited ${input.layerLastEditedAt}, at or after the ${input.regimeAdoptedAt} adoption of the governing zoning regime.`,
  };
}

// ── Evidence ──────────────────────────────────────────────────────────────

/** How the value was obtained. Map-derived findings must say so. */
export type GisDerivation = 'layer_attribute' | 'map_derived';

export interface GisScreenshot {
  path: string;
  purpose: string;
  /** The layers visible in this capture — what the picture actually proves. */
  layersVisible: string[];
  legendCaptured: boolean;
  capturedAtIso: string;
}

export interface GisEvidence {
  question: GisQuestion;
  /** The application the operator could open themselves. */
  appUrl: string;
  appTitle: string | null;
  sourceLabel: string;
  /** The service URL behind the layer, when exposed. */
  layerUrl: string | null;
  layerName: string;
  layerLastEditedAt: string | null;
  subject: GisSubjectConfirmation;
  derivation: GisDerivation;
  /** The attribute name and value actually read. */
  attribute: string | null;
  value: string | null;
  /** The legend entry that explains the value, when one was read. */
  legendLabel: string | null;
  screenshots: GisScreenshot[];
  retrievedAtIso: string;
  notes: string[];
}

/**
 * A screenshot is admissible only when it says what it shows.
 *
 * A file on disk proves nothing. A capture that does not record which layers
 * were visible cannot support a claim about those layers, so it is refused
 * here rather than counted later.
 */
export function screenshotProves(shot: GisScreenshot, layerName: string): boolean {
  return !!shot.path && shot.layersVisible.some((name) => name === layerName);
}

// ── Executor ──────────────────────────────────────────────────────────────

export interface GisStepOptions { timeoutMs: number }

/**
 * The mechanics, abstracted.
 *
 * One implementation drives an ArcGIS application through the governed
 * browser; a different platform gets a different implementation without any
 * of the rules above changing. The session never learns which it is talking to.
 */
export interface GisBrowserExecutor {
  readonly id: string;
  openApp(url: string, opts: GisStepOptions): Promise<{ url: string; title: string | null }>;
  /** Find the subject and return the identifier/owner the map itself carries. */
  locateSubject(subject: GisSubject, opts: GisStepOptions): Promise<{
    identifier: string | null;
    owner: string | null;
    attributes: Record<string, string>;
  } | null>;
  listLayers(opts: GisStepOptions): Promise<GisLayerRef[]>;
  setLayerVisible(layer: GisLayerRef, visible: boolean, opts: GisStepOptions): Promise<boolean>;
  readSubjectAttributes(subject: GisSubject, layer: GisLayerRef, opts: GisStepOptions): Promise<Record<string, string> | null>;
  readLegend(layer: GisLayerRef, opts: GisStepOptions): Promise<Array<{ value: string; label: string }>>;
  capture(purpose: string, layersVisible: string[], opts: GisStepOptions & { legend?: boolean }): Promise<GisScreenshot | null>;
}

// ── Session ───────────────────────────────────────────────────────────────

/**
 * The session's own step ceiling.
 *
 * The contract's happy path is seven steps — open, locate, list, show, read,
 * legend, capture — so a budget of six would truncate every successful
 * session at exactly the point where it captures its evidence, producing an
 * answer with no screenshot behind it. Eight leaves one spare step and stays
 * small enough to be a ceiling rather than a licence.
 *
 * This is deliberately NOT `DEFAULT_ESCALATION_BUDGET.maxBrowserInteractions`.
 * That number caps BROWSER interactions inside the wider GIS escalation
 * ladder; several steps here are service reads that never touch a tab. The
 * ladder still governs how many times this session may be attempted at all.
 */
export const DEFAULT_GIS_SESSION_STEPS = 8;

export type GisSessionOutcome = 'answered' | 'subject_unconfirmed' | 'no_relevant_layer' | 'no_value' | 'budget_exhausted' | 'app_unreachable';

export interface GisSessionResult {
  outcome: GisSessionOutcome;
  evidence: GisEvidence | null;
  interactionsUsed: number;
  notes: string[];
}

export interface GisSessionInput {
  subject: GisSubject;
  question: GisQuestion;
  appUrl: string;
  sourceLabel: string;
  executor: GisBrowserExecutor;
  /** The date the governing regime took effect, for `current_zoning`. */
  regimeAdoptedAt?: string | null;
  /** Ceiling on interactive steps. Defaults to DEFAULT_GIS_SESSION_STEPS. */
  maxInteractions?: number;
  timeoutMs?: number;
  now?: () => string;
}

/**
 * Run one bounded interactive GIS session.
 *
 * The order is the contract: open, locate, CONFIRM, list layers, select for the
 * question, make visible, read, legend, capture. Every step spends from a small
 * finite interaction budget, and the session returns as soon as it can answer
 * or as soon as it cannot — it never loops.
 */
export async function runInteractiveGisSession(input: GisSessionInput): Promise<GisSessionResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const timeoutMs = input.timeoutMs ?? 30_000;
  const budget = input.maxInteractions ?? DEFAULT_GIS_SESSION_STEPS;
  const notes: string[] = [];
  let used = 0;

  /**
   * Every interactive step goes through here, so nothing is unbudgeted.
   *
   * `exhausted` is reported separately from a step that ran and failed: those
   * are different outcomes and the operator needs to know which happened.
   */
  let exhausted = false;
  const spend = async <T>(work: () => Promise<T>): Promise<T | null> => {
    if (used >= budget) { exhausted = true; return null; }
    used += 1;
    try {
      return await work();
    } catch {
      return null;
    }
  };

  const app = await spend(() => input.executor.openApp(input.appUrl, { timeoutMs }));
  if (!app) {
    return exhausted
      ? { outcome: 'budget_exhausted', evidence: null, interactionsUsed: used, notes: [budgetNote(budget)] }
      : { outcome: 'app_unreachable', evidence: null, interactionsUsed: used, notes: [`The GIS application at ${input.appUrl} could not be opened.`] };
  }

  // IDENTITY FIRST. Nothing is read from any layer until the map feature is
  // proven to be the subject parcel.
  const located = await spend(() => input.executor.locateSubject(input.subject, { timeoutMs }));
  if (exhausted) return { outcome: 'budget_exhausted', evidence: null, interactionsUsed: used, notes: [budgetNote(budget)] };
  const confirmation = confirmGisSubject({
    subject: input.subject,
    featureIdentifier: located?.identifier ?? null,
    featureOwner: located?.owner ?? null,
  });
  if (!confirmation.confirmed) {
    notes.push(confirmation.statement);
    return { outcome: 'subject_unconfirmed', evidence: null, interactionsUsed: used, notes };
  }
  notes.push(confirmation.statement);

  const layers = (await spend(() => input.executor.listLayers({ timeoutMs }))) ?? [];
  if (exhausted) return { outcome: 'budget_exhausted', evidence: null, interactionsUsed: used, notes: [...notes, budgetNote(budget)] };

  const relevant = selectLayersForQuestion(input.question, layers);
  if (!relevant.length) {
    notes.push(`No layer in this application answers ${input.question.replace(/_/g, ' ')}; ${layers.length} layer(s) were listed and none matched the question.`);
    return { outcome: 'no_relevant_layer', evidence: null, interactionsUsed: used, notes };
  }
  const layer = relevant[0];
  notes.push(`Selected layer "${layer.title}" for ${input.question.replace(/_/g, ' ')}; ${layers.length} layer(s) available, ${relevant.length} relevant. Layers not relevant to the question were left alone.`);

  const visible = await spend(() => input.executor.setLayerVisible(layer, true, { timeoutMs }));
  if (exhausted) return { outcome: 'budget_exhausted', evidence: null, interactionsUsed: used, notes: [...notes, budgetNote(budget)] };
  notes.push(visible
    ? `Layer "${layer.title}" reported visible.`
    : `The layer "${layer.title}" did not report a visible state; any capture below records what was actually shown.`);

  const attributes = await spend(() => input.executor.readSubjectAttributes(input.subject, layer, { timeoutMs }));
  if (exhausted) return { outcome: 'budget_exhausted', evidence: null, interactionsUsed: used, notes: [...notes, budgetNote(budget)] };

  const field = layer.rendererField ?? null;
  const value = field && attributes ? (attributes[field] ?? null) : null;

  const legend = (await spend(() => input.executor.readLegend(layer, { timeoutMs }))) ?? [];
  const legendLabel = value ? legend.find((entry) => entry.value === value)?.label ?? null : null;

  const shot = await spend(() => input.executor.capture(
    `${input.question} — subject with ${layer.title}`,
    [layer.title],
    { timeoutMs, legend: true },
  ));
  if (exhausted) notes.push(budgetNote(budget));

  if (!value) {
    notes.push(`The subject feature carried no readable value on "${layer.title}"${field ? ` (field ${field})` : ''}.`);
    return { outcome: 'no_value', evidence: null, interactionsUsed: used, notes };
  }

  // Currency is asserted, not assumed.
  if (input.question === 'current_zoning') {
    const currency = assessZoningCurrency({
      layerLastEditedAt: layer.lastEditedAt,
      regimeAdoptedAt: input.regimeAdoptedAt,
    });
    notes.push(currency.statement);
    if (!currency.establishesCurrent) {
      notes.push('This reading is retained as evidence of the layer\'s regime, not as the CURRENT district.');
    }
  }

  const evidence: GisEvidence = {
    question: input.question,
    appUrl: app.url,
    appTitle: app.title,
    sourceLabel: input.sourceLabel,
    layerUrl: layer.url ?? null,
    layerName: layer.title,
    layerLastEditedAt: layer.lastEditedAt ?? null,
    subject: confirmation,
    derivation: attributes ? 'layer_attribute' : 'map_derived',
    attribute: field,
    value,
    legendLabel,
    screenshots: shot ? [shot] : [],
    retrievedAtIso: now(),
    notes: [...notes],
  };
  return { outcome: 'answered', evidence, interactionsUsed: used, notes };
}

function budgetNote(budget: number): string {
  return `The interactive GIS budget of ${budget} step(s) was exhausted; the route is deferred rather than retried.`;
}
