// LandOS — Universal Smart Intake foundation.
//
// THE permanent front door for LandOS. Every transport (dashboard text, voice
// transcript, Telegram, CRM lead, free text) enters here. The Smart Intake
// component classifies the raw input and ROUTES it to the owning department's
// intent. Today only the Property Resolution / DD route is implemented; future
// departments REGISTER an intent here (data, not a rewrite of the component).
//
// This module is the routing architecture the prompt requires: additional intents
// are added via registerIntakeIntent() / the INTAKE_INTENTS table, and the intake
// component, the resolver, and the UI never change shape to add one.
//
// Pure + deterministic. Parsing is reused from the existing, tested
// duke-preflight + source-adapters parsers — intake never re-implements parsing.

import { extractPropertyArgs, looksLikePropertyInput } from './duke-preflight.js';
import { extractAreaSignals } from './source-adapters.js';
import { extractApnCandidates } from './intake-normalize.js';
import type { LpResolveArgs } from './landportal-client.js';
import type { ParcelIdentityClass } from './intake-types.js';

/** Where a classified intent is routed. Only 'property_resolution' is wired now;
 *  the rest are registered shells so the architecture is complete. */
export const INTAKE_ROUTES = [
  'property_resolution', // → Property Resolution Engine → DD (IMPLEMENTED)
  'area_market',         // area-only market lane (registered)
  'seller_discovery',    // acquisitions seller-prep (registered)
  'general',             // unrouted free text (registered)
  'future_department',   // a department that registered an intent but isn't built
] as const;
export type IntakeRoute = (typeof INTAKE_ROUTES)[number];

export type IntakeLifecycle = 'operational' | 'registered';

/** The parsed, normalized fields the intake extracts from raw input. Mirrors the
 *  resolver's IntakeFields plus area-only signals. No field is mandatory. */
export interface ParsedIntakeFields {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  fips?: string;
  apn?: string;
  owner?: string;
  propertyId?: string;
  lpUrl?: string;
  /** Common county formats for the APN, tried before declaring a lookup failure
   *  (e.g. "094-020.08" → "09402008", "094 020 08", …). */
  apnVariants?: string[];
  /** Additional distinct APN representations found in the input (e.g. a
   *  parenthetical alternate parcel number "(094 02008 000)"). */
  apnAlternates?: string[];
}

/** A registered intent. Future departments add one of these — that is the entire
 *  extensibility contract. `match` is a pure predicate over the parsed input. */
export interface IntakeIntent {
  id: string;
  label: string;
  route: IntakeRoute;
  departmentId: string;
  lifecycle: IntakeLifecycle;
  /** Higher wins when multiple intents match. */
  priority: number;
  /** Pure predicate: does this intent claim the input? */
  match: (ctx: IntakeMatchContext) => boolean;
}

export interface IntakeMatchContext {
  rawText: string;
  fields: ParsedIntakeFields;
  identityClass: ParcelIdentityClass;
  hasParcelIdentity: boolean;
  looksLikeProperty: boolean;
  area: { city?: string; county?: string; state?: string };
}

export interface SmartIntakeResult {
  /** The winning intent. */
  intent: IntakeIntent;
  route: IntakeRoute;
  lifecycle: IntakeLifecycle;
  parsedFields: ParsedIntakeFields;
  identityClass: ParcelIdentityClass;
  hasParcelIdentity: boolean;
  /** Deterministic human-readable reason for the route. */
  reason: string;
  /** All intents that matched (for transparency/tests). */
  candidates: Array<{ id: string; route: IntakeRoute; priority: number }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Parsing → fields + identity class
// ─────────────────────────────────────────────────────────────────────────

function fieldsFromArgs(args: LpResolveArgs | null, rawText: string): ParsedIntakeFields {
  const area = extractAreaSignals(rawText);
  const a = (args ?? {}) as Record<string, string | undefined>;
  // Normalize every APN in the raw input into common county formats and capture
  // any alternate parcel number (e.g. a parenthetical "(094 02008 000)"). The
  // primary APN stays whatever the underlying parser resolved; the variants and
  // alternates give the resolver more shots before it can declare a failure.
  const apnCands = extractApnCandidates(rawText);
  const apn = a.apn ?? apnCands.primary;
  const variants = apn ? apnCands.allVariants : [];
  const alternates = apn ? apnCands.alternates.filter((alt) => alt !== apn) : [];
  return {
    address: a.address,
    city: a.city ?? area.city,
    state: a.state ?? area.state,
    zip: a.zip,
    county: a.county ?? area.county,
    fips: a.fips,
    apn,
    owner: a.owner,
    propertyId: a.propertyid,
    lpUrl: a.lp_url,
    ...(variants.length ? { apnVariants: variants } : {}),
    ...(alternates.length ? { apnAlternates: alternates } : {}),
  };
}

/** Classify the strength of parcel identity present in the parsed input. Never
 *  derived from coordinates/proximity. Mirrors PARCEL_IDENTITY_CLASSES. */
export function classifyParcelIdentity(f: ParsedIntakeFields, looksLikeProperty: boolean): ParcelIdentityClass {
  const has = (v?: string) => typeof v === 'string' && v.trim().length > 0;
  const localityCo = has(f.county) || has(f.fips);
  const localityCS = has(f.city) && has(f.state);
  if (has(f.lpUrl)) return 'lp_url';
  if (has(f.propertyId) && has(f.fips)) return 'property_id';
  if (has(f.apn) && (localityCo || has(f.state))) return 'apn_county';
  if (has(f.address) && /^\s*\d/.test(f.address!.trim()) && (localityCS || localityCo)) return 'full_address';
  if (has(f.owner) && (localityCS || localityCo)) return 'owner_county';
  if (has(f.address) || looksLikeProperty) return 'property_ambiguous';
  if (has(f.city) && has(f.state)) return 'street_city_state_only';
  return 'none';
}

const PARCEL_IDENTITY_CLASSES_WITH_IDENTITY = new Set<ParcelIdentityClass>([
  'lp_url', 'property_id', 'apn_county', 'full_address', 'owner_county', 'property_ambiguous',
]);

// ─────────────────────────────────────────────────────────────────────────
// Intent registry — the extensibility seam
// ─────────────────────────────────────────────────────────────────────────

/** The Property Resolution intent — the ONLY operational route this sprint. It
 *  claims any input that carries a parcel identity OR looks like a property. */
const PROPERTY_RESOLUTION_INTENT: IntakeIntent = {
  id: 'property_resolution',
  label: 'Property Resolution / Due Diligence',
  route: 'property_resolution',
  departmentId: 'research_due_diligence',
  lifecycle: 'operational',
  priority: 100,
  match: (ctx) => ctx.hasParcelIdentity || ctx.looksLikeProperty,
};

/** Registered (not yet wired) intents. They make the architecture complete: the
 *  intake routes to them today as `registered`, and building the department later
 *  is a data/lifecycle change, never a redesign of intake. */
const REGISTERED_INTENTS: IntakeIntent[] = [
  {
    id: 'area_market',
    label: 'Area Market Research',
    route: 'area_market',
    departmentId: 'research_due_diligence',
    lifecycle: 'registered',
    priority: 60,
    match: (ctx) => !ctx.hasParcelIdentity && !!(ctx.area.county || ctx.area.city) && !!ctx.area.state,
  },
  {
    id: 'seller_discovery',
    label: 'Seller Discovery Prep',
    route: 'seller_discovery',
    departmentId: 'acquisition',
    lifecycle: 'registered',
    priority: 50,
    match: (ctx) => /\b(seller|owner said|discovery call|motivat|asking price|wants? to sell)\b/i.test(ctx.rawText) && !ctx.hasParcelIdentity,
  },
];

const GENERAL_FALLBACK_INTENT: IntakeIntent = {
  id: 'general',
  label: 'General / Unrouted',
  route: 'general',
  departmentId: 'main',
  lifecycle: 'registered',
  priority: 0,
  match: () => true,
};

// Mutable registry (seeded with the built-ins). Future departments append here.
const registry: IntakeIntent[] = [PROPERTY_RESOLUTION_INTENT, ...REGISTERED_INTENTS];

/** Register a new department intent. The whole extensibility contract: data in,
 *  no component/engine rewrite. Idempotent on id (re-registering replaces). */
export function registerIntakeIntent(intent: IntakeIntent): void {
  const i = registry.findIndex((x) => x.id === intent.id);
  if (i >= 0) registry[i] = intent;
  else registry.push(intent);
}

/** Snapshot of registered intents (for the dashboard / tests). */
export function listIntakeIntents(): Array<{ id: string; label: string; route: IntakeRoute; lifecycle: IntakeLifecycle; departmentId: string }> {
  return [...registry, GENERAL_FALLBACK_INTENT].map((i) => ({ id: i.id, label: i.label, route: i.route, lifecycle: i.lifecycle, departmentId: i.departmentId }));
}

// ─────────────────────────────────────────────────────────────────────────
// The classifier
// ─────────────────────────────────────────────────────────────────────────

export interface ClassifyDeps {
  /** Override the registry (tests). Defaults to the live registry. */
  intents?: IntakeIntent[];
}

/**
 * Classify raw intake text and route it to the owning department's intent. Pure
 * + deterministic. Highest-priority matching intent wins; the general fallback
 * always matches last. Only the property_resolution intent is operational; the
 * rest route as `registered`.
 */
export function classifySmartIntake(rawText: string, deps: ClassifyDeps = {}): SmartIntakeResult {
  const text = (rawText ?? '').trim();
  const args = extractPropertyArgs(text);
  const looksLikeProperty = looksLikePropertyInput(text);
  const fields = fieldsFromArgs(args, text);
  const identityClass = classifyParcelIdentity(fields, looksLikeProperty);
  const hasParcelIdentity = PARCEL_IDENTITY_CLASSES_WITH_IDENTITY.has(identityClass) && identityClass !== 'property_ambiguous'
    ? true
    : identityClass === 'property_ambiguous'
      ? looksLikeProperty || !!args
      : false;
  const area = extractAreaSignals(text);

  const ctx: IntakeMatchContext = { rawText: text, fields, identityClass, hasParcelIdentity, looksLikeProperty, area };
  const intents = [...(deps.intents ?? registry), GENERAL_FALLBACK_INTENT];

  const matched = intents.filter((i) => safeMatch(i, ctx)).sort((a, b) => b.priority - a.priority);
  const winner = matched[0] ?? GENERAL_FALLBACK_INTENT;

  return {
    intent: winner,
    route: winner.route,
    lifecycle: winner.lifecycle,
    parsedFields: fields,
    identityClass,
    hasParcelIdentity,
    reason: reasonFor(winner, ctx),
    candidates: matched.map((i) => ({ id: i.id, route: i.route, priority: i.priority })),
  };
}

function safeMatch(i: IntakeIntent, ctx: IntakeMatchContext): boolean {
  try { return i.match(ctx); } catch { return false; }
}

function reasonFor(intent: IntakeIntent, ctx: IntakeMatchContext): string {
  if (intent.route === 'property_resolution') {
    return ctx.hasParcelIdentity
      ? `Parcel identity present (${ctx.identityClass}) → Property Resolution.`
      : 'Input looks like a property → Property Resolution.';
  }
  if (intent.route === 'area_market') return `Area-only signals (${[ctx.area.city, ctx.area.county, ctx.area.state].filter(Boolean).join(', ')}) → Area Market (registered).`;
  if (intent.route === 'seller_discovery') return 'Seller-discovery language → Seller Discovery (registered).';
  return 'No property or department signal → general (unrouted).';
}
