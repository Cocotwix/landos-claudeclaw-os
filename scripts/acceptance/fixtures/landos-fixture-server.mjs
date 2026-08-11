import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_PROPERTY = Object.freeze({
  address: '704 Bell Rd, Red Creek, NY 13143',
  normalizedAddress: '704 Bell Rd, Red Creek, NY 13143',
  apn: '056400 37.00-1-33',
  canonicalPropertyId: '89520173',
  canonicalCounts: { comps: 4, visuals: 1 },
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function evidenceAttributes(property, kind) {
  return `data-acceptance-evidence-kind="${kind}" data-subject-address="${escapeHtml(property.normalizedAddress)}" data-subject-apn="${escapeHtml(property.apn)}" data-subject-property-id="${escapeHtml(property.canonicalPropertyId)}"`;
}

function compRows(property, projection) {
  if (projection !== 'pass') return '';
  return Array.from({ length: property.canonicalCounts.comps }, (_unused, index) => `
            <article role="listitem" ${evidenceAttributes(property, 'comp')} data-item-address="${100 + index} Comparable Rd, Red Creek, NY 13143">
              <strong>Accepted comp ${index + 1}</strong><span class="muted">${100 + index} Comparable Rd - canonical Hermes evidence</span>
            </article>`).join('');
}

function visualRows(property, projection) {
  if (projection !== 'pass') return '';
  return Array.from({ length: property.canonicalCounts.visuals }, (_unused, index) => `
            <figure role="listitem" ${evidenceAttributes(property, 'visual')} data-item-address="${escapeHtml(property.normalizedAddress)}">
              <img alt="Retained subject imagery ${index + 1} for ${escapeHtml(property.normalizedAddress)}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='760' height='260'%3E%3Crect width='760' height='260' fill='%23087b9f'/%3E%3Cpath d='M0 210L190 65L360 190L520 90L760 230V260H0Z' fill='%231b4f45'/%3E%3Ccircle cx='650' cy='55' r='28' fill='%23f3b35c'/%3E%3C/svg%3E">
              <figcaption>Canonical retained subject visual ${index + 1}</figcaption>
            </figure>`).join('');
}

function html(restartGeneration, property, projection) {
  const address = escapeHtml(property.normalizedAddress);
  const apn = escapeHtml(property.apn);
  const propertyId = escapeHtml(property.canonicalPropertyId);
  const visibleComps = projection === 'pass' ? property.canonicalCounts.comps : 0;
  const visibleVisuals = projection === 'pass' ? property.canonicalCounts.visuals : 0;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LandOS deterministic acceptance fixture</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#07101e; color:#e7eefb; }
    * { box-sizing:border-box; } body { margin:0; min-height:100vh; background:radial-gradient(circle at 80% 0,#17305b 0,transparent 35%),linear-gradient(145deg,#07101e,#101a2e); }
    header { padding:22px 36px; border-bottom:1px solid #33435f; background:#0c1626e8; display:flex; align-items:center; gap:24px; position:sticky; top:0; z-index:2; }
    header strong { color:#67d4ff; letter-spacing:.08em; } nav { display:flex; gap:8px; }
    button { color:#d9e5f7; background:#13223a; border:1px solid #3b4d6b; border-radius:9px; padding:10px 14px; font-weight:700; cursor:pointer; }
    button[aria-selected="true"], button.active { background:#087b9f; border-color:#58d5fa; color:white; }
    main { max-width:1100px; margin:0 auto; padding:30px; }
    .card { border:1px solid #354761; border-radius:16px; padding:22px; background:linear-gradient(155deg,#111d30,#0c1728); box-shadow:0 18px 45px #0005; }
    h1 { font-size:28px; margin:0 0 6px; } h2 { margin:0 0 16px; font-size:20px; } h3 { margin:0; font-size:15px; }
    .muted { color:#9eb0c8; } label { display:block; margin:18px 0 7px; color:#b8c9df; font-size:13px; font-weight:700; }
    textarea { width:100%; min-height:220px; background:#081222; color:#eff6ff; border:1px solid #4a5d7c; border-radius:12px; padding:16px; font-size:15px; }
    .rule { margin:15px 0; padding:12px; border:1px solid #197fa3; background:#0d3b5155; border-radius:10px; color:#bcecff; }
    .banner { padding:13px 16px; border:1px solid #c07c26; background:#60380f55; border-radius:12px; color:#ffd8a3; margin:16px 0; }
    .tablist { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0; }
    [role="tabpanel"][hidden], section[hidden], [hidden] { display:none; }
    .metric { display:grid; grid-template-columns:1fr auto; align-items:center; gap:20px; padding:18px; border:1px solid #40516d; border-radius:13px; background:#0b1628; margin:12px 0; }
    .count { font-size:26px; font-weight:900; color:#f3b35c; min-width:50px; text-align:center; }
    .empty { padding:28px; text-align:center; border:1px dashed #a56837; background:#4d2b1640; border-radius:12px; color:#f2ba82; margin-top:12px; }
    .identity { display:flex; justify-content:space-between; gap:20px; align-items:start; } .tag { border:1px solid #3a8a65; color:#8cedbd; background:#15462d66; border-radius:999px; padding:6px 10px; font-size:12px; }
    .meta { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:18px 0; } .meta div { padding:12px; border-radius:10px; background:#0b1525; border:1px solid #293b56; }
    .meta b { display:block; color:#8ea3c0; font-size:10px; text-transform:uppercase; margin-bottom:5px; }
    [role="list"] { display:grid; gap:10px; } [role="listitem"] { display:flex; justify-content:space-between; gap:18px; padding:14px; border:1px solid #354761; border-radius:11px; background:#101d31; }
    figure[role="listitem"] { display:block; margin:0; } figure img { display:block; width:100%; max-height:260px; object-fit:cover; border-radius:9px; } figcaption { margin-top:8px; color:#b8c9df; }
    footer { color:#7086a5; font-size:11px; padding:30px; text-align:center; }
  </style>
</head>
<body>
  <header><strong>LANDOS</strong><nav aria-label="Acquisitions"><button type="button" id="new-lead-nav" class="active">New Lead</button><button type="button">Deal Library</button></nav><span class="muted">Deterministic offline acceptance fixture</span></header>
  <main>
    <section id="new-lead" aria-labelledby="new-lead-heading">
      <form class="card" id="new-lead-form">
        <h1 id="new-lead-heading">Tell LandOS what you know</h1>
        <p class="muted">Enter the acceptance property through the normal operator-facing New Lead surface.</p>
        <label for="lead-information">Lead information</label>
        <textarea id="lead-information" aria-label="Lead information"></textarea>
        <div class="rule">LandOS saves the original words and creates the Deal Card. This fixture never calls a provider or mutates application data.</div>
        <button type="submit">Create Lead Card &amp; start research</button>
      </form>
    </section>
    <section id="deal-card" hidden aria-labelledby="deal-address" data-acceptance-subject data-subject-address="${address}" data-subject-apn="${apn}" data-subject-property-id="${propertyId}">
      <div class="card">
        <div class="identity"><div><div class="muted">Deal Card - accepted parcel</div><h1 id="deal-address">${address}</h1><div class="muted">APN ${apn} - Property ID ${propertyId}</div></div><span class="tag">Parcel confirmed</span></div>
        <div class="meta"><div><b>Canonical Hermes comps</b>${property.canonicalCounts.comps} accepted</div><div><b>Canonical visual</b>${property.canonicalCounts.visuals} accepted</div><div><b>Fixture restart generation</b><span data-restart-generation>${restartGeneration}</span></div></div>
        <div class="banner" data-specialist-results-claimed="true">Specialist results retained: ${property.canonicalCounts.comps} comps and ${property.canonicalCounts.visuals} visual${property.canonicalCounts.visuals === 1 ? '' : 's'}. ${projection === 'pass' ? 'The operator projection visibly renders every retained result.' : 'The operator projection below intentionally demonstrates the known mismatch.'}</div>
        <div class="tablist" role="tablist" aria-label="Deal Card workspaces">
          <button id="tab-overview" type="button" role="tab" aria-selected="true" aria-controls="deal-panel-overview">Overview</button>
          <button id="tab-market" type="button" role="tab" aria-selected="false" aria-controls="deal-panel-market">Comps &amp; Market</button>
          <button id="tab-documents" type="button" role="tab" aria-selected="false" aria-controls="deal-panel-documents">Documents &amp; Visuals</button>
        </div>
        <div role="tabpanel" id="deal-panel-overview" aria-labelledby="tab-overview"><h2>Property Intelligence</h2><p class="muted">Open each changed operator section to compare canonical accepted records with visible output.</p></div>
        <div role="tabpanel" id="deal-panel-market" aria-labelledby="tab-market" hidden>
          <h2>Should I want land here?</h2>
          <div class="metric" data-acceptance-section="comps"><div><h3>Accepted sold comps</h3><div class="muted">Canonical Hermes category is complete.</div></div><span class="count" data-visible-count="comps">${visibleComps}</span></div>
          <div role="list" aria-label="Accepted sold comps" data-rendered-rows="comps">${compRows(property, projection)}</div>
          <div class="empty" data-empty-state="comps"${projection === 'pass' ? ' hidden' : ''}>No closed sale survived the comp source policy, so no comp is presented as a value basis.</div>
        </div>
        <div role="tabpanel" id="deal-panel-documents" aria-labelledby="tab-documents" hidden>
          <h2>Documents &amp; Visuals</h2>
          <div class="metric" data-acceptance-section="visuals"><div><h3>Hero property imagery</h3><div class="muted">Retained subject imagery expected.</div></div><span class="count" data-visible-count="visuals">${visibleVisuals}</span></div>
          <div role="list" aria-label="Retained property visuals" data-rendered-rows="visuals">${visualRows(property, projection)}</div>
          <div class="empty" data-empty-state="visuals"${projection === 'pass' ? ' hidden' : ''}>No clean subject-centered parcel or aerial image was retained.</div>
          <div class="metric"><div><h3>Retained evidence</h3><div class="muted">Visual evidence displayed in this workspace.</div></div><span class="count">${visibleVisuals}</span></div>
        </div>
      </div>
    </section>
  </main>
  <footer>No credentials, cookies, external fonts, remote scripts, or network providers are used by this fixture.</footer>
  <script>
    const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    function showDeal() { document.querySelector('#new-lead').hidden=true; document.querySelector('#deal-card').hidden=false; history.replaceState(null,'','/?deal=' + encodeURIComponent(${JSON.stringify(String(property.canonicalPropertyId))})); }
    document.querySelector('#new-lead-form').addEventListener('submit', event => { event.preventDefault(); showDeal(); });
    tabs.forEach((tab, index) => tab.addEventListener('click', () => { tabs.forEach(t => t.setAttribute('aria-selected','false')); panels.forEach(p => p.hidden=true); tab.setAttribute('aria-selected','true'); panels[index].hidden=false; }));
    if (new URLSearchParams(location.search).has('deal')) showDeal();
  </script>
</body>
</html>`;
}

export async function startLandosFixtureServer({ host = '127.0.0.1', port = 0, property = DEFAULT_PROPERTY, projection = 'mismatch' } = {}) {
  if (!['mismatch', 'pass'].includes(projection)) throw new Error('fixture projection must be mismatch or pass');
  let generation = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method === 'POST' && url.pathname === '/__fixture/restart') {
      generation += 1;
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dept/acquisitions')) {
      const body = html(generation, property, projection);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:",
      });
      response.end(body);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end('Not found');
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not expose a TCP address');
  return {
    baseUrl: `http://${host}:${address.port}`,
    restart: async () => {
      const response = await fetch(`http://${host}:${address.port}/__fixture/restart`, { method: 'POST' });
      if (!response.ok) throw new Error(`fixture restart marker returned ${response.status}`);
    },
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startLandosFixtureServer({ port: Number(process.env.LANDOS_ACCEPTANCE_FIXTURE_PORT || 4179) });
  process.stdout.write(`${fixture.baseUrl}\n`);
  const stop = async () => { await fixture.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
