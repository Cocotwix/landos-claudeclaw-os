// Capture the utility map evidence for the Fairview acceptance property.
//
// The capture renders the OFFICIAL geometry unaltered: WADC's own hosted water
// main, sewer pipe and hydrant layers, and the Williamson County parcel layer,
// each fetched live from its published REST endpoint and drawn over the Esri
// World Imagery basemap. The page prints its own source URLs and retrieval time
// so the picture states what it is.
//
// Runs in the dedicated LandOS automation browser, which is a separate profile
// from the operator's Chrome and never takes the foreground.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { withAutomationTab } from '../../dist/landos/automation-browser.js';
import { landosArtifactPath } from '../../dist/landos/storage-profile.js';

const PARCELS = 'https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0/query';
const WADC = 'https://esriapps1.esriwadc.com/arcgis/rest/services/Hosted';
const BOX = '-87.1272,35.9690,-87.1089,35.9839';
const SUBJECT_PIN = '042    12300 00001042';

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

const retrievedAt = new Date().toISOString();

const subject = await q(PARCELS, {
  where: `PIN='${SUBJECT_PIN}'`, outFields: 'PIN,OWNER_1,AC', returnGeometry: 'true', outSR: '4326',
});
const neighbours = await q(PARCELS, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'PIN', returnGeometry: 'true',
});
const water = await q(`${WADC}/Fairview_Water_Mains/FeatureServer/127/query`, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'diameter,constr_dat', returnGeometry: 'true',
});
const sewer = await q(`${WADC}/Sewer_Pipe_Viewer/FeatureServer/138/query`, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'diameter,maintyplab', returnGeometry: 'true',
});
const hydrants = await q(`${WADC}/Fairview_Hydrants/FeatureServer/2/query`, {
  geometry: BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'facilityid', returnGeometry: 'true',
});

console.log(`fetched: subject=${subject.features.length} parcels=${neighbours.features.length} water=${water.features.length} sewer=${sewer.features.length} hydrants=${hydrants.features.length}`);

const payload = {
  retrievedAt,
  subject: subject.features[0],
  parcels: neighbours.features.map((f) => f.geometry.rings),
  water: water.features.map((f) => ({ p: f.geometry.paths, d: f.attributes.diameter, y: f.attributes.constr_dat })),
  sewer: sewer.features.map((f) => ({ p: f.geometry.paths, d: f.attributes.diameter, t: f.attributes.maintyplab })),
  hydrants: hydrants.features.map((f) => [f.geometry.x, f.geometry.y]),
};

function page(kind) {
  const title = kind === 'water'
    ? 'WADC water mains and hydrants at 0 Kingwood Blvd (APN 042-123.00-000)'
    : 'WADC sewer collection at 0 Kingwood Blvd (APN 042-123.00-000)';
  const source = kind === 'water'
    ? 'Water Authority of Dickson County — Hosted/Fairview_Water_Mains (layer 127) and Hosted/Fairview_Hydrants (layer 2)'
    : 'Water Authority of Dickson County — Hosted/Sewer_Pipe_Viewer (layer 138)';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
 html,body{margin:0;background:#0d0f0e;color:#ece8dc;font:13px/1.5 system-ui,sans-serif}
 #map{position:absolute;inset:0 0 96px 0}
 .cap{position:absolute;left:0;right:0;bottom:0;height:96px;padding:10px 14px;box-sizing:border-box;background:#12150f;border-top:1px solid #3a443b;font-size:11.5px}
 .cap b{color:#e0bd76}
 .cap div{margin-top:2px;color:#b6b2a3}
 .lgd{position:absolute;right:12px;top:12px;background:rgba(13,15,14,.9);border:1px solid #3a443b;border-radius:3px;padding:9px 11px;font-size:11.5px;z-index:500}
 .lgd i{display:inline-block;width:22px;height:0;border-top:3px solid;vertical-align:middle;margin-right:7px}
 .lgd s{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle;margin-right:7px;text-decoration:none}
 .lgd p{margin:0 0 5px}
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head><body>
<div id="map"></div>
<div class="lgd">
 <p><i style="border-color:#ffd166"></i> Subject parcel — 51.11 ac, LANDSOUTH LLC</p>
 <p><i style="border-color:#7fd4ff"></i> WADC water main</p>
 <p><i style="border-color:#8fae7c"></i> WADC sewer line</p>
 <p><s style="background:#ff6b6b"></s> WADC fire hydrant</p>
</div>
<div class="cap">
 <b>${title}</b>
 <div>Source: ${source}; parcel geometry from Williamson County GIS (services8.arcgis.com/.../Parcels/FeatureServer/0).</div>
 <div>Retrieved ${retrievedAt}. Geometry drawn unaltered from those services. Infrastructure geometry only — this map does not establish connection approval, capacity, or fire flow.</div>
</div>
<script>
const D = ${JSON.stringify(payload)};
const map = L.map('map', { zoomControl:false, attributionControl:false });
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}).addTo(map);
const flip = (ring) => ring.map(([x,y]) => [y,x]);
D.parcels.forEach(r => L.polygon(r.map(flip), {color:'#8b8879', weight:1, fill:false, opacity:.55}).addTo(map));
const subj = L.polygon(D.subject.geometry.rings.map(flip), {color:'#ffd166', weight:3, fillColor:'#ffd166', fillOpacity:.10}).addTo(map);
${kind === 'water'
    ? `D.water.forEach(f => f.p.forEach(p => L.polyline(flip(p), {color:'#7fd4ff', weight: f.d >= 6 ? 4 : 2, opacity:.95}).addTo(map)));
       D.hydrants.forEach(([x,y]) => L.circleMarker([y,x], {radius:4, color:'#ff6b6b', fillColor:'#ff6b6b', fillOpacity:1, weight:1}).addTo(map));`
    : `D.sewer.forEach(f => f.p.forEach(p => L.polyline(flip(p), {color:'#8fae7c', weight: (f.t||'').includes('(S)') ? 4 : 2, dashArray: (f.t||'').includes('(S)') ? null : '5,4', opacity:.95}).addTo(map)));`}
map.fitBounds(subj.getBounds().pad(0.55));
window.__ready = true;
</script>
</body></html>`;
}

const root = landosArtifactPath('browser-shots');
mkdirSync(root, { recursive: true });

for (const kind of ['water', 'sewer']) {
  const html = page(kind);
  const file = path.join(root, `deal89_utility_${kind}.png`);
  const htmlFile = path.join(root, `deal89_utility_${kind}.html`);
  writeFileSync(htmlFile, html, 'utf8');
  await withAutomationTab(async (p) => {
    await p.setViewport?.({ width: 1400, height: 1000 });
    await p.goto('file:///' + htmlFile.replace(/\\/g, '/'), { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4500));
    await p.screenshot({ path: file, type: 'png' });
  }, { label: `utility-map-${kind}` });
  console.log('captured', file);
}
