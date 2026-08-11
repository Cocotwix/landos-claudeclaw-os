#!/usr/bin/env tsx
// Initialize the physically isolated synthetic QA store. This process never
// opens store/landos.db because the mode is set before LandOS modules load.
process.env.LANDOS_STORAGE_MODE = 'qa';

const { getLandosStorageProfile } = await import('../../src/landos/storage-profile.js');
const { getLandosDb } = await import('../../src/landos/db.js');

const profile = getLandosStorageProfile();
if (profile.mode !== 'qa' || !profile.syntheticOnly) throw new Error('refusing to initialize a non-QA storage profile');
const db = getLandosDb();
const opportunities = db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as { n: number };
process.stdout.write(`${JSON.stringify({ mode: profile.mode, label: profile.label, databasePath: profile.databasePath, artifactRoot: profile.artifactRoot, opportunityCount: opportunities.n })}\n`);

