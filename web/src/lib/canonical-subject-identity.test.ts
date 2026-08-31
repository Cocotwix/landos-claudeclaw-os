// Canonical current identity outranks a derived intelligence snapshot.
//
// A Deal whose accepted APN had been corrected still showed the OLD identifier
// on the operator's header after a hard refresh, because the header read the
// deal-intelligence snapshot first. A snapshot is a point-in-time read of a run
// that may have executed against an identity since corrected or superseded; it
// can never override the current accepted property record.

import { describe, expect, it } from 'vitest';
import { canonicalSubjectIdentity } from './format';

const STALE = { apn: '00083-A-034001.5', owner: 'STALE OWNER', county: 'Bradford', state_: 'FL' };

describe('stale intelligence identity never overrides newer canonical identity', () => {
  it('shows the corrected parcel number, not the snapshot it superseded', () => {
    const subject = canonicalSubjectIdentity(
      { apn: '00083-A-03400', owner: 'HILL EUGENE W', county: 'Bradford', state: 'FL' },
      STALE,
    );
    expect(subject.apn).toBe('00083-A-03400');
    expect(subject.owner).toBe('HILL EUGENE W');
    expect(subject.state).toBe('FL');
  });

  it('still falls back to the snapshot for a field the record does not carry', () => {
    const subject = canonicalSubjectIdentity({ apn: null, owner: '', county: null, state: null }, STALE);
    expect(subject.apn).toBe('00083-A-034001.5');
    expect(subject.owner).toBe('STALE OWNER');
    expect(subject.state).toBe('FL');
  });

  it('is empty, never fabricated, when neither source carries the field', () => {
    expect(canonicalSubjectIdentity(null, null)).toEqual({ apn: '', owner: '', county: '', state: '' });
  });
});
