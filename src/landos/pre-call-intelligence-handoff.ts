// LandOS — the PRE-CALL INTELLIGENCE handoff.
//
// A backend read model, not a UI. It assembles what the post-resolution lanes
// established into the shape a Pre-Call panel will want, and — the part that
// actually earns its keep — generates the questions to ask THIS seller.
//
// The questions are the test of whether the intelligence is real. A generic
// list ("what's your timeline?") could be written without ever looking at the
// property. Every question here is DERIVED FROM STORED EVIDENCE and carries the
// finding it came from, so a question that cannot be traced to something LandOS
// actually established is not generated at all.
//
// Nothing here retrieves. It reads the durable snapshots the lanes wrote, which
// means a fresh process, a restarted service, or a session tomorrow produces
// the same package without touching a source.

import { readPropertyBackstory } from './property-backstory-store.js';
import {
  readControllingAuthority,
  readCurrentZoning,
  readPropertySubdivisionRead,
  readSubdivisionRegulations,
  readZoningStandards,
} from './land-use-intelligence-store.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { PropertyBackstory } from './property-backstory.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';

export interface PreCallQuestion {
  /** Stable within one package, so a UI can key on it. */
  key: string;
  question: string;
  /** Why this is worth the seller's time. */
  why: string;
  /** The stored finding this came from. Never empty. */
  groundedIn: { source: string; url: string | null; detail: string };
  topic: 'development_history' | 'zoning' | 'subdivision' | 'access' | 'utilities' | 'ownership' | 'constraints';
}

export interface PreCallContradiction {
  headline: string;
  detail: string;
  sources: string[];
}

export interface PreCallIntelligenceHandoff {
  dealCardId: number;
  generatedAt: string;
  property: {
    apn: string | null;
    parcelNotation: string | null;
    address: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    acres: number | null;
  };
  owner: { name: string | null; isEntity: boolean };
  backstorySummary: string | null;
  keyEvents: Array<{ date: string | null; headline: string; status: string; confidence: string; sourceUrl: string | null }>;
  currentZoning: {
    established: boolean;
    district: string | null;
    authority: string | null;
    source: string | null;
    sourceUrl: string | null;
    asOf: string | null;
    confidence: string;
    /** Historical statements, kept visibly separate from the line above. */
    historicalStatements: Array<{ value: string | null; asOf: string | null; sourceUrl: string | null }>;
  };
  /**
   * What the district actually allows, from the adopted code.
   *
   * `established: false` whenever the district is unresolved — the standards
   * are not guessed from a historical district.
   */
  allowedUses: {
    /** True only for the district established as CURRENT for this parcel. */
    established: boolean;
    /** True when these are a historical district's rules, kept for context. */
    contextOnly: boolean;
    district: string | null;
    minimumLotSize: string | null;
    minimumFrontage: string | null;
    density: string | null;
    residentialEligible: boolean | null;
    manufacturedHomeEligible: boolean | null;
    permitted: Array<{ use: string; section: string | null; sourceUrl: string | null }>;
    conditional: Array<{ use: string; section: string | null; sourceUrl: string | null }>;
    overlays: string[];
  };
  controllingAuthority: {
    zoning: { name: string | null; level: string; determination: string };
    subdivision: { name: string | null; level: string; determination: string };
    planningBody: string | null;
  };
  subdivisionRead: {
    likelyPath: string;
    reviewIndication: string;
    theoreticalLotCount: number | null;
    theoreticalIsNotApproved: true;
    requiredReviewBody: string | null;
    ruleCount: number;
    minorMajorBasis: string;
  } | null;
  majorConstraints: string[];
  majorOpportunities: string[];
  contradictions: PreCallContradiction[];
  questions: PreCallQuestion[];
  /** Everything the package could not establish, named. */
  unresolved: string[];
}

const ENTITY_PATTERN = /\b(?:llc|l\.l\.c\.|inc\.?|corp\.?|corporation|company|co\.|trust|partnership|lp|llp|holdings|properties|farms|estate\s+of)\b/i;

/**
 * Build the handoff from the DURABLE reads.
 *
 * Every input is optional. A package built when only the backstory has landed
 * is still useful, and it says plainly what is missing rather than presenting a
 * thin read as a complete one.
 */
export function buildPreCallIntelligenceHandoff(input: {
  dealCardId: number;
  backstory: PropertyBackstory | null;
  authority: ControllingLandUseAuthority | null;
  zoning: CurrentZoningDetermination | null;
  regulations: SubdivisionRegulations | null;
  subdivisionRead: PropertySubdivisionRead | null;
  standards?: ZoningStandardsResult | null;
  now?: () => string;
}): PreCallIntelligenceHandoff {
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const subject = input.backstory?.subject ?? null;
  const owner = subject?.owner ?? null;
  const unresolved: string[] = [];
  const contradictions: PreCallContradiction[] = [];
  const constraints: string[] = [];
  const opportunities: string[] = [];

  if (!input.backstory) unresolved.push('No Property Backstory has been built for this parcel yet.');
  if (!input.authority) unresolved.push('The controlling land-use authority has not been researched.');
  else {
    if (input.authority.zoningAuthority.determination === 'unresolved') unresolved.push('Controlling zoning authority is unresolved.');
    if (input.authority.zoningAuthority.determination === 'ambiguous') {
      contradictions.push({
        headline: 'Two governments both credibly claim zoning authority over this parcel.',
        detail: input.authority.zoningAuthority.basis,
        sources: input.authority.zoningAuthority.competingClaims.map((claim) => claim.sourceUrl ?? claim.name),
      });
    }
    if (input.authority.subdivisionAuthority.determination === 'unresolved') unresolved.push('Controlling subdivision authority is unresolved.');
    for (const conflict of input.authority.conflicts) {
      contradictions.push({ headline: 'Land-use authority conflict', detail: conflict, sources: input.authority.sources.map((row) => row.url ?? row.label) });
    }
  }
  if (!input.zoning?.established) unresolved.push('Current zoning district is not established from a current authoritative source.');
  for (const conflict of input.zoning?.conflicts ?? []) {
    contradictions.push({ headline: 'Conflicting current zoning evidence', detail: conflict, sources: [] });
  }
  if (!input.regulations?.rules.length) unresolved.push('No current subdivision rule was extracted for the controlling authority.');
  if (input.zoning?.established && !input.standards?.established) {
    unresolved.push('The district is established but its allowed uses and dimensional standards were not retrieved from the adopted code.');
  }
  for (const conflict of input.standards?.conflicts ?? []) {
    contradictions.push({ headline: 'Conflicting zoning standards', detail: conflict, sources: (input.standards?.documents ?? []).map((row) => row.url ?? row.label) });
  }

  // A historical zoning statement beside an established current district that
  // differs is exactly the contradiction an operator needs before a call.
  const historical = input.zoning?.historicalReferences ?? input.backstory?.zoningReferences.filter((row) => row.kind !== 'requested') ?? [];
  if (input.zoning?.established && input.zoning.districtCode) {
    const current = input.zoning.districtCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const row of historical) {
      const past = (row.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (past && past !== current) {
        contradictions.push({
          headline: `The planning record states "${row.value}"${row.asOf ? ` as of ${row.asOf}` : ''}, while the current authoritative source states ${input.zoning.districtCode}.`,
          detail: 'A historical statement describes the district on the document\'s own date. The parcel may have been rezoned since, or the packet may have been wrong.',
          sources: [row.sourceUrl, input.zoning.sourceUrl].filter((url): url is string => !!url),
        });
      }
    }
  }

  for (const constraint of input.subdivisionRead?.constraints ?? []) {
    if (constraint.basis === 'unknown' || constraint.kind === 'environmental' || constraint.kind === 'access' || constraint.kind === 'utilities_septic') {
      constraints.push(constraint.headline);
    }
  }
  for (const event of input.backstory?.events ?? []) {
    if (event.eventType === 'environmental_constraint') constraints.push(event.summary);
  }
  if (input.subdivisionRead?.theoreticalLotCount.value != null) {
    opportunities.push(
      `Acreage and the stated minimum lot size support up to ${input.subdivisionRead.theoreticalLotCount.value} theoretical lot(s). This is arithmetic, not an approved yield.`,
    );
  }
  const priorLots = (input.backstory?.events ?? [])
    .map((event) => event.materialNumbers.lots)
    .filter((lots): lots is number => lots != null)
    .sort((a, b) => b - a)[0] ?? null;
  if (priorLots != null) {
    opportunities.push(`A ${priorLots}-lot concept for this tract already exists in the public planning record, so a prior owner or developer has already engineered a layout.`);
  }
  if (input.standards?.standards.residentialEligible === true || input.zoning?.standards.residentialEligible === true) {
    opportunities.push('The adopted district standards reference single-family residential use.');
  }
  if (input.standards?.established && input.standards.standards.minimumLotSize) {
    opportunities.push(`${input.standards.districtCode} minimum lot size per the adopted code: ${input.standards.standards.minimumLotSize}.`);
  }
  if (input.standards?.contextOnly && input.standards.standards.minimumLotSize) {
    constraints.push(
      `CONTEXT ONLY: ${input.standards.districtCode} requires ${input.standards.standards.minimumLotSize}, but the parcel's CURRENT district is unresolved, so this is not confirmed to apply.`,
    );
  }
  if (input.standards?.standards.manufacturedHomeEligible === false) {
    constraints.push(`${input.standards.districtCode} does not permit manufactured homes per the adopted code.`);
  }

  return {
    dealCardId: input.dealCardId,
    generatedAt,
    property: {
      apn: subject?.apn ?? null,
      parcelNotation: subject?.parcelNotation ?? null,
      address: subject?.address ?? null,
      city: subject?.city ?? null,
      county: subject?.county ?? null,
      state: subject?.state ?? null,
      acres: subject?.acres ?? null,
    },
    owner: { name: owner, isEntity: !!owner && ENTITY_PATTERN.test(owner) },
    backstorySummary: input.backstory?.summary.narrative ?? null,
    keyEvents: (input.backstory?.events ?? []).slice(0, 10).map((event) => ({
      date: event.eventDate,
      headline: event.summary,
      status: event.status,
      confidence: event.confidence,
      sourceUrl: event.sourceUrl,
    })),
    currentZoning: {
      established: input.zoning?.established ?? false,
      district: input.zoning?.districtCode ?? null,
      authority: input.zoning?.authorityName ?? null,
      source: input.zoning?.sourceLabel ?? null,
      sourceUrl: input.zoning?.sourceUrl ?? null,
      asOf: input.zoning?.effectiveOrAsOf ?? null,
      confidence: input.zoning?.confidence ?? 'unresolved',
      // Only statements that carry a district. A "rezoning was discussed"
      // reference is a backstory event, not a zoning value, and listing it
      // here as an empty row would read as a gap in the evidence.
      historicalStatements: historical
        .filter((row) => !!row.value)
        .map((row) => ({ value: row.value, asOf: row.asOf, sourceUrl: row.sourceUrl })),
    },
    allowedUses: {
      established: input.standards?.established ?? false,
      contextOnly: input.standards?.contextOnly ?? false,
      district: input.standards?.districtCode ?? null,
      minimumLotSize: input.standards?.standards.minimumLotSize ?? null,
      minimumFrontage: input.standards?.standards.frontage ?? null,
      density: input.standards?.standards.density ?? null,
      residentialEligible: input.standards?.standards.residentialEligible ?? null,
      manufacturedHomeEligible: input.standards?.standards.manufacturedHomeEligible ?? null,
      permitted: (input.standards?.allowedUses ?? []).filter((use) => use.status === 'permitted')
        .map((use) => ({ use: use.use, section: use.section, sourceUrl: use.sourceUrl })),
      conditional: (input.standards?.allowedUses ?? []).filter((use) => use.status === 'conditional' || use.status === 'special_exception')
        .map((use) => ({ use: use.use, section: use.section, sourceUrl: use.sourceUrl })),
      overlays: input.standards?.overlays ?? [],
    },
    controllingAuthority: {
      zoning: {
        name: input.authority?.zoningAuthority.name ?? null,
        level: input.authority?.zoningAuthority.level ?? 'unknown',
        determination: input.authority?.zoningAuthority.determination ?? 'unresolved',
      },
      subdivision: {
        name: input.authority?.subdivisionAuthority.name ?? null,
        level: input.authority?.subdivisionAuthority.level ?? 'unknown',
        determination: input.authority?.subdivisionAuthority.determination ?? 'unresolved',
      },
      planningBody: input.authority?.planningBody ?? null,
    },
    subdivisionRead: input.subdivisionRead
      ? {
          likelyPath: input.subdivisionRead.likelyPath.kind,
          reviewIndication: input.subdivisionRead.reviewIndication,
          theoreticalLotCount: input.subdivisionRead.theoreticalLotCount.value,
          theoreticalIsNotApproved: true,
          requiredReviewBody: input.subdivisionRead.requiredReviewBody,
          ruleCount: input.regulations?.rules.length ?? 0,
          minorMajorBasis: input.regulations?.thresholds.basis ?? 'Not established.',
        }
      : null,
    majorConstraints: [...new Set(constraints)],
    majorOpportunities: [...new Set(opportunities)],
    contradictions,
    questions: buildSellerQuestions(input),
    unresolved: [...new Set(unresolved)],
  };
}

/**
 * The questions to ask THIS seller.
 *
 * Each is generated from one stored finding and cites it. The generic
 * fallbacks at the end fire only when the specific evidence is absent, and they
 * are still property-anchored — "is there a recorded easement to the road" on a
 * tract with no mapped public road contact is not a generic question.
 */
export function buildSellerQuestions(input: {
  backstory: PropertyBackstory | null;
  authority: ControllingLandUseAuthority | null;
  zoning: CurrentZoningDetermination | null;
  regulations: SubdivisionRegulations | null;
  subdivisionRead: PropertySubdivisionRead | null;
  standards?: ZoningStandardsResult | null;
}): PreCallQuestion[] {
  const questions: PreCallQuestion[] = [];
  const add = (question: PreCallQuestion): void => {
    if (questions.length >= 10 || questions.some((row) => row.key === question.key)) return;
    questions.push(question);
  };

  const events = input.backstory?.events ?? [];
  const project = input.backstory?.subject.projectName
    ?? events.find((event) => event.subjectOrProject)?.subjectOrProject
    ?? null;

  // ── From the development history ─────────────────────────────────────────
  const lotEvent = events.find((event) => event.materialNumbers.lots != null);
  if (lotEvent?.materialNumbers.lots != null) {
    add({
      key: 'prior_lot_concept',
      question: `Public planning records show a ${lotEvent.materialNumbers.lots}-lot concept${project ? ` under the name ${project}` : ''} for this tract${lotEvent.eventDate ? ` around ${lotEvent.eventDate}` : ''}. What happened to it, and why did it stop?`,
      why: 'A prior layout means engineering, survey and plan work may already exist, and the reason it stalled is usually the real constraint on the deal.',
      groundedIn: { source: lotEvent.evidence[0]?.sourceTitle ?? 'Official planning document', url: lotEvent.sourceUrl, detail: lotEvent.summary },
      topic: 'development_history',
    });
    add({
      key: 'prior_engineering_plans',
      question: 'Do you still have the engineering, survey, plat drawings or studies from that submittal, and can you send them over?',
      why: 'Existing plans cut re-entitlement cost and time, and they reveal constraints the public record only hints at.',
      groundedIn: { source: lotEvent.evidence[0]?.sourceTitle ?? 'Official planning document', url: lotEvent.sourceUrl, detail: lotEvent.summary },
      topic: 'development_history',
    });
  }

  const decided = events.find((event) => ['denied', 'deferred', 'withdrawn'].includes(event.status));
  if (decided) {
    add({
      key: 'why_not_approved',
      question: `The record shows this matter was ${decided.status}${decided.eventDate ? ` on ${decided.eventDate}` : ''}${decided.governingBody ? ` by the ${decided.governingBody}` : ''}. What was the objection, and has anything changed since?`,
      why: 'A denial or withdrawal is the cheapest available read on what the reviewing body will not accept here.',
      groundedIn: { source: decided.evidence[0]?.sourceTitle ?? 'Official planning document', url: decided.sourceUrl, detail: decided.summary },
      topic: 'development_history',
    });
  }
  const approved = events.find((event) => event.status === 'approved' || event.status === 'adopted');
  if (approved) {
    add({
      key: 'approval_still_valid',
      question: `The record shows an approval${approved.eventDate ? ` on ${approved.eventDate}` : ''}. Is that approval still active, or has it expired?`,
      why: 'An expired approval is not an entitlement, and the difference changes the price.',
      groundedIn: { source: approved.evidence[0]?.sourceTitle ?? 'Official planning document', url: approved.sourceUrl, detail: approved.summary },
      topic: 'development_history',
    });
  }

  // ── From the zoning position ─────────────────────────────────────────────
  const requested = (input.zoning?.requestedZoning ?? input.backstory?.zoningReferences.filter((row) => row.kind === 'requested') ?? [])[0];
  if (requested?.value) {
    add({
      key: 'rezoning_request',
      question: `Records show a rezoning to ${requested.value} was requested${requested.asOf ? ` around ${requested.asOf}` : ''}. Was it granted, and is the parcel zoned that way today?`,
      why: 'A requested district is not a granted one. This is the fastest way to separate what was asked for from what the parcel actually carries.',
      groundedIn: { source: 'Official planning document', url: requested.sourceUrl, detail: requested.quote.slice(0, 200) },
      topic: 'zoning',
    });
  }
  if (input.zoning?.established && input.zoning.districtCode) {
    add({
      key: 'zoning_confirmation',
      question: `Our reading of ${input.zoning.authorityName ?? 'the controlling authority'}'s records puts this parcel in ${input.zoning.districtCode}. Does that match what you have been told?`,
      why: 'A seller who has spoken to planning often knows about an overlay or a condition that the map does not print.',
      groundedIn: { source: input.zoning.sourceLabel ?? 'Official zoning source', url: input.zoning.sourceUrl, detail: input.zoning.parcelMatchBasis ?? '' },
      topic: 'zoning',
    });
  } else {
    const historicalValue = (input.zoning?.historicalReferences ?? input.backstory?.zoningReferences ?? [])
      .find((row) => row.kind === 'stated_as_current_at_the_time' && row.value);
    if (historicalValue) {
      add({
        key: 'zoning_unverified',
        question: `The only zoning figure in the public record for this tract is "${historicalValue.value}"${historicalValue.asOf ? ` from a ${historicalValue.asOf} planning document` : ''}, which does not tell us today's district. Do you know how it is zoned now, and have you spoken to the planning department?`,
        why: 'Current zoning could not be verified from an authoritative source. The seller may hold the answer, and the conversation itself reveals how far they have taken it.',
        groundedIn: { source: 'Official planning document (historical)', url: historicalValue.sourceUrl, detail: historicalValue.quote.slice(0, 200) },
        topic: 'zoning',
      });
    }
  }

  // ── From the adopted district standards ──────────────────────────────────
  if (input.standards?.contextOnly && input.standards.standards.minimumLotSize) {
    add({
      key: 'context_district_standards',
      question: `The historical record puts this tract in ${input.standards.districtCode}, which requires ${input.standards.standards.minimumLotSize}. We could not confirm today's district from the city's published records. Do you know what it is zoned now?`,
      why: 'The district decides the minimum lot size, and the minimum lot size decides the deal. The seller is the cheapest route to the answer when the city publishes no parcel-level zoning.',
      groundedIn: {
        source: input.standards.standards.sources[0]?.label ?? 'Adopted zoning ordinance',
        url: input.standards.standards.sources[0]?.url ?? null,
        detail: `${input.standards.districtCode}: ${input.standards.standards.minimumLotSize}`,
      },
      topic: 'zoning',
    });
  }
  if (input.standards?.established && input.standards.standards.minimumLotSize) {
    add({
      key: 'district_minimum_lot',
      question: `${input.standards.districtCode} carries a minimum lot size of ${input.standards.standards.minimumLotSize}. Has anyone told you a different number for this tract, or discussed a variance?`,
      why: 'A seller who has spoken to planning often knows about a condition, an overlay or a variance that the published code does not print.',
      groundedIn: {
        source: input.standards.standards.sources[0]?.label ?? 'Adopted zoning ordinance',
        url: input.standards.standards.sources[0]?.url ?? null,
        detail: input.standards.standards.minimumLotSize,
      },
      topic: 'zoning',
    });
  }
  if (input.standards?.established && input.standards.standards.manufacturedHomeEligible === false) {
    add({
      key: 'manufactured_home_restriction',
      question: `The adopted code for ${input.standards.districtCode} appears not to permit manufactured homes. Is that your understanding of what can go on this land?`,
      why: 'Manufactured-home eligibility decides an entire exit strategy, and the seller usually knows what neighbours have been allowed to place.',
      groundedIn: {
        source: input.standards.standards.sources[0]?.label ?? 'Adopted zoning ordinance',
        url: input.standards.standards.sources[0]?.url ?? null,
        detail: 'Manufactured-home use read as not permitted in the district block.',
      },
      topic: 'zoning',
    });
  }

  // ── From the subdivision read ────────────────────────────────────────────
  const read = input.subdivisionRead;
  if (read?.frontageConstraint.status === 'unknown') {
    add({
      key: 'road_frontage',
      question: 'How much road frontage does the tract actually have, and is all of it on a public road?',
      why: read.frontageConstraint.detail,
      groundedIn: { source: 'LandOS subdivision read', url: null, detail: read.frontageConstraint.detail },
      topic: 'access',
    });
  }
  const utilities = read?.constraints.find((constraint) => constraint.kind === 'utilities_septic');
  if (utilities) {
    add({
      key: 'utilities_septic',
      question: 'Is public sewer or water available at the road, and has anyone ever run soil or perc tests on this tract?',
      why: utilities.detail,
      groundedIn: { source: utilities.sources[0]?.label ?? 'LandOS subdivision read', url: utilities.sources[0]?.url ?? null, detail: utilities.headline },
      topic: 'utilities',
    });
  }
  const access = read?.constraints.find((constraint) => constraint.kind === 'access');
  if (access) {
    add({
      key: 'legal_access',
      question: 'How do you physically get to the property, and is that access recorded as an easement or is it a handshake with a neighbour?',
      why: access.detail,
      groundedIn: { source: access.sources[0]?.label ?? 'LandOS access screening', url: access.sources[0]?.url ?? null, detail: access.headline },
      topic: 'access',
    });
  }
  if (read && read.reviewIndication === 'major') {
    add({
      key: 'major_review_awareness',
      question: `At the lot count this tract points to, the controlling authority's regulations indicate MAJOR subdivision review${read.requiredReviewBody ? ` through ${read.requiredReviewBody}` : ''}. Have you been through that process here before?`,
      why: 'Major review means preliminary and final plat, road standards and a public hearing. Sellers who have been through it price differently from sellers who have not.',
      groundedIn: { source: 'LandOS subdivision read', url: null, detail: read.likelyPath.why },
      topic: 'subdivision',
    });
  }

  // ── From ownership and constraints ───────────────────────────────────────
  const ownerName = input.backstory?.subject.owner ?? null;
  if (ownerName && ENTITY_PATTERN.test(ownerName)) {
    add({
      key: 'entity_owner',
      question: `Title is held by ${ownerName}. Who has authority to sign for the entity, and are there other members or partners who have to agree?`,
      why: 'An entity seller with more than one decision-maker is the most common cause of a deal that agrees on price and then never closes.',
      groundedIn: { source: 'Resolved parcel identity', url: null, detail: `Owner of record: ${ownerName}` },
      topic: 'ownership',
    });
  }
  const environmental = events.find((event) => event.eventType === 'environmental_constraint');
  if (environmental) {
    add({
      key: 'terrain_or_water',
      question: `Planning records for this tract discuss ${environmental.summary.replace(/\.$/, '')}. How much of the property is affected, and does any of it flood?`,
      why: 'Terrain and water are what turn a theoretical lot count into a real one, and the owner has walked the ground.',
      groundedIn: { source: environmental.evidence[0]?.sourceTitle ?? 'Official planning document', url: environmental.sourceUrl, detail: environmental.summary },
      topic: 'constraints',
    });
  }
  const infrastructure = events.find((event) => event.eventType === 'infrastructure_or_utility' || event.eventType === 'access_or_road');
  if (infrastructure) {
    add({
      key: 'infrastructure_history',
      question: `The record discusses ${infrastructure.summary.replace(/\.$/, '')}. Was any of that work ever quoted, engineered or paid for?`,
      why: 'A quoted road or sewer extension is the number that decides whether a subdivision pencils, and the seller usually has it.',
      groundedIn: { source: infrastructure.evidence[0]?.sourceTitle ?? 'Official planning document', url: infrastructure.sourceUrl, detail: infrastructure.summary },
      topic: 'utilities',
    });
  }

  return questions;
}

/**
 * The handoff, assembled from durable storage alone.
 *
 * This is the function a route or a future Pre-Call panel calls. No network, no
 * document, no re-derivation: everything it needs was written by the lanes.
 */
export function readPreCallIntelligenceHandoff(
  dealCardId: number,
  options: { now?: () => string } = {},
): PreCallIntelligenceHandoff {
  return buildPreCallIntelligenceHandoff({
    dealCardId,
    backstory: readPropertyBackstory(dealCardId),
    authority: readControllingAuthority(dealCardId),
    zoning: readCurrentZoning(dealCardId),
    regulations: readSubdivisionRegulations(dealCardId),
    subdivisionRead: readPropertySubdivisionRead(dealCardId),
    standards: readZoningStandards(dealCardId),
    now: options.now,
  });
}
