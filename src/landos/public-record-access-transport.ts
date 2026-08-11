// LandOS — access observation as a TRANSPORT decorator.
//
// The honest place to learn whether a portal wants an account is the response
// it actually gave, and the GIS ladder already fetches those responses. So this
// wraps `GovFetchText` and reads along; it changes no header, no order, no
// retry, and no adapter behaviour. If this module were deleted the GIS lane
// would behave identically.
//
// Detections are buffered in memory rather than written per response, because
// the platform family is only known after fingerprinting. One host produces one
// merged row, with the right family on it, committed once at the end of a run.

import {
  detectAccessRequirement,
  mergeAuthDetections,
  type AuthDetection,
} from './public-record-auth-detection.js';
import { normalizeDeploymentDomain } from './public-record-access-types.js';
import type { PublicRecordAccessStore } from './public-record-access-store.js';
import type { GovFetchText } from './gis-transport.js';

export class AccessSignalCollector {
  private readonly byHost = new Map<string, AuthDetection>();

  observe(url: string, response: { status: number; body: string; url: string; contentType: string; blocked?: boolean }): void {
    const host = normalizeDeploymentDomain(response.url || url);
    if (!host) return;
    const detection = detectAccessRequirement({
      status: response.status,
      body: response.body,
      url: response.url || url,
      contentType: response.contentType,
      blocked: response.blocked,
    });
    // An unknown reading carries no information and must not overwrite a real one.
    if (detection.requirement === 'unknown' && detection.registration === 'not_applicable' && !this.byHost.has(host)) {
      this.byHost.set(host, detection);
      return;
    }
    this.byHost.set(host, mergeAuthDetections(this.byHost.get(host) ?? null, detection));
  }

  get(host: string): AuthDetection | null {
    return this.byHost.get(normalizeDeploymentDomain(host)) ?? null;
  }

  hosts(): string[] {
    return [...this.byHost.keys()];
  }

  /** Persist what was learned, with the platform family resolved by the caller. */
  commit(store: PublicRecordAccessStore, familyFor: (host: string) => string, at: string): void {
    for (const [deploymentDomain, detection] of this.byHost) {
      try {
        store.observe({ providerFamily: familyFor(deploymentDomain) || 'unknown', deploymentDomain }, detection, at);
      } catch {
        // Access knowledge is an aid, never a gate on the parcel result. A
        // rejected row must not fail a run that already produced real evidence.
      }
    }
  }
}

/** Same transport, now also listening. Failures pass straight through. */
export function withAccessSignals(fetchText: GovFetchText, collector: AccessSignalCollector): GovFetchText {
  return async (url, options) => {
    const response = await fetchText(url, options);
    try { collector.observe(url, response); } catch { /* observation never breaks retrieval */ }
    return response;
  };
}
