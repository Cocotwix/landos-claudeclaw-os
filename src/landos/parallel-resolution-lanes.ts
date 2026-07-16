// Live lane adapters for the parallel resolution orchestrator.
//
// These map LandOS's existing shared services into the orchestrator's neutral
// LaneOutcome shape, so parallel-resolution.ts stays pure and both lanes reuse
// the SAME code the rest of LandOS already trusts:
//   - Official public lane  → lookupOfficialParcel (structured county/state adapters).
//   - LandPortal lane        → an existing read-only LandPortal BrowserService.
//
// Both adapters are defensive: an unavailable adapter or an unauthenticated
// browser session becomes an honest `unavailable`/`candidate` outcome, never a
// throw and never a fabricated confirmation. The orchestrator runs them
// concurrently; neither waits for the other.

import type { LaneOutcome } from './parallel-resolution.js';
import type { ParsedIntakeFields } from './intake-router.js';
import type { BrowserService, BrowserSearchKey } from './browser-intelligence.js';
import { lookupOfficialParcel, type OfficialParcelLookupResult } from './public-property-intelligence-live.js';

const isHttp = (u: string | undefined | null): u is string => !!u && /^https?:\/\//i.test(u);

export type OfficialLookupFn = (
  fields: Pick<ParsedIntakeFields, 'address' | 'county' | 'state' | 'apn'>,
  timeoutMs: number,
) => Promise<OfficialParcelLookupResult>;

/**
 * Lane A — official public record. A tested structured adapter (county GIS /
 * assessor / state parcel layer) confirms the exact parcel; a jurisdiction with
 * no adapter returns `unavailable` (honest, non-fatal — the other lane and, when
 * wired, browser-driven official research still run).
 */
export async function officialResolutionLane(
  fields: { address?: string | null; county?: string | null; state?: string | null; apn?: string | null },
  timeoutMs: number,
  lookup: OfficialLookupFn = lookupOfficialParcel,
): Promise<LaneOutcome> {
  const result = await lookup(
    { address: fields.address ?? undefined, county: fields.county ?? undefined, state: fields.state ?? undefined, apn: fields.apn ?? undefined },
    timeoutMs,
  );
  const attempts = result.attempted.map((a) => ({ source: a.source, status: a.status, note: a.note }));
  const p = result.parcel;
  if (p) {
    return {
      lane: 'official_public',
      status: 'confirmed',
      confirmedIdentity: true,
      parcel: {
        address: p.address,
        apn: p.apn,
        owner: p.owner,
        acres: p.acres,
        county: p.county,
        state: p.state,
        coordinates: p.coordinates,
        sourceUrl: p.sourceUrl,
        source: p.provider,
      },
      attempts,
      note: `Exact parcel confirmed by ${p.provider}.`,
    };
  }
  const noAdapter = result.attempted.every((a) => a.status === 'unavailable');
  return {
    lane: 'official_public',
    status: 'unavailable',
    confirmedIdentity: false,
    parcel: null,
    attempts,
    note: noAdapter
      ? (attempts[0]?.note ?? 'No tested public parcel adapter for this jurisdiction.')
      : 'Official sources ran but matched no exact parcel.',
  };
}

/**
 * Lane B — LandPortal parcel page via an existing read-only BrowserService. A
 * retrieved parcel with its own APN + jurisdiction + source URL is a confirmed
 * identity; a partial read is a `candidate`; an unauthenticated/parked session
 * is `unavailable`. Never blocks Lane A and never purchases a paid report (the
 * service enforces the read-only contract).
 */
export async function landPortalResolutionLane(
  service: BrowserService | undefined,
  searchKey: BrowserSearchKey,
  timeoutMs: number,
): Promise<LaneOutcome> {
  if (!service || !service.configured()) {
    return {
      lane: 'landportal',
      status: 'unavailable',
      confirmedIdentity: false,
      parcel: null,
      attempts: [{ source: 'LandPortal', status: 'parked', note: 'No authenticated LandPortal browser session.' }],
      note: 'LandPortal browser session is not available; lane skipped without blocking official sources.',
    };
  }
  const ev = await service.runWorkflow({ searchKey }, { timeoutMs });
  if (ev.status === 'retrieved') {
    const apn = ev.patch.apn ?? undefined;
    const county = ev.patch.county ?? undefined;
    const state = ev.patch.state ?? undefined;
    const fips = ev.patch.fips ?? undefined;
    const sourceUrl = ev.sourceUrls.find(isHttp) ?? ev.sourcesUsed.find((s) => isHttp(s.url))?.url;
    const confirmedIdentity = !!(apn && (county || state || fips) && sourceUrl);
    return {
      lane: 'landportal',
      status: confirmedIdentity ? 'confirmed' : 'candidate',
      confirmedIdentity,
      parcel: {
        address: ev.patch.address ?? ev.patch.normalizedAddress ?? undefined,
        apn,
        owner: ev.patch.owner ?? undefined,
        acres: ev.patch.acres ?? undefined,
        county,
        state,
        coordinates: ev.patch.coordinates ?? undefined,
        sourceUrl,
        source: 'LandPortal Map Search parcel panel (browser read-only)',
      },
      attempts: [{ source: 'LandPortal', status: 'retrieved', note: ev.note, url: sourceUrl }],
      note: ev.note || 'LandPortal parcel page read.',
    };
  }
  return {
    lane: 'landportal',
    status: ev.status === 'error' ? 'error' : 'unavailable',
    confirmedIdentity: false,
    parcel: null,
    attempts: [{ source: 'LandPortal', status: ev.status, note: ev.note }],
    note: ev.note || `LandPortal lane ${ev.status}.`,
  };
}
