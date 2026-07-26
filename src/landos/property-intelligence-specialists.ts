// Property Intelligence specialist catalog — the parent mission's work plan.
//
// One operator action starts ONE parent Property Intelligence mission. The
// mission dispatches these specialists; the operator never coordinates them by
// hand. Each specialist owns a separate source lane so a provider outage in one
// lane cannot silently degrade another, and so the final synthesis can name
// exactly which contribution is missing.
//
// Pure. No I/O. The runner supplies the execution; this file is the contract.

export type SpecialistId =
  | 'parcel_identity'
  | 'government_records'
  | 'zoning_land_use'
  | 'environmental_terrain'
  | 'access_utilities'
  | 'comparables'
  | 'market_intelligence'
  | 'valuation_strategy'
  | 'evidence_visuals'
  | 'synthesis_review';

export type SpecialistStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface SpecialistDefinition {
  id: SpecialistId;
  label: string;
  /** One line the operator reads on the progress panel. */
  purpose: string;
  /** Specialists whose results this one consumes. */
  dependsOn: SpecialistId[];
  /**
   * `required` — a missing result must show as a gap in the final synthesis.
   * `supporting` — useful, but its absence alone never blocks a conclusion.
   */
  role: 'required' | 'supporting';
  /**
   * True when the specialist cannot produce parcel-specific work until parcel
   * identity is established. These are skipped (never failed) on an unresolved
   * parcel, and the skip reason is surfaced.
   */
  requiresConfirmedIdentity: boolean;
  timeoutMs: number;
}

export const PROPERTY_INTELLIGENCE_SPECIALISTS: SpecialistDefinition[] = [
  {
    id: 'parcel_identity',
    label: 'Parcel identity',
    purpose: 'Resolve the subject parcel against official sources and reconcile APN, owner, acreage, situs and geometry.',
    dependsOn: [],
    role: 'required',
    requiresConfirmedIdentity: false,
    timeoutMs: 180_000,
  },
  {
    id: 'government_records',
    label: 'Government records',
    purpose: 'Retrieve and retain assessor, deed/recorder, ownership, legal description, tax and assessed-value evidence.',
    dependsOn: ['parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: true,
    timeoutMs: 240_000,
  },
  {
    id: 'zoning_land_use',
    label: 'Zoning and land use',
    purpose: 'Establish the zoning district, future land use, and the development rules that govern what may be built.',
    dependsOn: ['parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: true,
    timeoutMs: 180_000,
  },
  {
    id: 'environmental_terrain',
    label: 'Environmental and terrain',
    purpose: 'Screen floodplain, wetlands, soils and septic suitability, slope, and mapped water features.',
    dependsOn: ['parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: true,
    timeoutMs: 180_000,
  },
  {
    id: 'access_utilities',
    label: 'Access, frontage and utilities',
    purpose: 'Determine legal and physical access, road frontage, discoverable easements, and utility availability.',
    dependsOn: ['parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: true,
    timeoutMs: 180_000,
  },
  {
    id: 'comparables',
    label: 'Comparable sales and competition',
    purpose: 'Collect vacant-land comparable sales and active competition under the approved comp source policy.',
    dependsOn: ['parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: false,
    timeoutMs: 300_000,
  },
  {
    id: 'market_intelligence',
    label: 'Market intelligence',
    purpose: 'Assemble the Market Matrix and Market Pulse context around the subject market.',
    dependsOn: ['parcel_identity'],
    role: 'supporting',
    requiresConfirmedIdentity: false,
    timeoutMs: 180_000,
  },
  {
    id: 'valuation_strategy',
    label: 'Valuation and strategy',
    purpose: 'Produce a defensible value conclusion and evaluate the five approved LandOS strategies.',
    dependsOn: ['comparables', 'parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: false,
    timeoutMs: 120_000,
  },
  {
    id: 'evidence_visuals',
    label: 'Evidence and visuals',
    purpose: 'Retain screenshots, maps, documents, source links and structured evidence for everything concluded.',
    dependsOn: ['parcel_identity'],
    role: 'required',
    requiresConfirmedIdentity: false,
    timeoutMs: 180_000,
  },
  {
    id: 'synthesis_review',
    label: 'Synthesis and quality review',
    purpose: 'Join every specialist result into one snapshot and name any missing or contradictory contribution.',
    dependsOn: [
      'parcel_identity',
      'government_records',
      'zoning_land_use',
      'environmental_terrain',
      'access_utilities',
      'comparables',
      'market_intelligence',
      'valuation_strategy',
      'evidence_visuals',
    ],
    role: 'required',
    requiresConfirmedIdentity: false,
    timeoutMs: 60_000,
  },
];

const BY_ID = new Map(PROPERTY_INTELLIGENCE_SPECIALISTS.map((s) => [s.id, s]));

export function specialistDefinition(id: SpecialistId): SpecialistDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown Property Intelligence specialist: ${id}`);
  return found;
}

/**
 * Execution waves. Specialists inside a wave run concurrently; a wave starts
 * only once every specialist it depends on has settled (in any terminal state,
 * so one failure never strands the rest of the mission).
 */
export function specialistWaves(): SpecialistId[][] {
  const waves: SpecialistId[][] = [];
  const settled = new Set<SpecialistId>();
  const pending = new Set<SpecialistId>(PROPERTY_INTELLIGENCE_SPECIALISTS.map((s) => s.id));

  while (pending.size > 0) {
    const wave = [...pending].filter((id) => specialistDefinition(id).dependsOn.every((dep) => settled.has(dep)));
    if (wave.length === 0) {
      throw new Error('Property Intelligence specialist graph has a dependency cycle.');
    }
    waves.push(wave);
    for (const id of wave) { pending.delete(id); settled.add(id); }
  }
  return waves;
}

/** Terminal states — a mission may only finish once every specialist is here. */
export const TERMINAL_SPECIALIST_STATUSES: readonly SpecialistStatus[] = ['completed', 'partial', 'failed', 'blocked', 'skipped'];

export function isTerminalSpecialistStatus(status: SpecialistStatus): boolean {
  return TERMINAL_SPECIALIST_STATUSES.includes(status);
}

/** True when the specialist contributed something the synthesis can use. */
export function contributedResult(status: SpecialistStatus): boolean {
  return status === 'completed' || status === 'partial';
}
