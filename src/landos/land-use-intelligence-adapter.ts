// LAND USE → PROPERTY INTELLIGENCE ZONING LANE
//
// The Property Intelligence task graph had exactly ONE zoning_landuse adapter,
// and it read the county GIS zoning polygon by the official parcel's own rings.
// That made zoning research a downstream consequence of obtaining an
// OfficialParcel: on a county that publishes no parcel service the lane fell
// through to the orchestrator's no-adapter path and reported
// "Zoning and land use is not connected."
//
// Zoning authority is a property of the LOCATION, not of a parcel polygon. The
// nationwide Land Use engine already resolves it that way — county, local unit,
// incorporation status, who exercises zoning, the state framework, and the
// local ordinance — from the address point. This module is the connection
// between the two.
//
// It is a PROJECTION, not a second engine. It runs no research, reaches no
// network, and invents nothing: it reads the already-accepted determination and
// restates it as the task graph's zoning_landuse finding, carrying the original
// citations. When nothing has been accepted it returns `unavailable` with the
// land-use lane's own reason — never a fabricated district and never the
// parcel lane's blocker.

import { getLandUseDetermination } from './land-use-store.js';
import { jurisdictionClaimFromLandUse } from './land-use-jurisdiction-bridge.js';
import { isByRight } from './land-use-types.js';
import type {
  EvidencedValue,
  LandUseDetermination,
  LegalSourceCitation,
} from './land-use-types.js';
import type {
  PublicEvidence,
  PublicIntelligenceAdapter,
  PublicIntelligenceAdapterResult,
  PublicIntelligenceSubject,
  ZoningLandUseFinding,
} from './public-property-intelligence.js';

export const LAND_USE_ZONING_ADAPTER_ID = 'land_use_engine_zoning_projection_v1';

/** An accepted value's own words, when it has any. */
function valueText(value: EvidencedValue<string> | undefined): string | null {
  const text = (value?.value ?? '').trim();
  return text.length ? text : null;
}

/** The authority statement without the citation's full page excerpt trailing it. */
function boundedBasis(basis: string): string {
  const upToPattern = basis.indexOf(').');
  const statement = upToPattern >= 0 ? basis.slice(0, upToPattern + 2) : basis;
  return statement.length > 400 ? `${statement.slice(0, 397)}...` : statement;
}

function citationEvidence(
  citations: readonly LegalSourceCitation[],
  retrievedAt: string,
  supports: string[],
): PublicEvidence[] {
  const seen = new Set<string>();
  const rows: PublicEvidence[] = [];
  for (const citation of citations) {
    const key = citation.url ?? citation.label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      evidenceId: `land-use-${rows.length + 1}`,
      sourceName: citation.label,
      sourceUrl: citation.url ?? undefined,
      // The land-use engine derives quality FROM its citations; a primary tier
      // there is an official government publication here. Nothing is promoted.
      sourceTier: 'official_county_state',
      verification: 'official_record',
      retrievedAt: citation.retrievedAt ?? retrievedAt,
      confidence: 'medium',
      supports,
      limitation: citation.excerpt
        ? 'Retrieved from the governing authority\'s own published law or official page. Read the cited text before relying on it.'
        : 'Official source located by the land-use lane; open the citation before relying on it.',
      captureMode: 'live',
      decisionUsable: true,
    });
    if (rows.length >= 8) break;
  }
  return rows;
}

/**
 * Build the zoning_landuse finding from an accepted determination.
 *
 * Exported for direct testing: the projection rules are the thing worth
 * pinning, not the store read around them.
 */
export function zoningFindingFromLandUse(
  determination: LandUseDetermination,
  mailingCity: string | null = null,
): PublicIntelligenceAdapterResult {
  const authority = jurisdictionClaimFromLandUse({ determination, mailingCity });
  const zoning = determination.zoning;
  const subdivision = determination.subdivision;
  const fallback = determination.countySubdivisionFallback ?? null;

  const zoningCode = valueText(zoning.code);
  const zoningName = valueText(zoning.districtName);
  // A classification that is NOT adopted zoning never enters the zoning slot.
  const nonZoning = zoning.nonZoningClassification;

  const jurisdiction = authority?.authorityName
    ?? determination.authority.localUnit?.name?.value
    ?? [determination.subject.county, determination.subject.state].filter(Boolean).join(', ')
    ?? null;

  const byRightPaths = subdivision.paths.filter((path) => path.isByRight);
  // The by-right split is the engine's own: only the two by-right statuses
  // count, and an objective condition never demotes one.
  const byRightUses = determination.uses.filter((use) => isByRight(use.status));
  const subdivisionNote = fallback
    ? `${fallback.label} ${fallback.blocker}. ${fallback.summary}`
    : subdivision.governingBody
      ? `${subdivision.governingBody} administers land division here.${byRightPaths.length
        ? ` By-right procedures located: ${byRightPaths.map((path) => path.originalTerm).join(', ')}.`
        : ''}`
      : 'The body that approves land division for this parcel is not established.';

  const stateFrameworkNote = determination.stateFramework.status === 'present'
    ? `Statewide framework: ${determination.stateFramework.provisions.length} provision(s) located for ${determination.stateFramework.state}.`
    : null;

  const citations: LegalSourceCitation[] = [
    ...(zoning.code.citations ?? []),
    ...(determination.authority.zoningAuthority?.name?.citations ?? []),
    ...(fallback?.sources ?? []),
    ...determination.sources,
  ];
  const evidence = citationEvidence(citations, determination.determinedAt, ['zoning authority', 'land use', 'subdivision']);

  const presenceSummary = zoning.presence === 'no_conventional_zoning'
    ? `NO CONVENTIONAL ZONING — verified for ${jurisdiction ?? 'this jurisdiction'}.`
    : zoningCode
      ? `Zoned ${zoningName ?? zoningCode}${jurisdiction ? ` under ${jurisdiction}` : ''}.`
      : jurisdiction
        ? `${jurisdiction} exercises zoning authority here; the zoning district itself is not established.`
        : 'No zoning authority has been established for this subject.';

  // Silence is never permission: with no accepted authority AND no accepted
  // zoning presence, the lane reports unavailable rather than an empty finding
  // that reads like a researched answer.
  if (!authority && zoning.presence === 'zoning_unverified' && !zoningCode && !fallback) {
    return {
      status: 'unavailable',
      evidence,
      confidence: 'none',
      retryEligible: true,
      failureReason: 'The land-use lane ran but established neither a governing zoning authority nor a zoning determination for this subject. Run Land Use research from the Deal Card to retry.',
    };
  }

  return {
    status: authority && (zoning.presence !== 'zoning_unverified' || !!zoningCode) ? 'succeeded' : 'partial',
    evidence,
    confidence: authority?.determination === 'confirmed' ? 'high' : authority ? 'medium' : 'low',
    retryEligible: !zoningCode,
    finding: {
      kind: 'zoning_landuse',
      zoningCode,
      zoningName,
      overlayDistricts: [],
      futureLandUse: null,
      existingLandUse: null,
      jurisdiction,
      minimumLotSize: valueText(subdivision.minimumLotArea),
      allowedUsesNote: byRightUses.length
        ? `By right: ${byRightUses.map((use) => use.structureType.replace(/_/g, ' ')).join(', ')}.`
        : null,
      subdivisionNote,
      sourceLayerUrls: evidence.map((row) => row.sourceUrl).filter((url): url is string => !!url),
      summary: [
        presenceSummary,
        // The bridge's basis appends the citation excerpt verbatim, and a
        // township homepage excerpt is its whole navigation. Keep the statement
        // of who governs and why; the full excerpt stays on the citation.
        authority ? boundedBasis(authority.basis) : null,
        stateFrameworkNote,
        subdivisionNote,
        nonZoning ? `A "${nonZoning.code}" value published by the parcel source is a ${nonZoning.kind.replace(/_/g, ' ')}, not adopted zoning, and is held out of the zoning slot.` : null,
      ].filter(Boolean).join(' '),
      whyItMatters: 'Who governs zoning, what the district permits by right, and which land-division rules apply decide what can be built and how many lots the parcel can yield.',
      limitation: 'Retrieved from official published law and government sources by the land-use lane. It is not a zoning verification letter, and the governing authority\'s own staff determination controls.',
      classification: zoning.presence === 'zoning_unverified' && !zoningCode ? 'screening' : 'official_record',
    },
  };
}

const NO_DETERMINATION_REASON =
  'No land-use determination has been accepted for this Deal Card yet. Zoning, planning and subdivision research runs from the Land Use lane; it does not depend on the official parcel record.';

/**
 * Fold the county GIS zoning polygon into an accepted legal determination.
 *
 * SUPPLEMENT means supplement. The GIS value never enters `zoningCode`,
 * `zoningName` or `jurisdiction`, because a zoning polygon is a spatial
 * publication and the determination is the adopted law resolved against the
 * governing authority. What GIS genuinely adds is spatial: overlay districts
 * the parcel intersects, the future/existing land-use plan values, and the
 * layer URLs an operator can open.
 */
export function mergeGisZoningSupplement(
  primary: PublicIntelligenceAdapterResult,
  supplement: PublicIntelligenceAdapterResult | null,
): PublicIntelligenceAdapterResult {
  const gis = supplement?.finding?.kind === 'zoning_landuse' ? supplement.finding as ZoningLandUseFinding : null;
  const legal = primary.finding?.kind === 'zoning_landuse' ? primary.finding as ZoningLandUseFinding : null;
  if (!gis || !legal) return primary;

  const gisNote = [
    gis.zoningCode ? `County GIS zoning polygon publishes "${gis.zoningName ?? gis.zoningCode}" for this parcel` : null,
    gis.overlayDistricts.length ? `overlay districts intersected: ${gis.overlayDistricts.join(', ')}` : null,
    gis.futureLandUse ? `future land use ${gis.futureLandUse}` : null,
    gis.existingLandUse ? `existing land use ${gis.existingLandUse}` : null,
  ].filter(Boolean).join('; ');

  return {
    ...primary,
    evidence: [...primary.evidence, ...supplement!.evidence],
    finding: {
      ...legal,
      overlayDistricts: [...new Set([...legal.overlayDistricts, ...gis.overlayDistricts])],
      futureLandUse: legal.futureLandUse ?? gis.futureLandUse,
      existingLandUse: legal.existingLandUse ?? gis.existingLandUse,
      sourceLayerUrls: [...new Set([...legal.sourceLayerUrls, ...gis.sourceLayerUrls])],
      summary: gisNote
        ? `${legal.summary} Supplemental county GIS screening: ${gisNote}. The adopted law and the governing authority above control.`
        : legal.summary,
    },
  };
}

export interface ZoningLandUseAdapterInput {
  dealCardId: number;
  mailingCity?: string | null;
  /**
   * The county GIS zoning polygon lane, when a parcel polygon exists to query
   * it with. Optional by design: its absence changes nothing about the legal
   * determination, and it can never make this lane unavailable.
   */
  gisSupplement?: PublicIntelligenceAdapter | null;
}

/**
 * The zoning_landuse lane. ONE source-selection site for both branches.
 *
 * The accepted Land Use / zoning / subdivision determination is the primary
 * legal and jurisdictional source whether or not `lookupOfficialParcel()`
 * returned a parcel. That is the whole point: the legal chain runs
 * subject → location hierarchy → incorporation → governing authority → state
 * framework → official local sources → district → by-right uses → land
 * division, and a parcel polygon appears nowhere in it.
 */
export function makeZoningLandUseAdapter(input: ZoningLandUseAdapterInput): PublicIntelligenceAdapter {
  const mailingCity = input.mailingCity ?? null;
  const supplementAdapter = input.gisSupplement ?? null;
  return {
    task: 'zoning_landuse',
    adapterId: LAND_USE_ZONING_ADAPTER_ID,
    timeoutMs: supplementAdapter ? 45_000 : 5_000,
    async run(subject: PublicIntelligenceSubject, context): Promise<PublicIntelligenceAdapterResult> {
      const record = getLandUseDetermination(input.dealCardId);
      // The supplement is best-effort in every direction: a county with no
      // tested zoning layer, a layer that times out, or an adapter that throws
      // all reduce to "no supplemental spatial evidence".
      let supplement: PublicIntelligenceAdapterResult | null = null;
      if (supplementAdapter) {
        try {
          const result = await supplementAdapter.run(subject, context);
          supplement = result.finding?.kind === 'zoning_landuse' ? result : null;
        } catch {
          supplement = null;
        }
      }

      if (!record) {
        // Nothing legal has been accepted. GIS is still shown rather than
        // discarded, but it is labelled for what it is — spatial screening —
        // and it never claims to be the jurisdictional determination.
        if (supplement?.finding) {
          return {
            ...supplement,
            status: 'partial',
            confidence: 'low',
            retryEligible: true,
            failureReason: NO_DETERMINATION_REASON,
          };
        }
        return {
          status: 'unavailable',
          evidence: [],
          confidence: 'none',
          retryEligible: true,
          failureReason: NO_DETERMINATION_REASON,
        };
      }

      const primary = zoningFindingFromLandUse(record.determination, mailingCity);
      if (!primary.finding && supplement?.finding) {
        return { ...supplement, status: 'partial', confidence: 'low', retryEligible: true, failureReason: primary.failureReason };
      }
      return mergeGisZoningSupplement(primary, supplement);
    },
  };
}
