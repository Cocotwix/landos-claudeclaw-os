// Acquisition Workspace V2 — Deal Card → Property Development History.
//
// The PROPERTY question, kept separate from the jurisdiction question the
// Zoning & Subdivision panel answers: what material government, planning and
// development history has surfaced for THIS exact parcel.
//
// Three rendering rules carry the panel's honesty:
//
//   1. A proposal is never rendered as an approval. Each chapter shows the
//      status the record actually printed, and "Final entitlement status" is
//      stated on its own line rather than inferred from a lot count.
//   2. A discovered applicant, developer or historical owner is labelled with
//      that role. It is never rendered as the seller, and nothing in this panel
//      writes a CRM field.
//   3. When nothing was established the panel says so in LandOS's own words —
//      "not established from the official sources searched" — which is not the
//      same claim as "no history exists".
import { useState } from 'preact/hooks';

import { apiPost } from '@/lib/api';
import { useCanonicalParcelGate } from '@/lib/useCanonicalParcelGate';

interface HistoryEvent {
  key: string;
  eventDate: string | null;
  eventTypeLabel: string;
  governingBody: string | null;
  projectName: string | null;
  statusLabel: string;
  statusClass: string;
  entitlementEstablished: false;
  entitlementBasis: string;
  proposedLots: number | null;
  acres: number | null;
  summary: string;
  ownerAtTheTime: string | null;
  applicant: string | null;
  sourceUrl: string | null;
  confidence: string;
}

interface PropertyDevelopmentHistoryResult {
  invocationId: string;
  subjectResolution: string;
  facts: {
    outcome?: string;
    summary?: string;
    history?: {
      established?: boolean;
      statement?: string;
      eventCount?: number;
      events?: HistoryEvent[];
      zoningReferences?: Array<{ kind: string; value: string | null; asOf: string | null; sourceUrl: string | null }>;
      narrative?: string;
      highlights?: string[];
      openQuestions?: string[];
    };
    relatedParties?: Array<{ name: string; role: string; roleLabel: string; basis: string; sourceUrl: string | null }>;
    crmContacts?: Array<{ name: string; role: string }>;
    retainedContext?: { documentsHeld?: number; findingsHeld?: number; documentsReused?: number };
    search?: { ran?: boolean; documentsRetrieved?: number; sourcesConsulted?: number; note?: string };
    sources?: Array<{ title: string; url: string | null; date: string | null; reusedFromStorage: boolean }>;
    limitations?: string[];
  };
  warnings: string[];
  missingInformation: string[];
  execution: { mode: string; reused: boolean; durationMs: number };
}

export function PropertyDevelopmentHistoryPanel({ dealId }: { dealId?: number }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PropertyDevelopmentHistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gate = useCanonicalParcelGate(dealId);

  if (!dealId) return null;

  const invoke = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: PropertyDevelopmentHistoryResult }>(
        `/api/landos/deal-cards/${dealId}/property-development-history/capability`,
        { refresh: true },
      );
      setResult(response.result);
    } catch (caught) {
      setError((caught as Error)?.message ?? 'Property Development History could not run.');
    } finally {
      setRunning(false);
    }
  };

  const facts = result?.facts ?? {};
  const history = facts.history ?? {};
  const events = history.events ?? [];

  return (
    <div class="awv2-pi-note awv2-property-history" data-testid="awv2-property-development-history">
      <div class="awv2-opg-sub">Property development history</div>
      <button
        type="button"
        data-testid="awv2-property-development-history-button"
        disabled={running || gate.blocked}
        title={gate.blocked ? gate.reason : 'Run Property Development History'}
        onClick={() => { void invoke(); }}
      >
        {running ? 'Reading the parcel record…' : 'Run Property Development History'}
      </button>
      {' '}Reads what LandOS already retained about this exact parcel first, then runs one bounded
      targeted search if that did not establish material history. It never changes which parcel this
      card is about, and it never changes the seller or contact on this deal.
      {gate.blocked && <div class="awv2-pi-note">Waiting for prerequisite: {gate.reason}</div>}
      {error && <div class="awv2-pi-note" role="alert">{error}</div>}
      {result && (
        <div class="awv2-property-history-result" data-testid="awv2-property-development-history-result">
          {history.established ? (
            <>
              <div><b>{history.eventCount ?? events.length} material record(s) established</b> · subject {result.subjectResolution}</div>
              {history.narrative && <div>{history.narrative}</div>}
              <ul data-testid="awv2-property-development-history-events">
                {events.map((event) => (
                  <li>
                    <div>
                      <b>{event.eventDate ?? 'Date not stated'} — {event.projectName ?? event.eventTypeLabel}</b>
                    </div>
                    <div>{event.eventTypeLabel} · {event.statusLabel}
                      {event.governingBody ? ` · ${event.governingBody}` : ''}</div>
                    {event.proposedLots != null && (
                      <div>{event.proposedLots} lot(s) proposed
                        {event.acres != null ? ` on ${event.acres} acre(s)` : ''}</div>
                    )}
                    {/* Stated on its own line, with the reason. The recorded
                        action is shown above; a recorded action is never
                        rendered here as an entitlement. */}
                    <div data-testid="awv2-property-history-entitlement">
                      Final entitlement status: Not established
                      {event.entitlementBasis ? ` — ${event.entitlementBasis}` : ''}
                    </div>
                    {event.applicant && <div>Applicant / developer: {event.applicant}</div>}
                    {event.ownerAtTheTime && <div>Owner of record at the time: {event.ownerAtTheTime}</div>}
                    <div>{event.summary}</div>
                    {event.sourceUrl && (
                      <div><a href={event.sourceUrl} target="_blank" rel="noreferrer">Open official record ↗</a></div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div data-testid="awv2-property-development-history-empty">
              {history.statement
                ?? 'No material prior development or entitlement history was established from the official sources searched.'}
            </div>
          )}

          {!!history.zoningReferences?.length && (
            <div data-testid="awv2-property-history-zoning-references">
              <b>Zoning the historical record stated (never the district in force today):</b>
              <ul>
                {history.zoningReferences.map((row) => (
                  <li>
                    {row.kind.replace(/_/g, ' ')}: {row.value ?? 'not stated'}
                    {row.asOf ? ` (as of ${row.asOf})` : ''}
                    {row.sourceUrl && <> — <a href={row.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Roles stay distinct. These are people and entities the government
              record named; the CRM seller and contact are untouched. */}
          {!!facts.relatedParties?.length && (
            <div data-testid="awv2-property-history-related-parties">
              <b>Related parties named in the record</b> (context only — this does not change the
              seller or contact on this deal):
              <ul>
                {facts.relatedParties.map((party) => (
                  <li>
                    {party.name} — {party.roleLabel}
                    {party.sourceUrl && <> — <a href={party.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!facts.crmContacts?.length && (
            <div data-testid="awv2-property-history-crm-contacts">
              <b>This deal&apos;s contacts (unchanged):</b>{' '}
              {facts.crmContacts.map((contact) => `${contact.name} — ${contact.role.replace(/_/g, ' ')}`).join('; ')}
            </div>
          )}

          {!!history.openQuestions?.length && (
            <div><b>The record raises and does not answer:</b> {history.openQuestions.join('; ')}</div>
          )}
          {!!facts.sources?.length && (
            <div data-testid="awv2-property-history-sources">
              <b>Official sources:</b>
              <ul>
                {facts.sources.slice(0, 10).map((source) => (
                  <li>
                    {source.url
                      ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
                      : source.title}
                    {source.reusedFromStorage ? ' (already retained; nothing was re-fetched)' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facts.search?.note && <div data-testid="awv2-property-history-search-note">{facts.search.note}</div>}
          {!!facts.limitations?.length && <div><b>Limitations:</b> {facts.limitations.join('; ')}</div>}
        </div>
      )}
    </div>
  );
}
