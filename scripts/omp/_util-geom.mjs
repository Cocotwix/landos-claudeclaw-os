// Throwaway geometry probe for the Fairview utility slice: how does WADC's own
// water/sewer geometry actually relate to the subject parcel and its road?
import { readFileSync } from 'node:fs';

const PARCELS = 'https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0/query';
const WADC = 'https://esriapps1.esriwadc.com/arcgis/rest/services/Hosted';

async function q(url, params) {
  const body = new URLSearchParams({ f: 'json', ...params });
  const res = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json;
}

// Subject polygon, straight from the county parcel layer.
const subject = await q(PARCELS, {
  where: "PIN='042    12300 00001042'",
  outFields: 'PIN,AC,ADDRESS,OWNER_1',
  returnGeometry: 'true',
  outSR: '4326',
});
const geom = subject.features[0].geometry;
const polygon = JSON.stringify({ rings: geom.rings, spatialReference: { wkid: 4326 } });
console.log('SUBJECT', JSON.stringify(subject.features[0].attributes));

// Metres per degree at this latitude, for honest distance reporting.
const LAT = 35.9764228598698;
const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * LAT * Math.PI / 180);
const M_PER_DEG_LNG = 111412.84 * Math.cos(LAT * Math.PI / 180);

function ringPoints(rings) { return rings.flat(); }
function polyMinDistanceFt(pathA, rings) {
  // Coarse vertex-to-vertex minimum. Enough to say "at the parcel" vs "600 ft away".
  let best = Infinity;
  const target = ringPoints(rings);
  for (const [x1, y1] of pathA.flat()) {
    for (const [x2, y2] of target) {
      const dx = (x1 - x2) * M_PER_DEG_LNG;
      const dy = (y1 - y2) * M_PER_DEG_LAT;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
  }
  return best * 3.28084;
}

for (const [label, service, layer] of [
  ['WATER MAINS', 'Fairview_Water_Mains', 127],
  ['SEWER PIPE', 'Sewer_Pipe_Viewer', 138],
]) {
  console.log(`\n===== ${label} =====`);

  // 1. Does anything INTERSECT the parcel polygon itself?
  const onParcel = await q(`${WADC}/${service}/FeatureServer/${layer}/query`, {
    geometry: polygon,
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
  });
  console.log('intersecting the parcel polygon:', onParcel.features.length);
  for (const f of onParcel.features.slice(0, 8)) {
    const a = f.attributes;
    console.log('  ', a.diameter + '"', a.pipe_material, 'constr', a.constr_dat, 'len_ft', Math.round(a.length_feet), a.symbolgrp ?? a.maintyplab ?? '');
  }

  // 2. Everything within a generous corridor box, with real distances.
  const near = await q(`${WADC}/${service}/FeatureServer/${layer}/query`, {
    geometry: '-87.1272,35.9690,-87.1089,35.9839',
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
  });
  const scored = near.features.map((f) => ({
    a: f.attributes,
    d: polyMinDistanceFt(f.geometry.paths, geom.rings),
  })).sort((x, y) => x.d - y.d);
  console.log('within the surrounding box:', scored.length);
  for (const s of scored.slice(0, 12)) {
    const a = s.a;
    console.log(`   ${Math.round(s.d).toString().padStart(5)} ft  ${(a.diameter ?? '?') + '"'} ${a.pipe_material ?? ''} constr ${a.constr_dat ?? '?'} ${a.maintyplab ?? ''} ${a.symbolgrp ?? ''} ${a.notes ?? ''}`);
  }
  const attrs = scored[0]?.a ?? {};
  console.log('   fields:', Object.keys(attrs).join(', '));
}

// Hydrants, as corroboration for the water corridor.
console.log('\n===== FAIRVIEW HYDRANTS =====');
const hyd = await q(`${WADC}/Fairview_Hydrants/FeatureServer/2/query`, {
  geometry: '-87.1272,35.9690,-87.1089,35.9839',
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  outFields: '*',
  returnGeometry: 'true',
});
const hs = hyd.features.map((f) => {
  const dx = (f.geometry.x - -87.1180051138148) * M_PER_DEG_LNG;
  const dy = (f.geometry.y - 35.9764228598698) * M_PER_DEG_LAT;
  return { a: f.attributes, d: polyMinDistanceFt([[[f.geometry.x, f.geometry.y]]], geom.rings), c: Math.hypot(dx, dy) * 3.28084 };
}).sort((x, y) => x.d - y.d);
console.log('hydrants in the surrounding box:', hs.length);
for (const h of hs.slice(0, 10)) {
  console.log(`   ${Math.round(h.d).toString().padStart(5)} ft from parcel  ${JSON.stringify(h.a).slice(0, 220)}`);
}
