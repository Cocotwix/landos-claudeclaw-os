import type { BrowserDriver } from './browser-intelligence.js';

declare const document: any;
declare const window: any;

export const BROCKOVICH_MAP_URL = 'https://www.brockovichdatacenter.com/#map-section';
export const BROCKOVICH_RADIUS_MILES = 20;

export interface BrockovichProject {
  title: string;
  status: 'operational' | 'under_construction' | 'proposed' | 'community_reported' | 'unknown';
  operatorOrDeveloper: string | null;
  location: string | null;
  summary: string;
  sourceUrl: string | null;
  lat: number;
  lng: number;
  distanceMiles: number;
}

export interface BrockovichMapResult {
  status: 'found' | 'none_found' | 'not_run' | 'unavailable';
  sourceUrl: string;
  subject: { lat: number; lng: number } | null;
  radiusMiles: 20;
  projects: BrockovichProject[];
  screenshotPath: string | null;
  attemptedAt: string;
  note: string;
}

interface MapDomRead {
  mapReady: boolean;
  centered: boolean;
  subjectMarked: boolean;
  centersParsed: boolean;
  /** True only for the generated radius/grid fallback. It may aid debugging but
   * never qualifies as the requested live Brockovich map evidence. */
  syntheticFallback: boolean;
  markers: Array<{
    title: string;
    operatorOrDeveloper: string | null;
    location: string | null;
    text: string;
    href: string | null;
    lat: number | null;
    lng: number | null;
  }>;
}

export function brockovichDistanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function classifyBrockovichStatus(text: string): BrockovichProject['status'] {
  if (/under construction/i.test(text)) return 'under_construction';
  if (/community reported/i.test(text)) return 'community_reported';
  if (/operational/i.test(text)) return 'operational';
  if (/proposed/i.test(text)) return 'proposed';
  return 'unknown';
}

const PREPARE_AND_READ_MAP = (subject: { lat: number; lng: number }): MapDomRead => {
  const candidates = Array.from((document as any).querySelectorAll(
    '#dc-map,#map-section gmp-map,#map-section [class*="map" i],#map-section canvas,main gmp-map,main [class*="map" i],gmp-map',
  )) as any[];
  const map = candidates
    .map((node) => ({ node, rect: node.getBoundingClientRect?.() }))
    .filter((entry) => entry.rect && entry.rect.width >= 500 && entry.rect.height >= 350)
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.node ?? null;
  if (!map) return {
    mapReady: false,
    centered: false,
    subjectMarked: false,
    centersParsed: false,
    syntheticFallback: false,
    markers: [],
  };

  for (const node of Array.from((document as any).querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="popup" i],[class*="modal" i],[class*="cookie" i]')) as any[]) {
    const text = String(node.textContent ?? '');
    if (!/cookie|subscribe|newsletter|advert|privacy|special offer/i.test(text)) continue;
    const close = node.querySelector?.('button[aria-label*="close" i],button,[role="button"]');
    try { close?.click?.(); } catch { node.style.display = 'none'; }
  }

  let centered = false;
  let syntheticFallback = false;
  let leafletMap: any = null;
  for (const key of ['map', 'dcMap', 'dataCenterMap']) {
    try {
      const candidate = (window as any)[key];
      if (candidate?.setView && candidate?.getCenter) { leafletMap = candidate; break; }
    } catch { /* inaccessible global */ }
  }
  const mapApi = leafletMap ?? (map as any).innerMap ?? (map as any).map ?? null;
  try {
    if (mapApi?.setView) {
      mapApi.setView([subject.lat, subject.lng], 10, { animate: false });
      centered = true;
    } else if (mapApi?.setCenter) {
      mapApi.setCenter(subject);
      mapApi.setZoom?.(10);
      centered = true;
    } else if ('center' in map) {
      map.center = subject;
      map.zoom = 10;
      centered = true;
    }
  } catch { centered = false; }

  const markerId = 'landos-subject-location-marker';
  let subjectMarker = (document as any).getElementById(markerId);
  if (!subjectMarker) {
    subjectMarker = (document as any).createElement('div');
    subjectMarker.id = markerId;
    subjectMarker.textContent = 'SUBJECT';
    subjectMarker.setAttribute('aria-label', `Subject property ${subject.lat}, ${subject.lng}`);
    Object.assign(subjectMarker.style, {
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      zIndex: '2147483647', padding: '7px 10px', borderRadius: '999px',
      background: '#f97316', color: '#111827', border: '3px solid white',
      font: '700 12px/1 sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.55)', pointerEvents: 'none',
    });
    const style = (window as any).getComputedStyle(map);
    if (style.position === 'static') map.style.position = 'relative';
    map.appendChild(subjectMarker);
  }

  const markerNodes = Array.from((document as any).querySelectorAll(
    'gmp-advanced-marker,[data-lat][data-lng],[data-latitude][data-longitude],[role="button"][title],[aria-label*="data center" i]',
  )) as any[];
  const domMarkers = markerNodes.filter((node) => node.id !== markerId).map((node) => {
    try { node.click?.(); } catch { /* read-only map selection */ }
    const position = node.position ?? node._position ?? null;
    const latValue = position?.lat?.() ?? position?.lat ?? node.dataset?.lat ?? node.dataset?.latitude ?? node.getAttribute?.('latitude');
    const lngValue = position?.lng?.() ?? position?.lng ?? node.dataset?.lng ?? node.dataset?.longitude ?? node.getAttribute?.('longitude');
    const popup = (document as any).querySelector('[role="dialog"],.gm-style-iw,[class*="popup" i]');
    const title = String(node.title ?? node.getAttribute?.('aria-label') ?? popup?.querySelector?.('h1,h2,h3,h4')?.textContent ?? 'Data center project').trim();
    const text = String(popup?.textContent ?? node.textContent ?? title).replace(/\s+/g, ' ').trim();
    const href = popup?.querySelector?.('a[href]')?.href ?? node.querySelector?.('a[href]')?.href ?? null;
    const lat = Number(latValue);
    const lng = Number(lngValue);
    return {
      title,
      operatorOrDeveloper: null,
      location: null,
      text,
      href,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  });

  // Brockovich's Leaflet marker elements intentionally carry no coordinates.
  // Read the page-owned inline `centers` dataset without evaluating page text:
  // JSON first, then a conservative field parser for JavaScript object literals.
  const centersScript = (Array.from((document as any).scripts) as any[])
    .map((script) => String(script.textContent ?? ''))
    .find((text) => /\bvar\s+centers\s*=/.test(text)) ?? '';
  const arrayMatch = centersScript.match(/\bvar\s+centers\s*=\s*(\[[\s\S]*?\])\s*;/);
  let parsedCenters: any[] | null = null;
  if (arrayMatch?.[1]) {
    try {
      const parsed = JSON.parse(arrayMatch[1]);
      if (Array.isArray(parsed)) parsedCenters = parsed;
    } catch {
      const rows: any[] = [];
      const objects = arrayMatch[1].match(/\{[\s\S]*?\}/g) ?? [];
      const field = (objectText: string, name: string): string | null => {
        const quoted = objectText.match(new RegExp(`(?:^|[,\\\\s])${name}\\\\s*:\\\\s*(['"\`])([\\\\s\\\\S]*?)\\\\1(?:\\\\s*[,}])`, 'i'));
        if (quoted) return quoted[2].replace(/\\\\(['"\`\\\\])/g, '$1');
        const bare = objectText.match(new RegExp(`(?:^|[,\\\\s])${name}\\\\s*:\\\\s*([^,}]+)`, 'i'));
        return bare?.[1]?.trim() ?? null;
      };
      for (const objectText of objects) {
        const lat = Number(field(objectText, 'lat'));
        const lng = Number(field(objectText, 'lng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        rows.push({
          name: field(objectText, 'name'),
          company: field(objectText, 'company'),
          city: field(objectText, 'city'),
          status: field(objectText, 'status'),
          note: field(objectText, 'note'),
          source: field(objectText, 'source'),
          lat,
          lng,
        });
      }
      if (objects.length > 0) parsedCenters = rows;
    }
  }
  const centersParsed = parsedCenters != null;
  const centerMarkers = (parsedCenters ?? []).map((center) => ({
    title: String(center.name ?? center.company ?? 'Data center project').trim(),
    operatorOrDeveloper: center.company == null ? null : String(center.company).trim() || null,
    location: center.city == null ? null : String(center.city).trim() || null,
    text: [center.name, center.company, center.city, center.status, center.note].filter(Boolean).join(' · '),
    href: typeof center.source === 'string' && /^https?:\/\//i.test(center.source) ? center.source : null,
    lat: Number.isFinite(Number(center.lat)) ? Number(center.lat) : null,
    lng: Number.isFinite(Number(center.lng)) ? Number(center.lng) : null,
  }));
  const markers = centersParsed ? centerMarkers : domMarkers;

  // The live site's Leaflet instance is closure-scoped, so some deployments
  // expose the map visually without exposing a callable `setView`. When that
  // happens, render a clean subject-centered 20-mile screen directly over the
  // live map using the page-owned `centers` dataset we just parsed. This is not
  // a guessed result: every plotted project and coordinate comes from the
  // Brockovich page, while LandOS supplies only the subject/radius overlay.
  if (!centered && centersParsed) {
    syntheticFallback = true;
    const canvas = (document as any).createElement('canvas');
    canvas.id = 'landos-brockovich-subject-screen';
    canvas.width = 1200;
    canvas.height = 800;
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      zIndex: '2147483500', background: '#f5f1e8', pointerEvents: 'none',
    });
    map.appendChild(canvas);
    const ctx = canvas.getContext?.('2d');
    if (ctx) {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = 570;
      const centerY = 430;
      const radiusPixels = 290;
      const pixelsPerMile = radiusPixels / 20;
      const milesPerLatDegree = 69;
      const milesPerLngDegree = 69 * Math.cos(subject.lat * Math.PI / 180);
      const distance = (lat: number, lng: number) => {
        const north = (lat - subject.lat) * milesPerLatDegree;
        const east = (lng - subject.lng) * milesPerLngDegree;
        return Math.sqrt(north * north + east * east);
      };
      const nearby = centerMarkers
        .filter((marker) => marker.lat != null && marker.lng != null && distance(marker.lat, marker.lng) <= 24)
        .sort((a, b) => distance(a.lat as number, a.lng as number) - distance(b.lat as number, b.lng as number));

      ctx.fillStyle = '#f5f1e8';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#d6d3d1';
      ctx.lineWidth = 1;
      for (let x = centerX - radiusPixels; x <= centerX + radiusPixels; x += radiusPixels / 4) {
        ctx.beginPath(); ctx.moveTo(x, centerY - radiusPixels); ctx.lineTo(x, centerY + radiusPixels); ctx.stroke();
      }
      for (let y = centerY - radiusPixels; y <= centerY + radiusPixels; y += radiusPixels / 4) {
        ctx.beginPath(); ctx.moveTo(centerX - radiusPixels, y); ctx.lineTo(centerX + radiusPixels, y); ctx.stroke();
      }
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(centerX, centerY, radiusPixels, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(15,118,110,.06)';
      ctx.fill();

      ctx.fillStyle = '#111827';
      ctx.font = '700 28px sans-serif';
      ctx.fillText('Brockovich Data Center Map · Subject 20-mile screen', 48, 54);
      ctx.font = '500 17px sans-serif';
      ctx.fillStyle = '#4b5563';
      ctx.fillText(`Subject ${subject.lat.toFixed(5)}, ${subject.lng.toFixed(5)} · screened ${nearby.length} nearby mapped project(s)`, 48, 84);
      ctx.fillText('Project coordinates and labels: brockovichdatacenter.com · circle/subject overlay: LandOS', 48, 110);

      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(950, 156); ctx.lineTo(950, 112); ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.beginPath(); ctx.moveTo(950, 100); ctx.lineTo(940, 120); ctx.lineTo(960, 120); ctx.closePath(); ctx.fill();
      ctx.font = '700 16px sans-serif';
      ctx.fillText('N', 943, 90);

      for (const marker of nearby) {
        const eastMiles = ((marker.lng as number) - subject.lng) * milesPerLngDegree;
        const northMiles = ((marker.lat as number) - subject.lat) * milesPerLatDegree;
        const x = centerX + eastMiles * pixelsPerMile;
        const y = centerY - northMiles * pixelsPerMile;
        ctx.fillStyle = '#2563eb';
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#1f2937';
        ctx.font = '600 13px sans-serif';
        const title = String(marker.title || 'Data center project').slice(0, 42);
        ctx.fillText(title, x + 12, y - 3);
        ctx.font = '500 12px sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`${distance(marker.lat as number, marker.lng as number).toFixed(1)} mi`, x + 12, y + 13);
      }

      ctx.fillStyle = '#f97316';
      ctx.beginPath(); ctx.arc(centerX, centerY, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.font = '700 15px sans-serif';
      ctx.fillText('SUBJECT', centerX + 18, centerY + 5);

      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(930, 704); ctx.lineTo(1075, 704); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(930, 696); ctx.lineTo(930, 712); ctx.moveTo(1075, 696); ctx.lineTo(1075, 712); ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.font = '600 14px sans-serif';
      ctx.fillText('10 miles', 970, 730);
      ctx.fillStyle = '#4b5563';
      ctx.font = '500 13px sans-serif';
      ctx.fillText('Blue: mapped project', 930, 655);
      ctx.fillText('Orange: subject', 930, 676);
    }
    centered = true;
  }

  // Make the map the screenshot surface. This lane owns a dedicated page, so
  // changing its capture presentation cannot disturb LandPortal or the operator.
  for (const child of Array.from((document as any).body.children) as any[]) {
    if (child === map || child.contains?.(map)) continue;
    child.style.visibility = 'hidden';
  }
  Object.assign(map.style, {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh',
    zIndex: '2147483000', background: '#e5e7eb',
  });
  return { mapReady: true, centered, subjectMarked: !!subjectMarker, centersParsed, syntheticFallback, markers };
};

export async function runBrockovichDataCenterMap(input: {
  lat?: number | null;
  lng?: number | null;
  driver: BrowserDriver;
  nowIso?: string;
  timeoutMs?: number;
}): Promise<BrockovichMapResult> {
  const attemptedAt = input.nowIso ?? new Date().toISOString();
  const subject = Number.isFinite(input.lat) && Number.isFinite(input.lng)
    ? { lat: input.lat as number, lng: input.lng as number }
    : null;
  const base = {
    sourceUrl: BROCKOVICH_MAP_URL,
    subject,
    radiusMiles: BROCKOVICH_RADIUS_MILES as 20,
    attemptedAt,
  };
  if (!subject) return { ...base, status: 'not_run', projects: [], screenshotPath: null, note: 'Confirmed subject coordinates are required for the 20-mile browser-map screen.' };
  if (!input.driver.configured() || !input.driver.evaluate) {
    return { ...base, status: 'unavailable', projects: [], screenshotPath: null, note: 'The live browser driver needed for the Brockovich map is unavailable.' };
  }
  try {
    await input.driver.open(BROCKOVICH_MAP_URL, { timeoutMs: input.timeoutMs ?? 45_000 });
    const read = await input.driver.evaluate<MapDomRead>(PREPARE_AND_READ_MAP as unknown as () => MapDomRead, subject);
    if (!read?.mapReady || !read.centered || !read.subjectMarked || !read.centersParsed || read.syntheticFallback === true) {
      return {
        ...base, status: 'unavailable', projects: [], screenshotPath: null,
        note: `The Brockovich map opened but could not be fully evidenced around the subject (${read?.mapReady ? 'map found' : 'map missing'}; ${read?.centered ? 'centered' : 'not centered'}; ${read?.centersParsed ? 'project dataset parsed' : 'project dataset unavailable'}; ${read?.syntheticFallback ? 'only a generated radius screen was possible, which is not accepted as map proof' : 'live map context retained'}).`,
      };
    }
    const projects = (read.markers ?? [])
      .filter((marker): marker is typeof marker & { lat: number; lng: number } => marker.lat != null && marker.lng != null)
      .map((marker) => ({
        title: marker.title,
        status: classifyBrockovichStatus(`${marker.title} ${marker.text}`),
        operatorOrDeveloper: marker.operatorOrDeveloper ?? null,
        location: marker.location ?? null,
        summary: marker.text,
        sourceUrl: marker.href,
        lat: marker.lat,
        lng: marker.lng,
        distanceMiles: brockovichDistanceMiles(subject, marker),
      }))
      .filter((project) => project.distanceMiles <= BROCKOVICH_RADIUS_MILES)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
    const shot = await input.driver.screenshot('brockovich_data_center_map_subject_20mi', {
      timeoutMs: input.timeoutMs ?? 45_000,
    });
    return {
      ...base,
      status: projects.length ? 'found' : 'none_found',
      projects,
      screenshotPath: shot.path,
      note: projects.length
        ? `${projects.length} Brockovich map project(s) with coordinates were proven within 20 miles of the subject.`
        : 'The Brockovich map was positioned at the subject and no map project with coordinates was proven within 20 miles.',
    };
  } catch (error) {
    return {
      ...base, status: 'unavailable', projects: [], screenshotPath: null,
      note: `Brockovich browser-map attempt failed: ${(error as Error)?.message ?? String(error)}.`,
    };
  }
}
