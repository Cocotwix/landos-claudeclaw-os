import { describe, it, expect } from 'vitest';
import { scanForSecrets, redactSecrets } from './exfiltration-guard.js';

describe('scanForSecrets', () => {
  // ── Anthropic keys ─────────────────────────────────────────────────

  it('detects sk-ant- Anthropic API key pattern', () => {
    const text = 'my key is sk-ant-api03-abcdefghijklmnopqrstuvwx';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('anthropic_key');
    expect(matches[0].preview).toBe('sk-ant-a...');
  });

  // ── Generic SK keys ────────────────────────────────────────────────

  it('detects generic sk- keys without double-matching Anthropic keys', () => {
    const text = 'token: sk-proj-abc123def456ghi789jkl012mno';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('generic_sk_key');
  });

  // ── Slack tokens ───────────────────────────────────────────────────

  it('detects xoxb- Slack bot token', () => {
    const text = 'SLACK_TOKEN=xoxb-1234567890-abcdefghij';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('slack_token');
    expect(matches[0].preview).toBe('xoxb-123...');
  });

  it('detects xoxp- Slack user token', () => {
    const text = 'token is xoxp-9876543210-abcdefghij';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('slack_token');
  });

  // ── GitHub tokens ──────────────────────────────────────────────────

  it('detects ghp_ GitHub personal access token', () => {
    const text = 'export GH_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('github_token');
  });

  it('detects gho_ GitHub OAuth token', () => {
    const text = 'auth: gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('github_token');
  });

  // ── AWS keys ───────────────────────────────────────────────────────

  it('detects AKIA AWS access key', () => {
    const text = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('aws_key');
    expect(matches[0].preview).toBe('AKIAIOSF...');
    // Verify position and length
    const start = text.indexOf('AKIA');
    expect(matches[0].position).toBe(start);
    expect(matches[0].length).toBe(20);
  });

  // ── Hex strings ────────────────────────────────────────────────────

  it('detects 64-char hex string as potential encryption key', () => {
    const hex64 = 'a'.repeat(64);
    const text = `encryption_key=${hex64}`;
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('hex_key');
    expect(matches[0].length).toBe(64);
  });

  it('does NOT flag 40-char hex preceded by "commit " (git SHA)', () => {
    const sha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const text = `commit ${sha}`;
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(0);
  });

  it('does NOT flag short hex strings (< 40 chars)', () => {
    const text = 'color: #ff00aa; id: 0deadbeef123;';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(0);
  });

  it('flags 40-char hex NOT preceded by git patterns', () => {
    const hex40 = 'abcdef1234567890abcdef1234567890abcdef12';
    const text = `secret_key=${hex40}`;
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('hex_key');
  });

  // ── Protected env values ───────────────────────────────────────────

  it('detects base64-encoded version of a protected value', () => {
    const secret = 'my-super-secret-api-key-12345';
    const encoded = Buffer.from(secret).toString('base64');
    const text = `data: ${encoded} trailing`;
    const matches = scanForSecrets(text, [secret]);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('env_value');
    expect(matches[0].position).toBe(text.indexOf(encoded));
    expect(matches[0].length).toBe(encoded.length);
  });

  it('detects URL-encoded version of a protected value', () => {
    const secret = 'key=value&other=thing!@#';
    const encoded = encodeURIComponent(secret);
    const text = `param=${encoded}`;
    const matches = scanForSecrets(text, [secret]);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('env_value');
  });

  it('ignores protected values 8 chars or shorter', () => {
    const text = 'some text with short12 embedded';
    const matches = scanForSecrets(text, ['short']);
    expect(matches).toHaveLength(0);
  });

  // ── Clean text ─────────────────────────────────────────────────────

  it('returns empty array for clean text', () => {
    const text = 'This is a normal message with no secrets whatsoever.';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(0);
  });

  // ── Multiline ──────────────────────────────────────────────────────

  it('handles multiline text correctly', () => {
    const text = [
      'Line 1: normal text',
      'Line 2: sk-ant-api03-abcdefghijklmnopqrstuvwx',
      'Line 3: more normal text',
      'Line 4: xoxb-1234567890-abcdefghij',
      'Line 5: end',
    ].join('\n');
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(2);
    expect(matches[0].type).toBe('anthropic_key');
    expect(matches[1].type).toBe('slack_token');
    // Verify positions are correct across lines
    expect(matches[0].position).toBe(text.indexOf('sk-ant-'));
    expect(matches[1].position).toBe(text.indexOf('xoxb-'));
  });

  // ── Position and length accuracy ───────────────────────────────────

  it('returns correct position and length for each match', () => {
    const prefix = 'some text before ';
    const key = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    const text = prefix + key + ' some text after';
    const matches = scanForSecrets(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].position).toBe(prefix.length);
    expect(matches[0].length).toBe(key.length);
    // Verify the match extracts the right substring
    expect(text.slice(matches[0].position, matches[0].position + matches[0].length)).toBe(key);
  });
});

describe('redactSecrets', () => {
  it('replaces matches with [REDACTED]', () => {
    const text = 'key: sk-ant-api03-abcdefghijklmnopqrstuvwx end';
    const matches = scanForSecrets(text);
    const redacted = redactSecrets(text, matches);
    expect(redacted).toBe('key: [REDACTED] end');
    expect(redacted).not.toContain('sk-ant-');
  });

  it('handles multiple matches', () => {
    const text = 'a: xoxb-123456789012345 b: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345 c';
    const matches = scanForSecrets(text);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const redacted = redactSecrets(text, matches);
    expect(redacted).not.toContain('xoxb-');
    expect(redacted).not.toContain('ghp_');
    expect(redacted).toContain('[REDACTED]');
    // Surrounding text preserved
    expect(redacted).toContain('a: ');
    expect(redacted).toContain(' b: ');
    expect(redacted).toContain(' c');
  });

  it('returns original text when no matches', () => {
    const text = 'nothing to redact here';
    const redacted = redactSecrets(text, []);
    expect(redacted).toBe(text);
  });

  it('handles multiline redaction', () => {
    const text = 'line1\nsk-ant-api03-abcdefghijklmnopqrstuvwx\nline3';
    const matches = scanForSecrets(text);
    const redacted = redactSecrets(text, matches);
    expect(redacted).toBe('line1\n[REDACTED]\nline3');
  });
});

// ── Raw registered-secret coverage ───────────────────────────────────
//
// The guard used to scan only the base64 and URL-encoded variants of a
// registered value. That left the most likely leak — the credential in
// plaintext — undetected whenever its shape matched none of the generic
// patterns above. A native Telegram bot token and an opaque dashboard token
// are exactly that case.
//
// Every secret below is SYNTHETIC.

describe('scanForSecrets — raw registered values', () => {
  // Shapeless on purpose: matches none of the built-in patterns, so only the
  // registered-value path can catch it.
  const SHAPELESS = 'zzzz-shapeless-registered-secret-zzzz';
  const TELEGRAM = '123456789:AAFakeSyntheticTelegramTokenValue00000';
  const DASHBOARD = 'synthetic-dashboard-token-8f3a1c7e9b2d4056';

  it('blocks a raw synthetic secret that matches no generic pattern', () => {
    const text = `here is the value ${SHAPELESS} in plain sight`;
    // Baseline: without registration the guard has nothing to match on, which
    // is precisely why the raw variant is needed.
    expect(scanForSecrets(text)).toHaveLength(0);

    const matches = scanForSecrets(text, [SHAPELESS]);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('env_value');
    expect(matches[0].position).toBe(text.indexOf(SHAPELESS));
    expect(matches[0].length).toBe(SHAPELESS.length);
    expect(redactSecrets(text, matches)).not.toContain(SHAPELESS);
  });

  it('blocks a raw Telegram-shaped bot token', () => {
    const text = `polling https://api.telegram.org/bot${TELEGRAM}/getUpdates`;
    const matches = scanForSecrets(text, [TELEGRAM]);
    expect(matches.some((m) => m.type === 'env_value')).toBe(true);
    expect(redactSecrets(text, matches)).not.toContain(TELEGRAM);
  });

  it('blocks a raw dashboard token carried in a URL', () => {
    const text = `GET /deals?token=${DASHBOARD}&tab=intel`;
    const matches = scanForSecrets(text, [DASHBOARD]);
    expect(matches).toHaveLength(1);
    expect(redactSecrets(text, matches)).not.toContain(DASHBOARD);
  });

  it('still blocks the URL-encoded variant', () => {
    const secret = 'synthetic value/with+special?chars=here';
    const encoded = encodeURIComponent(secret);
    expect(encoded).not.toBe(secret);
    const text = `payload=${encoded}`;
    const matches = scanForSecrets(text, [secret]);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('env_value');
    expect(redactSecrets(text, matches)).not.toContain(encoded);
  });

  it('still blocks the base64 variant', () => {
    const encoded = Buffer.from(SHAPELESS).toString('base64');
    const text = `blob ${encoded} end`;
    const matches = scanForSecrets(text, [SHAPELESS]);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('env_value');
    expect(redactSecrets(text, matches)).not.toContain(encoded);
  });

  it('catches raw, base64 and URL-encoded forms present together', () => {
    const b64 = Buffer.from(SHAPELESS).toString('base64');
    const text = `raw=${SHAPELESS} b64=${b64}`;
    const matches = scanForSecrets(text, [SHAPELESS]);
    expect(matches).toHaveLength(2);
    const redacted = redactSecrets(text, matches);
    expect(redacted).not.toContain(SHAPELESS);
    expect(redacted).not.toContain(b64);
  });

  it('handles multiple registered secrets in one payload', () => {
    const text = `a=${SHAPELESS} b=${DASHBOARD} c=${TELEGRAM}`;
    const matches = scanForSecrets(text, [SHAPELESS, DASHBOARD, TELEGRAM]);
    const redacted = redactSecrets(text, matches);
    for (const secret of [SHAPELESS, DASHBOARD, TELEGRAM]) {
      expect(redacted).not.toContain(secret);
    }
    // Structure around the values survives.
    expect(redacted).toContain('a=');
    expect(redacted).toContain('b=');
    expect(redacted).toContain('c=');
  });

  it('leaves ordinary non-secret text alone even with secrets registered', () => {
    const text = 'Deal 32 identity confirmed for APN 073090 04200 in Roane County, TN.';
    expect(scanForSecrets(text, [SHAPELESS, DASHBOARD, TELEGRAM])).toHaveLength(0);
  });

  it('does not fire on a partial or near-miss of a registered secret', () => {
    // A prefix, a suffix and a one-character mutation must all stay clean:
    // substring matching on secrets is how a guard starts eating real output.
    const samples = [
      SHAPELESS.slice(0, SHAPELESS.length - 1),
      SHAPELESS.slice(1),
      `${SHAPELESS.slice(0, -1)}Q`,
      'zzzz-shapeless-registered-secretz-zzzz',
    ];
    for (const sample of samples) {
      expect(scanForSecrets(`text ${sample} text`, [SHAPELESS])).toHaveLength(0);
    }
  });

  it('does not fire on unrelated text that shares a common word', () => {
    const secret = 'landos-production-signing-secret-4471';
    const text = 'The landos production run finished; signing is disabled in this environment.';
    expect(scanForSecrets(text, [secret])).toHaveLength(0);
  });

  it('still ignores registered values of 8 characters or fewer', () => {
    // Short values collide with ordinary output; blanking them would corrupt
    // legitimate responses.
    const text = 'the shortpw token appears here';
    expect(scanForSecrets(text, ['shortpw'])).toHaveLength(0);
  });

  it('reports every occurrence of a repeated raw secret', () => {
    const text = `${SHAPELESS} ... and again ${SHAPELESS}`;
    const matches = scanForSecrets(text, [SHAPELESS]);
    expect(matches).toHaveLength(2);
    expect(redactSecrets(text, matches)).not.toContain(SHAPELESS);
  });
});
