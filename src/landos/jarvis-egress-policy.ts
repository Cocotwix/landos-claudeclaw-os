// Phase 1 Jarvis egress boundary.
//
// Jarvis may communicate outbound only with the configured owner. External
// parties (including sellers, buyers, vendors, Slack and WhatsApp contacts) are
// never approval-gated: the transport must fail before any network call.

export type JarvisEgressChannel = 'telegram' | 'whatsapp' | 'slack' | 'email' | 'sms' | 'other';

export interface JarvisEgressRequest {
  channel: JarvisEgressChannel;
  recipientId: string;
  ownerRecipientId?: string | null;
}

export interface JarvisEgressDecision {
  allowed: boolean;
  reason: 'owner_only' | 'owner_not_configured' | 'external_channel_prohibited' | 'not_owner';
}

export function decideJarvisEgress(request: JarvisEgressRequest): JarvisEgressDecision {
  if (request.channel !== 'telegram') {
    return { allowed: false, reason: 'external_channel_prohibited' };
  }
  const owner = request.ownerRecipientId?.trim();
  if (!owner) return { allowed: false, reason: 'owner_not_configured' };
  if (request.recipientId.trim() !== owner) return { allowed: false, reason: 'not_owner' };
  return { allowed: true, reason: 'owner_only' };
}

export function assertJarvisEgressAllowed(request: JarvisEgressRequest): void {
  const decision = decideJarvisEgress(request);
  if (!decision.allowed) {
    throw new Error(`Max outbound communication prohibited: ${decision.reason}`);
  }
}
