import { slug } from './runtime-helpers.mjs';

export const EXPECTED_BINDINGS = Object.freeze([
  'property.normalizedAddress',
  'property.apn',
  'property.canonicalPropertyId',
  'property.canonicalCounts.comps',
  'property.canonicalCounts.visuals',
  'expectations.imageryAvailable',
  'expectations.specialistResultsRendered',
  'expectations.noCrossPropertyContamination',
]);

export function resolveExpectedBinding(contract, binding) {
  if (!EXPECTED_BINDINGS.includes(binding)) throw new Error(`Unsupported acceptance expectedBinding ${JSON.stringify(binding)}`);
  return binding.split('.').reduce((value, key) => value?.[key], contract);
}

function requiredText(environment, name, fallback) {
  const value = environment[name]?.trim() || fallback;
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function numeric(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function flag(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (value === '1' || value.toLocaleLowerCase('en-US') === 'true') return true;
  if (value === '0' || value.toLocaleLowerCase('en-US') === 'false') return false;
  throw new Error(`${name} must be 1, 0, true, or false`);
}

function patterns(environment, name, fallback = []) {
  const value = environment[name]?.trim();
  return value ? value.split(';').map((entry) => entry.trim()).filter(Boolean) : [...fallback];
}

function changedSubject(template, property) {
  return property.normalizedAddress !== template.property.normalizedAddress
    || property.apn !== template.property.apn
    || property.canonicalPropertyId !== template.property.canonicalPropertyId;
}

/**
 * Builds the complete, approved contract in memory. Callers persist only the
 * returned object, so a run can never observe a half-updated property identity
 * or stale claim expectation.
 */
export function buildRunContract(template, {
  mode,
  startedAt,
  environment = process.env,
}) {
  if (!['fixture', 'live'].includes(mode)) throw new Error('Acceptance mode must be fixture or live');
  if (!Number.isFinite(Date.parse(startedAt)) || new Date(Date.parse(startedAt)).toISOString() !== startedAt) {
    throw new Error('startedAt must be a canonical ISO-8601 UTC timestamp');
  }

  const entryFlow = environment.LANDOS_ACCEPTANCE_ENTRY_FLOW
    ?? (mode === 'fixture' ? 'new-lead' : 'existing-deal');
  if (!['new-lead', 'existing-deal'].includes(entryFlow)) {
    throw new Error('LANDOS_ACCEPTANCE_ENTRY_FLOW must be new-lead or existing-deal');
  }

  const addressOverride = environment.LANDOS_ACCEPTANCE_PROPERTY_ADDRESS?.trim();
  const property = {
    address: requiredText(environment, 'LANDOS_ACCEPTANCE_PROPERTY_ADDRESS', template.property.address),
    normalizedAddress: requiredText(environment, 'LANDOS_ACCEPTANCE_NORMALIZED_ADDRESS', addressOverride || template.property.normalizedAddress),
    apn: requiredText(environment, 'LANDOS_ACCEPTANCE_PROPERTY_APN', template.property.apn),
    canonicalPropertyId: requiredText(environment, 'LANDOS_ACCEPTANCE_PROPERTY_ID', template.property.canonicalPropertyId),
    canonicalCounts: {
      comps: numeric(environment, 'LANDOS_ACCEPTANCE_CANONICAL_COMPS', template.property.canonicalCounts.comps),
      visuals: numeric(environment, 'LANDOS_ACCEPTANCE_CANONICAL_VISUALS', template.property.canonicalCounts.visuals),
    },
  };

  if (addressOverride && changedSubject(template, property)) {
    for (const name of ['LANDOS_ACCEPTANCE_PROPERTY_APN', 'LANDOS_ACCEPTANCE_PROPERTY_ID']) {
      if (!environment[name]?.trim()) {
        throw new Error(`${name} is required when selecting a different acceptance property`);
      }
    }
  }

  const contract = structuredClone(template);
  contract.createdAt = startedAt;
  contract.property = property;
  contract.expectations = {
    imageryAvailable: flag(environment, 'LANDOS_ACCEPTANCE_EXPECT_IMAGERY', template.expectations.imageryAvailable),
    specialistResultsRendered: flag(environment, 'LANDOS_ACCEPTANCE_EXPECT_SPECIALIST_RESULTS', template.expectations.specialistResultsRendered),
    noCrossPropertyContamination: true,
  };
  contract.runPolicy.mode = mode;
  contract.runPolicy.entryFlow = entryFlow;
  contract.runPolicy.freshnessRequired = flag(environment, 'LANDOS_ACCEPTANCE_FRESHNESS_REQUIRED', false);
  contract.runPolicy.requiredNetworkPatterns = patterns(
    environment,
    'LANDOS_ACCEPTANCE_REQUIRED_NETWORK_PATTERNS',
    mode === 'live' ? ['^/api/landos/deal-cards/'] : [],
  );
  contract.runPolicy.allowedConsoleErrorPatterns = patterns(environment, 'LANDOS_ACCEPTANCE_ALLOWED_CONSOLE_ERRORS');

  if (changedSubject(template, property)) {
    contract.contractId = requiredText(
      environment,
      'LANDOS_ACCEPTANCE_CONTRACT_ID',
      `landos-${slug(property.normalizedAddress)}-${startedAt.slice(0, 10)}`,
    );
  } else if (environment.LANDOS_ACCEPTANCE_CONTRACT_ID?.trim()) {
    contract.contractId = environment.LANDOS_ACCEPTANCE_CONTRACT_ID.trim();
  }

  for (const claim of contract.claims) {
    claim.expectedValue = resolveExpectedBinding(contract, claim.expectedBinding);
  }

  return contract;
}
