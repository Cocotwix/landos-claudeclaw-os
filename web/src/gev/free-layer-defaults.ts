/**
 * God's Eye View free-layer default activation + one-time state migration.
 *
 * Operator requirement: every genuinely free/keyless layer is ON by default —
 * the toolbox is immediately useful when opened. Registration or provider
 * availability is NOT operator availability; the live Data Layers panel must
 * actually show ON.
 *
 * Migration semantics:
 *  - FIRST RUN or PRE-UPGRADE persisted state (marker absent): every eligible
 *    free/keyless layer is enabled ONCE, committed durably through the
 *    upstream layer-state coordinator (origin 'tool' is an explicit commit,
 *    identical in weight to clicking the rows).
 *  - AFTER the marker exists: the operator's manual choices win. A layer
 *    Tyler switches OFF stays OFF on every later visit — nothing re-forces it.
 *
 * Deliberately NOT in this list:
 *  - 'local-firms' and 'ais-live-vessels' — FREE but credential-required;
 *    they stay in their honest KEY-REQUIRED / setup states until the free key
 *    exists, not in an ordinary OFF that implies operator choice.
 */

export const FREE_DEFAULT_LAYER_IDS: readonly string[] = Object.freeze([
  'bikeshare',
  'cctv',
  'earthquakes',
  'flights',
  'local-dams',
  'local-datacenters',
  'military',
  'military-awareness',
  'military-installations',
  'radio', // station points only; audio remains click-to-play
  'rocket-launches',
  'satellites',
  'traffic',
]);

export const FREE_DEFAULTS_MARKER_KEY = 'landos.gev.freeLayerDefaults';
export const FREE_DEFAULTS_VERSION = 'v1';

interface DataManagerLike {
  layers?: Map<string, unknown>;
  setEnabled?: (id: string, enabled: boolean, opts?: { origin?: string }) => Promise<unknown>;
}

/**
 * Apply the one-time migration against a live data manager. Returns the ids
 * actually enabled this call ([] when the marker already exists).
 * The marker is written BEFORE enabling so a manual OFF during or after the
 * sweep is never re-forced by a later visit.
 */
export async function applyFreeLayerDefaults(
  dataManager: DataManagerLike | null | undefined,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<string[]> {
  if (!storage || !dataManager?.layers || typeof dataManager.setEnabled !== 'function') return [];
  try {
    if (storage.getItem(FREE_DEFAULTS_MARKER_KEY) === FREE_DEFAULTS_VERSION) return [];
    storage.setItem(FREE_DEFAULTS_MARKER_KEY, FREE_DEFAULTS_VERSION);
  } catch {
    return []; // storage blocked — do not loop-force defaults every visit
  }
  const enabled: string[] = [];
  for (const id of FREE_DEFAULT_LAYER_IDS) {
    if (!dataManager.layers.has(id)) continue;
    try {
      await dataManager.setEnabled(id, true, { origin: 'tool' });
      enabled.push(id);
    } catch {
      // A layer that cannot start degrades honestly; the rest still enable.
    }
  }
  return enabled;
}
