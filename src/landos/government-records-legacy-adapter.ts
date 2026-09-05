import fs from 'node:fs';
import path from 'node:path';

import { documentRegistryForCard } from './deal-card-canonical.js';
import { getDealCard } from './deal-card.js';
import {
  type GovernmentRecordArtifactInput,
  type GovernmentRecordClaimInput,
  type GovernmentRecordCollectorInput,
  getGovernmentRecordReadModel,
  synchronizeGovernmentRecordSlice,
} from './government-records-operator.js';
import type {
  GovernmentRecordDomain,
  GovernmentRecordLocatorStatus,
  GovernmentRecordReadModel,
} from './government-records-types.js';
import { listPublicRecordOutcomes } from './lead-card-intake.js';
import { PropertyResearchStore } from './property-research-store.js';
import { recordedInstrumentAccessFindings, recordedInstrumentAccessResult } from './recorded-instrument-access.js';
import { synchronizePropertySummaryForDeal } from './property-summary-legacy-adapter.js';
import { readCurrentPropertyIdentity } from './property-summary-slice.js';
import { landosArtifactPath } from './storage-profile.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const LEGACY_ADAPTER_VERSION = 'legacy-evidence-adapter-v2';

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function retainedArtifactPath(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const absolute = path.resolve(candidate);
  const artifactRoot = path.resolve(landosArtifactPath());
  const relative = path.relative(artifactRoot, absolute);
  const insideArtifactRoot = relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  return insideArtifactRoot && fs.existsSync(absolute) && fs.statSync(absolute).isFile()
    ? absolute
    : null;
}

function locatorStatus(record: Record<string, unknown>): GovernmentRecordLocatorStatus {
  if (record.retrieval_status === 'no_matching_record') return 'no_matching_record_found';
  if (record.retrieval_status === 'retrieved_yes') return 'record_located';
  const summary = text(record.summary);
  if (/pay|purchase|credit|fee/i.test(summary)) return 'official_source_paywalled';
  if (/login|log in|sign in|authenticat|registration|account required/i.test(summary)) return 'official_source_authenticated';
  if (/captcha|blocked|access denied|forbidden/i.test(summary)) return 'official_source_blocked';
  if (/unavailable|offline|changed|timed out|could not connect/i.test(summary)) return 'official_source_unavailable';
  return 'record_referenced_document_unavailable';
}

function domainsForCategory(category: string): GovernmentRecordDomain[] {
  if (/deed|title|easement/i.test(category)) return ['deed_ownership', 'recorded_encumbrances', 'surveys_plats'];
  if (/lien|judgment|tax/i.test(category)) return ['property_tax', 'lien_judgment'];
  if (/survey|plat|boundary/i.test(category)) return ['surveys_plats'];
  if (/encumbr|restriction|covenant|right.of.way/i.test(category)) return ['recorded_encumbrances'];
  if (/ownership|assessor/i.test(category)) return ['deed_ownership'];
  return [];
}

function inferClaimDomain(key: string, fallback: GovernmentRecordDomain): GovernmentRecordDomain {
  if (/tax|delinquen|penalt|sale|redemption|assessment|account/i.test(key)) return 'property_tax';
  if (/lien|judgment|lis pendens|mechanic|code enforcement|hoa/i.test(key)) return 'lien_judgment';
  if (/survey|plat|boundary|lot split|adjustment/i.test(key)) return 'surveys_plats';
  if (/easement|restriction|covenant|reservation|right.of.way|road maintenance|mineral|encumbrance/i.test(key)) return 'recorded_encumbrances';
  if (/owner|vesting|grantor|grantee|deed|legal description/i.test(key)) return 'deed_ownership';
  return fallback;
}

function legacyFindingValue(label: string, detail: string): unknown {
  if (/grantor.*grantee/i.test(label)) {
    const conveyance = detail.split(';')[0] ?? detail;
    const [grantor, ...granteeParts] = conveyance.split(/\s+to\s+/i);
    const grantee = granteeParts.join(' to ').trim();
    if (grantor?.trim() && grantee) {
      return {
        parties: [grantee],
        grantors: [grantor.trim()],
        grantees: [grantee],
        conveyance,
      };
    }
  }
  return detail;
}

function referencedBookPage(label: string, detail: string): string | null {
  if (!/prior deed|referenced deed|deed reference/i.test(label)) return null;
  const match = detail.match(/(?:Deed\s+)?Book\s+([^,;.]+),?\s+Page\s+([A-Za-z0-9-]+)/i);
  return match ? `Book ${match[1].trim()}, Page ${match[2].trim()}` : null;
}

function claimsFromPublicOutcome(
  record: Record<string, unknown>,
  artifactKey: string | null = null,
): GovernmentRecordClaimInput[] {
  const domains = domainsForCategory(text(record.category));
  if (!domains.length) return [];
  const status = locatorStatus(record);
  const facts = (record.facts && typeof record.facts === 'object' ? record.facts : {}) as Record<string, unknown>;
  const sourceName = text(record.authority) || 'Official public-record source';
  const sourceUrl = text(record.document_url) || text(record.source_url) || null;
  const jurisdiction = text(record.jurisdiction);
  const retrievedAt = text(record.searched_at) || new Date(Number(record.updated_at ?? 0) * 1000).toISOString();
  const entries = Object.entries(facts);
  if (!entries.length) {
    return domains.map((domain) => ({
      claimKey: `${domain}_search_outcome`,
      exactWording: text(record.summary),
      normalizedValue: null,
      domain,
      association: 'not_applicable',
      locatorStatus: status,
      sourceName,
      sourceUrl,
      sourceJurisdiction: jurisdiction,
      sourceTier: 'official_county_state',
      confidence: status === 'record_located' || status === 'no_matching_record_found' ? 'medium' : 'unknown',
      retrievedAt,
      documentType: text(record.title) || null,
      artifactKey,
    }));
  }
  return entries.map(([key, value]) => {
    const fallback = domains[0];
    const domain = inferClaimDomain(key, fallback);
    const ownerNameOnly = domain === 'lien_judgment' && /owner|judgment/i.test(key) && !/parcel|property|apn/i.test(key);
    return {
      claimKey: key,
      exactWording: `${key.replace(/_/g, ' ')}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
      normalizedValue: value,
      domain,
      association: ownerNameOnly ? 'owner_name_possible_match' : 'subject_property_direct',
      locatorStatus: ownerNameOnly && status === 'record_located' ? 'possible_owner_name_match' : status,
      sourceName,
      sourceUrl,
      sourceJurisdiction: jurisdiction,
      sourceTier: 'official_county_state',
      confidence: status === 'record_located' || status === 'no_matching_record_found' ? 'medium' : 'unknown',
      retrievedAt,
      documentType: text(record.title) || null,
      instrumentNumber: text(facts.instrumentNumber) || null,
      bookPage: text(facts.recordBookPage) || text(facts.deedRef) || null,
      parcelReference: text(facts.apn) || null,
      recordingFilingDate: text(facts.recordingDate) || null,
      artifactKey,
      artifactPage: artifactKey ? 1 : null,
    } satisfies GovernmentRecordClaimInput;
  });
}

function mimeTypeForArtifact(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

/**
 * Convert the persisted official-browser outcome into normalized claims and,
 * when a local capture was actually retained, an immutable government artifact.
 *
 * The official document's page count is metadata about the source instrument;
 * `captureCount` remains the number of local files retained. For example, an
 * Acclaim three-page deed with one retained viewer capture is honestly stored
 * as pageCount=3 and captureCount=1.
 */
export function artifactsAndClaimsFromPublicOutcomes(
  records: Array<Record<string, unknown>>,
): { artifacts: GovernmentRecordArtifactInput[]; claims: GovernmentRecordClaimInput[] } {
  const artifacts: GovernmentRecordArtifactInput[] = [];
  const claims: GovernmentRecordClaimInput[] = [];
  for (const record of records) {
    const domains = domainsForCategory(text(record.category));
    const artifactPath = record.retrieval_status === 'retrieved_yes'
      ? retainedArtifactPath(record.screenshot_url)
      : null;
    const facts = (record.facts && typeof record.facts === 'object'
      ? record.facts
      : {}) as Record<string, unknown>;
    const artifactKey = artifactPath && domains.length
      ? `public-record-outcome:${String(record.id ?? `${text(record.category)}:${text(record.authority)}`)}`
      : null;
    if (artifactPath && artifactKey) {
      const domain = domains[0];
      const documentUrl = text(record.document_url) || null;
      artifacts.push({
        artifactKey,
        domain,
        sourceJurisdiction: text(record.jurisdiction),
        sourceName: text(record.authority) || 'Official public-record source',
        sourceUrl: documentUrl || text(record.source_url) || null,
        portalReference: documentUrl || text(record.source_url) || null,
        instrumentNumber: text(facts.instrumentNumber) || null,
        bookPage: text(facts.recordBookPage) || text(facts.deedRef) || null,
        parcelReference: text(facts.apn) || null,
        recordingFilingDate: text(facts.recordingDate) || null,
        documentType: text(facts.currentDeed) || text(record.title) || 'Recorded document',
        mimeType: mimeTypeForArtifact(artifactPath),
        displayName: text(record.title) || path.basename(artifactPath),
        retrievedAt: text(record.searched_at) || new Date(Number(record.updated_at ?? 0) * 1000).toISOString(),
        pageCount: positiveInteger(facts.recordedPageCount) ?? 1,
        pageSourcePaths: [artifactPath],
      });
    }
    claims.push(...claimsFromPublicOutcome(record, artifactKey));
  }
  return { artifacts, claims };
}

function domainForDocument(document: { category: string; title: string; docType: string }): GovernmentRecordDomain {
  const value = `${document.category} ${document.title} ${document.docType}`;
  if (/survey|plat/i.test(value)) return 'surveys_plats';
  if (/tax/i.test(value)) return 'property_tax';
  if (/easement|restriction|covenant|right.of.way|encumbr/i.test(value)) return 'recorded_encumbrances';
  return 'deed_ownership';
}

function artifactsAndClaimsFromRegistry(input: {
  dealCardId: number;
  cardId: number;
  jurisdiction: string;
}): { artifacts: GovernmentRecordArtifactInput[]; claims: GovernmentRecordClaimInput[] } {
  const registry = documentRegistryForCard(input.cardId, { dealCardId: input.dealCardId });
  const artifacts: GovernmentRecordArtifactInput[] = [];
  const claims: GovernmentRecordClaimInput[] = [];
  for (const document of registry.documents) {
    if (document.uploaded) continue;
    const domain = domainForDocument(document);
    const artifactKey = document.id;
    const pageSourcePaths = document.pages.map((page) => landosArtifactPath('visuals', path.basename(page.file)));
    if (pageSourcePaths.length > 0) {
      artifacts.push({
        artifactKey,
        domain,
        sourceJurisdiction: input.jurisdiction,
        sourceName: document.source,
        sourceUrl: document.officialUrl,
        portalReference: document.id,
        instrumentNumber: document.id.startsWith('deed:') ? document.id.slice(5) : null,
        recordingFilingDate: document.documentDate,
        documentType: document.docType,
        mimeType: 'image/png',
        displayName: document.title,
        retrievedAt: document.captureDate || new Date().toISOString(),
        pageCount: document.pageCount,
        pageSourcePaths,
      });
    }
    claims.push({
      claimKey: domain === 'deed_ownership' ? 'recorded_instrument' : 'recorded_document',
      exactWording: `${document.docType}: ${document.title}`,
      normalizedValue: {
        title: document.title,
        documentType: document.docType,
        pageCount: document.pageCount,
      },
      domain,
      association: 'subject_property_direct',
      locatorStatus: pageSourcePaths.length ? 'record_located' : 'record_referenced_document_unavailable',
      sourceName: document.source,
      sourceUrl: document.officialUrl,
      sourceJurisdiction: input.jurisdiction,
      sourceTier: 'official_county_state',
      confidence: pageSourcePaths.length ? 'high' : 'medium',
      retrievedAt: document.captureDate || new Date().toISOString(),
      documentType: document.docType,
      instrumentNumber: document.id.startsWith('deed:') ? document.id.slice(5) : null,
      artifactKey: pageSourcePaths.length ? artifactKey : null,
    });
    for (const finding of document.findings) {
      // The finding label is the canonical fact type. Detail often contains
      // cautions mentioning surveys, easements, or title searches and must not
      // reroute the fact into an unrelated collector domain.
      const findingDomain = inferClaimDomain(finding.label, domain);
      const priorBookPage = referencedBookPage(finding.label, finding.detail);
      claims.push({
        claimKey: finding.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'document_finding',
        exactWording: finding.detail,
        normalizedValue: legacyFindingValue(finding.label, finding.detail),
        domain: findingDomain,
        association: priorBookPage || findingDomain !== domain ? 'referenced_in_instrument' : 'subject_property_direct',
        locatorStatus: priorBookPage
          ? 'record_referenced_document_unavailable'
          : pageSourcePaths.length ? 'record_located' : 'record_referenced_document_unavailable',
        sourceName: document.source,
        sourceUrl: finding.sourceUrl || document.officialUrl,
        sourceJurisdiction: input.jurisdiction,
        sourceTier: 'official_county_state',
        confidence: document.extractionConfidence === 'high' ? 'high' : document.extractionConfidence === 'low' ? 'low' : 'medium',
        retrievedAt: document.captureDate || new Date().toISOString(),
        documentType: document.docType,
        instrumentNumber: priorBookPage ? null : document.id.startsWith('deed:') ? document.id.slice(5) : null,
        bookPage: priorBookPage,
        artifactKey: pageSourcePaths.length ? artifactKey : null,
        artifactPage: finding.pageNumber,
      });
    }
  }
  return { artifacts, claims };
}

function statusForClaims(claims: GovernmentRecordClaimInput[]): GovernmentRecordCollectorInput['status'] {
  if (!claims.length) return 'partial';
  if (claims.some((claim) =>
    (claim.association === 'subject_property_direct' || claim.association === 'not_applicable')
    && (claim.locatorStatus === 'record_located' || claim.locatorStatus === 'no_matching_record_found'))) return 'succeeded';
  if (claims.every((claim) => claim.locatorStatus === 'official_source_blocked'
    || claim.locatorStatus === 'official_source_authenticated'
    || claim.locatorStatus === 'official_source_paywalled'
    || claim.locatorStatus === 'official_source_unavailable')) return 'blocked';
  return 'partial';
}

export function synchronizeGovernmentRecordsForDeal(input: {
  dealCardId: number;
  actor: string;
  changeReason: string;
}): GovernmentRecordReadModel {
  const deal = getDealCard(input.dealCardId);
  if (!deal) throw new Error('Deal Card not found.');
  let identity = readCurrentPropertyIdentity(input.dealCardId);
  if (!identity) {
    synchronizePropertySummaryForDeal({
      dealCardId: input.dealCardId,
      actor: input.actor,
      changeReason: 'Established the versioned property identity before government-record screening.',
    });
    identity = readCurrentPropertyIdentity(input.dealCardId);
  }
  if (!identity) throw new Error('The versioned subject property identity could not be established.');
  const property = (deal.propertyCards[0] ?? {}) as Record<string, unknown>;
  const cardId = Number(property.id);
  const jurisdiction = [identity.county ? `${identity.county} County` : null, identity.state].filter(Boolean).join(', ');
  const publicEvidence = artifactsAndClaimsFromPublicOutcomes(listPublicRecordOutcomes(input.dealCardId));
  const registry = Number.isInteger(cardId)
    ? artifactsAndClaimsFromRegistry({ dealCardId: input.dealCardId, cardId, jurisdiction })
    : { artifacts: [], claims: [] };
  const allClaims = [...publicEvidence.claims, ...registry.claims];
  const collectors = ([
    'deed_ownership',
    'surveys_plats',
    'recorded_encumbrances',
    'property_tax',
    'lien_judgment',
  ] as GovernmentRecordDomain[]).map((domain): GovernmentRecordCollectorInput => {
    const claims = allClaims.filter((claim) => claim.domain === domain);
    const artifacts = [...publicEvidence.artifacts, ...registry.artifacts]
      .filter((artifact) => artifact.domain === domain);
    // The persistence boundary independently enforces either a confirmed
    // identity or an exact official parcel-reference match. Preserve the
    // collector's real result here so a subject-correlated recorder document can
    // be retained without auto-promoting the canonical identity.
    const status = statusForClaims(claims);
    return {
      identity: identity!,
      domain,
      sourceJurisdiction: jurisdiction,
      platform: 'persisted-official-evidence',
      adapterKey: LEGACY_ADAPTER_VERSION,
      status,
      outcomeKind: status === 'blocked' ? 'blocked' : 'completed',
      error: status === 'blocked'
        ? (identity!.status === 'confirmed'
            ? 'The persisted official source was unavailable, authenticated, blocked, or paywalled.'
            : 'Confirmed subject property identity is required before recorded-government research.')
        : status === 'partial'
          ? 'No complete persisted official-source result is available for this domain.'
          : null,
      claims,
      artifacts,
      requestKey: JSON.stringify({
        adapterVersion: LEGACY_ADAPTER_VERSION,
        identityId: identity!.id,
        domain,
        status,
        claims: claims.map((claim) => [
          claim.claimKey,
          claim.exactWording,
          claim.normalizedValue,
          claim.association,
          claim.locatorStatus,
          claim.sourceUrl,
          claim.instrumentNumber,
          claim.bookPage,
          claim.artifactKey,
          claim.artifactPage,
        ]),
        artifacts: artifacts.map((artifact) => [artifact.artifactKey, artifact.instrumentNumber, artifact.pageCount]),
      }),
    };
  });
  const readModel = synchronizeGovernmentRecordSlice({
    identity,
    collectors,
    changeReason: input.changeReason,
    generatedBy: input.actor,
  });
  // A retrieved instrument that itself grants or reserves ingress/egress is
  // verified-legal access evidence. It is asserted through the canonical
  // research store so the access ladder, the Deal Brain and the risk read all
  // see the same item; the instrument-keyed id makes a rebuild idempotent.
  if (Number.isInteger(cardId)) {
    const findings = recordedInstrumentAccessFindings(listPublicRecordOutcomes(input.dealCardId));
    const result = recordedInstrumentAccessResult({
      propertyCardId: cardId,
      dealCardId: input.dealCardId,
      normalizedAddress: text(property.active_input_address).toLowerCase(),
      address: text(property.active_input_address),
      city: text(property.city) || null,
      county: text(property.county) || null,
      state: text(property.state) || null,
      zip: text(property.zip) || null,
      apn: text(property.apn) || null,
      fips: text(property.fips) || null,
      landPortalPropertyId: text(property.lp_property_id) || null,
    }, findings, new Date().toISOString());
    if (result) new PropertyResearchStore().persistProviderResult(result);
  }
  return readModel;
}

/** SELECT-only read adapter for the Deal Card route. */
export function readGovernmentRecordsForDeal(dealCardId: number): GovernmentRecordReadModel | null {
  return getGovernmentRecordReadModel(dealCardId);
}
