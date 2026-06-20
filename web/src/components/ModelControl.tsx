import { useEffect, useState } from 'preact/hooks';
import { apiGet, apiPost } from '@/lib/api';
import { LandModelPicker, type LandModelEntry } from '@/components/LandModelPicker';

// Point-of-action model control. A picker is a CONTROL, not décor — place this
// only where a model actually runs or is configured (intake run, Run Report,
// Strategy run, the Cost Control config home). It reads the neutral registry +
// the facts-based suggestion, shows the effective model for ITS scope, and sets
// a sticky override (override > suggestion > configured_default). Reuses the
// existing /api/landos/models, /override, /override/reset endpoints.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

interface Suggestion { modelId: string | null; reason: string; availability: string; fallbackModelId: string | null; paidApiRequired: boolean; }
interface PreferenceRow { entity: string; scopeKind: string; scopeKey: string; taskType: string; modelId: string; }
interface ModelsResponse {
  registry: LandModelEntry[];
  suggestions: { task_oriented: Suggestion; reasoning_oriented: Suggestion };
  preferences: PreferenceRow[];
}

interface Props {
  entity?: EntityFilter;
  scopeKind: 'task_type' | 'department' | 'sub_agent';
  scopeKey: string;
  taskType?: string;
  orientation: 'task_oriented' | 'reasoning_oriented';
  /** Small caption rendered before the picker, e.g. "Run Report model". */
  label?: string;
  size?: 'sm' | 'md';
}

export function ModelControl({ entity = 'all', scopeKind, scopeKey, taskType = '', orientation, label, size = 'sm' }: Props) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entityQuery = entity && entity !== 'all' ? `?entity=${entity}` : '';
  const entityBody = entity && entity !== 'all' ? { entity } : {};

  async function load() {
    try {
      setError(null);
      const res = await apiGet<ModelsResponse>(`/api/landos/models${entityQuery}`);
      setData(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }

  useEffect(() => { void load(); }, [entity]);

  const suggestion = data?.suggestions?.[orientation];
  const override = data?.preferences?.find(
    (p) => p.scopeKind === scopeKind && p.scopeKey === scopeKey && (p.taskType || '') === (taskType || ''),
  );
  const value = override?.modelId ?? suggestion?.modelId ?? null;

  async function setOverride(modelId: string) {
    setBusy(true);
    try {
      await apiPost('/api/landos/models/override', { ...entityBody, scopeKind, scopeKey, taskType, modelId });
      await load();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetOverride() {
    setBusy(true);
    try {
      await apiPost('/api/landos/models/override/reset', { ...entityBody, scopeKind, scopeKey, taskType });
      await load();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <span class="text-[10px] text-[var(--color-status-failed)]">model picker: {error}</span>;
  if (!data) return <span class="text-[10px] text-[var(--color-text-faint)]">loading models…</span>;

  return (
    <span class="inline-flex items-center gap-1.5">
      {label && <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>}
      <LandModelPicker
        models={data.registry}
        value={value}
        suggestionId={suggestion?.modelId ?? null}
        reason={suggestion?.reason}
        isOverride={!!override}
        onSelect={(m) => void setOverride(m)}
        onReset={() => void resetOverride()}
        disabled={busy}
        size={size}
      />
    </span>
  );
}
