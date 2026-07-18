import path from 'path';

import { PROJECT_ROOT, STORE_DIR } from '../config.js';

export type LandosStorageMode = 'operating' | 'qa';

export interface LandosStorageProfile {
  mode: LandosStorageMode;
  label: 'OPERATING DATA' | 'ISOLATED QA DATA';
  root: string;
  databasePath: string;
  artifactRoot: string;
  syntheticOnly: boolean;
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * LandOS business storage is deliberately independent from the generic app
 * store override. QA may only use the dedicated runtime root and can never be
 * redirected into the operating store.
 */
export function resolveLandosStorageProfile(
  env: NodeJS.ProcessEnv = process.env,
  opts: { projectRoot?: string; operatingRoot?: string } = {},
): LandosStorageProfile {
  const projectRoot = path.resolve(opts.projectRoot ?? PROJECT_ROOT);
  const operatingRoot = path.resolve(opts.operatingRoot ?? STORE_DIR);
  const mode: LandosStorageMode = env.LANDOS_STORAGE_MODE === 'qa' ? 'qa' : 'operating';
  const requestedQaRoot = env.LANDOS_QA_ROOT?.trim();
  const qaRoot = path.resolve(requestedQaRoot || path.join(projectRoot, '.runtime', 'landos', 'qa-data'));

  if (mode === 'qa' && inside(operatingRoot, qaRoot)) {
    throw new Error('LANDOS_QA_ROOT must be physically outside the operating LandOS store');
  }

  const root = mode === 'qa' ? qaRoot : operatingRoot;
  return {
    mode,
    label: mode === 'qa' ? 'ISOLATED QA DATA' : 'OPERATING DATA',
    root,
    databasePath: path.join(root, mode === 'qa' ? 'landos-qa.db' : 'landos.db'),
    // Keep the established operating layout intact. QA gets a namespaced root
    // because it has no legacy artifacts to preserve.
    artifactRoot: mode === 'qa' ? path.join(root, 'artifacts') : root,
    syntheticOnly: mode === 'qa',
  };
}

export function getLandosStorageProfile(): LandosStorageProfile {
  return resolveLandosStorageProfile();
}

export function landosArtifactPath(...segments: string[]): string {
  return path.join(getLandosStorageProfile().artifactRoot, ...segments);
}
