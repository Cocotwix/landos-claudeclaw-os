import { describe, it, expect } from 'vitest';
import {
  matchFieldPhrase,
  bestSelector,
  isStableId,
  chooseExtraction,
  selectorTextScript,
  labelValueScript,
  probeElementScript,
  labelSearchScript,
  toFactConfidence,
  FIELD_ALIASES,
  LANDPORTAL_FIELDS,
} from './field-binding.js';

describe('matchFieldPhrase', () => {
  it('recognizes field-binding utterances and maps to canonical fields', () => {
    expect(matchFieldPhrase('this is the road frontage')?.field).toBe('road_frontage');
    expect(matchFieldPhrase("that's the wetlands")?.field).toBe('wetlands');
    expect(matchFieldPhrase("here's the FEMA flood zone")?.field).toBe('fema_flood');
    expect(matchFieldPhrase('mark this as slope')?.field).toBe('slope');
    expect(matchFieldPhrase('this is the parcel number')?.field).toBe('apn');
    expect(matchFieldPhrase('this is the owner name')?.field).toBe('owner');
  });

  it('prefers the longest alias (road frontage over frontage, flood zone over flood)', () => {
    expect(matchFieldPhrase('this is the road frontage')?.alias).toBe('road frontage');
    expect(matchFieldPhrase('this is the flood zone')?.field).toBe('fema_flood');
    expect(matchFieldPhrase('this is the flood zone')?.alias).toBe('flood zone');
  });

  it('does NOT bind on a bare mention without a cue (no false positives)', () => {
    expect(matchFieldPhrase('the owner is John and there are ten acres')).toBeNull();
    expect(matchFieldPhrase('let me scroll down to the wetlands section later')).toBeNull();
    expect(matchFieldPhrase('')).toBeNull();
  });

  it('covers all LandPortal fields with at least one alias', () => {
    for (const f of LANDPORTAL_FIELDS) {
      expect(FIELD_ALIASES[f]?.length, f).toBeGreaterThan(0);
    }
  });
});

describe('isStableId', () => {
  it('accepts human ids and rejects framework/generated ids', () => {
    expect(isStableId('ownerName')).toBe(true);
    expect(isStableId('field_owner_value')).toBe(true);
    expect(isStableId('12345')).toBe(false);
    expect(isStableId('row-8471023')).toBe(false);
    expect(isStableId(':r0:')).toBe(false);
    expect(isStableId('radix-42')).toBe(false);
    expect(isStableId('a')).toBe(false);
    expect(isStableId(undefined)).toBe(false);
  });
});

describe('bestSelector', () => {
  it('prefers an explicit provided selector (id-shaped → high)', () => {
    const e = bestSelector({ selector: '#owner', text: 'Jane', labelText: 'Owner' });
    expect(e).toEqual({ selector: '#owner', label: 'Owner', confidence: 'high', strategy: 'provided' });
  });

  it('uses data-testid when present', () => {
    const e = bestSelector({ testId: 'owner-value', testAttr: 'data-field', labelText: 'Owner' });
    expect(e?.selector).toBe('[data-field="owner-value"]');
    expect(e?.strategy).toBe('testid');
    expect(e?.confidence).toBe('high');
  });

  it('falls back to a stable id, then to a label anchor', () => {
    expect(bestSelector({ id: 'ownerName' })?.selector).toBe('#ownerName');
    const labelOnly = bestSelector({ labelText: 'Road Frontage' });
    expect(labelOnly).toEqual({ selector: '', label: 'Road Frontage', confidence: 'medium', strategy: 'label' });
  });

  it('uses a class selector as a last resort and supplies a fallback label', () => {
    const e = bestSelector({ classes: ['sidebar', 'value'] }, 'Owner');
    expect(e?.selector).toBe('.sidebar.value');
    expect(e?.label).toBe('Owner');
    expect(e?.strategy).toBe('class');
  });

  it('returns null when there is nothing to anchor on', () => {
    expect(bestSelector({ id: '99999' })).toBeNull();
  });
});

describe('chooseExtraction (selector-then-label fallback)', () => {
  it('prefers the selector value, falls back to label, then none', () => {
    expect(chooseExtraction('Jane Doe', 'ignored')).toEqual({ value: 'Jane Doe', strategy: 'selector' });
    expect(chooseExtraction('', 'Label Value')).toEqual({ value: 'Label Value', strategy: 'label' });
    expect(chooseExtraction('   ', 'Label Value')).toEqual({ value: 'Label Value', strategy: 'label' });
    expect(chooseExtraction('', '')).toEqual({ value: '', strategy: 'none' });
  });
});

describe('script builders', () => {
  it('produce distinguishable read-only scripts', () => {
    expect(selectorTextScript('#owner')).toContain('querySelector');
    expect(selectorTextScript('#owner')).toContain('"#owner"');
    expect(labelValueScript('Road Frontage')).toContain('LABELVALUE');
    expect(labelValueScript('Road Frontage')).toContain('road frontage');
    expect(probeElementScript('#owner')).toContain('previousElementSibling');
    expect(labelSearchScript(['owner', 'owner name'])).toContain('wants');
  });
});

describe('toFactConfidence', () => {
  it('maps binding confidence to Deal Card fact confidence', () => {
    expect(toFactConfidence('high')).toBe('high');
    expect(toFactConfidence('medium')).toBe('medium');
    expect(toFactConfidence('low')).toBe('low');
    expect(toFactConfidence(undefined)).toBe('medium');
  });
});
