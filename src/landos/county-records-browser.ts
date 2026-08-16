// LandOS — County Records Browser service (Phase 4).
//
// Fills gaps left by LandPortal and verifies critical PUBLIC records. It browses
// county sites like an experienced land researcher — assessor, tax office, GIS,
// recorder, clerk, planning, zoning, deeds, plat maps, tax history, ownership,
// parcel maps, road frontage, recorded documents, and other public resources. It
// is NOT a restricted robot: it follows links, opens PDFs, reads tables, and
// extracts data. If NETR links fail, it searches intelligently for the current
// county site and continues — it never stops because a link changed.
//
// Workflow mode retrieves ONLY what is still missing after LandPortal (gap-fill,
// no duplicate retrieval). Ask mode answers natural public-record questions and
// determines the correct workflow automatically. Public records require no login;
// it only stops for payments, credentialed logins, destructive actions, or
// unsolvable CAPTCHAs. Driver is injectable; the default parked stub never fakes.

// The functions passed to driver.evaluate() execute INSIDE the operator's
// browser (not Node), so the DOM globals are declared as `any` purely to satisfy
// the Node typechecker. They are never executed in this process.
declare const document: any;
declare const Event: any;
declare const window: any;
declare const HTMLFormElement: any;
declare const HTMLSelectElement: any;
declare const HTMLInputElement: any;

import {
  type BrowserService, type BrowserDriver, type BrowserEvidence, type BrowserWorkflowInput,
  type BrowserSearchKey, type BrowserFact, type BrowserRunHooks, type BrowserSourceAttempt,
  makeParkedDriver, emptyEvidence, routeBrowserQuestion, recordBlocked,
} from './browser-intelligence.js';
import type { PropertyPatch } from './normalized-property.js';
import { isRejectedParcelRecordDestination, planParcelSearch, pickParcelRecordLink, type FormInfo, type NavSearchKey } from './browser-navigator.js';
import { planNetrWorkflow, buildNetrStateUrl, type NetrStep } from './browser-retrieval.js';
import { withOwnedPages } from './browser-owned-pages.js';
import { COUNTY_WORKFLOW_FOR, type DdField } from './missing-field-analysis.js';
import {
  extractCountySources, officialSearchQuery, pickOfficialResult, netrIsStale,
  searchEngineUrl, unwrapSearchResults,
  governmentSourceScopePriority, orderCountySourcesLocalFirst,
  officialDomainScore, sourceContradictsRequestedState,
  COUNTY_SOURCE_TYPES, type CountySourceLink, type CountySourceType,
} from './netr-routing.js';
import { extractRecordFacts, extractAgencyContact, parcelRecordSignal, type ExtractContext } from './semantic-extract.js';
import { getCountySources, saveCountySources, isCountyCacheFresh } from './county-source-map.js';
import { CountyResearchCapability } from './county-research-capability.js';
import { apnSearchVariants } from './opportunity-research-mission.js';
import { statewidePortalFor, type StatewidePortal } from './statewide-assessment-portals.js';
import {
  pickBestCandidate, planNavigationStrategy, rankSearchMethods,
  type PageObservation, type SearchMethod,
} from './website-intelligence.js';
import { deriveTaxStanding, TAX_STANDING_LABEL } from './tax-status-research.js';

/** County workflow targets (the public resources the researcher navigates). */
export const COUNTY_WORKFLOWS = [
  'assessor', 'tax_office', 'gis', 'recorder', 'clerk', 'planning_zoning',
] as const;
export type CountyWorkflow = (typeof COUNTY_WORKFLOWS)[number];

/** Map a county workflow to the NETR navigation step it begins from. */
const WORKFLOW_NETR_STEP: Record<string, NetrStep> = {
  assessor: 'locate_assessor',
  tax_office: 'locate_tax_records',
  gis: 'locate_gis',
  recorder: 'locate_recorder',
  clerk: 'locate_recorder',
  planning_zoning: 'locate_county',
};

export interface CountyRecordsBrowserDeps {
  driver?: BrowserDriver;
  now?: () => string;
}

/** Reasons the county researcher legitimately stops (and records as blocked). */
export const COUNTY_STOP_CONDITIONS = ['payment', 'credentialed_login', 'destructive_action', 'unsolvable_captcha'] as const;

function workflowsForNeeded(neededFields?: string[]): CountyWorkflow[] {
  if (!neededFields || neededFields.length === 0) return [...COUNTY_WORKFLOWS];
  const set = new Set<string>();
  for (const f of neededFields) {
    const wf = COUNTY_WORKFLOW_FOR[f as DdField];
    if (wf) set.add(wf);
  }
  return [...set].filter((w): w is CountyWorkflow => (COUNTY_WORKFLOWS as readonly string[]).includes(w));
}

interface AdditionalGovernmentFactSpec {
  key: string;
  label: string;
  rx: RegExp;
  /** Parcel facts require a reached parcel/record detail. Ordinance and utility
   * facts may be extracted from an official jurisdiction page. */
  scope: 'parcel' | 'jurisdiction';
}

const ADDITIONAL_GOVERNMENT_FACT_SPECS: AdditionalGovernmentFactSpec[] = [
  { key: 'taxAmount', label: 'Current property-tax amount', rx: /^(current\s+)?(?:annual\s+)?(?:property\s+)?tax(?:es|\s+bill)?\s*(?:amount|total|due)?$/i, scope: 'parcel' },
  { key: 'taxYear', label: 'Property-tax year', rx: /^(?:property\s+)?tax\s*year$/i, scope: 'parcel' },
  { key: 'taxPaymentStatus', label: 'Property-tax payment status', rx: /^(?:property\s+)?tax\s*(?:payment\s*)?status$/i, scope: 'parcel' },
  { key: 'delinquencyStatus', label: 'Tax delinquency status', rx: /^(delinquen(cy|t)?(\s*status)?|tax\s*delinquen(cy|t)|past\s*due|amount\s*past\s*due)$/i, scope: 'parcel' },
  { key: 'delinquentAmount', label: 'Delinquent tax amount owed', rx: /^(?:delinquent|past[- ]due|back)\s*(?:tax(?:es)?\s*)?(?:amount|balance|total|owed)|^(?:tax(?:es)?\s*)?amount\s+owed$/i, scope: 'parcel' },
  { key: 'unpaidTaxYears', label: 'Unpaid property-tax years', rx: /^(?:unpaid|delinquent|past[- ]due)\s*(?:tax\s*)?years?$/i, scope: 'parcel' },
  { key: 'delinquencyStartYear', label: 'Tax delinquency began', rx: /^(?:delinquen(?:cy|t)|unpaid|past[- ]due)\s*(?:since|start(?:ed)?|begin|from)(?:\s+year)?$/i, scope: 'parcel' },
  { key: 'taxPenaltyInterest', label: 'Tax penalties and interest', rx: /^(?:tax\s*)?(?:penalt(?:y|ies)|interest|penalt(?:y|ies)\s*(?:and|&)\s*interest)$/i, scope: 'parcel' },
  { key: 'taxSaleStatus', label: 'Tax-sale status', rx: /^(?:delinquent\s*)?tax[- ]sale\s*(?:status|date)?$/i, scope: 'parcel' },
  { key: 'structureType', label: 'Improvement / structure type', rx: /^(?:primary\s*)?(?:improvement|building|structure)\s*(?:description|type|class|use)$/i, scope: 'parcel' },
  { key: 'yearBuilt', label: 'Year built', rx: /^(?:actual\s+|effective\s+)?year\s*built$/i, scope: 'parcel' },
  { key: 'buildingSqft', label: 'Building square footage', rx: /^(?:building|heated|living|finished|total)\s*(?:area|sq(?:uare)?\s*(?:feet|foot|ft)|sqft)$/i, scope: 'parcel' },
  { key: 'improvements', label: 'Improvements', rx: /^(improvements?|structures?|building\s*value)$/i, scope: 'parcel' },
  { key: 'manufacturedHomeAssessment', label: 'Manufactured-home assessment relationship', rx: /^(?:(?:mobile|manufactured)\s*home|trailer)\s*(?:assessment|assessed\s+with\s+land|real\s+property\s+status)$/i, scope: 'parcel' },
  { key: 'manufacturedHomeAccount', label: 'Manufactured-home tax/account number', rx: /^(?:(?:mobile|manufactured)\s*home|trailer)\s*(?:tax\s*)?(?:account|parcel|record|decal|id)(?:\s*(?:number|no\.?|#))?$/i, scope: 'parcel' },
  { key: 'manufacturedHomeOwner', label: 'Manufactured-home assessed owner', rx: /^(?:(?:mobile|manufactured)\s*home|trailer)\s*(?:assessed\s*)?owner(?:\s+name)?$/i, scope: 'parcel' },
  { key: 'manufacturedHomeTitleOwner', label: 'Manufactured-home title owner', rx: /^(?:(?:mobile|manufactured)\s*home|trailer)\s*title(?:d)?\s*(?:owner|holder)(?:\s+name)?$/i, scope: 'parcel' },
  { key: 'currentDeed', label: 'Current deed', rx: /^(current\s*deed|deed\s*(type|description)|document\s*type)$/i, scope: 'parcel' },
  { key: 'grantor', label: 'Grantor', rx: /^(grantor|seller|from\s*party)$/i, scope: 'parcel' },
  { key: 'grantee', label: 'Grantee', rx: /^(grantee|buyer|to\s*party)$/i, scope: 'parcel' },
  { key: 'recordingDate', label: 'Recording date', rx: /^(record(ed|ing)?\s*date|filed\s*date)$/i, scope: 'parcel' },
  { key: 'instrumentNumber', label: 'Instrument number', rx: /^(instrument|document|recording)\s*(number|no\.?|#|id)$/i, scope: 'parcel' },
  { key: 'recordBookPage', label: 'Recorded book / page', rx: /^(deed\s*)?book\s*\/?\s*page$/i, scope: 'parcel' },
  { key: 'recordedPageCount', label: 'Recorded document pages', rx: /^(number\s*of\s*pages|recorded\s*(document\s*)?pages?)$/i, scope: 'parcel' },
  { key: 'consideration', label: 'Recorded consideration', rx: /^(consideration|transfer\s*(price|amount)|deed\s*consideration)$/i, scope: 'parcel' },
  { key: 'legalDescription', label: 'Legal description', rx: /^(legal(\s*description)?|property\s*description|brief\s*legal)$/i, scope: 'parcel' },
  { key: 'recordedPlat', label: 'Recorded plat', rx: /^(plat|plat\s*(book|reference|number|no\.?|#)|survey\s*reference)$/i, scope: 'parcel' },
  { key: 'easements', label: 'Easements', rx: /^(easements?|easement\s*(description|reference|type))$/i, scope: 'parcel' },
  { key: 'restrictionsCovenants', label: 'Restrictions / covenants', rx: /^(restrictions?|covenants?|deed\s*restrictions?|protective\s*covenants?)$/i, scope: 'parcel' },
  { key: 'accessInstruments', label: 'Access instruments', rx: /^(access\s*(easement|instrument|agreement)|ingress\s*\/?\s*egress)$/i, scope: 'parcel' },
  { key: 'roadMaintenanceAgreement', label: 'Road-maintenance agreement', rx: /^(road\s*maintenance(\s*agreement)?|private\s*road\s*agreement)$/i, scope: 'parcel' },
  { key: 'zoningJurisdiction', label: 'Governing zoning jurisdiction', rx: /^(zoning|planning|governing)\s*jurisdiction$/i, scope: 'jurisdiction' },
  { key: 'zoningDistrict', label: 'Zoning district', rx: /^(zoning(\s*(district|classification|code))?|zone)$/i, scope: 'parcel' },
  { key: 'permittedUses', label: 'Permitted uses', rx: /^(permitted|allowed|principal)\s*uses?$/i, scope: 'jurisdiction' },
  { key: 'minimumLotSize', label: 'Minimum lot size', rx: /^(minimum|min\.?)\s*(lot|parcel)\s*(size|area)$/i, scope: 'jurisdiction' },
  { key: 'minimumFrontage', label: 'Minimum frontage', rx: /^(minimum|min\.?)\s*(road\s*)?frontage$/i, scope: 'jurisdiction' },
  { key: 'minorSubdivisionRules', label: 'Minor-subdivision rules', rx: /^(minor\s*subdivision(\s*(rules?|standard|threshold))?|minor\s*plat)$/i, scope: 'jurisdiction' },
  { key: 'flagLotRules', label: 'Flag-lot rules', rx: /^(flag\s*lots?(\s*(rules?|standard|requirements?))?)$/i, scope: 'jurisdiction' },
  { key: 'sharedAccessRules', label: 'Shared-access rules', rx: /^(shared\s*(access|driveway)(\s*(rules?|standard|requirements?))?)$/i, scope: 'jurisdiction' },
  { key: 'privateRoadRequirements', label: 'Private-road requirements', rx: /^(private\s*roads?(\s*(rules?|standard|requirements?))?)$/i, scope: 'jurisdiction' },
  { key: 'publicWater', label: 'Public water information', rx: /^(public|municipal)\s*water(\s*(availability|service|provider))?$/i, scope: 'jurisdiction' },
  { key: 'publicSewer', label: 'Public sewer information', rx: /^(public|municipal)\s*(sewer|wastewater)(\s*(availability|service|provider))?$/i, scope: 'jurisdiction' },
  { key: 'utilityProvider', label: 'Utility-provider context', rx: /^(utility|water|sewer)\s*(provider|authority|district)$/i, scope: 'jurisdiction' },
];

function ownerSignature(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((part) => part && !['the', 'and', 'trustee', 'trustees'].includes(part))
    .sort().join(' ');
}

/** Add operator-facing conclusions only when the retained labeled county facts
 * support them. Missing ownership/title evidence remains explicitly unresolved. */
function finalizeTaxAndImprovementFacts(facts: BrowserFact[], subjectOwner?: string): void {
  const extracted = (key: string) => facts.find((fact) => fact.key === key && fact.status === 'extracted');
  const addDerived = (key: string, label: string, value: string, basis: BrowserFact): void => {
    if (extracted(key)) return;
    facts.push({ ...basis, key, label, value, extractionMethod: `derived from labeled official fields: ${basis.key}` });
  };

  const rawTaxStatus = extracted('taxPaymentStatus') ?? extracted('delinquencyStatus');
  const delinquentAmount = extracted('delinquentAmount');
  if (rawTaxStatus || delinquentAmount) {
    const basis = rawTaxStatus ?? delinquentAmount!;
    // ONE derivation rule, shared with the payment-status projection. Two copies
    // of "what counts as delinquent" is how a browser read and an operator panel
    // end up disagreeing about the same parcel.
    const standing = deriveTaxStanding({
      paymentStatus: rawTaxStatus?.value ?? null,
      delinquentAmount: delinquentAmount?.value ?? null,
    });
    if (standing !== 'unresolved') {
      addDerived('taxStanding', 'Property-tax standing', TAX_STANDING_LABEL[standing], basis);
    }
  }

  const structure = extracted('structureType') ?? extracted('improvements');
  const mobileHomePresent = structure != null && /\b(?:mobile|manufactured|modular)\s*home\b|\btrailer\b/i.test(structure.value);
  const assessment = extracted('manufacturedHomeAssessment');
  const account = extracted('manufacturedHomeAccount');
  const homeOwner = extracted('manufacturedHomeTitleOwner') ?? extracted('manufacturedHomeOwner');
  if (!mobileHomePresent && !assessment && !account && !homeOwner) return;
  const basis = assessment ?? account ?? homeOwner ?? structure!;
  if (account && (!assessment || !/separate/i.test(assessment.value))) {
    addDerived('manufacturedHomeAssessmentStatus', 'Manufactured-home assessment status', 'Separate tax/account record', account);
  } else if (assessment) {
    const status = /separate/i.test(assessment.value)
      ? 'Separate tax/account record'
      : /with\s+(?:the\s+)?land|real\s+property|same\s+(?:parcel|account)/i.test(assessment.value)
        ? 'Assessed with the land'
        : `Unresolved — public record states: ${assessment.value}`;
    addDerived('manufacturedHomeAssessmentStatus', 'Manufactured-home assessment status', status, assessment);
  } else {
    addDerived('manufacturedHomeAssessmentStatus', 'Manufactured-home assessment status', 'Unresolved — no assessment relationship was stated in the retained public record', basis);
  }

  const landOwner = subjectOwner?.trim() || extracted('owner')?.value.trim() || '';
  if (!homeOwner || !landOwner) {
    addDerived('manufacturedHomeOwnershipMatch', 'Manufactured-home owner compared with land owner', 'Unresolved — both the home owner/title holder and land owner were not stated in retained public records', basis);
    return;
  }
  const same = ownerSignature(homeOwner.value) === ownerSignature(landOwner);
  addDerived(
    'manufacturedHomeOwnershipMatch',
    'Manufactured-home owner compared with land owner',
    same ? `Same owner — ${homeOwner.value}` : `Different owner — home: ${homeOwner.value}; land: ${landOwner}`,
    homeOwner,
  );
}

function addVisibleFields(target: Record<string, string>, fields: Record<string, string> | undefined): void {
  for (const [rawLabel, rawValue] of Object.entries(fields ?? {})) {
    const label = rawLabel.replace(/\s+/g, ' ').trim().replace(/[:#]+$/, '');
    const value = String(rawValue ?? '').replace(/\s+/g, ' ').trim();
    // Later reads are closer to the reached record detail and therefore replace
    // same-labeled landing/result values from earlier navigation states.
    if (label && value) target[label] = value;
  }
}

/** Preserve explicit label/value snippets returned by a driver. Free-form prose
 * is ignored; only an unambiguous `label: value`, tab, or pipe pair is admitted. */
function addVisibleSnippets(target: Record<string, string>, snippets: string[] | undefined): void {
  for (const snippet of snippets ?? []) {
    for (const line of String(snippet).split(/\r?\n/)) {
      const match = line.trim().match(/^([^:|\t]{2,80})(?::|\t|\|)\s*(.{1,500})$/);
      if (!match) continue;
      addVisibleFields(target, { [match[1]]: match[2] });
    }
  }
}

function extractGovernmentFacts(
  fields: Record<string, string>,
  ctx: ExtractContext,
  opts: { pageIsRecord: boolean; sourceType: CountySourceType; extractionMethod: string },
): BrowserFact[] {
  const facts = opts.pageIsRecord
    ? extractRecordFacts(fields, ctx, { pageIsRecord: true }).map((fact) => ({
      ...fact,
      extractionMethod: opts.extractionMethod,
    }))
    : [];
  const seen = new Set(facts.map((fact) => fact.key));
  for (const [rawLabel, rawValue] of Object.entries(fields)) {
    const label = rawLabel.replace(/\s+/g, ' ').trim();
    const value = String(rawValue ?? '').replace(/\s+/g, ' ').trim();
    if (!label || !value) continue;
    for (const spec of ADDITIONAL_GOVERNMENT_FACT_SPECS) {
      if (seen.has(spec.key) || !spec.rx.test(label)) continue;
      if (spec.scope === 'parcel' && !opts.pageIsRecord) continue;
      if (spec.scope === 'jurisdiction' && !['planning', 'building', 'gis'].includes(opts.sourceType) && !opts.pageIsRecord) continue;
      seen.add(spec.key);
      facts.push({
        key: spec.key,
        label: spec.label,
        value: value.slice(0, 500),
        sourceName: ctx.sourceName,
        sourceType: ctx.sourceType,
        sourceUrl: ctx.sourceUrl,
        confidence: ctx.origin === 'search_fallback' ? 'medium' : 'high',
        origin: ctx.origin,
        status: 'extracted',
        extractionMethod: opts.extractionMethod,
      });
      break;
    }
  }
  return facts;
}

function compactIdentifier(value: string | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Reject an explicitly different parcel. Absence of a repeated identifier does
 * not block a practical record read; discovery already established the subject. */
function recordContradictsSubject(fields: Record<string, string>, key: BrowserSearchKey): boolean {
  const expectedApn = compactIdentifier(key.apn);
  if (!expectedApn) return false;
  for (const [label, value] of Object.entries(fields)) {
    if (!/^(apn|parcel(\s*(id|number|no\.?|#))?|pin|tax\s*map)/i.test(label.trim())) continue;
    const observed = compactIdentifier(value);
    if (observed.length >= 5 && observed !== expectedApn) return true;
  }
  return false;
}

function identifierValue(key: BrowserSearchKey, method: SearchMethod): string | undefined {
  if (method === 'apn') return key.apn;
  if (method === 'address') return key.address;
  if (method === 'owner') return key.owner;
  return undefined;
}

interface SubjectRecordRetrieval {
  fields: Record<string, string>;
  reachedUrl: string;
  recordReached: boolean;
  extractionMethod: string;
  searchMethods: string[];
  alternateRoutesAttempted: string[];
  steps: NonNullable<BrowserSourceAttempt['steps']>;
  failureCode?: BrowserSourceAttempt['failureCode'];
}

interface AcclaimGridRow {
  transactionItemId: number;
  instrumentNumber: string;
  parcelNumber: string;
  comments: string;
  bookPage: string;
  party: string;
  name: string;
  crossPartyName: string;
  docType: string;
  rowNumber: number;
}

function acclaimBaseUrl(sourceUrl: string): { origin: string; basePath: string; baseUrl: string } | null {
  try {
    const url = new URL(sourceUrl);
    const match = url.pathname.match(/^(.*?\/AcclaimWeb)(?:\/|$)/i);
    const basePath = match?.[1] ?? '/AcclaimWeb';
    return { origin: url.origin, basePath, baseUrl: `${url.origin}${basePath}` };
  } catch {
    return null;
  }
}

function readAcclaimSection(lines: string[], label: string, nextLabels: Set<string>): string {
  let start = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].toLowerCase() === label.toLowerCase()) {
      start = index;
      break;
    }
  }
  if (start < 0) return '';
  const values: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (nextLabels.has(line.toLowerCase())) break;
    values.push(line);
  }
  return values.join('; ').trim();
}

/** Parse the visible instrument-detail text emitted by Harris Acclaim. Kept
 * value-free and portal-family scoped so every county using Acclaim can reuse
 * the same extraction without a county/APN-specific scraper. */
export function acclaimDetailFieldsFromText(bodyText: string): Record<string, string> {
  const lines = String(bodyText ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const labels = [
    'Record Date:', 'Book Type:', 'Book / Page:', 'Instrument Number:',
    'Number Of Pages:', 'Doc Type:', 'Grantor:', 'Grantee:', 'Consideration:',
    'Description:', 'Referenced By:', 'Related DocLink:', 'TMS Number:', 'Mailback:',
  ];
  const nextLabels = new Set(labels.map((label) => label.toLowerCase()));
  const read = (label: string) => readAcclaimSection(lines, label, nextLabels);
  const related = read('Related DocLink:');
  const plat = related.split(/;\s*/).find((value) => /^PL\s+/i.test(value)) ?? '';
  const fields: Record<string, string> = {
    'Recording Date': read('Record Date:'),
    'Deed Book / Page': read('Book / Page:'),
    'Instrument Number': read('Instrument Number:'),
    'Number Of Pages': read('Number Of Pages:'),
    'Current Deed': read('Doc Type:') || read('Book Type:'),
    Grantor: read('Grantor:'),
    Grantee: read('Grantee:'),
    Consideration: read('Consideration:'),
    'Legal Description': read('Description:'),
    'Recorded Plat': plat,
    'Parcel ID': read('TMS Number:'),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => !!value));
}

/** Pick only an exact subject-parcel row from an Acclaim name-result grid. An
 * owner-name hit alone is deliberately insufficient because trusts and public
 * entities can have many unrelated instruments. */
export function findAcclaimSubjectRow(
  rows: Array<Record<string, unknown>>,
  expectedApn: string,
): AcclaimGridRow | null {
  const expected = compactIdentifier(expectedApn);
  if (!expected) return null;
  const index = rows.findIndex((row) => {
    const parcel = compactIdentifier(String(row.ParcelNumber ?? ''));
    return parcel === expected || parcel.startsWith(`${expected}po`);
  });
  if (index < 0) return null;
  const row = rows[index];
  const transactionItemId = Number(row.TransactionItemId);
  if (!Number.isInteger(transactionItemId) || transactionItemId <= 0) return null;
  return {
    transactionItemId,
    instrumentNumber: String(row.InstrumentNumber ?? '').trim(),
    parcelNumber: String(row.ParcelNumber ?? '').trim(),
    comments: String(row.Comments ?? '').trim(),
    bookPage: String(row.BookPage ?? '').trim(),
    party: String(row.Party ?? '').trim(),
    name: String(row.Name ?? '').trim(),
    crossPartyName: String(row.CrossPartyName ?? '').trim(),
    docType: String(row.DocType ?? '').trim(),
    rowNumber: index + 1,
  };
}

async function retrieveAcclaimSubjectRecord(
  driver: BrowserDriver,
  source: CountySourceLink,
  key: BrowserSearchKey,
  remaining: () => number,
  expired: () => boolean,
  cancelled: () => boolean,
): Promise<SubjectRecordRetrieval> {
  const route = acclaimBaseUrl(source.url);
  const steps: NonNullable<BrowserSourceAttempt['steps']> = [];
  const alternateRoutesAttempted = ['acclaim_name_search'];
  const searchMethods: string[] = [];
  if (!route || !driver.evaluate || !key.owner || !key.apn) {
    return {
      fields: {},
      reachedUrl: source.url,
      recordReached: false,
      extractionMethod: 'Harris Acclaim official-record search',
      searchMethods,
      alternateRoutesAttempted,
      steps: [{ stage: 'retrieve', outcome: 'skipped', detail: 'Acclaim correlation requires both the subject owner and APN.' }],
      failureCode: 'no_subject_identifier',
    };
  }
  const evaluate = <T>(fn: unknown, ...args: unknown[]): Promise<T> =>
    driver.evaluate!(fn as () => T, ...args);
  const wait = async (milliseconds: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, Math.max(0, remaining()))));
  };
  const namePath = `${route.basePath}/search/SearchTypeName`;
  const disclaimerUrl = `${route.baseUrl}/Search/Disclaimer?st=${namePath}`;
  const opened = await driver.open(disclaimerUrl, { timeoutMs: remaining() });
  steps.push({ stage: 'navigate', outcome: 'succeeded', detail: 'Opened the county recorder public-search disclaimer.', url: opened.url || disclaimerUrl });
  const accepted = await evaluate<boolean>(() => {
    const button = document.querySelector('#btnButton');
    if (!button) return false;
    button.click();
    return true;
  });
  if (accepted) {
    alternateRoutesAttempted.push('public_disclaimer_accepted');
    await wait(900);
  }
  if (expired() || cancelled()) {
    return {
      fields: {}, reachedUrl: opened.url || disclaimerUrl, recordReached: false,
      extractionMethod: 'Harris Acclaim official-record search',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'timeout_or_cancelled',
    };
  }

  searchMethods.push(`owner:${key.owner}`);
  const submitted = await evaluate<boolean>(((owner: string) => {
    const input = document.querySelector('#SearchOnName');
    const button = document.querySelector('#btnSearch');
    if (!input || !button) return false;
    input.value = owner;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    button.click();
    return true;
  }) as unknown as () => boolean, key.owner);
  if (!submitted) {
    steps.push({ stage: 'retrieve', outcome: 'unavailable', detail: 'The Acclaim owner-search control was not available.', url: `${route.baseUrl}/search/SearchTypeName` });
    return {
      fields: {}, reachedUrl: `${route.baseUrl}/search/SearchTypeName`, recordReached: false,
      extractionMethod: 'Harris Acclaim official-record search',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'no_search_control',
    };
  }
  await wait(1_300);

  const selected = await evaluate<boolean>(((owner: string) => {
    const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = normalize(owner);
    const valueInput = [...document.querySelectorAll('input[name="itemValue"]')]
      .find((input: any) => normalize(input.value) === target);
    const row = valueInput?.closest('li');
    const checkbox = row?.querySelector('input[type="checkbox"][name$=".Checked"]');
    const done = [...document.querySelectorAll('input')]
      .find((input: any) => String(input.getAttribute('onclick') ?? '').includes('GetNameListString'));
    if (!checkbox || !done) return false;
    if (!checkbox.checked) checkbox.click();
    done.click();
    return true;
  }) as unknown as () => boolean, key.owner);
  if (!selected) {
    steps.push({ stage: 'retrieve', outcome: 'no_match', detail: 'The exact owner was not offered by the recorder name index.', url: `${route.baseUrl}/search/SearchTypeName` });
    return {
      fields: {}, reachedUrl: `${route.baseUrl}/search/SearchTypeName`, recordReached: false,
      extractionMethod: 'Harris Acclaim official-record search',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'no_subject_match',
    };
  }
  alternateRoutesAttempted.push('exact_owner_selection');

  let rows: Array<Record<string, unknown>> = [];
  for (let attempt = 0; attempt < 16 && !expired() && !cancelled(); attempt += 1) {
    rows = await evaluate<Array<Record<string, unknown>>>(() => {
      const jq = window.jQuery || window.$;
      const grid = jq?.('#RsltsGrid')?.data?.('tGrid');
      return Array.isArray(grid?.data) ? grid.data : [];
    });
    if (rows.length) break;
    await wait(400);
  }
  const match = findAcclaimSubjectRow(rows, key.apn);
  searchMethods.push(`apn_correlation:${key.apn}`);
  if (!match) {
    steps.push({
      stage: 'retrieve',
      outcome: 'no_match',
      detail: `The exact owner index returned ${rows.length} instrument row(s), but none carried the subject APN.`,
      url: `${route.baseUrl}/search/SearchTypeName`,
    });
    return {
      fields: {}, reachedUrl: `${route.baseUrl}/search/SearchTypeName`, recordReached: false,
      extractionMethod: 'Harris Acclaim official-record search',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'no_subject_match',
    };
  }
  alternateRoutesAttempted.push('exact_apn_grid_correlation');

  const popupOpened = await evaluate<boolean>(((detail: {
    transactionItemId: number; instrumentNumber: string; rowNumber: number; detailUrl: string;
  }) => {
    window.LastDocId = detail.transactionItemId;
    window.LastInsNm = detail.instrumentNumber;
    window.RowId = detail.rowNumber;
    window.PageNumber = 1;
    window.PageSize = 100;
    try { window.__landosAcclaimDetail?.close?.(); } catch { /* already closed */ }
    window.__landosAcclaimDetail = window.open(detail.detailUrl, '_blank');
    return !!window.__landosAcclaimDetail;
  }) as unknown as () => boolean, {
    transactionItemId: match.transactionItemId,
    instrumentNumber: match.instrumentNumber,
    rowNumber: match.rowNumber,
    detailUrl: `${route.basePath}/Details/`,
  });
  if (!popupOpened) {
    steps.push({ stage: 'retrieve', outcome: 'unavailable', detail: 'The matched instrument detail could not be opened.', url: `${route.baseUrl}/search/SearchTypeName` });
    return {
      fields: {}, reachedUrl: `${route.baseUrl}/search/SearchTypeName`, recordReached: false,
      extractionMethod: 'Harris Acclaim official-record search',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'record_not_reached',
    };
  }
  alternateRoutesAttempted.push('instrument_detail');

  let detail: { body: string; url: string; documentUrl: string } = { body: '', url: `${route.baseUrl}/Details/`, documentUrl: '' };
  for (let attempt = 0; attempt < 16 && !expired() && !cancelled(); attempt += 1) {
    detail = await evaluate<{ body: string; url: string; documentUrl: string }>(() => {
      const popup = window.__landosAcclaimDetail;
      try {
        const body = String(popup?.document?.body?.innerText ?? '');
        const frame = popup?.document?.querySelector?.('#imgFrame1');
        return {
          body,
          url: String(popup?.location?.href ?? ''),
          documentUrl: String(frame?.src ?? ''),
        };
      } catch {
        return { body: '', url: '', documentUrl: '' };
      }
    });
    if (
      detail.body.includes(match.instrumentNumber)
      && /TMS Number:/i.test(detail.body)
      && /\/Image\/DocumentImage\d*\//i.test(detail.documentUrl)
    ) break;
    await wait(400);
  }
  if (!/\/Image\/DocumentImage\d*\//i.test(detail.documentUrl)) detail.documentUrl = '';
  try { await evaluate<void>(() => window.__landosAcclaimDetail?.close?.()); } catch { /* optional cleanup */ }

  const fields = acclaimDetailFieldsFromText(detail.body);
  const observedApn = compactIdentifier(fields['Parcel ID']);
  const expectedApn = compactIdentifier(key.apn);
  if (!detail.body || !observedApn || observedApn !== expectedApn) {
    steps.push({ stage: 'retrieve', outcome: 'no_match', detail: 'The instrument detail did not repeat the exact subject APN.', url: detail.url });
    return {
      fields, reachedUrl: detail.url || `${route.baseUrl}/Details/`, recordReached: false,
      extractionMethod: 'Harris Acclaim owner search → APN-correlated instrument',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'no_subject_match',
    };
  }
  if (detail.documentUrl && !expired() && !cancelled()) {
    try {
      await driver.open(detail.documentUrl, { timeoutMs: remaining() });
      alternateRoutesAttempted.push('official_document_image');
    } catch { /* detail metadata remains valid evidence if the scan viewer fails */ }
  }
  steps.push({
    stage: 'retrieve',
    outcome: 'succeeded',
    detail: `Matched recorder instrument ${match.instrumentNumber} to exact subject APN ${fields['Parcel ID']}.`,
    url: detail.documentUrl || detail.url,
  });
  return {
    fields,
    reachedUrl: detail.documentUrl || detail.url || `${route.baseUrl}/Details/`,
    recordReached: true,
    extractionMethod: 'Harris Acclaim owner search → exact APN → instrument detail',
    searchMethods,
    alternateRoutesAttempted,
    steps,
  };
}

function asPageObservation(value: unknown): PageObservation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PageObservation>;
  if (!Array.isArray(candidate.searchControls) || typeof candidate.fields !== 'object') return null;
  return {
    url: String(candidate.url ?? ''),
    title: String(candidate.title ?? ''),
    headings: Array.isArray(candidate.headings) ? candidate.headings : [],
    navItems: Array.isArray(candidate.navItems) ? candidate.navItems : [],
    searchControls: candidate.searchControls,
    buttons: Array.isArray(candidate.buttons) ? candidate.buttons : [],
    links: Array.isArray(candidate.links) ? candidate.links : [],
    hasMap: candidate.hasMap === true,
    hasTable: candidate.hasTable === true,
    fields: candidate.fields ?? {},
    loginLike: candidate.loginLike === true,
    methodToggle: candidate.methodToggle,
    interactive: candidate.interactive,
  };
}

async function collectCurrentPage(
  driver: BrowserDriver,
  remaining: () => number,
  fields: Record<string, string>,
): Promise<{ url: string; signal: number }> {
  const read = await driver.readFields({ timeoutMs: remaining() });
  addVisibleFields(fields, read.fields);
  addVisibleSnippets(fields, read.snippets);
  return { url: read.url, signal: parcelRecordSignal(fields) };
}

async function retrieveSubjectRecord(
  driver: BrowserDriver,
  source: CountySourceLink,
  key: BrowserSearchKey,
  remaining: () => number,
  expired: () => boolean,
  cancelled: () => boolean,
): Promise<SubjectRecordRetrieval> {
  if (source.type === 'recorder' && /\/AcclaimWeb(?:\/|$)|pickensscrod\./i.test(source.url) && driver.evaluate) {
    return retrieveAcclaimSubjectRecord(driver, source, key, remaining, expired, cancelled);
  }
  const fields: Record<string, string> = {};
  const searchMethods: string[] = [];
  const alternateRoutesAttempted: string[] = [];
  const steps: NonNullable<BrowserSourceAttempt['steps']> = [];
  const first = await driver.open(source.url, { timeoutMs: remaining() });
  addVisibleFields(fields, first.fields);
  addVisibleSnippets(fields, first.snippets);
  let reachedUrl = first.url || source.url;
  let contradictedRecord = parcelRecordSignal(fields) >= 2 && recordContradictsSubject(fields, key);
  steps.push({ stage: 'navigate', outcome: 'succeeded', detail: 'Opened the routed official destination.', url: reachedUrl });

  if (parcelRecordSignal(fields) >= 2 && !recordContradictsSubject(fields, key)) {
    steps.push({ stage: 'retrieve', outcome: 'succeeded', detail: 'The official destination was already a parcel/record detail.', url: reachedUrl });
    return {
      fields, reachedUrl, recordReached: true, extractionMethod: 'official record detail',
      searchMethods, alternateRoutesAttempted, steps,
    };
  }

  const identifierFallbacks: Array<NavSearchKey> = [];
  if (key.apn) identifierFallbacks.push({ apn: key.apn, county: key.county, state: key.state });
  if (key.owner) identifierFallbacks.push({ owner: key.owner, county: key.county, state: key.state });
  if (key.address) identifierFallbacks.push({ address: key.address, county: key.county, state: key.state });
  if (!identifierFallbacks.length) {
    steps.push({ stage: 'retrieve', outcome: 'skipped', detail: 'No APN, owner, or address was available for a subject lookup.' });
    return {
      fields, reachedUrl, recordReached: false, extractionMethod: 'official landing page',
      searchMethods, alternateRoutesAttempted, steps, failureCode: 'no_subject_identifier',
    };
  }

  // County department pages often link onward to a vendor-hosted search app.
  // Follow that public search link inside this same diagnosed attempt instead
  // of recording the department landing page as the result.
  let forms: FormInfo[] = (await driver.readForms?.({ timeoutMs: remaining() })) ?? [];
  if (!forms.length) {
    const searchLinks = await scanPageForSearchLinks(driver, reachedUrl, remaining());
    const deepLink = searchLinks.find((candidate) => candidate.type === source.type) ?? searchLinks[0];
    if (deepLink && deepLink.url !== reachedUrl) {
      alternateRoutesAttempted.push('official_search_link');
      if (source.type === 'recorder' && /\/AcclaimWeb(?:\/|$)|pickensscrod\./i.test(deepLink.url) && driver.evaluate) {
        const acclaim = await retrieveAcclaimSubjectRecord(
          driver,
          { ...source, url: deepLink.url, label: deepLink.label || source.label },
          key,
          remaining,
          expired,
          cancelled,
        );
        acclaim.alternateRoutesAttempted.unshift(...alternateRoutesAttempted);
        acclaim.steps.unshift(...steps);
        return acclaim;
      }
      const searchPage = await driver.open(deepLink.url, { timeoutMs: remaining() });
      addVisibleFields(fields, searchPage.fields);
      addVisibleSnippets(fields, searchPage.snippets);
      reachedUrl = searchPage.url || deepLink.url;
      steps.push({
        stage: 'navigate',
        outcome: 'succeeded',
        detail: 'Followed the department page to its public record-search application.',
        url: reachedUrl,
      });
      forms = (await driver.readForms?.({ timeoutMs: remaining() })) ?? [];
      contradictedRecord ||= parcelRecordSignal(fields) >= 2 && recordContradictsSubject(fields, key);
      if (parcelRecordSignal(fields) >= 2 && !recordContradictsSubject(fields, key)) {
        steps.push({ stage: 'retrieve', outcome: 'succeeded', detail: 'The linked search application opened directly on a parcel/record detail.', url: reachedUrl });
        return {
          fields, reachedUrl, recordReached: true, extractionMethod: 'official search link → record',
          searchMethods, alternateRoutesAttempted, steps,
        };
      }
    }
  }

  // Route 1: standard HTML forms.
  if (forms.length) {
    alternateRoutesAttempted.push('html_form');
    let found = false;
    for (const fallbackKey of identifierFallbacks) {
      if (found || expired() || cancelled()) break;
      const plan = planParcelSearch(forms, fallbackKey);
      if (!plan || !driver.fillAndSubmit) continue;
      const values = plan.idKind === 'apn'
        ? [plan.value, ...apnSearchVariants(plan.value).slice(1)].slice(0, 6)
        : [plan.value, ...plan.valueAlternates].slice(0, 4);
      for (const value of values) {
        if (expired() || cancelled()) break;
        searchMethods.push(`${plan.idKind}:${value}`);
        const after = await driver.fillAndSubmit(plan.fieldSelector, value, plan.submitSelector, { timeoutMs: remaining() });
        if (isRejectedParcelRecordDestination(after.url)) {
          alternateRoutesAttempted.push('commercial_result_rejected');
          steps.push({
            stage: 'retrieve',
            outcome: 'no_match',
            detail: 'The department site search redirected to a commercial property page; LandOS rejected it as non-government evidence.',
            url: source.url,
          });
          await driver.open(source.url, { timeoutMs: remaining() });
          reachedUrl = source.url;
          continue;
        }
        addVisibleFields(fields, after.fields);
        addVisibleSnippets(fields, after.snippets);
        reachedUrl = after.url || reachedUrl;
        contradictedRecord ||= parcelRecordSignal(after.fields) >= 2 && recordContradictsSubject(after.fields, key);
        if (parcelRecordSignal(after.fields) >= 2 && !recordContradictsSubject(after.fields, key)) {
          found = true;
          break;
        }

        const links = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
        const record = pickParcelRecordLink(links, fallbackKey);
        if (record) {
          alternateRoutesAttempted.push('anchor_result');
          const recordPage = await driver.open(record.href, { timeoutMs: remaining() });
          if (isRejectedParcelRecordDestination(recordPage.url || record.href)) {
            alternateRoutesAttempted.push('commercial_result_rejected');
            steps.push({
              stage: 'retrieve',
              outcome: 'no_match',
              detail: 'A result link redirected to a commercial property page; LandOS rejected it as non-government evidence.',
              url: source.url,
            });
            await driver.open(source.url, { timeoutMs: remaining() });
            reachedUrl = source.url;
            continue;
          }
          addVisibleFields(fields, recordPage.fields);
          addVisibleSnippets(fields, recordPage.snippets);
          reachedUrl = recordPage.url || record.href;
          await collectCurrentPage(driver, remaining, fields);
          contradictedRecord ||= parcelRecordSignal(fields) >= 2 && recordContradictsSubject(fields, key);
          if (parcelRecordSignal(fields) >= 2 && !recordContradictsSubject(fields, key)) {
            found = true;
            break;
          }
        }

        const candidates = (await driver.readCandidates?.({ timeoutMs: remaining() })) ?? [];
        const best = pickBestCandidate(candidates, key);
        if (best && driver.clickCandidate) {
          alternateRoutesAttempted.push('interactive_result_row');
          await driver.clickCandidate(best.index, { timeoutMs: remaining() });
          const current = await collectCurrentPage(driver, remaining, fields);
          if (isRejectedParcelRecordDestination(current.url)) {
            alternateRoutesAttempted.push('commercial_result_rejected');
            steps.push({
              stage: 'retrieve',
              outcome: 'no_match',
              detail: 'An interactive result redirected to a commercial property page; LandOS rejected it as non-government evidence.',
              url: source.url,
            });
            await driver.open(source.url, { timeoutMs: remaining() });
            reachedUrl = source.url;
            continue;
          }
          reachedUrl = current.url || reachedUrl;
          contradictedRecord ||= current.signal >= 2 && recordContradictsSubject(fields, key);
          if (current.signal >= 2 && !recordContradictsSubject(fields, key)) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) {
      steps.push({
        stage: 'retrieve', outcome: 'succeeded',
        detail: `Reached a subject record through the HTML-form route after ${searchMethods.length} submitted lookup(s).`,
        url: reachedUrl,
      });
      return {
        fields, reachedUrl, recordReached: true, extractionMethod: 'parcel search → record',
        searchMethods, alternateRoutesAttempted, steps,
      };
    }
    steps.push({
      stage: 'retrieve', outcome: 'no_match',
      detail: `The HTML-form route submitted ${searchMethods.length} lookup(s) but did not reach a matching record.`,
      url: reachedUrl,
    });
  }

  // Route 2: generic SPA/GIS controls and non-anchor result rows.
  const observed = asPageObservation(await driver.observe?.({ timeoutMs: remaining() }));
  if (observed && observed.searchControls.length && driver.typeSearch) {
    alternateRoutesAttempted.push('interactive_spa');
    for (const ranked of rankSearchMethods(key)) {
      if (expired() || cancelled()) break;
      const value = identifierValue(key, ranked.method);
      if (!value) continue;
      const strategy = planNavigationStrategy(observed, { kind: ranked.method, value });
      if (!strategy) continue;
      for (const step of strategy.steps) {
        if (expired() || cancelled()) break;
        if (step.action === 'select_method' && step.selector && step.text && driver.selectByText) {
          await driver.selectByText(step.selector, step.text, { timeoutMs: remaining() });
        } else if (step.action === 'click' && step.text && driver.clickByText) {
          await driver.clickByText(step.text, { timeoutMs: remaining() });
        } else if (step.action === 'fill' && step.selector && step.value) {
          await driver.typeSearch(step.selector, step.value, { timeoutMs: remaining() });
          searchMethods.push(`${ranked.method}:${step.value}`);
        } else if (step.action === 'submit') {
          const candidates = (await driver.readCandidates?.({ timeoutMs: remaining() })) ?? [];
          const best = pickBestCandidate(candidates, key);
          if (best && driver.clickCandidate) {
            alternateRoutesAttempted.push('interactive_result_row');
            await driver.clickCandidate(best.index, { timeoutMs: remaining() });
            const candidatePage = await collectCurrentPage(driver, remaining, fields);
            reachedUrl = candidatePage.url || reachedUrl;
            contradictedRecord ||= candidatePage.signal >= 2 && recordContradictsSubject(fields, key);
            // Some result rows open the record immediately; do not submit a
            // second, unrelated search control on the newly reached page.
            if (candidatePage.signal >= 2 && !recordContradictsSubject(fields, key)) break;
          }
          if (driver.submitSearch) await driver.submitSearch({ timeoutMs: remaining() });
        }
      }
      const current = await collectCurrentPage(driver, remaining, fields);
      reachedUrl = current.url || reachedUrl;
      const afterObservation = asPageObservation(await driver.observe?.({ timeoutMs: remaining() }));
      addVisibleFields(fields, afterObservation?.fields);
      contradictedRecord ||= parcelRecordSignal(fields) >= 2 && recordContradictsSubject(fields, key);
      if (parcelRecordSignal(fields) >= 2 && !recordContradictsSubject(fields, key)) {
        steps.push({
          stage: 'retrieve', outcome: 'succeeded',
          detail: `Reached a subject record through interactive controls using ${ranked.method}.`,
          url: reachedUrl,
        });
        return {
          fields, reachedUrl, recordReached: true, extractionMethod: `interactive ${ranked.method} search → record`,
          searchMethods, alternateRoutesAttempted, steps,
        };
      }
    }
    steps.push({
      stage: 'retrieve', outcome: 'no_match',
      detail: `Interactive controls were exercised with ${searchMethods.length} submitted lookup(s), but no matching record detail was reached.`,
      url: reachedUrl,
    });
  } else if (!forms.length) {
    steps.push({
      stage: 'retrieve', outcome: 'unavailable',
      detail: observed
        ? 'The page exposed no usable public subject-search control.'
        : 'The driver could not inspect an interactive search surface on this source.',
      url: reachedUrl,
    });
  }

  const failureCode: BrowserSourceAttempt['failureCode'] = expired() || cancelled()
    ? 'timeout_or_cancelled'
    : contradictedRecord
      ? 'no_subject_match'
    : forms.length || (observed?.searchControls.length ?? 0) > 0
      ? 'record_not_reached'
      : 'no_search_control';
  return {
    fields, reachedUrl, recordReached: false, extractionMethod: 'official landing page',
    searchMethods, alternateRoutesAttempted, steps, failureCode,
  };
}

/**
 * County Records workflow — REAL NETR-routed semantic retrieval (no county-
 * specific scrapers). Runs only after LandPortal. Steps:
 *   1. Reuse the County Source Map cache when fresh (routing is reused per county).
 *   2. Else route via NETR Online: open the state page → find the county link →
 *      read the county page links → classify official sources semantically.
 *   3. If NETR is stale/missing core sources → intelligent web search for the
 *      official county site (prefer .gov / county-owned), labeled search_fallback.
 *   4. Persist the routing to the County Source Map.
 *   5. Visit the official sources → reach a subject record through HTML forms,
 *      SPA controls, anchor results, or interactive rows → semantic-extract
 *      public-record facts with full provenance (never guessing). Source links
 *      remain evidence metadata and are never emitted as facts.
 * Parked driver returns honest `parked` evidence with the planned routing.
 */
async function runCountyWorkflow(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
  hooks: Partial<BrowserRunHooks> = {},
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('county_records', 'workflow');
  const key = input.searchKey;
  const mode = input.mode ?? 'parcel_fact';
  // timeoutMs is a workflow budget, not a fresh allowance for every page,
  // form, and fallback. Reissuing the full timeout at each step made a
  // 45-second call-prep lane run for many minutes on counties with several
  // official sources. Every browser operation now receives only the remaining
  // budget and the workflow stops cleanly when that shared deadline expires.
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  const expired = () => Date.now() >= deadline;
  const remaining = () => Math.max(250, deadline - Date.now());
  const cancelled = () => (hooks.isCancelled ? hooks.isCancelled() : false);
  const state = (key.state ?? '').trim();
  const county = (key.county ?? '').replace(/\s+county$/i, '').trim();
  const targets = workflowsForNeeded(input.neededFields);
  const plan = planNetrWorkflow({ county, state }, { configured: driver.configured() });

  if (!driver.configured()) {
    ev.status = 'parked';
    ev.sourceUrls.push(plan.directoryUrl);
    ev.note = `County Records parked (no live session). Plan: route ${county || '<county>'}, ${state || '<state>'} via NETR → official sources (${targets.join(', ')}); search fallback if NETR is stale. Runs only after LandPortal; no credential/login for public records.`;
    return ev;
  }
  if (!state || !county) {
    ev.status = 'no_match';
    ev.note = 'Need state + county to route county records (provide a verified locality first).';
    return ev;
  }

  let sources: CountySourceLink[] = [];
  let netrUrl: string | null = null;
  let usedSearchFallback = false;
  const cached = getCountySources(state, county);
  if (isCountyCacheFresh(cached) && cached) {
    sources = cached.sources; netrUrl = cached.netrUrl; usedSearchFallback = cached.usedSearchFallback;
    ev.sourceUrls.push('cache:county-source-map');
  } else {
    try {
      const stateUrl = buildNetrStateUrl(state);
      await driver.open(stateUrl, { timeoutMs: remaining() });
      const stateLinks = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
      const countyRx = new RegExp(`\\b${county.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const countyLink = stateLinks.find((l) => countyRx.test(l.text) && /netronline/i.test(l.href));
      netrUrl = countyLink?.href ?? stateUrl;
      const countyPage = await driver.open(netrUrl, { timeoutMs: remaining() });
      ev.sourceUrls.push(countyPage.url || netrUrl);
      const countyLinks = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
      sources = extractCountySources(countyLinks, { origin: 'netr', county, state });
    } catch { sources = []; }

    if (netrIsStale(sources)) {
      usedSearchFallback = true;
      const fallbackTypes: CountySourceType[] = ['assessor', 'appraiser', 'tax', 'recorder', 'gis'];
      if (mode === 'deep_record' || targets.includes('planning_zoning')) {
        fallbackTypes.push('planning');
      }
      for (const type of fallbackTypes) {
        if (expired()) break;
        if (sources.some((s) => s.type === type)) continue;
        try {
          await driver.open(searchEngineUrl(officialSearchQuery(type, county, state)), { timeoutMs: remaining() });
          const raw = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
          const picked = pickOfficialResult(unwrapSearchResults(raw), type, county, state);
          if (picked) sources.push(picked);
        } catch { /* keep going */ }
      }
    }

    const status: 'routed' | 'partial' | 'not_found' = sources.length === 0 ? 'not_found' : netrIsStale(sources) ? 'partial' : 'routed';
    const confidence: 'high' | 'medium' | 'low' = status === 'routed' ? 'high' : status === 'partial' ? 'medium' : 'low';
    try {
      saveCountySources({ state, county, netrUrl, sources, usedSearchFallback, status, confidence, notes: usedSearchFallback ? 'NETR thin/stale — used official search fallback for missing sources.' : 'Routed via NETR Online.' });
    } catch { /* cache best-effort */ }

  }

  // Revalidate cached routes before reuse. A same-name county from another
  // state or a directory aggregator must not survive simply because an older
  // routing record was marked fresh.
  sources = sources.filter((source) =>
    officialDomainScore(source.url, county, state) > 0
    && !sourceContradictsRequestedState({ text: source.label, href: source.url }, county, state));

  // A fresh routing cache is useful, but it is not proof that every required
  // department was attempted. In deep-record mode always resolve planning
  // independently when the cached county map does not contain it.
  // This keeps zoning/subdivision research from disappearing merely because
  // assessor/GIS/recorder/tax were already cached.
  // TAX IS REQUIRED, NOT OPTIONAL. The assessor levies the tax; the collecting
  // office (trustee / treasurer / tax collector / revenue commissioner) is the
  // only one that publishes whether it was PAID. Leaving `tax` out of this list
  // meant a county whose cached map happened to lack a tax source never had one
  // resolved, so payment status came back unanswered on every lead in that
  // county — while recorder and planning were re-resolved without fail.
  const requiredDepartmentTypes: CountySourceType[] = mode === 'deep_record'
    ? ['recorder', 'planning', 'tax']
    : targets.includes('planning_zoning') ? ['planning'] : [];
  let enrichedCachedSources = false;
  for (const type of requiredDepartmentTypes) {
    if (expired() || sources.some((source) => source.type === type)) continue;
    try {
      usedSearchFallback = true;
      await driver.open(searchEngineUrl(officialSearchQuery(type, county, state)), { timeoutMs: remaining() });
      const raw = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
      const picked = pickOfficialResult(unwrapSearchResults(raw), type, county, state);
      if (picked) {
        sources.push(picked);
        enrichedCachedSources = true;
      }
    } catch { /* retain the exact sources that did resolve */ }
  }
  if (enrichedCachedSources) {
    const status: 'routed' | 'partial' = netrIsStale(sources) ? 'partial' : 'routed';
    try {
      saveCountySources({
        state,
        county,
        netrUrl,
        sources,
        usedSearchFallback,
        status,
        confidence: status === 'routed' ? 'high' : 'medium',
        notes: 'Reused the county source map and resolved the missing planning department with official search fallback.',
      });
    } catch { /* cache best-effort */ }
  }

  ev.sourcesUsed = sources.map((s) => ({ type: s.type, url: s.url, origin: s.origin === 'netr' ? 'netr_county' as const : 'search_fallback' as const, confidence: s.confidence }));
  const countyCapability = new CountyResearchCapability();
  const runReference = `county-records/${state.toLowerCase()}/${county.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${now()}`;
  let guidanceKind: 'county_verified' | 'platform_template' | 'none' = 'none';
  try {
    countyCapability.observeLocalSources({ state, county, sources, observedAt: now(), runReference });
    guidanceKind = countyCapability.guidance(state, county).kind;
  } catch { /* capability memory must never prevent public-record retrieval */ }

  const facts: BrowserFact[] = [];
  const sourceAttempts: BrowserSourceAttempt[] = [];
  const emit = (f: BrowserFact) => { facts.push(f); try { hooks.onFact?.(f); } catch { /* non-fatal */ } };
  const factPriority: CountySourceType[] = ['assessor', 'appraiser', 'tax', 'gis', 'recorder', 'planning', 'building'];
  const deepPriority: CountySourceType[] = ['recorder', 'planning', 'building', 'assessor', 'appraiser', 'tax', 'gis'];
  const locality = { county, city: key.city, state };
  const ordered = orderCountySourcesLocalFirst(sources, locality).sort((a, b) => {
    const localDiff = governmentSourceScopePriority(a, locality) - governmentSourceScopePriority(b, locality);
    if (localDiff !== 0) return localDiff;
    return (mode === 'deep_record' ? deepPriority : factPriority).indexOf(a.type) - (mode === 'deep_record' ? deepPriority : factPriority).indexOf(b.type);
  });
  let screenshotTaken = false;
  let stopped = false;
  let recipeRecorded = false;
  for (const src of ordered) {
    if (cancelled() || expired()) { stopped = true; break; }
    const sourceName = `${county} County ${labelFor(src.type)}`;
    const attemptedAt = now();
    try {
      const retrieval = await retrieveSubjectRecord(driver, src, key, remaining, expired, cancelled);
      ev.sourceUrls.push(src.url);
      if (retrieval.reachedUrl && retrieval.reachedUrl !== src.url) ev.sourceUrls.push(retrieval.reachedUrl);
      if (expired() || cancelled()) stopped = true;
      const ctx: ExtractContext = {
        sourceName,
        sourceType: src.type,
        sourceUrl: retrieval.reachedUrl || src.url,
        origin: src.origin === 'netr' ? 'netr_county' : 'search_fallback',
      };
      const ext = extractGovernmentFacts(retrieval.fields, ctx, {
        pageIsRecord: retrieval.recordReached,
        sourceType: src.type,
        extractionMethod: retrieval.extractionMethod,
      });
      retrieval.steps.push({
        stage: 'extract',
        outcome: ext.length ? 'succeeded' : 'no_match',
        detail: ext.length
          ? `Extracted ${ext.length} labeled subject/jurisdiction fact(s).`
          : retrieval.recordReached
            ? 'A record detail was reached, but it contained no supported labeled fields.'
            : 'No subject record was reached, so parcel fields were not extracted.',
        url: retrieval.reachedUrl,
      });
      if (ext.length > 0) {
        for (const f of ext) emit(f);
        if (!recipeRecorded && retrieval.recordReached && retrieval.searchMethods.length > 0) {
          try {
            const searchMethods = retrieval.searchMethods
              .map((method) => method.split(':', 1)[0])
              .filter((method): method is 'apn' | 'address' | 'owner' =>
                method === 'apn' || method === 'address' || method === 'owner');
            countyCapability.recordSuccessfulLookup({
              state, county, source: src, searchMethods,
              validatedFacts: [...new Set(ext.map((fact) => fact.key))], observedAt: now(), runReference,
            });
            recipeRecorded = true;
          } catch { /* real facts remain usable even if reusable memory cannot update */ }
        }
        if (!screenshotTaken && !expired()) { try { ev.screenshots.push(await driver.screenshot(`county_${src.type}_record`, { timeoutMs: remaining() })); } catch { /* optional */ } screenshotTaken = true; }
      } else {
        for (const a of extractAgencyContact(retrieval.fields, ctx)) emit({ ...a, extractionMethod: 'agency contact page (not a parcel record)' });
      }
      const substantiveFacts = ext.filter((fact) => fact.status === 'extracted');
      const failureCode = substantiveFacts.length
        ? undefined
        : retrieval.failureCode ?? (retrieval.recordReached ? 'no_extractable_subject_fields' : 'record_not_reached');
      retrieval.steps.push({
        stage: 'interpret',
        outcome: substantiveFacts.length ? 'succeeded' : 'no_match',
        detail: substantiveFacts.length
          ? 'Supported labeled values were classified as government facts with exact provenance.'
          : `The source remains an attempted destination only; it is not a completed government finding (${failureCode}).`,
        url: retrieval.reachedUrl,
      });
      sourceAttempts.push({
        sourceName,
        sourceType: src.type,
        sourceUrl: src.url,
        attemptedAt,
        result: substantiveFacts.length > 0
          ? 'retrieved'
          : retrieval.recordReached
            ? 'not_found'
            : 'attempted_inconclusive',
        factCount: substantiveFacts.length,
        note: substantiveFacts.length > 0
          ? `${substantiveFacts.length} subject/jurisdiction fact(s) extracted from ${retrieval.reachedUrl}. Lookup submissions: ${retrieval.searchMethods.join(', ') || 'direct official page'}. Routes exercised: ${retrieval.alternateRoutesAttempted.join(', ') || 'direct official page'}.`
          : `The official destination was reached at ${retrieval.reachedUrl}, but no supported subject fact was extracted (${failureCode}). Lookup submissions: ${retrieval.searchMethods.join(', ') || 'none possible'}. Alternate routes attempted: ${retrieval.alternateRoutesAttempted.join(', ') || 'none available'}.`,
        reachedUrl: retrieval.reachedUrl,
        searchMethods: retrieval.searchMethods,
        alternateRoutesAttempted: retrieval.alternateRoutesAttempted,
        extractedFactKeys: [...new Set(substantiveFacts.map((fact) => fact.key))],
        failureCode,
        steps: retrieval.steps,
      });
      const completedWorkflow: CountyWorkflow = ({
        assessor: 'assessor',
        appraiser: 'assessor',
        tax: 'tax_office',
        gis: 'gis',
        recorder: 'recorder',
        planning: 'planning_zoning',
        building: 'planning_zoning',
      } as Record<CountySourceType, CountyWorkflow>)[src.type];
      if (
        substantiveFacts.length > 0
        && input.neededFields?.length
        && targets.length === 1
        && targets[0] === completedWorkflow
      ) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timeout = /timeout|timed out|deadline/i.test(message);
      sourceAttempts.push({
        sourceName,
        sourceType: src.type,
        sourceUrl: src.url,
        attemptedAt,
        result: timeout ? 'source_unavailable' : 'execution_failure',
        factCount: 0,
        note: `The official source could not be completed: ${message}`,
        extractedFactKeys: [],
        failureCode: timeout ? 'source_unavailable' : 'execution_failure',
        steps: [
          { stage: 'navigate', outcome: 'failed', detail: `Opening or interacting with the official source failed: ${message}`, url: src.url },
          { stage: 'retrieve', outcome: 'skipped', detail: 'No subject record could be retrieved after the navigation failure.' },
          { stage: 'extract', outcome: 'skipped', detail: 'Extraction was not run without a retrieved page.' },
          { stage: 'interpret', outcome: 'skipped', detail: 'No finding was asserted.' },
        ],
      });
      /* try the next source; never stop on one */
    }
  }

  let statewideFacts: BrowserFact[] | null = null;
  if (!expired() && facts.filter((fact) => fact.status === 'extracted').length === 0) {
    const portal = statewidePortalFor(state);
    if (portal && driver.evaluate) {
      const attemptedAt = now();
      const portalCtx: ExtractContext = {
        sourceName: `${state} Statewide Assessment Portal`,
        sourceType: 'assessor',
        sourceUrl: portal.url,
        origin: 'search_fallback',
      };
      statewideFacts = await tryStatewidePortalFallback(
        driver, portal, key, portalCtx, remaining(), now, countyCapability, runReference,
      );
      ev.sourceUrls.push(portal.url);
      if (!ev.sourcesUsed.some((source) => source.url === portal.url)) {
        ev.sourcesUsed.push({ type: 'assessor', url: portal.url, origin: 'search_fallback', confidence: 0.7 });
      }
      sourceAttempts.push({
        sourceName: portalCtx.sourceName,
        sourceType: portalCtx.sourceType,
        sourceUrl: portal.url,
        attemptedAt,
        result: statewideFacts?.length ? 'retrieved' : 'attempted_inconclusive',
        factCount: statewideFacts?.length ?? 0,
        note: statewideFacts?.length
          ? `${statewideFacts.length} subject-property fact(s) extracted through the statewide assessment fallback.`
          : 'The statewide assessment fallback ran but did not return a supported subject-property fact.',
        reachedUrl: portal.url,
        searchMethods: [key.apn ? `apn:${key.apn}` : key.owner ? `owner:${key.owner}` : key.address ? `address:${key.address}` : 'no_subject_identifier'],
        alternateRoutesAttempted: ['statewide_assessment_portal'],
        extractedFactKeys: statewideFacts ? [...new Set(statewideFacts.map((fact) => fact.key))] : [],
        failureCode: statewideFacts?.length ? undefined : 'record_not_reached',
        steps: [
          { stage: 'navigate', outcome: 'succeeded', detail: 'Opened the configured statewide public assessment portal.', url: portal.url },
          {
            stage: 'retrieve', outcome: statewideFacts?.length ? 'succeeded' : 'no_match',
            detail: statewideFacts?.length ? 'Reached a parcel record through the statewide fallback.' : 'The statewide fallback did not reach a supported subject record.',
            url: portal.url,
          },
          {
            stage: 'extract', outcome: statewideFacts?.length ? 'succeeded' : 'no_match',
            detail: statewideFacts?.length ? `Extracted ${statewideFacts.length} labeled fact(s).` : 'No supported labeled subject fields were extracted.',
            url: portal.url,
          },
          {
            stage: 'interpret', outcome: statewideFacts?.length ? 'succeeded' : 'no_match',
            detail: statewideFacts?.length ? 'Classified the returned fields with official-source provenance.' : 'No completed finding was asserted from the fallback.',
            url: portal.url,
          },
        ],
      });
    }
  }
  if (statewideFacts) {
    for (const f of statewideFacts) emit(f);
    ev.sourceUrls.push(`statewide:${state}`);
  }

  finalizeTaxAndImprovementFacts(facts, key.owner);
  ev.facts = facts;
  ev.sourceAttempts = sourceAttempts;
  ev.patch = factsToPatch(facts);
  const extractedCount = facts.filter((f) => f.status === 'extracted').length;
  ev.status = extractedCount > 0 ? 'retrieved' : sources.length > 0 ? 'partial' : 'no_match';
  const stoppedNote = stopped ? 'Stopped by operator — facts already found are saved. ' : '';
  ev.note = sources.length === 0
    ? `${stoppedNote}No official county source could be routed for ${county}, ${state} (NETR + search). Records marked Needs Verification.`
    : `${stoppedNote}County Records (${mode}) via ${usedSearchFallback ? 'NETR + official search fallback' : 'NETR Online'}: ${sources.length} official source(s) (${ev.sourcesUsed.map((s) => s.type).join(', ')}); ${extractedCount} public-record fact(s) with provenance. ${guidanceKind === 'county_verified' ? 'Reused a verified county navigation recipe.' : guidanceKind === 'platform_template' ? 'Started from value-free guidance learned from this portal family; county facts were still independently verified.' : 'No prior county/platform recipe was assumed.'} LandPortal-first; no duplicate retrieval.`;
  return ev;
}

function labelFor(t: CountySourceType): string {
  return ({ assessor: 'Assessor', appraiser: 'Property Appraiser', tax: 'Tax Office', gis: 'GIS', recorder: 'Recorder / Register of Deeds', planning: 'Planning & Zoning', building: 'Building Dept' } as Record<CountySourceType, string>)[t];
}

// ── Deep-link following + statewide fallback ──────────────────────────────────

async function scanPageForSearchLinks(
  driver: BrowserDriver,
  baseUrl: string,
  timeoutMs: number,
): Promise<CountySourceLink[]> {
  const links = (await driver.readLinks?.({ timeoutMs })) ?? [];
  const searchRx = /property\s+search|parcel\s+search|parcel\s+viewer|gis\s+map|assessment|tax\s+search|record\s+search|deed\s+search/i;
  const vendorRx = /tylertech|tylerhost|governmax|qpublic|schneidercorp|schneidergis|beacon|arcgis\.com/i;
  const out: CountySourceLink[] = [];
  for (const l of links) {
    const hay = `${l.text} ${l.href}`.toLowerCase();
    if (!/^https?:/i.test(l.href)) continue;
    if (/netronline|zillow|realtor|redfin|trulia|spokeo|whitepages|propertyshark|landglide|regrid|loopnet|facebook|google\.com\/search/i.test(l.href)) continue;
    const isSearch = searchRx.test(hay) || vendorRx.test(hay);
    if (!isSearch) continue;
    let type: CountySourceType = 'gis';
    if (/assessor|appraisal|assessment/i.test(hay)) type = 'assessor';
    else if (/tax\s+search|tax\s+collector|treasurer|property\s+tax/i.test(hay)) type = 'tax';
    else if (/recorder|register\s+of\s+deeds|deed/i.test(hay)) type = 'recorder';
    else if (/planning|zoning/i.test(hay)) type = 'planning';
    out.push({ type, url: l.href, label: l.text.slice(0, 80).trim(), origin: 'search_fallback', confidence: 0.6 });
  }
  return out;
}

async function tryStatewidePortalFallback(
  driver: BrowserDriver,
  portal: StatewidePortal,
  key: BrowserSearchKey,
  ctx: ExtractContext,
  timeoutMs: number,
  now: () => string,
  countyCapability: CountyResearchCapability,
  runReference: string,
): Promise<BrowserFact[] | null> {
  const facts: BrowserFact[] = [];
  try {
    if (!driver.evaluate) return null;
    let page = await driver.open(portal.url, { timeoutMs });
    await new Promise((r) => setTimeout(r, 3000));
    let merged: Record<string, string> = { ...page.fields };

    const evaluate = <T>(fn: (() => T) | string, ...args: unknown[]): Promise<T | undefined> => driver.evaluate!(fn as unknown as () => T, ...args);

    if (portal.platform === 'aspnet') {
      const GET_COUNTY_CODE = (() => {
        const fn = (countyName: string): string | null => {
          const sel = document.querySelector('#countySelect, select[name="Jur"]');
          if (!sel) return null;
          for (const opt of (sel as any).options) {
            if ((opt.textContent || '').toLowerCase().includes(countyName.toLowerCase())) return opt.value;
          }
          return null;
        };
        return fn as unknown as () => string;
      })();
      const countyCode = await evaluate(GET_COUNTY_CODE, key.county ?? '');

      const FILL_FORM = (() => {
        const fn = (params: Record<string, string | undefined>): string => {
          const out: string[] = [];
          if (params.countyCode) {
            const sel = document.querySelector('#countySelect, select[name="Jur"]') as any;
            if (sel) { sel.value = params.countyCode; sel.dispatchEvent(new Event('change', { bubbles: true })); out.push('county=' + params.countyCode); }
          }
          const parts = (params.apn || '').replace(/[^0-9A-Za-z]/g, ' ').trim().split(/\s+/);
          const cm = parts[0] || '';
          const pn = parts[parts.length - 1] || '';
          const cmInput = document.querySelector('#controlMapSelect, input[name="ControlMap"]') as any;
          if (cmInput) { cmInput.value = cm; cmInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('cm=' + cm); }
          const pnInput = document.querySelector('#parcelSelect, input[name="ParcelNumber"]') as any;
          if (pnInput) { pnInput.value = pn; pnInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('pn=' + pn); }
          const qInput = document.querySelector('#Query, input[name="Query"]') as any;
          if (qInput) { qInput.value = params.apn; qInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('query=' + params.apn); }
          const oInput = document.querySelector('#ownerSelect, input[name="Owner"]') as any;
          if (oInput && params.owner) { oInput.value = params.owner; oInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('owner=' + params.owner); }
          const aInput = document.querySelector('#propertyAddressSelect, input[name="PropertyAddress"]') as any;
          if (aInput && params.address) { aInput.value = params.address; aInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('addr=' + params.address); }
          return out.join(',');
        };
        return fn as unknown as () => string;
      })();
      await evaluate(FILL_FORM, { countyCode: countyCode ?? undefined, apn: key.apn ?? '', owner: key.owner, address: key.address });

      const CLICK_SEARCH = (() => {
        const fn = (): string => {
          const btns = Array.from(document.querySelectorAll('button.searchButton, input.searchButton, button[type="submit"], input[type="submit"]'));
          const searchBtn = btns.find((b: any) => ((b.textContent || b.getAttribute?.('value') || '')).trim() === 'Search') as any;
          if (searchBtn) { searchBtn.click(); return 'clicked_search'; }
          const form = document.querySelector('#advancedSearchForm, #basicSearchForm, form');
          if (form) { form.submit(); return 'submitted_form'; }
          return 'not_found';
        };
        return fn as unknown as () => string;
      })();
      const clicked = await evaluate(CLICK_SEARCH);

      if (clicked === 'clicked_search' || clicked === 'submitted_form') {
        await new Promise((r) => setTimeout(r, 5000));
        const afterPage = await driver.readFields?.({ timeoutMs });
        if (afterPage) merged = { ...merged, ...afterPage.fields };
      }
    }

    const GET_BODY = (() => {
      const fn = (): string => { return (document.body?.innerText || '').slice(0, 2000); };
      return fn as unknown as () => string;
    })();
    const bodySnippet = (await evaluate(GET_BODY)) ?? '';
    const resultsRx = /showing\s+\d+\s+to\s+\d+\s+of\s+\d+\s+entries|results\s+for/i;
    if (bodySnippet && resultsRx.test(bodySnippet.toLowerCase())) {
      const GET_PARCEL_LINKS = (() => {
        const fn = (): Array<{ text: string; href: string }> => {
          const out: Array<{ text: string; href: string }> = [];
          document.querySelectorAll('a').forEach((a: any) => {
            const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
            const href = a.getAttribute('href') || '';
            if (/view|parcel|detail|property/i.test(text) && href && !/^(https?:)?\/\/tnmap/.test(href)) {
              out.push({ text, href });
            }
          });
          return out;
        };
        return fn as unknown as () => Array<{ text: string; href: string }>;
      })();
      const parcelLinks = await evaluate(GET_PARCEL_LINKS);

      if (parcelLinks && parcelLinks.length > 0) {
        let detailPage = await driver.open(parcelLinks[0].href, { timeoutMs });
        await new Promise((r) => setTimeout(r, 4000));
        const detailFields = await driver.readFields?.({ timeoutMs }) ?? detailPage;
        merged = { ...merged, ...detailFields.fields };

        const pageIsRecord = parcelRecordSignal(merged) >= 2;
        if (pageIsRecord) {
          const ext = extractGovernmentFacts(merged, ctx, {
            pageIsRecord: true,
            sourceType: 'assessor',
            extractionMethod: 'statewide assessment search → record',
          });
          facts.push(...ext);
          try {
            countyCapability.recordSuccessfulLookup({
              state: ctx.sourceUrl.includes('tn.gov') ? 'TN' : '',
              county: key.county ?? '',
              source: { type: 'assessor', url: portal.url, label: `${key.county} County Assessor (statewide)`, origin: 'search_fallback', confidence: 0.7 },
              searchMethods: key.apn ? ['apn'] : key.owner ? ['owner'] : ['address'],
              validatedFacts: [...new Set(ext.map((f) => f.key))],
              observedAt: now(),
              runReference,
            });
          } catch { /* best-effort */ }
        }
      }
    }
  } catch { /* statewide portal is best-effort */ }
  return facts.length > 0 ? facts : null;
}

function factsToPatch(facts: BrowserFact[]): PropertyPatch {
  const patch: PropertyPatch = {};
  const fact = (key: string) => facts.find((f) => f.key === key && f.status === 'extracted');
  const owner = fact('owner'); if (owner) patch.owner = owner.value;
  const apn = fact('apn'); if (apn) patch.apn = apn.value;
  const situs = fact('situsAddress'); if (situs) patch.address = situs.value;
  const acreage = fact('acreage'); if (acreage) { const n = Number(acreage.value.replace(/[^0-9.]/g, '')); if (Number.isFinite(n) && n > 0) patch.acres = n; }
  return patch;
}

export function makeCountyRecordsBrowser(deps: CountyRecordsBrowserDeps = {}): BrowserService {
  const driver = deps.driver ?? makeParkedDriver('county_records');
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    id: 'county_records',
    label: 'County Records Browser (public-record research)',
    modes: ['workflow', 'ask'],
    configured() { return driver.configured(); },
    // BROWSER LIFECYCLE: every county/GIS/assessor research page this job
    // causes to exist is closed in a finally-style owned-page scope — after
    // success, failure, timeout, or cancellation — once its facts are
    // persisted. Operator pages are preserved.
    runWorkflow(input, opts) {
      return withOwnedPages(driver, () => runCountyWorkflow(input, driver, now, opts.timeoutMs, opts));
    },
    async ask(question, ctx, opts) {
      const route = routeBrowserQuestion(question, ctx);
      const wf = COUNTY_WORKFLOW_FOR[route.intent as DdField] ?? 'assessor';
      return withOwnedPages(driver, async () => {
        const ev = await runCountyWorkflow({ searchKey: route.searchKey, neededFields: [route.intent] }, driver, now, opts.timeoutMs);
        ev.mode = 'ask';
        if (ev.status !== 'parked' && ev.status !== 'error') ev.note = `Asked: "${route.intent}" → ${wf}. ${ev.note}`;
        return ev;
      });
    },
  };
}

export function countyStopExample(condition: (typeof COUNTY_STOP_CONDITIONS)[number]): BrowserEvidence {
  const ev = emptyEvidence('county_records', 'workflow');
  if (condition === 'payment') recordBlocked(ev, 'purchase', 'A paid record purchase was required — stopped (no payment).');
  else if (condition === 'credentialed_login') recordBlocked(ev, 'store_credentials', 'A credentialed login was required — stopped (no credential stored).');
  else if (condition === 'destructive_action') recordBlocked(ev, 'any_write', 'A write/destructive action was required — stopped.');
  else recordBlocked(ev, 'navigate', 'An unsolvable CAPTCHA blocked navigation — stopped.');
  ev.status = 'blocked';
  ev.note = `County research stopped only for: ${condition}. It otherwise browses public records freely.`;
  return ev;
}
