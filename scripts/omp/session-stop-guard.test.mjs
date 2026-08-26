import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { evaluateLandosSprintStop } from './session-stop-guard.mjs';

function transcript(records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

function withTranscript(records) {
  const dir = mkdtempSync(join(tmpdir(), 'landos-session-stop-'));
  const transcriptPath = join(dir, 'transcript.jsonl');
  writeFileSync(transcriptPath, transcript(records), 'utf8');
  return {
    input: { cwd: 'C:/Users/tbutt/claudeclaw-os', transcript_path: transcriptPath },
    transcriptRecords: records,
  };
}

describe('LandOS OMP session_stop guard', () => {
  it('forces incomplete LandOS implementation sprint endings to continue', () => {
    const ctx = withTranscript([
      { message: { role: 'user', content: 'LandOS sprint: implement refresh persistence and test it on localhost.' } },
      { message: { role: 'assistant', content: 'The implementation is incomplete. Remaining work: test localhost refresh persistence.' } },
    ]);

    const verdict = evaluateLandosSprintStop(ctx);

    assert.equal(verdict.allow, false);
    assert.match(verdict.reason, /active LandOS sprint is NOT finished/);
    assert.match(verdict.reason, /Continue executing the ORIGINAL user request/);
  });

  it('allows only the explicit verified completion marker', () => {
    const ctx = withTranscript([
      { message: { role: 'user', content: 'LandOS feature sprint: build the OMP completion guard and verify it.' } },
      { message: { role: 'assistant', content: 'LANDOS_SPRINT_COMPLETE: PASS\nVerified guard install and tests passed.' } },
    ]);

    const verdict = evaluateLandosSprintStop(ctx);

    assert.equal(verdict.allow, true);
    assert.equal(verdict.reason, 'Completion marker present.');
  });

  it('rejects blocked markers that do not prove an exhausted external blocker', () => {
    const ctx = withTranscript([
      { message: { role: 'user', content: 'LandOS fix sprint: build the missing localhost persistence.' } },
      { message: { role: 'assistant', content: 'LANDOS_SPRINT_BLOCKED: tests are failing and implementation remains incomplete.' } },
    ]);

    const verdict = evaluateLandosSprintStop(ctx);

    assert.equal(verdict.allow, false);
    assert.match(verdict.reason, /only terminal when it identifies a genuine external blocker/);
  });

  it('allows a blocked marker only for genuine external exhausted blockers', () => {
    const ctx = withTranscript([
      { message: { role: 'user', content: 'LandOS build sprint: verify localhost operator acceptance.' } },
      { message: { role: 'assistant', content: 'LANDOS_SPRINT_BLOCKED: external provider outage prevents required OAuth login after retried route, browser fallback, and all available tools/reasonable attempts were exhausted.' } },
    ]);

    const verdict = evaluateLandosSprintStop(ctx);

    assert.equal(verdict.allow, true);
    assert.equal(verdict.reason, 'External exhausted blocker marker present.');
  });

  it('does not interfere with non-LandOS conversations', () => {
    const ctx = withTranscript([
      { message: { role: 'user', content: 'Summarize this text.' } },
      { message: { role: 'assistant', content: 'Done.' } },
    ]);

    const verdict = evaluateLandosSprintStop(ctx);

    assert.equal(verdict.allow, true);
    assert.equal(verdict.reason, 'No active LandOS implementation sprint detected.');
  });
});
