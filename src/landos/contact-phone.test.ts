import { describe, expect, it } from 'vitest';
import { extractSafePhone } from './contact-phone.js';

describe('safe contact phone extraction', () => {
  it('accepts a separately labeled phone without punctuation', () => {
    const raw = 'Seller: Maria Hernandez\nPhone 704-555-0182\nAPN: 123-45-678';
    expect(extractSafePhone(raw)).toBe('704-555-0182');
  });

  it('does not extract a phone-shaped span from a full APN', () => {
    const raw = 'Owner: WILKINSON DANIEL\nAPN: 053889-075-000-0001-024-011-0000';
    expect(extractSafePhone(raw)).toBeNull();
  });

  it('keeps a real labeled phone even when an APN follows on another line', () => {
    const raw = 'Phone: (315) 555-0182\nParcel ID: 053889-075-000-0001-024-011-0000';
    expect(extractSafePhone(raw)).toBe('(315) 555-0182');
  });
});
