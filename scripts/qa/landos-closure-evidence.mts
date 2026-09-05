#!/usr/bin/env tsx
// Read-only acceptance evidence reader for the operational closure.
//
//   npx tsx scripts/qa/landos-closure-evidence.mts <section> [dealCardId]
//
// Sections: valuation | comps | providers | landhome | zillow | redfin
//           | realtor | dealbrain | landwatch | family
//
// GETs the live operator application and reads store/landos.db read-only.
// It writes nothing, runs no research, and never prints a credential.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { readEnvFile } from '../../src/env.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const section = process.argv[2] ?? 'valuation';
const dealCardId = Number(process.argv[3] ?? 90);

const previousCwd = process.cwd();
process.chdir(ROOT);
let token = '';
try { token = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; } finally { process.chdir(previousCwd); }

const db = new Database(path.join(ROOT, 'store', 'landos.db'), { readonly: true, fileMustExist: true });

async function api<T>(apiPath: string): Promise<T> {
  const url = new URL(apiPath, 'http://localhost:3141');
  url.searchParams.set('token', token);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${url.pathname} -> ${res.status}`);
  return await res.json() as T;
}

const money = (n: number | null | undefined) => (n == null ? 'null' : `$${n.toLocaleString('en-US')}`);
const pad = (s: unknown, n: number) => String(s ?? '').slice(0, n).padEnd(n);

async function valuation(): Promise<void> {
  const body = await api<any>(`/api/landos/deal-cards/${dealCardId}/comps-valuation`);
  const cv = body.compsValuation;
  const pkg = cv.valuationPackage;
  console.log('=== LANE VIEWS ===');
  console.log(`LandPortal FMV    : ${money(pkg.landPortalFmv.value)}  compCount=${pkg.landPortalFmv.compCount}  conf=${pkg.landPortalFmv.confidence}`);
  console.log(`  source          : ${pkg.landPortalFmv.source}`);
  console.log(`  limitation      : ${pkg.landPortalFmv.limitation ?? 'none'}`);
  console.log(`Non-LandPortal FMV: ${money(pkg.nonLandPortalFmv.value)}  compCount=${pkg.nonLandPortalFmv.compCount}  conf=${pkg.nonLandPortalFmv.confidence}`);
  console.log(`  method          : ${pkg.nonLandPortalFmv.method}`);
  console.log(`  sources         : ${(pkg.nonLandPortalFmv.sources ?? []).join(', ')}`);
  console.log(`  limitation      : ${pkg.nonLandPortalFmv.limitation ?? 'none'}`);
  console.log(`Combined LandOS   : ${money(pkg.combinedFmv.value)}  method=${pkg.combinedFmv.method}  conf=${pkg.combinedFmv.confidence}`);
  console.log(`  calculation     : ${pkg.combinedFmv.calculation}`);
  console.log(`  40% / 60%       : ${money(pkg.offer40)} / ${money(pkg.offer60)}   offer50 present=${Object.prototype.hasOwnProperty.call(pkg, 'offer50')}`);
  console.log(`  provenance      : ${JSON.stringify(pkg.provenance)}`);
  console.log();
  console.log('=== CLEANED NON-LANDPORTAL RECONCILIATION ===');
  console.log(JSON.stringify(cv.cleaned, null, 1).slice(0, 1500));
}

async function comps(): Promise<void> {
  const body = await api<any>(`/api/landos/deal-cards/${dealCardId}/comps-valuation`);
  const cv = body.compsValuation;
  const pkg = cv.valuationPackage;
  const nonLpKeys = new Set<string>(pkg.nonLandPortalFmv.compKeys ?? []);
  const lpKeys = new Set<string>(pkg.landPortalFmv.compKeys ?? []);
  console.log(`total workspace comps: ${cv.comps.length}`);
  console.log(`counts: ${JSON.stringify(cv.counts)}`);
  console.log(`canonicalCompCount=${cv.canonicalCompCount} duplicatesMerged=${cv.duplicatesMerged}`);
  console.log();
  console.log('=== SELECTED NON-LANDPORTAL CLOSED SALES (these produce the Non-LandPortal FMV) ===');
  console.log(`${pad('address', 44)} ${pad('price', 10)} ${pad('acres', 7)} ${pad('$/ac', 10)} ${pad('date', 11)} ${pad('mi', 5)} origins`);
  let n = 0;
  for (const c of cv.comps) {
    if (!nonLpKeys.has(c.key)) continue;
    n += 1;
    console.log(`${pad(c.address, 44)} ${pad(money(c.price), 10)} ${pad(c.acres, 7)} ${pad(money(c.pricePerAcre), 10)} ${pad(c.dateIso, 11)} ${pad(c.distanceMiles, 5)} ${(c.origins ?? []).join('+')}`);
  }
  console.log(`selected non-LandPortal closed sales: ${n}`);
  console.log();
  console.log('=== EVERY CLOSED SALE IN THE VALUATION SET (any lane) ===');
  for (const c of cv.comps) {
    if (!c.inValuationSet) continue;
    console.log(`  [${c.category}] ${pad(c.address, 40)} ${pad(money(c.price), 10)} ${pad(c.acres, 6)} ${pad(c.dateIso, 11)} lp=${lpKeys.has(c.key)} nonlp=${nonLpKeys.has(c.key)} origins=${(c.origins ?? []).join('+')}`);
  }
  console.log();
  console.log('=== ACTIVE COMPETITION ===');
  console.log(`count=${pkg.activeCompetition.count}  summary=${pkg.activeCompetition.summary}`);
  for (const c of cv.comps) {
    if (c.category !== 'active_competition') continue;
    console.log(`  ${pad(c.address, 44)} ${pad(money(c.price), 10)} ${pad(c.acres, 7)} dom=${c.daysOnMarket ?? '-'} origins=${(c.origins ?? []).join('+')}`);
  }
}

function providers(): void {
  console.log('=== PROVIDER LANE ATTEMPTS (landos_property_research_lane_attempt) ===');
  const rows = db.prepare(`
    SELECT lane_id, provider_id, status, COUNT(*) n, MAX(completed_at) last_at,
           MAX(duration_ms) max_ms, SUBSTR(MAX(COALESCE(failure_reason,'')),1,120) reason
      FROM landos_property_research_lane_attempt
     WHERE deal_card_id IN (SELECT id FROM landos_deal_card WHERE id=? OR canonical_deal_card_id=?)
     GROUP BY lane_id, provider_id, status
     ORDER BY lane_id, provider_id, status
  `).all(dealCardId, dealCardId) as any[];
  console.log(`${pad('lane', 30)} ${pad('provider', 22)} ${pad('status', 14)} ${pad('n', 4)} ${pad('maxMs', 9)} last`);
  for (const r of rows) {
    console.log(`${pad(r.lane_id, 30)} ${pad(r.provider_id, 22)} ${pad(r.status, 14)} ${pad(r.n, 4)} ${pad(r.max_ms, 9)} ${r.last_at}`);
    if (r.reason) console.log(`    reason: ${r.reason}`);
  }
  console.log();
  console.log('=== ALL DISTINCT TERMINAL STATES IN USE (whole DB) ===');
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM landos_property_research_lane_attempt GROUP BY status ORDER BY n DESC').all() as any[]) {
    console.log(`  ${pad(r.status, 20)} ${r.n}`);
  }
}

async function landhome(): Promise<void> {
  const body = await api<any>(`/api/landos/deal-cards/${dealCardId}/comps-valuation`);
  const lhp = body.compsValuation.valuationPackage.landHomePackage;
  console.log('=== LAND HOME PACKAGE SCREEN ===');
  console.log(JSON.stringify(lhp, null, 1));
}

function zillow(): void {
  console.log('=== ZILLOW / MARKETPLACE LANE ATTEMPTS (all deals) ===');
  const rows = db.prepare(`
    SELECT deal_card_id, lane_id, provider_id, status, started_at, completed_at, duration_ms,
           SUBSTR(COALESCE(failure_reason,''),1,160) reason
      FROM landos_property_research_lane_attempt
     WHERE lane_id LIKE '%zillow%' OR provider_id LIKE '%zillow%'
     ORDER BY completed_at DESC LIMIT 40
  `).all() as any[];
  if (!rows.length) console.log('  (no zillow lane attempts retained)');
  for (const r of rows) {
    console.log(`  deal ${pad(r.deal_card_id, 5)} ${pad(r.lane_id, 26)} ${pad(r.status, 13)} ${pad(r.duration_ms, 8)}ms ${r.completed_at}`);
    if (r.reason) console.log(`      ${r.reason}`);
  }
  console.log();
  console.log('=== ZILLOW-ORIGIN COMPS RETAINED ===');
  for (const r of db.prepare(`
    SELECT deal_card_id, COUNT(*) n, SUM(CASE WHEN price_kind='sale' THEN 1 ELSE 0 END) sold,
           SUM(CASE WHEN price_kind='list' THEN 1 ELSE 0 END) active
      FROM landos_comp WHERE LOWER(COALESCE(source_label,'')||COALESCE(canonical_source,'')||COALESCE(source_url,'')) LIKE '%zillow%'
     GROUP BY deal_card_id ORDER BY n DESC LIMIT 15
  `).all() as any[]) {
    console.log(`  deal ${pad(r.deal_card_id, 5)} total=${pad(r.n, 5)} sold=${pad(r.sold, 5)} active=${r.active}`);
  }
}

function redfin(): void {
  console.log('=== REDFIN COMPS AND COORDINATE ENRICHMENT (this deal family) ===');
  const rows = db.prepare(`
    SELECT id, address_desc AS address, price, acres, price_kind, classification, status,
           sale_or_list_date AS sale_date, distance_miles,
           lat, lng, geo_lat, geo_lng, geo_precision, geo_source, geo_tier, geo_resolved_at,
           valuation_selected, canonical_source, source_label AS source, source_url
      FROM landos_comp
     WHERE deal_card_id IN (SELECT id FROM landos_deal_card WHERE id=? OR canonical_deal_card_id=?)
       AND LOWER(COALESCE(source_label,'')||' '||COALESCE(canonical_source,'')||' '||COALESCE(source_url,'')) LIKE '%redfin%'
     ORDER BY price_kind, sale_date DESC
  `).all(dealCardId, dealCardId) as any[];
  console.log(`redfin comps retained: ${rows.length}`);
  for (const r of rows) {
    const coord = r.geo_lat ?? r.lat, coordLng = r.geo_lng ?? r.lng;
    console.log(`  #${pad(r.id, 6)} ${pad(r.address, 42)} ${pad(money(r.price), 10)} ${pad(r.acres, 6)} ${pad(r.price_kind, 5)} ${pad(r.sale_date, 11)}`);
    console.log(`         coords=${coord ?? 'NONE'},${coordLng ?? 'NONE'} precision=${r.geo_precision ?? '-'} source=${r.geo_source ?? '-'} tier=${r.geo_tier ?? '-'} resolvedAt=${r.geo_resolved_at ?? '-'}`);
    console.log(`         dist=${r.distance_miles ?? '-'}mi selected=${r.valuation_selected} class=${r.classification ?? '-'} status=${r.status}`);
  }
}

function realtor(): void {
  console.log('=== REALTOR.COM LANE ATTEMPTS ===');
  const rows = db.prepare(`
    SELECT deal_card_id, lane_id, provider_id, status, duration_ms, completed_at,
           SUBSTR(COALESCE(failure_reason,''),1,200) reason
      FROM landos_property_research_lane_attempt
     WHERE lane_id LIKE '%realtor%' OR provider_id LIKE '%realtor%'
     ORDER BY completed_at DESC LIMIT 30
  `).all() as any[];
  if (!rows.length) console.log('  (no realtor lane attempts retained)');
  for (const r of rows) {
    console.log(`  deal ${pad(r.deal_card_id, 5)} ${pad(r.status, 13)} ${pad(r.duration_ms, 8)}ms ${r.completed_at}`);
    if (r.reason) console.log(`      ${r.reason}`);
  }
}

function dealbrain(): void {
  console.log('=== DEAL BRAIN DECISIONS (canonical family) ===');
  const rows = db.prepare(`
    SELECT id, deal_card_id, snapshot_type, version, status, input_hash, change_reason, created_at
      FROM landos_deal_intelligence_snapshot
     WHERE deal_card_id IN (SELECT id FROM landos_deal_card WHERE id=? OR canonical_deal_card_id=?)
       AND snapshot_type LIKE '%deal_brain%'
     ORDER BY created_at DESC LIMIT 20
  `).all(dealCardId, dealCardId) as any[];
  console.log(`deal brain snapshots: ${rows.length}`);
  for (const r of rows) {
    console.log(`  #${pad(r.id, 6)} deal ${pad(r.deal_card_id, 5)} v${pad(r.version, 7)} ${pad(r.status, 11)} hash=${String(r.input_hash).slice(0, 16)} ${new Date(r.created_at * 1000).toISOString()}`);
    console.log(`         ${String(r.change_reason ?? '').slice(0, 150)}`);
  }
}

async function landwatch(): Promise<void> {
  for (const id of [dealCardId, 89]) {
    const body = await api<any>(`/api/landos/deal-cards/${id}/comps-valuation`);
    const pkg = body.compsValuation?.valuationPackage;
    console.log(`=== DEAL ${id} ===`);
    if (!pkg) { console.log('  no valuation package'); continue; }
    console.log(`  subject acres      : ${pkg.provenance?.subjectAcres}`);
    console.log(`  landWatch          : ${JSON.stringify(pkg.landWatch)}`);
    console.log(`  combined FMV       : ${money(pkg.combinedFmv.value)} (${pkg.combinedFmv.method}, ${pkg.combinedFmv.confidence})`);
    console.log(`  40 / 60            : ${money(pkg.offer40)} / ${money(pkg.offer60)}`);
    console.log(`  landHome triggered : ${pkg.landHomePackage?.triggered} physical=${pkg.landHomePackage?.physical?.met} market=${pkg.landHomePackage?.market?.met}`);
  }
}

function family(): void {
  console.log('=== CANONICAL FAMILY ===');
  for (const r of db.prepare('SELECT id,title,canonical_deal_card_id,archived_as_duplicate_at,subject_key,subject_key_basis FROM landos_deal_card WHERE id IN (89,90,114,115) ORDER BY id').all() as any[]) {
    console.log(`  deal ${pad(r.id, 5)} canonical=${pad(r.canonical_deal_card_id ?? 'SELF', 6)} key=${pad(r.subject_key || '(none)', 40)} ${r.title}`);
  }
  console.log();
  console.log('=== CURRENT IDENTITY PER CARD ===');
  for (const r of db.prepare('SELECT deal_card_id,version,status,apn,acreage,confidence,SUBSTR(basis,1,110) basis FROM landos_property_identity_version WHERE deal_card_id IN (89,90,114,115) AND is_current=1 ORDER BY deal_card_id').all() as any[]) {
    console.log(`  deal ${pad(r.deal_card_id, 5)} v${pad(r.version, 4)} ${pad(r.status, 11)} apn=${pad(r.apn, 18)} acres=${pad(r.acreage, 8)} conf=${r.confidence}`);
    console.log(`         ${r.basis}`);
  }
  console.log();
  console.log('=== EVIDENCE REACHABLE FROM THE FAMILY vs DEAL 90 ALONE ===');
  const fam = db.prepare("SELECT COUNT(*) n FROM landos_property_evidence_item WHERE deal_card_id IN (90,114,115)").get() as any;
  const own = db.prepare("SELECT COUNT(*) n FROM landos_property_evidence_item WHERE deal_card_id = 90").get() as any;
  console.log(`  family total evidence rows : ${fam.n}`);
  console.log(`  deal 90 own evidence rows  : ${own.n}`);
  console.log(`  alias-owned (reachable)    : ${fam.n - own.n}`);
}

async function reconcile(): Promise<void> {
  // Deal 115 is the archived alias whose research produced the accepted
  // package; Deal 90 is the canonical card. Every acceptance-bearing field the
  // operator reads must now be identical on the canonical card.
  const [canonical, alias] = await Promise.all([
    api<any>('/api/landos/deal-cards/90/comps-valuation'),
    api<any>('/api/landos/deal-cards/115/comps-valuation'),
  ]);
  const pick = (b: any) => {
    const cv = b.compsValuation; const pkg = cv?.valuationPackage;
    return {
      landPortalFmv: pkg?.landPortalFmv?.value ?? null,
      nonLandPortalFmv: pkg?.nonLandPortalFmv?.value ?? null,
      combinedFmv: pkg?.combinedFmv?.value ?? null,
      combinedMethod: pkg?.combinedFmv?.method ?? null,
      offer40: pkg?.offer40 ?? null,
      offer60: pkg?.offer60 ?? null,
      workspaceComps: cv?.comps?.length ?? 0,
      canonicalCompCount: cv?.canonicalCompCount ?? 0,
      duplicatesMerged: cv?.duplicatesMerged ?? 0,
      activeCompetition: pkg?.activeCompetition?.count ?? 0,
      landHomeTriggered: pkg?.landHomePackage?.triggered ?? null,
      landHomeQualifying: pkg?.landHomePackage?.market?.qualifyingSaleCount ?? null,
      landHomeTopSale: pkg?.landHomePackage?.market?.topSalePrice ?? null,
      landWatchApplicable: pkg?.landWatch?.applicable ?? null,
      subjectAcres: pkg?.provenance?.subjectAcres ?? null,
      compEvidenceFingerprint: pkg?.provenance?.compEvidenceFingerprint ?? null,
      selectedCompSetVersion: pkg?.provenance?.selectedCompSetVersion ?? null,
    };
  };
  const c = pick(canonical); const a = pick(alias);
  const keys = Object.keys(c) as Array<keyof typeof c>;
  console.log(`${pad('field', 26)} ${pad('DEAL 90 (canonical)', 26)} ${pad('DEAL 115 (alias)', 26)} match`);
  let mismatches = 0;
  for (const k of keys) {
    const same = JSON.stringify(c[k]) === JSON.stringify(a[k]);
    if (!same) mismatches += 1;
    console.log(`${pad(k, 26)} ${pad(JSON.stringify(c[k]), 26)} ${pad(JSON.stringify(a[k]), 26)} ${same ? 'YES' : 'NO'}`);
  }
  console.log();
  console.log(`fields compared: ${keys.length}  mismatches: ${mismatches}`);
}

const sections: Record<string, () => void | Promise<void>> = {
  valuation, comps, providers, landhome, zillow, redfin, realtor, dealbrain, landwatch, family, reconcile,
};
const fn = sections[section];
if (!fn) { console.error(`unknown section: ${section}`); process.exit(1); }
await fn();
db.close();
