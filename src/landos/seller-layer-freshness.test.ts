import { describe, expect, it } from 'vitest';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { SellerIntelligenceProduct } from './intelligence-stack-contract.js';
import { sellerLayerCurrent, sellerLayerFingerprint } from './intelligence-stack.js';

// Deal 89's Seller and Deal Brain products vanished from the Overview after a
// build reshaped the seller slice of the dossier. Nothing about the seller had
// changed: no contact, no communication, no stated price. A schema shape change
// is not a seller change.

function sellerSlice(overrides: Partial<AcquisitionDossier['seller']> = {}): AcquisitionDossier['seller'] {
  return {
    present: false,
    name: null,
    askingPrice: null,
    stage: null,
    people: [],
    profile: null,
    sellerReportedFacts: [],
    communications: [],
    discovery: [],
    ...overrides,
  } as AcquisitionDossier['seller'];
}

const dossierWith = (seller: AcquisitionDossier['seller']): AcquisitionDossier =>
  ({ seller } as AcquisitionDossier);

function preContactProduct(overrides: Partial<SellerIntelligenceProduct> = {}): SellerIntelligenceProduct {
  return {
    state: 'pre_contact',
    phase: 'pre_call',
    layerFingerprint: 'fingerprint-from-the-old-seller-shape',
    ...overrides,
  } as SellerIntelligenceProduct;
}

describe('seller layer freshness', () => {
  it('keeps a deterministic pre-contact read current when only the seller slice shape moved', () => {
    const dossier = dossierWith(sellerSlice());
    const current = sellerLayerFingerprint(dossier, false, 'pre_call');
    expect(current).not.toBe('fingerprint-from-the-old-seller-shape');

    expect(sellerLayerCurrent({
      product: preContactProduct(),
      dossier,
      sellerEstablished: false,
      phase: 'pre_call',
      fingerprint: current,
    })).toBe(true);
  });

  it('stales once seller contact is actually established', () => {
    const dossier = dossierWith(sellerSlice({ present: true, askingPrice: 120_000 }));
    expect(sellerLayerCurrent({
      product: preContactProduct(),
      dossier,
      sellerEstablished: true,
      phase: 'in_negotiation' as never,
      fingerprint: sellerLayerFingerprint(dossier, true, 'in_negotiation' as never),
    })).toBe(false);
  });

  it('stales on a material lifecycle phase change', () => {
    const dossier = dossierWith(sellerSlice());
    expect(sellerLayerCurrent({
      product: preContactProduct({ phase: 'pre_call' }),
      dossier,
      sellerEstablished: false,
      phase: 'post_call' as never,
      fingerprint: sellerLayerFingerprint(dossier, false, 'post_call' as never),
    })).toBe(false);
  });

  it('stales on substantive seller-reported information even before contact is established', () => {
    const dossier = dossierWith(sellerSlice({
      sellerReportedFacts: [{ statement: 'Owner says the creek floods the north field', source: 'note', at: null }],
    }));
    expect(sellerLayerCurrent({
      product: preContactProduct(),
      dossier,
      sellerEstablished: false,
      phase: 'pre_call',
      fingerprint: sellerLayerFingerprint(dossier, false, 'pre_call'),
    })).toBe(false);
  });

  it('never treats a missing product as current, and honours an exact fingerprint match', () => {
    const dossier = dossierWith(sellerSlice());
    const fingerprint = sellerLayerFingerprint(dossier, false, 'pre_call');
    expect(sellerLayerCurrent({ product: null, dossier, sellerEstablished: false, phase: 'pre_call', fingerprint }))
      .toBe(false);
    // A model-produced (non pre-contact) read still lives or dies by its fingerprint.
    expect(sellerLayerCurrent({
      product: preContactProduct({ state: 'established' as never, layerFingerprint: fingerprint }),
      dossier,
      sellerEstablished: false,
      phase: 'pre_call',
      fingerprint,
    })).toBe(true);
    expect(sellerLayerCurrent({
      product: preContactProduct({ state: 'established' as never }),
      dossier,
      sellerEstablished: false,
      phase: 'pre_call',
      fingerprint,
    })).toBe(false);
  });
});

describe('pre-contact products written before the phase field existed', () => {
  it('stays current while the deal is still pre-call', () => {
    const dossier = dossierWith(sellerSlice());
    expect(sellerLayerCurrent({
      product: preContactProduct({ phase: undefined }),
      dossier,
      sellerEstablished: false,
      phase: 'pre_call',
      fingerprint: sellerLayerFingerprint(dossier, false, 'pre_call'),
    })).toBe(true);
  });

  it('stales once the deal has moved past pre-call', () => {
    const dossier = dossierWith(sellerSlice());
    expect(sellerLayerCurrent({
      product: preContactProduct({ phase: undefined }),
      dossier,
      sellerEstablished: false,
      phase: 'underwriting',
      fingerprint: sellerLayerFingerprint(dossier, false, 'underwriting'),
    })).toBe(false);
  });
});
