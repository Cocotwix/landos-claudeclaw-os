import type { PropertyEvidencePackage } from './property-evidence';

/**
 * Shared spatial platform boundary.
 *
 * Any LandOS department can hand God's Eye View structured spatial context
 * without touching upstream code and without rerunning research:
 *
 *   import { openPropertyInGodsEyeView } from '@/gev/spatial-platform';
 *   openPropertyInGodsEyeView(pkg);           // navigates + flies to subject
 *
 * The pending context survives the route transition via sessionStorage; the
 * host adapter applies it after the app is mounted (or resumed). Applying is
 * purely visual — camera flight plus subject/comp/listing markers drawn as
 * Cesium entities — no model calls, no research, no valuation math.
 */

const PENDING_KEY = 'landos.gev.pendingSpatialContext';

export interface SpatialContext {
  package: PropertyEvidencePackage;
  /** Camera height above the subject in meters (default 2500). */
  viewHeightM?: number;
}

export function openPropertyInGodsEyeView(pkg: PropertyEvidencePackage, opts: { viewHeightM?: number; navigate?: (path: string) => void } = {}): void {
  const ctx: SpatialContext = { package: pkg, viewHeightM: opts.viewHeightM };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(ctx));
  } catch { /* storage full/blocked — the fly-to just won't happen */ }
  if (opts.navigate) opts.navigate('/dept/gods-eye-view');
  else window.location.assign('/dept/gods-eye-view');
}

export function peekPendingSpatialContext(): SpatialContext | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpatialContext;
    if (!parsed?.package?.subject) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface CesiumLike {
  Cartesian3: { fromDegrees: (lon: number, lat: number, height?: number) => unknown };
  Color: { fromCssColorString: (s: string) => unknown };
  VerticalOrigin: { BOTTOM: unknown };
  HeightReference: { CLAMP_TO_GROUND: unknown };
  LabelStyle: { FILL_AND_OUTLINE: unknown };
  Cartesian2: new (x: number, y: number) => unknown;
}

let contextEntities: unknown[] = [];

/**
 * Apply (and consume) the pending spatial context against the live app.
 * Called by the host adapter after mount/resume. Safe no-op without context.
 */
export async function applyPendingSpatialContext(): Promise<void> {
  const ctx = peekPendingSpatialContext();
  if (!ctx) return;
  const app = (window as { __godsEyeView?: { viewer?: unknown } }).__godsEyeView;
  const viewer = app?.viewer as {
    camera?: { flyTo: (o: Record<string, unknown>) => void };
    entities?: { add: (o: Record<string, unknown>) => unknown; remove: (e: unknown) => void };
  } | undefined;
  if (!viewer?.camera || !viewer.entities) return;

  // The cesium module is already loaded (the app is running); this dynamic
  // import resolves from cache and never affects the main LandOS bundle.
  const Cesium = await import('cesium') as unknown as CesiumLike;
  const { package: pkg } = ctx;

  for (const e of contextEntities) { try { viewer.entities.remove(e); } catch { /* gone already */ } }
  contextEntities = [];

  const marker = (point: { lat: number; lon: number }, label: string, color: string): void => {
    try {
      const entity = viewer.entities!.add({
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.fromCssColorString('#06121c'),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: label,
          font: '600 13px "JetBrains Mono", monospace',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.fromCssColorString('#e8eaed'),
          outlineColor: Cesium.Color.fromCssColorString('#06121c'),
          outlineWidth: 3,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      contextEntities.push(entity);
    } catch { /* marker is best-effort */ }
  };

  const subjectLabel = pkg.address ?? pkg.apn ?? 'SUBJECT';
  marker(pkg.subject, `◉ ${String(subjectLabel)}`, '#00d4ff');

  for (const comp of pkg.soldComps ?? []) {
    if (!comp.point) continue;
    const ppa = comp.pricePerAcre ? ` $${Math.round(comp.pricePerAcre).toLocaleString()}/ac` : '';
    marker(comp.point, `SOLD${ppa}`, '#37d67a');
  }
  for (const listing of pkg.activeListings ?? []) {
    if (!listing.point) continue;
    const ppa = listing.pricePerAcre ? ` $${Math.round(listing.pricePerAcre).toLocaleString()}/ac` : '';
    marker(listing.point, `ACTIVE${ppa}`, '#f5a623');
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(pkg.subject.lon, pkg.subject.lat, ctx.viewHeightM ?? 2500),
    duration: 3,
  });

  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* best-effort */ }
}
