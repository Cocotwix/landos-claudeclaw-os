// Sticky model-preference persistence + resolution. Proves the override round-
// trips through the LandOS DB and that resolution honors the approved order.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb, setModelPreference, getModelPreferences, resetModelPreference } from './db.js';
import { resolveModel, type ModelResolutionContext } from './model-providers.js';

beforeEach(() => {
  _initTestLandosDb();
});

const ctx = (over: Partial<ModelResolutionContext> = {}): ModelResolutionContext => ({
  entity: 'LAND_ALLY',
  subAgent: 'duke',
  department: 'research_due_diligence',
  taskType: 'parcel_verification',
  orientation: 'reasoning_oriented',
  ...over,
});

describe('sticky model preference persistence', () => {
  it('sets and reads back an override from a fresh query', () => {
    setModelPreference({ entity: 'LAND_ALLY', scopeKind: 'sub_agent', scopeKey: 'duke', modelId: 'gpt' });
    const prefs = getModelPreferences('LAND_ALLY');
    expect(prefs).toHaveLength(1);
    expect(prefs[0]).toMatchObject({ scopeKind: 'sub_agent', scopeKey: 'duke', modelId: 'gpt', taskType: '' });
  });

  it('upserts (re-setting the same scope updates the model, no duplicate row)', () => {
    setModelPreference({ scopeKind: 'department', scopeKey: 'strategy', modelId: 'claude' });
    setModelPreference({ scopeKind: 'department', scopeKey: 'strategy', modelId: 'gpt' });
    const prefs = getModelPreferences();
    expect(prefs).toHaveLength(1);
    expect(prefs[0].modelId).toBe('gpt');
  });

  it('cross-entity ("") and entity-specific overrides both apply for that entity', () => {
    setModelPreference({ entity: '', scopeKind: 'task_type', scopeKey: 'parcel_verification', modelId: 'gemma-4-e4b' });
    setModelPreference({ entity: 'LAND_ALLY', scopeKind: 'task_type', scopeKey: 'parcel_verification', modelId: 'claude' });
    expect(getModelPreferences('LAND_ALLY')).toHaveLength(2);
    expect(getModelPreferences('TY_LAND_BIZ')).toHaveLength(1); // only the cross-entity one
  });

  it('resolveModel uses a persisted override, then resets back to the suggestion', () => {
    setModelPreference({ entity: 'LAND_ALLY', scopeKind: 'sub_agent', scopeKey: 'duke', modelId: 'gpt' });
    const withOverride = resolveModel(getModelPreferences('LAND_ALLY'), ctx());
    expect(withOverride.source).toBe('override');
    expect(withOverride.modelId).toBe('gpt');

    const removed = resetModelPreference({ entity: 'LAND_ALLY', scopeKind: 'sub_agent', scopeKey: 'duke' });
    expect(removed).toBe(true);

    const afterReset = resolveModel(getModelPreferences('LAND_ALLY'), ctx());
    expect(afterReset.source).toBe('suggestion');
  });

  it('reset reports false when there was nothing to remove', () => {
    expect(resetModelPreference({ scopeKind: 'department', scopeKey: 'nope' })).toBe(false);
  });
});
