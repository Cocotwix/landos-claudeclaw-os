// LandOS — the WRITTEN PROVIDER CONFIRMATION package.
//
// WHY THIS EXISTS. Connection, capacity and fire flow are decisions a utility
// makes. No map read, no neighborhood pattern, no adjacent subdivision and no
// amount of further searching can produce them. When public research has gone
// as far as public research can go, the honest lane state is not UNRESOLVED —
// it is "this now needs the provider", and the useful product is a request the
// operator can send today.
//
// The request is built from what the research actually established, and that is
// the difference between a form letter and a good one. An inquiry that says
// "the adjoining neighborhood appears to be on public water with individual
// septic, and the site's own prior engineering proposed two pump stations" gets
// a real answer from a utility engineer. "Do you serve this address?" does not.
//
// NOTHING HERE SENDS ANYTHING. It composes a package; the operator decides.
//
// Pure. No I/O, no clock, no model, no browser, no network.

import type {
  UtilityAvailabilityResolution,
  UtilityKind,
} from './utility-availability-resolution.js';
import { corridorInfrastructureShown } from './utility-availability-resolution.js';

/** How the operator would actually reach the provider. */
export interface UtilityProviderContact {
  name: string;
  phone?: string | null;
  email?: string | null;
  formUrl?: string | null;
  websiteUrl?: string | null;
  /** e.g. engineering department, new service, tap applications. */
  department?: string | null;
}

export interface UtilityConfirmationSubject {
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
  /** What the operator is contemplating, so capacity can be asked about it. */
  contemplatedUse?: string | null;
}

export interface UtilityConfirmationRequest {
  kind: UtilityKind;
  /** Short subject line the operator can paste. */
  subjectLine: string;
  contact: UtilityProviderContact | null;
  /** Parcel identification, as the utility would need it. */
  propertyLines: string[];
  /** What LandOS already established, offered to the provider as context. */
  knownEvidence: string[];
  /** The questions, in the order they should be asked. */
  questions: string[];
  /** A ready-to-send body assembled from the above. */
  messageBody: string;
  /** Why this is a request rather than an answer. */
  whyRequired: string;
}

const WATER_QUESTIONS: readonly string[] = [
  'Is public water available to this parcel?',
  'Where is the nearest existing water main?',
  'Does a water main run along this parcel\'s road frontage?',
  'What is the size of that main, if one exists?',
  'Would a main extension be required to serve this parcel?',
  'Is capacity currently available for residential development at this location?',
  'Is the fire flow required for the contemplated use available?',
  'What application, engineering submittal or fee is needed to obtain a written availability determination?',
];

const SEWER_QUESTIONS: readonly string[] = [
  'Is public sewer available to this parcel?',
  'Where is the nearest existing collection line?',
  'Does a sewer line run along this parcel\'s road frontage?',
  'Is gravity service possible from this parcel?',
  'Would a pump or lift station, or a force main, be required?',
  'Is collection and treatment capacity currently available at this location?',
  'Would an offsite extension be required, and along what route?',
  'What application, engineering submittal or fee is needed to obtain a written availability determination?',
];

export function utilityConfirmationQuestions(kind: UtilityKind): readonly string[] {
  return kind === 'water' ? WATER_QUESTIONS : SEWER_QUESTIONS;
}

/**
 * The evidence lines worth showing a utility engineer.
 *
 * Only dimensions that were actually established appear. An inquiry padded with
 * "unresolved" lines reads as noise and invites a form response, so the empty
 * dimensions are simply left out — they are what the questions are for.
 */
function knownEvidenceLines(
  resolution: UtilityAvailabilityResolution,
  extraContext: readonly string[],
): string[] {
  const lines: string[] = [];
  if (resolution.provider.state === 'identified' && resolution.provider.name) {
    lines.push(`Provider identified as ${resolution.provider.name}${resolution.provider.providerType ? ` (${resolution.provider.providerType})` : ''}.`);
  }
  if (resolution.territory.state === 'inside') {
    lines.push('The parcel appears to fall inside your mapped service territory.');
  } else if (resolution.territory.state === 'outside') {
    lines.push('The parcel appears to fall outside your mapped service territory.');
  }
  const relationship = resolution.infrastructure.state;
  if (corridorInfrastructureShown(relationship)) {
    const where = relationship === 'AT_SUBJECT'
      ? 'at the parcel'
      : relationship === 'ON_SUBJECT_ROAD'
        ? 'along the parcel\'s road corridor'
        : 'immediately adjacent to the parcel';
    const sized = resolution.infrastructure.mainSizeInches
      ? ` The layer shows a ${resolution.infrastructure.mainSizeInches}-inch main.`
      : '';
    lines.push(`Public mapping shows a ${resolution.kind} main ${where}${resolution.infrastructure.layerName ? ` on the "${resolution.infrastructure.layerName}" layer` : ''}.${sized}`);
  } else if (relationship === 'NEARBY') {
    lines.push(`Public mapping shows a ${resolution.kind} main in the vicinity but not on the parcel's road corridor.`);
  } else if (relationship === 'NOT_SHOWN') {
    lines.push(`The public ${resolution.kind} layer we were able to read draws no line at or along this parcel, which is why we are asking rather than assuming.`);
  }
  if (resolution.kind === 'sewer' && resolution.infrastructure.liftStationObserved) {
    lines.push('A lift or pump station appears on the mapping in this area.');
  }
  for (const entry of resolution.areaContext) lines.push(entry.statement);
  for (const entry of extraContext) if (entry.trim()) lines.push(entry.trim());
  return lines;
}

function propertyLines(subject: UtilityConfirmationSubject): string[] {
  const lines: string[] = [];
  if (subject.address) lines.push(`Property: ${subject.address}`);
  if (subject.apn) lines.push(`Parcel / APN: ${subject.apn}`);
  const place = [subject.county ? `${subject.county} County` : null, subject.state].filter(Boolean).join(', ');
  if (place) lines.push(`Jurisdiction: ${place}`);
  if (subject.acres != null) lines.push(`Size: ${subject.acres} acres`);
  if (subject.contemplatedUse) lines.push(`Contemplated use: ${subject.contemplatedUse}`);
  return lines;
}

/**
 * Build the request.
 *
 * `extraContext` is where a caller passes findings that live outside the
 * resolution itself — a traced adjacent extension, a historical pump-station
 * proposal. They are offered to the provider as context and are never presented
 * as our conclusion about the parcel.
 */
export function buildUtilityConfirmationRequest(input: {
  kind: UtilityKind;
  subject: UtilityConfirmationSubject;
  resolution: UtilityAvailabilityResolution;
  contact?: UtilityProviderContact | null;
  extraContext?: readonly string[];
}): UtilityConfirmationRequest {
  const { kind, subject, resolution } = input;
  const label = kind === 'water' ? 'water' : 'sewer';
  const known = knownEvidenceLines(resolution, input.extraContext ?? []);
  const questions = [...utilityConfirmationQuestions(kind)];
  const property = propertyLines(subject);

  const identity = subject.apn
    ? `${subject.address ?? 'the parcel'} (APN ${subject.apn})`
    : subject.address ?? 'the subject parcel';

  const messageBody = [
    `I am evaluating ${identity} and need to establish whether public ${label} service is available to it.`,
    '',
    ...property,
    '',
    ...(known.length
      ? ['What I have been able to establish from public sources:', ...known.map((line) => `- ${line}`), '']
      : []),
    `Questions:`,
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'A written availability determination, or a pointer to the application that produces one, is what I ultimately need. Thank you.',
  ].join('\n');

  return {
    kind,
    subjectLine: `Public ${label} availability — ${identity}`,
    contact: input.contact ?? null,
    propertyLines: property,
    knownEvidence: known,
    questions,
    messageBody,
    whyRequired: corridorInfrastructureShown(resolution.infrastructure.state)
      ? `Public mapping settled where the ${label} infrastructure is. It cannot settle whether this parcel may connect to it, at what capacity, or on what conditions — those are determinations only ${resolution.provider.name ?? 'the serving authority'} makes.`
      : `Public research did not place ${label} infrastructure on this parcel's corridor. Further searching cannot produce an availability determination; ${resolution.provider.name ?? 'the serving authority'} is the only source that can answer it.`,
  };
}
