// One visual identity for a comparable, used everywhere it appears.
//
// The failure this replaces: closed valuation evidence and current active
// competition were separated by nothing but a slightly different dot colour. An
// operator glancing at the map could not tell whether a cluster was six closed
// sales or six listings that nobody has bought. Those two things carry opposite
// meanings for an offer, so they must be distinguishable at a glance and in the
// same way in every surface.
//
// The identity is therefore defined ONCE here — colour, marker shape, badge text
// and card treatment — and the map markers, hover previews, pinned popups,
// cluster lists, comp cards, filters and legend all read it from this module.
// Colour alone is never the signal: every kind also has its own SHAPE, so the
// distinction survives a colour-blind operator and a small screen.

export type CompRecordKind =
  | 'subject'
  | 'closed'      // closed sale carrying valuation weight
  | 'active'      // live competition
  | 'zeroWeight'  // closed sale retained at zero valuation weight
  | 'improved'    // improved-property context
  | 'context'     // other retained context
  | 'excluded';   // excluded, restorable

export type CompMarkerShape = 'diamond' | 'circle' | 'square' | 'triangle' | 'cross';

export interface CompRecordIdentity {
  kind: CompRecordKind;
  shape: CompMarkerShape;
  color: string;
  border: string;
  /** Size in px at rest. Selection and hover grow it. */
  size: number;
  /** The unmissable badge: "CLOSED SALE", "ACTIVE COMPETITOR", … */
  badge: string;
  /** Legend / filter wording. */
  legend: string;
  /** Whether this record is closed valuation evidence. */
  isClosedEvidence: boolean;
}

export const COMP_IDENTITIES: Readonly<Record<CompRecordKind, CompRecordIdentity>> = {
  subject: {
    kind: 'subject', shape: 'diamond', color: '#2563eb', border: '#eff6ff', size: 20,
    badge: 'SUBJECT', legend: 'Subject property', isClosedEvidence: false,
  },
  closed: {
    kind: 'closed', shape: 'circle', color: '#15803d', border: '#dcfce7', size: 20,
    badge: 'CLOSED SALE', legend: 'Closed valuation comp', isClosedEvidence: true,
  },
  active: {
    kind: 'active', shape: 'square', color: '#ea7317', border: '#fff7ed', size: 18,
    badge: 'ACTIVE COMPETITOR', legend: 'Active competitor', isClosedEvidence: false,
  },
  zeroWeight: {
    kind: 'zeroWeight', shape: 'circle', color: '#9ca3af', border: '#f3f4f6', size: 14,
    badge: 'ZERO-WEIGHT SALE', legend: 'Historical / zero-weight sale', isClosedEvidence: false,
  },
  improved: {
    kind: 'improved', shape: 'triangle', color: 'transparent', border: '#8a8577', size: 16,
    badge: 'IMPROVED CONTEXT', legend: 'Improved context', isClosedEvidence: false,
  },
  context: {
    kind: 'context', shape: 'triangle', color: 'transparent', border: '#a8574a', size: 15,
    badge: 'CONTEXT RECORD', legend: 'Other context', isClosedEvidence: false,
  },
  excluded: {
    kind: 'excluded', shape: 'cross', color: '#6b7280', border: '#6b7280', size: 14,
    badge: 'EXCLUDED', legend: 'Excluded record', isClosedEvidence: false,
  },
};

/** Minimal shape of a comp needed to decide its identity. */
export interface CompIdentityInput {
  operatorExcluded: boolean;
  inValuationSet: boolean;
  transactionKind?: 'closed' | 'active' | 'context';
  category: string;
  valuationRole: string | null;
}

/**
 * Decide one record's identity.
 *
 * Order matters and is deliberate: an excluded record reads as excluded before
 * anything else, then live competition (which must never be mistaken for
 * evidence), then closed sales split by whether they actually carry weight.
 */
export function identityFor(c: CompIdentityInput): CompRecordIdentity {
  if (c.operatorExcluded) return COMP_IDENTITIES.excluded;
  if (c.transactionKind === 'active' || c.category === 'active_competition' || c.category === 'asking_reference') {
    return COMP_IDENTITIES.active;
  }
  if (c.category === 'improved_context') return COMP_IDENTITIES.improved;
  if (c.inValuationSet) return COMP_IDENTITIES.closed;
  if (c.transactionKind === 'closed' || c.valuationRole === 'historical_context' || c.valuationRole === 'boundary') {
    return COMP_IDENTITIES.zeroWeight;
  }
  return COMP_IDENTITIES.context;
}

/** The marker glyph. Shape is drawn with CSS classes, never with colour alone. */
export function MarkerGlyph({ identity, size, selected, hovered }: {
  identity: CompRecordIdentity;
  size: number;
  selected?: boolean;
  hovered?: boolean;
}) {
  return (
    <span
      class={`awv2-cv-glyph shape-${identity.shape}${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}`}
      style={{
        width: size,
        height: size,
        background: identity.shape === 'triangle' ? 'transparent' : identity.color,
        borderColor: identity.shape === 'triangle' ? identity.border : identity.color,
        ...(identity.shape === 'triangle' ? { borderBottomColor: identity.border } : {}),
      }}
      aria-hidden="true"
    />
  );
}

/** The always-visible role badge on cards, popups and cluster rows. */
export function CompKindBadge({ identity }: { identity: CompRecordIdentity }) {
  return (
    <span class={`awv2-cv-kind kind-${identity.kind}`}>
      <MarkerGlyph identity={identity} size={11} />
      {identity.badge}
    </span>
  );
}
