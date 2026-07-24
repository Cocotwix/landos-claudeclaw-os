// Shared LandPortal-comparable valuation rule.
//
// Tyler's underwriting rule is intentionally source-specific: retain every
// provider's comp evidence for review, but calculate FMV and the 40-60% rough
// acquisition range from up to five usable LandPortal comparable rows. When
// fewer than five exist, use every usable row rather than blocking pricing.

export interface LandPortalComparableLike {
  rawText?: string;
  sourceUrl?: string | null;
  apn?: string | null;
  address?: string | null;
  saleDate?: string | null;
  acres?: number | null;
  price?: number | null;
  pricePerAcre?: number | null;
  distanceMiles?: number | null;
  status?: string | null;
  saleListIndicator?: string | null;
  improvement?: string | null;
  confidence?: string | null;
}

export interface LandPortalValuationRow extends LandPortalComparableLike {
  acres: number;
  price: number;
  pricePerAcre: number;
}

export interface LandPortalValuationStats {
  comps: LandPortalValuationRow[];
  count: number;
  averagePricePerAcre: number | null;
}

function usable(row: LandPortalComparableLike): row is LandPortalComparableLike & { acres: number; price: number } {
  return typeof row.acres === 'number' && Number.isFinite(row.acres) && row.acres > 0
    && typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0;
}

/** Rank by acreage similarity first, then known distance. LandPortal's visible
 * comparable set is already local; this keeps a remote size match from beating
 * a materially closer parcel when the size differences are effectively tied. */
export function landPortalValuationStats(
  rows: LandPortalComparableLike[] | null | undefined,
  subjectAcres: number | null | undefined,
): LandPortalValuationStats {
  const acres = typeof subjectAcres === 'number' && subjectAcres > 0 ? subjectAcres : null;
  const ranked = (rows ?? [])
    .filter(usable)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (acres != null) {
        const aDelta = Math.abs(a.row.acres - acres) / acres;
        const bDelta = Math.abs(b.row.acres - acres) / acres;
        if (Math.abs(aDelta - bDelta) > 0.02) return aDelta - bDelta;
      }
      const aDistance = typeof a.row.distanceMiles === 'number' ? a.row.distanceMiles : Number.POSITIVE_INFINITY;
      const bDistance = typeof b.row.distanceMiles === 'number' ? b.row.distanceMiles : Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return a.index - b.index;
    })
    .slice(0, 5)
    .map(({ row }): LandPortalValuationRow => ({
      ...row,
      acres: row.acres,
      price: row.price,
      // Exact price / acres is the auditable arithmetic; do not trust a stale or
      // rounded provider PPA when both transaction inputs are present.
      pricePerAcre: Math.round(row.price / row.acres),
    }));
  return {
    comps: ranked,
    count: ranked.length,
    averagePricePerAcre: ranked.length
      ? Math.round(ranked.reduce((sum, row) => sum + row.pricePerAcre, 0) / ranked.length)
      : null,
  };
}
