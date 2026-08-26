// Throwaway: pinpoint exactly what the nearest pipes are and whose ground they
// are on. "There is a main 13 ft away" is only useful once you know whether it
// is the subject's frontage main or somebody else's internal line.
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
  where: "PIN='042    12300 00001042'", outFields: 'PIN', returnGeometry: 'true', outSR: '4326',
});
const rings = subject.features[0].geometry.rings;
const BOX = '-87.1272,35.9690,-87.1089,35.9839';

async function parcelAt(x, y) {
  const hit = await q(PARCELS, {
    geometry: `${x},${y}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'PIN,ADDRESS,OWNER_1,AC,IMP_VAL', returnGeometry: 'false',
  });
  return hit.features[0]?.attributes ?? null;
}

for (const [label, service, layer] of [
  ['WATER', 'Fairview_Water_Mains', 127],
  ['SEWER', 'Sewer_Pipe_Viewer', 138],
]) {
  const near = await q(`${WADC}/${service}/FeatureServer/${layer}/query`, {
    geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true',
  });
  const scored = near.features
    .map((f) => ({ a: f.attributes, g: f.geometry, d: pathsDistanceFt(f.geometry.paths, rings) }))
    .sort((x, y) => x.d - y.d);

  console.log(`\n===== ${label}: the six closest segments, with the ground they sit on =====`);
  for (const s of scored.slice(0, 6)) {
    const pts = s.g.paths.flat();
    const mid = pts[Math.floor(pts.length / 2)];
    const owner = await parcelAt(mid[0], mid[1]);
    const a = s.a;
    console.log(`  ${Math.round(s.d).toString().padStart(4)} ft | ${a.diameter}" ${a.pipe_material ?? ''} ${a.maintyplab ?? ''} constr=${a.constr_dat ?? a.yr_install ?? '?'} len=${Math.round(a.length_feet ?? 0)}ft`);
    console.log(`         on: ${owner ? `${owner.OWNER_1} | ${owner.ADDRESS} | ${owner.AC}ac | imp=${owner.IMP_VAL}` : 'no parcel (public right-of-way)'}`);
  }
}
