import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  'utf8',
);

describe('current utility truth wiring', () => {
  it('feeds mission, property intelligence, strategy readiness and missing diligence from projection.knowledge', () => {
    const live = read('./property-intelligence-live.ts');
    const canonical = read('./deal-card-canonical.ts');
    const routes = read('./routes.ts');
    const readiness = read('./research-readiness-reconcile.ts');

    expect(readiness).toContain('projectUtilityAvailability(availabilityRecord');
    expect(live).toContain('availability?.knowledge.fullyKnown ?? false');
    expect(canonical).toContain('input.utilityKnowledge?.fullyKnown === true');
    expect(routes.match(/utilityAvailability\?\.knowledge\.fullyKnown \?\? false/g)).toHaveLength(2);
  });

  it('contains no older fuzzy utility-card or DD-grade override', () => {
    const live = read('./property-intelligence-live.ts');
    const canonical = read('./deal-card-canonical.ts');
    const routes = read('./routes.ts');

    expect(live).not.toContain("!!utilitiesCard && utilitiesCard.verdict !== 'unknown'");
    expect(canonical).not.toContain("decisionCards.find((c) => c.key === 'utilities' && c.verdict !== 'unknown')");
    expect(routes).not.toContain("utilitiesKnown: !!utilities && !['unresolved_question', 'unavailable_public_record'].includes(utilities.grade)");
    expect(routes).not.toContain("utilitiesConfirmed: resolvedVerdict('utilities')");
  });
});
