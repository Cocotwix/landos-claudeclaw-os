import { describe, it, expect } from 'vitest';
import { decideAttachment } from './deal-card-attachment-policy.js';

describe('Deal Card attachment policy', () => {
  it('property-specific output (DD) with an apn attaches to the Deal Card', () => {
    const d = decideAttachment({ agentKey: 'dd_bot', apn: 'APN-1' });
    expect(d.attachToDealCard).toBe(true);
    expect(d.knowledgeDestination).toBeNull();
  });

  it('property-class output WITHOUT an apn cannot attach (held in knowledge layer)', () => {
    const d = decideAttachment({ agentKey: 'dd_bot', apn: null });
    expect(d.attachToDealCard).toBe(false);
    expect(d.knowledgeDestination).toContain('agents/dd_bot/knowledge');
  });

  it('business output (county scorecard) never attaches to a Deal Card', () => {
    const d = decideAttachment({ agentKey: 'market_bot', apn: 'APN-1' });
    expect(d.attachToDealCard).toBe(false);
    expect(d.knowledgeDestination).toBe('markets/');
  });

  it('conditional output attaches ONLY when tied to a specific property', () => {
    expect(decideAttachment({ agentKey: 'research_bot', apn: 'APN-9' }).attachToDealCard).toBe(true);
    expect(decideAttachment({ agentKey: 'research_bot' }).attachToDealCard).toBe(false);
  });

  it('competitor/AI/system intelligence routes to the knowledge layer, not Deal Cards', () => {
    expect(decideAttachment({ agentKey: 'spy_bot', apn: 'APN-1' }).attachToDealCard).toBe(false);
    expect(decideAttachment({ agentKey: 'ai_bot' }).knowledgeDestination).toBe('intelligence/');
    expect(decideAttachment({ agentKey: 'sys_bot' }).knowledgeDestination).toBe('system/');
  });
});
