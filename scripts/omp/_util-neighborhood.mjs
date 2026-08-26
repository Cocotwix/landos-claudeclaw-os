// Throwaway: how is the immediate neighborhood actually served? For every
// developed lot on the subject's own road, is there a WADC water main and a
// WADC sewer line close enough to be the thing serving it?
const PARCELS = 'https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0/query';
const WADC = 'https://esriapps1.esriwadc.com/arcgis/rest/services/Hosted';

async function q(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    body: new URLSearchParams({ f: 'json', ...params }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json;
}

const LAT = 35.9764228598698;
const MLAT = 111132.92 - 559.82 * Math.cos(2 * LAT * Math.PI / 180);
const MLNG = 111412.84 * Math.cos(LAT * Math.PI / 180);
const FT = 3.28084;
const m = ([x, y]) => [x * MLNG, y * MLAT];
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function distToPathsFt(rings, paths) {
  let best = Infinity;
  for (const r of rings) {
    const R = r.map(m);
    for (const p of paths) {
      const P = p.map(m);
      for (const pt of R) for (let i = 0; i + 1 < P.length; i += 1) best = Math.min(best, segDist(pt, P[i], P[i + 1]));
      for (const pt of P) for (let i = 0; i + 1 < R.length; i += 1) best = Math.min(best, segDist(pt, R[i], R[i + 1]));
    }
  }
  return best * FT;
}

const BOX = '-87.1330,35.9650,-87.1050,35.9880';
const water = (await q(`${WADC}/Fairview_Water_Mains/FeatureServer/127/query`, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'diameter,constr_dat', returnGeometry: 'true',
})).features;
const sewer = (await q(`${WADC}/Sewer_Pipe_Viewer/FeatureServer/138/query`, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'diameter,maintyplab', returnGeometry: 'true',
})).features;
console.log(`water segments in study box: ${water.length}; sewer segments: ${sewer.length}`);

// The subject's own road, developed lots only.
const lots = (await q(PARCELS, {
  where: "(ADDRESS LIKE '%KINGWOOD%') AND IMP_VAL > 0",
  outFields: 'PIN,ADDRESS,OWNER_1,IMP_VAL', returnGeometry: 'true', outSR: '4326',
})).features;

console.log(`\n=== developed lots on the subject road: ${lots.length} ===`);
const NEAR_FT = 120;
let servedWater = 0, servedSewer = 0, servedLPS = 0;
for (const lot of lots) {
  const rings = lot.geometry.rings;
  let wd = Infinity, wdia = null, sd = Infinity, stype = null, sdia = null;
  for (const f of water) {
    const d = distToPathsFt(rings, f.geometry.paths);
    if (d < wd) { wd = d; wdia = f.attributes.diameter; }
  }
  for (const f of sewer) {
    const d = distToPathsFt(rings, f.geometry.paths);
    if (d < sd) { sd = d; stype = f.attributes.maintyplab; sdia = f.attributes.diameter; }
  }
  if (wd <= NEAR_FT) servedWater += 1;
  if (sd <= NEAR_FT) { servedSewer += 1; if ((stype || '').includes('LPS')) servedLPS += 1; }
  console.log(`  ${String(lot.attributes.ADDRESS).padEnd(20)} water ${Math.round(wd).toString().padStart(4)}ft (${wdia}") | sewer ${Math.round(sd).toString().padStart(4)}ft (${sdia}" ${stype ?? ''})`);
}
console.log(`\n  within ${NEAR_FT} ft of a WADC water main: ${servedWater}/${lots.length}`);
console.log(`  within ${NEAR_FT} ft of a WADC sewer line: ${servedSewer}/${lots.length} (of which nearest line is low-pressure: ${servedLPS})`);
