import path from 'path';
import { describe, expect, it } from 'vitest';

import { resolveLandosStorageProfile } from './storage-profile.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';

describe('LandOS storage profiles', () => {
  const projectRoot = path.resolve('C:/repo');
  const operatingRoot = path.join(projectRoot, 'store');

  it('defaults to the operating database and a private artifact root', () => {
    const p = resolveLandosStorageProfile({}, { projectRoot, operatingRoot });
    expect(p.mode).toBe('operating');
    expect(p.databasePath).toBe(path.join(operatingRoot, 'landos.db'));
    expect(p.artifactRoot).toBe(operatingRoot);
    expect(p.syntheticOnly).toBe(false);
  });

  it('places QA database and artifacts outside the operating store', () => {
    const p = resolveLandosStorageProfile({ LANDOS_STORAGE_MODE: 'qa' }, { projectRoot, operatingRoot });
    expect(p.label).toBe('ISOLATED QA DATA');
    expect(p.databasePath).toContain(path.join('.runtime', 'landos', 'qa-data', 'landos-qa.db'));
    expect(p.databasePath.startsWith(operatingRoot)).toBe(false);
    expect(p.artifactRoot.startsWith(operatingRoot)).toBe(false);
    expect(p.syntheticOnly).toBe(true);
  });

  it('rejects a QA root inside operating storage', () => {
    expect(() => resolveLandosStorageProfile({
      LANDOS_STORAGE_MODE: 'qa',
      LANDOS_QA_ROOT: path.join(operatingRoot, 'qa'),
    }, { projectRoot, operatingRoot })).toThrow(/physically outside/i);
  });

  it('allows only explicit synthetic TEST LEAD records in QA mode', () => {
    const previous = process.env.LANDOS_STORAGE_MODE;
    process.env.LANDOS_STORAGE_MODE = 'qa';
    try {
      _initTestLandosDb();
      expect(() => createDealCard({ entity: 'LAND_ALLY', title: 'real', leadType: 'actual' })).toThrow(/synthetic TEST LEAD/i);
      expect(createDealCard({ entity: 'LAND_ALLY', title: 'synthetic', leadType: 'test' }).id).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.LANDOS_STORAGE_MODE;
      else process.env.LANDOS_STORAGE_MODE = previous;
    }
  });
});
