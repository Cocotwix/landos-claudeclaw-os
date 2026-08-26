// Throwaway trace. The new 2024/2025 mains sit 13-41 ft off the subject but
// follow no mapped city street — so they are inside somebody's development.
// Which one, and does it reach the subject's own frontage?
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

const BOX = '-87.1272,35.9690,-87.1089,35.9839';

for (const [label, service, layer, where] of [
  ['NEW WATER (2024-2025)', 'Fairview_Water_Mains', 127, 'constr_dat >= 2024'],
  ['ALL WATER', 'Fairview_Water_Mains', 127, '1=1'],
  ['SEWER', 'Sewer_Pipe_Viewer', 138, '1=1'],
]) {
  const near = await q(`${WADC}/${service}/FeatureServer/${layer}/query`, {
    where, geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true',
  });
  console.log(`\n===== ${label}: ${near.features.length} segments =====`);

  // Which parcels do these run through? One spatial query per unique owner is
  // too many; ask the parcel layer once with the union of the pipe vertices.
  const points = near.features.flatMap((f) => f.geometry.paths.flat());
  const sample = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 60)) === 0).slice(0, 60);
  const owners = new Map();
  for (const [x, y] of sample) {
    try {
      const hit = await q(PARCELS, {
        geometry: `${x},${y}`, geometryType: 'esriGeometryPoint', inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects', outFields: 'PIN,ADDRESS,OWNER_1,AC,IMP_VAL', returnGeometry: 'false',
      });
      for (const f of hit.features) {
        const a = f.attributes;
        const key = a.PIN;
        owners.set(key, { ...a, n: (owners.get(key)?.n ?? 0) + 1 });
      }
    } catch { /* ignore one bad point */ }
  }
  const ranked = [...owners.values()].sort((a, b) => b.n - a.n);
  console.log('  parcels these pipes cross (by sampled hits):');
  for (const o of ranked.slice(0, 12)) {
    console.log(`   ${String(o.n).padStart(3)}x  ${(o.OWNER_1 || '').slice(0, 34).padEnd(34)} ${String(o.ADDRESS || '').slice(0, 22).padEnd(22)} ac=${o.AC} imp=${o.IMP_VAL}`);
  }
}

// The four Brook Hollow Green parcels: what are they, and where?
console.log('\n===== BROOK HOLLOW GREEN LLC parcels =====');
const bh = await q(PARCELS, {
  where: "OWNER_1 LIKE '%BROOK HOLLOW%'", outFields: 'PIN,ADDRESS,OWNER_1,AC,IMP_VAL,DEED_BK_LS,DEED_PG_LS',
  returnGeometry: 'false',
});
for (const f of bh.features) console.log('  ', JSON.stringify(f.attributes));
