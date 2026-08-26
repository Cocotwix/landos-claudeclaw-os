import { useEffect, useRef } from 'preact/hooks';
import { Link } from 'wouter-preact';
import { mountGev, releaseGev, gevPhase, gevGoogleState } from '@/gev/host';

/**
 * God's Eye View — top-level LandOS department hosting the complete vendored
 * upstream application (no iframe). The host adapter owns mount/suspend/
 * destroy; this page is a thin lifecycle shell plus honest provider-state
 * banners. The `transform` on the outer div makes upstream's fixed-position
 * panels contain themselves to this page instead of covering the sidebar.
 */
export function GodsEyeView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) void mountGev(el);
    return () => { releaseGev(); };
  }, []);

  const phase = gevPhase.value;
  const google = gevGoogleState.value;

  return (
    <div
      class="relative h-full w-full overflow-hidden bg-[#0a0a0f]"
      style={{ transform: 'translate(0,0)' }}
      data-testid="gods-eye-view-department"
    >
      <div ref={containerRef} class="absolute inset-0" />

      {phase === 'error' && (
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]">
          <div class="max-w-md text-center px-6">
            <div class="text-[15px] font-semibold text-red-400 mb-2">God's Eye View failed to start</div>
            <div class="text-[13px] text-[#8b8fa3]">
              The console has the details. The rest of LandOS is unaffected — use the sidebar to
              navigate away, then reopen this department to retry.
            </div>
          </div>
        </div>
      )}

      {phase === 'ready' && google === 'no-key' && (
        <div class="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-xl rounded-lg border border-[#2a2f45] bg-[#101322]/95 px-4 py-2.5 text-[12.5px] text-[#c6cadf] shadow-lg">
          <span class="font-semibold text-[#e8eaed]">Google Photorealistic 3D Tiles: setup required.</span>{' '}
          Running on the keyless map (OSM / Cesium globe). Add a browser-safe Google Maps key
          restricted to the Map Tiles API + localhost origins in{' '}
          <Link href="/settings" class="underline text-[#00d4ff]">Settings → God's Eye View</Link>.
          No Google request is made until a key is configured.
        </div>
      )}

      {phase === 'ready' && google === 'limit-blocked' && (
        <div class="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-xl rounded-lg border border-amber-700/50 bg-[#1a1410]/95 px-4 py-2.5 text-[12.5px] text-[#e8d9c0] shadow-lg">
          <span class="font-semibold">Google 3D Tiles paused by the local monthly session safeguard.</span>{' '}
          Running on the keyless map. Review usage in{' '}
          <Link href="/settings" class="underline text-[#00d4ff]">Settings → God's Eye View</Link>.
        </div>
      )}
    </div>
  );
}
