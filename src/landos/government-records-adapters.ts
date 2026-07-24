import { platformKey, rememberPlatform } from './platform-library.js';
import type {
  GovernmentRecordCollectorAdapter,
} from './government-records-operator.js';
import type {
  GovernmentRecordDomain,
} from './government-records-types.js';
import type { PropertyIdentityVersion } from './property-summary-slice.js';

export interface OfficialGovernmentSource {
  jurisdiction: string;
  authority: string;
  url: string;
  sourceType: 'recorder' | 'clerk' | 'tax' | 'court' | 'assessor' | 'gis';
  platformHint?: string | null;
  configuration?: Record<string, unknown>;
}

export interface GovernmentRecordAdapterDefinition {
  key: string;
  platform: string;
  supports(source: OfficialGovernmentSource): boolean;
  create(source: OfficialGovernmentSource): GovernmentRecordCollectorAdapter;
}

export interface ResolvedGovernmentRecordCollector {
  jurisdiction: string;
  source: OfficialGovernmentSource;
  platform: string;
  adapterKey: string;
  resolution: 'known_adapter' | 'adaptive_browser_fallback';
  adapter: GovernmentRecordCollectorAdapter;
}

const SOURCE_PRIORITY: Record<GovernmentRecordDomain, OfficialGovernmentSource['sourceType'][]> = {
  deed_ownership: ['recorder', 'clerk', 'assessor'],
  surveys_plats: ['recorder', 'clerk', 'gis'],
  recorded_encumbrances: ['recorder', 'clerk'],
  property_tax: ['tax', 'assessor'],
  lien_judgment: ['recorder', 'clerk', 'court', 'tax'],
};

export class GovernmentRecordAdapterRegistry {
  private readonly definitions: GovernmentRecordAdapterDefinition[] = [];

  register(definition: GovernmentRecordAdapterDefinition): this {
    if (this.definitions.some((candidate) => candidate.key === definition.key)) {
      throw new Error(`Government-record adapter "${definition.key}" is already registered.`);
    }
    this.definitions.push(definition);
    return this;
  }

  resolve(input: {
    identity: PropertyIdentityVersion;
    domain: GovernmentRecordDomain;
    officialSources: OfficialGovernmentSource[];
    makeAdaptiveFallback(source: OfficialGovernmentSource): GovernmentRecordCollectorAdapter;
  }): ResolvedGovernmentRecordCollector {
    if (input.identity.status !== 'confirmed') throw new Error('Confirmed property identity is required before source resolution.');
    const priorities = SOURCE_PRIORITY[input.domain];
    const source = [...input.officialSources]
      .filter((candidate) => candidate.jurisdiction.trim())
      .sort((left, right) => priorities.indexOf(left.sourceType) - priorities.indexOf(right.sourceType))
      .find((candidate) => priorities.includes(candidate.sourceType));
    if (!source) throw new Error(`No applicable official source is configured for ${input.domain}.`);
    const known = this.definitions.find((definition) => definition.supports(source));
    if (known) {
      return {
        jurisdiction: source.jurisdiction,
        source,
        platform: known.platform,
        adapterKey: known.key,
        resolution: 'known_adapter',
        adapter: known.create(source),
      };
    }
    const adaptive = input.makeAdaptiveFallback(source);
    return {
      jurisdiction: source.jurisdiction,
      source,
      platform: adaptive.platform || platformKey(source.url),
      adapterKey: adaptive.key,
      resolution: 'adaptive_browser_fallback',
      adapter: adaptive,
    };
  }
}

/**
 * Records only the value-free navigation pattern after a successful official
 * retrieval. Property values, credentials, cookies, and document bytes never
 * enter the reusable platform library.
 */
export function rememberSuccessfulGovernmentNavigation(input: {
  source: OfficialGovernmentSource;
  domain: GovernmentRecordDomain;
  adapterKey: string;
  navigationPattern: string;
  authRequired: boolean;
}): void {
  rememberPlatform(input.source.url, {
    classification: input.source.platformHint || 'government_public_records',
    navPatterns: `${input.domain}:${input.adapterKey}:${input.navigationPattern}`,
    authRequired: input.authRequired,
    confidence: 'high',
    used: true,
    succeeded: true,
    validatedNow: true,
    knownLimitations: [],
    taskBoundary: {
      allowed: ['public property record search', 'free official document retrieval'],
      restricted: ['free account registration under managed government-account policy'],
      forbidden: ['payment', 'access-control bypass', 'CAPTCHA bypass'],
    },
  });
}
