// Evaluator-owned probe: the access evidence ladder.
//
// LandPortal flags 9490 Elk Lake Rd "Land Locked: Yes" because the parcel does
// not directly front a recognized named road. That is a PARCEL FLAG. It is not
// proof the property has no physical or legal access, and it must never become
// the final conclusion by itself.
//
// Four evidence types stay separate, each with provenance and weight:
//   parcel_flag        what LandPortal's parcel record states
//   apparent_physical  what satellite / Street View imagery visibly shows
//   reported_legal     what a listing or other secondary source REPORTS
//   verified_legal     a recorded instrument actually read
//
// A visible gravel drive never proves a recorded easement. A listing sentence
// never becomes a recorded easement. Nothing collapses into a yes/no field and
// nothing overwrites anything else.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const url = (rel) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);

const script = `
import {
  accessInvestigationTrigger,
  reconcileAccessEvidence,
  type AccessEvidenceItem,
} from ${url('src/landos/access-evidence-ladder.ts')};

function fail(reason: string): never { console.log('PROBE_FAIL: ' + reason); process.exit(1); }
function ok(cond: unknown, reason: string) { if (!cond) fail(reason); }

// ── 1. Land Locked: Yes TRIGGERS investigation, it does not end analysis ─────
const flagged = accessInvestigationTrigger({ landlockedStatus: 'Yes', roadFrontageFt: null, setbackFromRoad: true });
ok(flagged.triggered === true, 'a LandPortal "Land Locked: Yes" flag must TRIGGER visual access investigation, got triggered=' + String(flagged.triggered));
ok(Array.isArray(flagged.reasons) && flagged.reasons.length >= 1, 'the trigger must state why investigation is required');
const steps = (flagged.requiredSteps ?? []).join(' | ').toLowerCase();
ok(/satellite|aerial|map/.test(steps), 'requiredSteps must include inspecting the LandPortal satellite/map view, got ' + JSON.stringify(flagged.requiredSteps));
ok(/street ?view/.test(steps), 'requiredSteps must include a LandPortal Street View pass, got ' + JSON.stringify(flagged.requiredSteps));

ok(accessInvestigationTrigger({ landlockedStatus: 'Yes' }).triggered === true, 'the landlocked flag alone must trigger investigation');
ok(accessInvestigationTrigger({ roadFrontageFt: 0 }).triggered === true, 'zero road frontage must trigger investigation');
ok(accessInvestigationTrigger({ setbackFromRoad: true }).triggered === true, 'a parcel set back from the road must trigger investigation');
const clear = accessInvestigationTrigger({ landlockedStatus: 'No', roadFrontageFt: 420, setbackFromRoad: false });
ok(clear.triggered === false, 'a parcel with mapped frontage and no landlocked flag must NOT force an access investigation, got triggered=' + String(clear.triggered));

// ── 2. The parcel flag ALONE never concludes "no access" ─────────────────────
const parcelFlag: AccessEvidenceItem = {
  tier: 'parcel_flag',
  statement: 'LandPortal flags the parcel as land locked: it does not directly front a recognized named road.',
  sourceLabel: 'LandPortal parcel page',
  sourceKind: 'landportal_parcel_flag',
  basis: 'source_stated',
  weight: 'confirmed',
  sourceUrl: 'https://landportal.com/?property=subject',
  observedAt: '2026-08-10T12:00:00Z',
};

const flagOnly = reconcileAccessEvidence([parcelFlag]);
ok(flagOnly.parcelFlagged === true, 'reconcile must record the parcel flag');
ok(flagOnly.apparentPhysicalAccess === false, 'no imagery evidence was supplied, so apparentPhysicalAccess must be false');
ok(flagOnly.reportedLegalAccess === false, 'no listing evidence was supplied, so reportedLegalAccess must be false');
ok(flagOnly.verifiedLegalAccess === false, 'no recorded instrument was supplied, so verifiedLegalAccess must be false');
ok(typeof flagOnly.operatorConclusion === 'string' && flagOnly.operatorConclusion.trim().length >= 60,
  'operatorConclusion must be an operator-readable multi-clause statement, got ' + JSON.stringify(flagOnly.operatorConclusion));
const flagText = flagOnly.operatorConclusion.toLowerCase();
ok(!/\\bhas no (?:legal |physical )?access\\b|\\bno access\\b|\\bis landlocked\\.\\s*$/.test(flagText),
  'a parcel flag alone must NEVER conclude the property has no access; conclusion was ' + JSON.stringify(flagOnly.operatorConclusion));
ok(/not directly front|does not front|recognized named road|named road/.test(flagText),
  'the conclusion must say WHY LandPortal flagged it (no direct frontage on a recognized named road), got ' + JSON.stringify(flagOnly.operatorConclusion));
ok(Array.isArray(flagOnly.outstanding) && flagOnly.outstanding.length >= 1, 'outstanding diligence must be listed while access is unproven');
ok(flagOnly.conclusionWeight !== 'confirmed', 'a parcel-flag-only conclusion cannot carry Confirmed weight, got ' + String(flagOnly.conclusionWeight));

// ── 3. Apparent physical access is added, never substituted ─────────────────
const satellite: AccessEvidenceItem = {
  tier: 'apparent_physical',
  statement: 'Satellite view shows an apparent gray gravel drive running from Elk Lake Rd back toward the subject parcel.',
  sourceLabel: 'LandPortal satellite view',
  sourceKind: 'satellite_imagery',
  basis: 'direct_observation',
  weight: 'well_supported',
  observedAt: '2026-08-10T12:05:00Z',
};
const streetView: AccessEvidenceItem = {
  tier: 'apparent_physical',
  statement: 'Street View from Elk Lake Rd shows an apparent gravel driveway entrance at the parcel frontage.',
  sourceLabel: 'LandPortal Street View',
  sourceKind: 'street_view',
  basis: 'direct_observation',
  weight: 'well_supported',
  observedAt: '2026-08-10T12:09:00Z',
};

const withVisual = reconcileAccessEvidence([parcelFlag, satellite, streetView]);
ok(withVisual.items.length === 3, 'every supplied evidence item must be RETAINED, never collapsed; got ' + withVisual.items.length + ' of 3');
ok(withVisual.items.some((item) => item.sourceKind === 'landportal_parcel_flag'), 'the LandPortal parcel flag must survive alongside the imagery evidence, not be overwritten by it');
ok(withVisual.parcelFlagged === true, 'the parcel flag remains true after imagery evidence arrives');
ok(withVisual.apparentPhysicalAccess === true, 'a directly observed gravel drive must set apparentPhysicalAccess');
ok(withVisual.reportedLegalAccess === false, 'a visible driveway is NOT reported legal access');
ok(withVisual.verifiedLegalAccess === false, 'a visible driveway must NEVER prove a recorded easement');
const visualText = withVisual.operatorConclusion.toLowerCase();
ok(/apparent/.test(visualText), 'the conclusion must describe the drive as APPARENT, got ' + JSON.stringify(withVisual.operatorConclusion));
ok(!/recorded easement (?:is )?(?:confirmed|verified|established)|legal access (?:is )?(?:confirmed|verified|established|proven)/.test(visualText),
  'apparent physical access must never be stated as confirmed legal access; conclusion was ' + JSON.stringify(withVisual.operatorConclusion));
ok(withVisual.outstanding.some((entry) => /recorded|easement|instrument|deed/i.test(entry)),
  'recorded easement documentation must remain an outstanding diligence item, got ' + JSON.stringify(withVisual.outstanding));
ok((withVisual.byTier?.apparent_physical ?? []).length === 2, 'byTier must group both imagery observations under apparent_physical');

// ── 4. A listing statement is REPORTED legal access, nothing more ───────────
const listing: AccessEvidenceItem = {
  tier: 'reported_legal',
  statement: 'Prior MLS listing remarks state the property has legal easement access from Elk Lake Rd.',
  sourceLabel: 'Prior MLS listing (Zillow mirror)',
  sourceKind: 'listing',
  basis: 'source_stated',
  weight: 'likely',
  sourceUrl: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd/',
  observedAt: '2026-08-10T12:20:00Z',
};
const withListing = reconcileAccessEvidence([parcelFlag, satellite, streetView, listing]);
ok(withListing.items.length === 4, 'all four evidence items must be retained');
ok(withListing.reportedLegalAccess === true, 'a listing statement must set reportedLegalAccess');
ok(withListing.verifiedLegalAccess === false, 'a listing statement must NEVER set verifiedLegalAccess');
const listingText = withListing.operatorConclusion.toLowerCase();
ok(/report|listing/.test(listingText), 'the conclusion must attribute the easement claim to reported listing evidence, got ' + JSON.stringify(withListing.operatorConclusion));
ok(withListing.outstanding.some((entry) => /recorded|easement|instrument|deed/i.test(entry)),
  'recorded easement verification stays outstanding even with a listing statement, got ' + JSON.stringify(withListing.outstanding));

// The conclusion must name every distinct evidence type that is present.
for (const [needle, why] of [
  ['land lock', 'the LandPortal parcel flag'],
  ['satellite', 'the satellite observation'],
  ['street view', 'the Street View observation'],
] as Array<[string, string]>) {
  ok(listingText.includes(needle), 'the operator conclusion must mention ' + why + ' (looking for "' + needle + '"), got ' + JSON.stringify(withListing.operatorConclusion));
}

// ── 5. Only a recorded instrument can verify legal access ───────────────────
const fakeVerified: AccessEvidenceItem = {
  tier: 'verified_legal',
  statement: 'The drive looks like it has been there for years, so there must be an easement.',
  sourceLabel: 'LandPortal Street View',
  sourceKind: 'street_view',
  basis: 'reasonable_interpretation',
  weight: 'likely',
};
const bogus = reconcileAccessEvidence([parcelFlag, fakeVerified]);
ok(bogus.verifiedLegalAccess === false,
  'verifiedLegalAccess must require basis "recorded_instrument"; an interpretation of imagery can never verify legal access');
ok(bogus.items.length === 2, 'the unsupported claim is still retained as evidence with its weight, not silently deleted');

const recorded: AccessEvidenceItem = {
  tier: 'verified_legal',
  statement: 'Recorded ingress/egress easement, Grand Traverse County Liber 1234 Page 567, benefiting the subject parcel.',
  sourceLabel: 'Grand Traverse County Register of Deeds',
  sourceKind: 'official_record',
  basis: 'recorded_instrument',
  weight: 'confirmed',
};
const verified = reconcileAccessEvidence([parcelFlag, satellite, streetView, listing, recorded]);
ok(verified.verifiedLegalAccess === true, 'a read recorded instrument must set verifiedLegalAccess');
ok(!verified.outstanding.some((entry) => /recorded easement (?:documentation|verification)/i.test(entry)),
  'once a recorded instrument is read, recorded-easement verification must leave the outstanding list, got ' + JSON.stringify(verified.outstanding));
ok(verified.items.length === 5, 'every earlier evidence type must still be retained after verification');
ok(verified.conclusionWeight === 'confirmed', 'a conclusion carried by a recorded instrument may reach Confirmed weight, got ' + String(verified.conclusionWeight));

// ── 6. Nothing collapses to a yes/no ────────────────────────────────────────
ok(!('legalAccess' in (verified as unknown as Record<string, unknown>)) || typeof (verified as unknown as Record<string, unknown>).legalAccess !== 'boolean',
  'the reconciliation must not expose a single collapsed boolean legalAccess field');
ok(Object.keys(verified.byTier ?? {}).length >= 4, 'byTier must expose all four evidence tiers separately');

console.log('PROBE_OK access evidence ladder');
`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'landos-probe-'));
const file = path.join(dir, 'probe.mts');
writeFileSync(file, script, 'utf8');

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const run = spawnSync(process.execPath, [tsx, file], { cwd: root, encoding: 'utf8', timeout: 240000 });
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
process.stdout.write(out);
if (run.status !== 0 && !out.includes('PROBE_FAIL')) {
  console.log(`PROBE_FAIL: access evidence ladder probe could not run (exit ${run.status}): ${String(run.stderr ?? run.error ?? '').slice(0, 700)}`);
}
process.exit(run.status === 0 ? 0 : 1);
