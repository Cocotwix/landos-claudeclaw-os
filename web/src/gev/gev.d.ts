// Type shims for the vendored God's Eye View module (plain JS + raw imports).
declare module '@gev-upstream/index.html?raw' {
  const html: string;
  export default html;
}

declare module '@gev-upstream/src/main.js' {
  export interface GevHostOptions {
    googleMapsKey?: string;
    cesiumIonToken?: string;
    enableVoice?: boolean;
    /** Client-side Google Geocoding calls stay hard-off unless this is true.
     *  LandOS never sets it (Map-Tiles-only key policy). */
    enableGeocoding?: boolean;
    beforeGoogleSession?: () => Promise<boolean> | boolean;
    onGoogleSessionCreated?: () => void;
  }
  export function mountGodsEyeView(options?: GevHostOptions): Promise<GevApp | null>;
  export function destroyGodsEyeView(): Promise<void>;
  export interface GevApp {
    viewer?: { useDefaultRenderLoop: boolean; destroy?: () => void };
    dataManager?: {
      layers?: Map<string, unknown>;
      isEnabled?: (id: string) => boolean;
      restoreEnabledLayerIds?: (ids: Iterable<string>) => Promise<void>;
      /** Absolute enable/disable; origin 'tool' commits durably like a click. */
      setEnabled?: (id: string, enabled: boolean, opts?: { origin?: string }) => Promise<unknown>;
    };
    requestRender?: (reason?: string) => void;
    host?: {
      googleKeyConfigured?: boolean;
      googleSessionBlocked?: boolean;
    };
    voiceCommands?: null | { stop?: (o?: { removeUi?: boolean }) => void };
  }
}
