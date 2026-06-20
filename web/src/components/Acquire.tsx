import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { ModelControl } from '@/components/ModelControl';

// Acquire flow: dashboard intake -> verification waterfall -> Deal Card.
// VERIFIED parcel identity -> create a Deal Card (server re-verifies; the client
// 'verified' flag is never trusted). UNVERIFIED -> "Local Area Context — Not
// Parcel Verified", NO Deal Card. Parcel identity comes ONLY from the bounded
// non-credit LandPortal resolve, never from imagery/coordinates. No fake data:
// missing facts render as honest placeholders, never invented values.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

interface LandScoreFactor { id: string; label: string; maxPoints: number; points: number; dataGap: boolean; basis: string; }
interface LandScore { score: number; maxScore: number; verdict: string; factors: LandScoreFactor[]; dataGaps: string[]; flags: string[]; confidence: string; note: string; }
interface Imagery { label: string; notCaptured: boolean; note: string; description?: { text: string }; }
interface Identity { situsAddress?: string; apn?: string; county?: string; state?: string; owner?: string; }
interface Verification { parcelVerified: boolean; status: string; dataGaps?: string[]; propertyData?: { identity?: Identity; note?: string }; }
interface MarketPulse { eligible: boolean; areaLabel?: string; note?: string; }
interface VerifyResponse { verification: Verification; landScore: LandScore | null; imagery: Imagery | null; marketPulse?: MarketPulse; }
interface CreateResponse { created: boolean; parcelVerified: boolean; dealCardId?: number; landScore?: LandScore | null; ownerNote?: string | null; reason?: string; reportWarnings?: string[]; }

function entityLabel(e: EntityFilter): string {
  if (e === 'LAND_ALLY') return 'Land Ally';
  if (e === 'TY_LAND_BIZ') return 'Solo Biz';
  return 'pick an entity';
}

export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [text, setText] = useState('');
  const [leadName, setLeadName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [created, setCreated] = useState<CreateResponse | null>(null);

  const canCreate = entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ';

  async function verify() {
    if (!text.trim()) return;
    setVerifying(true);
    setError(null);
    setResult(null);
    setCreated(null);
    try {
      const res = await apiPost<VerifyResponse>('/api/landos/intake/duke-verification', { text });
      setResult(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setVerifying(false);
    }
  }

  async function createDealCard() {
    if (!canCreate || !text.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiPost<CreateResponse>('/api/landos/deal-cards/from-verification', { text, entity, leadName: leadName || undefined });
      setCreated(res);
      if (res.created && res.dealCardId && onOpenDealCard) onOpenDealCard(res.dealCardId);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  }

  const v = result?.verification;
  const verified = v?.parcelVerified === true;
  const id = v?.propertyData?.identity;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Acquire — Intake → Verify → Deal Card</div>
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="routing" orientation="task_oriented" label="Intake model" size="sm" />
        </div>
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="Address, APN, owner + county, or free text. Parcel identity is verified from LandPortal — never from imagery or coordinates."
          class="w-full h-20 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <input
            value={leadName}
            onInput={(e) => setLeadName((e.target as HTMLInputElement).value)}
            placeholder="Lead name (optional — owner-mismatch becomes a note)"
            class="flex-1 min-w-[180px] rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-1.5 text-[12px]"
          />
          <button
            type="button"
            onClick={() => void verify()}
            disabled={verifying || !text.trim()}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
          >
            {verifying ? 'Verifying…' : 'Verify parcel'}
          </button>
        </div>
        <div class="text-[10px] text-[var(--color-text-faint)]">
          Tagging entity: <span class="text-[var(--color-text-muted)]">{entityLabel(entity)}</span>. A Deal Card is created only after parcel identity is verified.
        </div>
      </div>

      {error && <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">{error}</div>}

      {result && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
          {/* Verified vs unverified banner */}
          {verified ? (
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)]">Parcel verified</span>
              <span class="text-[12px] text-[var(--color-text)]">{id?.situsAddress || id?.apn || 'verified parcel'}</span>
              <span class="text-[11px] text-[var(--color-text-muted)]">{[id?.county, id?.state].filter(Boolean).join(', ')}</span>
            </div>
          ) : (
            <div class="rounded-md border border-dashed border-[var(--color-border)] p-3">
              <div class="text-[12px] font-medium text-[var(--color-text-muted)]">Local Area Context — Not Parcel Verified</div>
              <div class="text-[11px] text-[var(--color-text-faint)] mt-1">
                No exact parcel identity from the verification waterfall, so NO Deal Card is created. Refine the address/APN, or check the county/city assessor manually.
                {result.marketPulse?.note ? ` ${result.marketPulse.note}` : ''}
              </div>
            </div>
          )}

          {/* Land Score — only from verified attributes */}
          {verified && result.landScore && <LandScorePanel score={result.landScore} />}

          {/* Imagery — supporting context only */}
          {result.imagery && <ImageryPanel imagery={result.imagery} />}

          {/* Create gate */}
          {verified && (
            <div class="flex items-center gap-2 flex-wrap pt-1">
              <button
                type="button"
                onClick={() => void createDealCard()}
                disabled={creating || !canCreate}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
              >
                {creating ? 'Creating…' : 'Create Deal Card'}
              </button>
              {!canCreate && <span class="text-[10px] text-[var(--color-status-failed)]">Pick Land Ally or Solo Biz (not "All entities") to tag the lead.</span>}
              {created?.ownerNote && <span class="text-[10px] text-[var(--color-text-muted)]">{created.ownerNote}</span>}
            </div>
          )}
          {created?.created && (
            <div class="text-[11px] text-[var(--color-accent)]">Deal Card #{created.dealCardId} created and opened.</div>
          )}
        </div>
      )}
    </div>
  );
}

function verdictTone(verdict: string): string {
  if (/pursue/i.test(verdict)) return 'border-[var(--color-accent)] text-[var(--color-accent)]';
  if (/pass/i.test(verdict)) return 'border-[var(--color-status-failed)] text-[var(--color-status-failed)]';
  return 'border-[var(--color-border)] text-[var(--color-text-muted)]';
}

function LandScorePanel({ score }: { score: { score: number; maxScore: number; verdict: string; factors: LandScoreFactor[]; dataGaps: string[]; flags: string[]; confidence: string; note: string } }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] p-3">
      <div class="flex items-center gap-2 flex-wrap mb-2">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Land Score</span>
        <span class="text-[14px] font-semibold tabular-nums">{score.score}<span class="text-[var(--color-text-faint)]">/{score.maxScore}</span></span>
        <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${verdictTone(score.verdict)}`}>{score.verdict}</span>
        <span class="text-[10px] text-[var(--color-text-faint)]">confidence: {score.confidence}</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4">
        {score.factors.map((f) => (
          <div key={f.id} class="flex items-center justify-between gap-2 py-0.5">
            <span class="text-[11px] text-[var(--color-text-muted)]">{f.label}{f.dataGap && <span class="text-[var(--color-status-failed)]"> · data gap</span>}</span>
            <span class="text-[11px] tabular-nums text-[var(--color-text)]">{f.points}/{f.maxPoints}</span>
          </div>
        ))}
      </div>
      {score.flags.length > 0 && (
        <ul class="list-disc pl-4 mt-2 space-y-0.5">
          {score.flags.map((fl) => <li key={fl} class="text-[10px] text-[var(--color-text-faint)]">{fl}</li>)}
        </ul>
      )}
    </div>
  );
}

function ImageryPanel({ imagery }: { imagery: Imagery }) {
  return (
    <div class="rounded-md border border-dashed border-[var(--color-border)] p-3">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Imagery</div>
      <div class="text-[9px] text-[var(--color-text-faint)] mb-1">{imagery.label}</div>
      <div class="text-[12px] text-[var(--color-text-muted)]">
        {imagery.notCaptured ? 'visual not captured yet' : (imagery.description?.text || imagery.note)}
      </div>
    </div>
  );
}
