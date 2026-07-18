import { describe, expect, it } from 'vitest';
import { assertJarvisEgressAllowed, decideJarvisEgress } from './jarvis-egress-policy.js';

describe('Jarvis Phase 1 owner-only egress', () => {
  it('allows only the configured owner Telegram recipient', () => {
    expect(decideJarvisEgress({ channel: 'telegram', recipientId: '42', ownerRecipientId: '42' })).toEqual({
      allowed: true,
      reason: 'owner_only',
    });
  });

  it('fails closed without an owner or for a different Telegram recipient', () => {
    expect(decideJarvisEgress({ channel: 'telegram', recipientId: '42' }).allowed).toBe(false);
    expect(decideJarvisEgress({ channel: 'telegram', recipientId: '7', ownerRecipientId: '42' }).allowed).toBe(false);
  });

  it.each(['whatsapp', 'slack', 'email', 'sms', 'other'] as const)('prohibits %s before transport', (channel) => {
    expect(() => assertJarvisEgressAllowed({ channel, recipientId: 'external', ownerRecipientId: 'external' }))
      .toThrow(/outbound communication prohibited/i);
  });
});
