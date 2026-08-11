// Acquisition Workspace V2 — OFFICIAL PARCEL & GIS panel.
//
// A compact evidence panel inside Property Intelligence. It answers five
// operator questions and nothing else: which official platform answered, is
// this parcel really the subject, who does the source say governs it, is there
// official zoning, and what is genuinely missing.
//
// Deliberately absent: service metadata, layer inventories, request counts,
// raw payloads, browser logs. Those live in the retained evidence record. A
// panel that dumps diagnostics stops being read.

import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';

export interface OfficialParcelGisView {
  present: boolean;
  provider: string;
  providerVariant: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  parcelMatch: 'verified' | 'provisional' | 'conflict' | 'not_found';
  parcelMatchLabel: string;
  conflictDetails: string[];
  parcelId: string | null;
  parcelAddress: string | null;
  owner: string | null;
  acres: number | null;
  jurisdictionClues: Array<{ level: string; name: string; statement: string }>;
  localGovernment: string | null;
  zoningStatus: 'found' | 'not_found' | 'unresolved';
  zoningCode: string | null;
  zoningDescription: string | null;
  zoningAuthority: 'official_zoning_layer' | 'assessment_classification' | 'unclassified' | null;
  zoningCaveat: string | null;
  zoningLayerName: string | null;
  geometryStatus: 'retained' | 'unavailable';
  geometryVertexCount: number | null;
  geometryCentroid: { lat: number; lng: number } | null;
  retrievalMethod: string;
  retrievalMethodLabel: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  failureStates: Array<{ code: string; label: string }>;
  unresolvedFields: string[];
  planningLinks: Array<{ label: string; url: string }>;
  retrievedAt: string | null;
  access?: PublicRecordAccessView | null;
  resolution?: 'resolved' | 'not_resolved' | 'not_run';
  statusHeadline?: string;
  statusDetail?: string;
  identityRetained?: boolean;
  actions?: Array<{ id?: string; label: string; href?: string | null }>;
}

/** Access status only. There is no password, handle, username or email here. */
export interface PublicRecordAccessView {
  present: boolean;
  requirement: 'auth_not_required' | 'auth_optional' | 'auth_required' | 'unknown';
  accessLabel: string;
  registration: string;
  registrationLabel: string | null;
  accountLabel: string | null;
  scopeLabel: string | null;
  lastLogin: string | null;
  actionLabel: string | null;
  paidRecordsNote: string | null;
  capabilities: string[];
  observedAt: string | null;
}

function Row({ k, v, empty }: { k: string; v: string | null | undefined; empty?: string }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">{empty || 'Not available'}</span>}
    </>
  );
}

function fieldLabel(field: string): string {
  switch (field) {
    case 'parcelId': return 'Parcel ID';
    case 'parcelAddress': return 'Parcel address';
    case 'owner': return 'Owner';
    case 'acres': return 'Acreage';
    case 'geometry': return 'Geometry';
    case 'zoning': return 'Zoning';
    default: return field;
  }
}

export function OfficialParcelGisPanel({ dealId, initial }: { dealId: number; initial: OfficialParcelGisView | null }) {
  const [view, setView] = useState<OfficialParcelGisView | null>(initial ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiPost<{ officialParcelGis: OfficialParcelGisView }>(
        `/api/landos/deal-cards/${dealId}/official-parcel-gis/run`,
      );
      setView(res.officialParcelGis);
    } catch (err) {
      setError((err as Error)?.message || 'Official parcel research failed.');
    } finally {
      setRunning(false);
    }
  };

  const v = view;
  const researched = !!v?.present || (v?.resolution != null && v.resolution !== 'not_run');
  const unresolved = !v || v.resolution === 'not_resolved' || (researched && v.parcelMatch === 'not_found');

  return (
    <section class="awv2-panel" id="official-parcel-gis">
      <div class="awv2-panel-title">
        Official Parcel &amp; GIS
        {researched && (
          <span class={`awv2-opg-badge ${v!.parcelMatch}`}>{v!.parcelMatchLabel}</span>
        )}
        {(!researched || !unresolved) && (
          <button class="awv2-opg-run" onClick={run} disabled={running}>
            {running ? 'Researching…' : researched ? 'Re-run' : 'Research official source'}
          </button>
        )}
      </div>

      {error && <div class="awv2-opg-warn">{error}</div>}

      {!researched && !running && (
        <div class="awv2-pi-note">
          Official county parcel source — not run
        </div>
      )}

      {unresolved && researched && (
        <div class="awv2-opg-unresolved">
          <div><b>{v?.statusHeadline || 'Official county parcel source — not resolved'}</b></div>
          <div>{v?.statusDetail || 'The official source did not return a subject parcel. Canonical subject facts and independent LandPortal intelligence remain available above.'}</div>
          <div class="awv2-opg-actions">
            <button type="button" onClick={run} disabled={running}>Retry</button>
            <details class="awv2-collapse awv2-opg-details">
              <summary>Details</summary>
              {(v?.failureStates || []).map((failure) => <div>{failure.label}</div>)}
              {(v?.unresolvedFields || []).map((field) => <div>{fieldLabel(field)} was not returned</div>)}
              {v?.retrievalMethodLabel && <div>Attempt: {v.retrievalMethodLabel}</div>}
            </details>
          </div>
        </div>
      )}

      {researched && !unresolved && (
        <>
          <div class="awv2-kv">
            <Row k="Provider" v={v!.providerVariant ? `${v!.provider} (${v!.providerVariant})` : v!.provider} />
            <Row k="Subject match" v={v!.parcelMatchLabel} />
            <Row
              k="Geometry"
              v={v!.geometryStatus === 'retained'
                ? `Retained (${v!.geometryVertexCount ?? 0} vertices)`
                : null}
              empty="Unavailable"
            />
          </div>

          {v!.parcelMatch === 'conflict' && v!.conflictDetails.length > 0 && (
            <div class="awv2-opg-warn">
              <b>Parcel identity conflict.</b> LandOS did not accept this record as the subject.
              {v!.conflictDetails.map((d) => <div>{d}</div>)}
            </div>
          )}

          <details class="awv2-collapse awv2-opg-details">
          <summary>Official zoning and source provenance</summary>
          <div class="awv2-opg-sub">Official zoning layer</div>
          {v!.zoningStatus === 'found' ? (
            <>
              <div class="awv2-kv">
                <Row k="Zoning code" v={v!.zoningCode} />
                <Row k="Description" v={v!.zoningDescription} />
                <Row k="Layer" v={v!.zoningLayerName} />
                <Row
                  k="Authority"
                  v={v!.zoningAuthority === 'official_zoning_layer'
                    ? 'Official zoning layer'
                    : v!.zoningAuthority === 'assessment_classification'
                      ? 'Assessment classification — not adopted zoning'
                      : 'Unclassified'}
                />
              </div>
              {v!.zoningCaveat && <div class="awv2-opg-warn">{v!.zoningCaveat}</div>}
              <div class="awv2-pi-note">Zoning rules are not interpreted here. This records what the official source publishes.</div>
            </>
          ) : (
            <div class="awv2-pi-note">
              {v!.zoningStatus === 'not_found'
                ? 'This platform exposes no zoning layer for the subject.'
                : 'A zoning layer was not resolved for the subject.'}
            </div>
          )}

          <div class="awv2-opg-provenance">
            {v!.sourceLabel && <div class="awv2-pi-note"><b>Source jurisdiction:</b> {v!.sourceLabel}</div>}
            {v!.jurisdictionClues.map((clue) => <div class="awv2-pi-note"><b>{clue.level}:</b> {clue.name}</div>)}
            {v!.sourceUrl && <a href={v!.sourceUrl} target="_blank" rel="noreferrer">Official source</a>}
            {v!.planningLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
            <div class="awv2-pi-note">{v!.retrievalMethodLabel} · {v!.confidence} confidence{v!.retrievedAt ? ` · retrieved ${new Date(v!.retrievedAt).toLocaleString()}` : ''}</div>
          </div>
          </details>
        </>
      )}
    </section>
  );
}
