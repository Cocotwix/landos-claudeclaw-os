// Throwaway corridor probe. The bbox answer ("there is pipe near this parcel")
// is not the answer that matters. This asks the two questions that decide the
// relationship: does the pipe run along the road the SUBJECT fronts, and how
// far is it from the parcel measured segment-to-segment rather than
// vertex-to-vertex.
const PARCELS = 'https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0/query';
const ROADS = 'https://services6.arcgis.com/sCdesv1knCIWF2x3/arcgis/rest/services/Fairview_Roadways/FeatureServer/0/query';
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
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum distance between two polylines/rings, in feet. */
function pathsDistanceFt(pathsA, pathsB) {
  let best = Infinity;
  for (const pa of pathsA) {
    const A = pa.map(m);
    for (const pb of pathsB) {
      const B = pb.map(m);
      for (const pt of A) for (let i = 0; i + 1 < B.length; i += 1) best = Math.min(best, segDist(pt, B[i], B[i + 1]));
      for (const pt of B) for (let i = 0; i + 1 < A.length; i += 1) best = Math.min(best, segDist(pt, A[i], A[i + 1]));
    }
  }
  return best * FT;
}

const subject = await q(PARCELS, {
  where: "PIN='042    12300 00001042'", outFields: 'PIN,AC', returnGeometry: 'true', outSR: '4326',
});
const rings = subject.features[0].geometry.rings;

const BOX = '-87.1272,35.9690,-87.1089,35.9839';

const roads = await q(ROADS, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'LABEL', returnGeometry: 'true',
});

// Which roads actually touch the subject? That set IS the subject corridor.
console.log('=== roads by distance to the subject parcel ===');
const roadDist = roads.features.map((f) => ({
  name: (f.attributes.LABEL || '').trim(),
  paths: f.geometry.paths,
  d: pathsDistanceFt(f.geometry.paths, rings),
})).sort((a, b) => a.d - b.d);
const byRoad = new Map();
for (const r of roadDist) if (!byRoad.has(r.name) || byRoad.get(r.name).d > r.d) byRoad.set(r.name, r);
for (const r of [...byRoad.values()].sort((a, b) => a.d - b.d).slice(0, 8)) {
  console.log(`  ${Math.round(r.d).toString().padStart(5)} ft  ${r.name}`);
}
const frontage = [...byRoad.values()].filter((r) => r.d < 60).map((r) => r.name);
console.log('  SUBJECT-FRONTING ROADS (<60 ft):', frontage.join(', ') || 'none');

for (const [label, service, layer, kindFields] of [
  ['WATER', 'Fairview_Water_Mains', 127, ['diameter', 'pipe_material', 'constr_dat', 'symbolgrp', 'maintyplab']],
  ['SEWER', 'Sewer_Pipe_Viewer', 138, ['diameter', 'maintyplab', 'yr_install', 'zone', 'us_mh', 'ds_mh']],
]) {
  const near = await q(`${WADC}/${service}/FeatureServer/${layer}/query`, {
    geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true',
  });
  const scored = near.features.map((f) => {
    const d = pathsDistanceFt(f.geometry.paths, rings);
    // Which road does this pipe follow? Nearest road centreline within 80 ft.
    let road = null, rd = Infinity;
    for (const r of roadDist) {
      const dd = pathsDistanceFt(f.geometry.paths, r.paths);
      if (dd < rd) { rd = dd; road = r.name; }
    }
    return { a: f.attributes, d, road, rd };
  }).sort((x, y) => x.d - y.d);

  console.log(`\n=== ${label}: nearest segments, with the road each one follows ===`);
  for (const s of scored.slice(0, 14)) {
    const a = s.a;
    const desc = kindFields.map((k) => `${k}=${a[k] ?? ''}`).join(' ');
    console.log(`  ${Math.round(s.d).toString().padStart(5)} ft from parcel | along ${s.road} (${Math.round(s.rd)} ft) | ${desc}`);
  }
  const onFrontage = scored.filter((s) => frontage.includes(s.road) && s.rd < 80);
  console.log(`  segments following a SUBJECT-FRONTING road: ${onFrontage.length}`);
  if (onFrontage.length) {
    const d = Math.min(...onFrontage.map((s) => s.d));
    const sizes = [...new Set(onFrontage.map((s) => s.a.diameter))].sort((a, b) => b - a);
    console.log(`   closest such segment: ${Math.round(d)} ft from the parcel; diameters present: ${sizes.join(', ')}`);
    for (const s of onFrontage.slice(0, 6)) {
      console.log(`     - ${s.a.diameter}" ${s.a.pipe_material ?? s.a.maintyplab ?? ''} along ${s.road}, ${Math.round(s.d)} ft from parcel`);
    }
  }
}
