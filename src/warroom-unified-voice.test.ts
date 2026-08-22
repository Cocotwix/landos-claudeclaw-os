/**
 * Unified voice + text War Room contract (Slice 8).
 *
 * The product claim under test: voice and text are two input/output modes
 * of ONE deal-scoped War Room. Same meeting, same transcript, same four
 * persistent Hermes specialist seats, same router, same Deal Brain chair,
 * same capability governance. Voice never becomes a second reasoning path.
 *
 * These tests pin the structural guarantees that make that true, plus the
 * behavior of the pieces that can be exercised without a live audio
 * provider (transcript origin, spoken-text selection, session binding).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { pickSpokenText } from './warroom-voice-session.js';

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Normalize line endings: these files are checked out CRLF on Windows and
// LF elsewhere, and none of the contracts below are about newline style.
const read = (p: string) =>
  fs.readFileSync(path.join(PROJECT_ROOT, p), 'utf-8').split('\r\n').join('\n');

const dashboardSrc = read('src/dashboard.ts');
const orchestratorSrc = read('src/warroom-text-orchestrator.ts');
const voicePageSrc = read('src/warroom-html.ts');
const textPageSrc = read('src/warroom-text-html.ts');
const serverPy = read('warroom/server.py');
const boardModePy = read('warroom/board_mode.py');
const configPy = read('warroom/config.py');
const dbSrc = read('src/db.ts');

describe('one meeting, one transcript', () => {
  it('the text page carries its meetingId into voice mode', () => {
    // Without this, Voice Mode lands on the global cinematic room and the
    // deal conversation forks in two.
    expect(textPageSrc).toMatch(/mode: 'voice', meetingId: MEETING_ID/);
  });

  it('the voice page adopts the bound meeting instead of creating one', () => {
    expect(voicePageSrc).toContain('currentMeetingId = BOARD_MEETING_ID;');
  });

  it('a board voice session never creates a second meeting row', () => {
    // /api/warroom/meeting/start is the voice-only meeting factory that
    // produced the old meeting_type='voice' rows. In board mode it must be
    // unreachable.
    const activate = voicePageSrc.slice(
      voicePageSrc.indexOf('function activateMeeting()'),
      voicePageSrc.indexOf('function activateMeeting()') + 2000,
    );
    expect(activate).toContain('if (BOARD)');
    expect(activate).toMatch(/if \(BOARD\) \{\s*\n\s*currentMeetingId = BOARD_MEETING_ID;\s*\n\s*\} else \{/);
  });

  it('leaving voice mode does not end the deal meeting', () => {
    expect(voicePageSrc).toContain("if (currentMeetingId && !BOARD) {");
  });

  it('the voice page never writes transcript rows in board mode', () => {
    // The turn engine persists both sides; a client-side write would
    // duplicate every line in the shared transcript.
    expect(voicePageSrc).toContain("if (currentMeetingId && speaker !== 'system' && !BOARD) {");
  });
});

describe('voice cannot bypass LandOS specialist routing', () => {
  it('board mode registers exactly one substantive tool', () => {
    expect(serverPy).toContain('standard_tools = [board_mode.build_ask_war_room_schema(), get_time_schema]');
    // Delegation, the generic agent list and the old auto-router are all
    // out of reach for the audio provider in a deal room.
    const registerBlock = serverPy.slice(
      serverPy.indexOf('if voice_session:\n        llm.register_function('),
      serverPy.indexOf('# Context aggregator pair'),
    );
    expect(registerBlock).toContain('llm.register_function(\n            "ask_war_room",');
    expect(registerBlock).toMatch(/else:\s*\n\s*llm\.register_function\("delegate_to_agent"/);
  });

  it('the audio provider is forbidden from answering deal questions itself', () => {
    expect(boardModePy).toContain('NEVER answer a deal question from your own knowledge');
    expect(boardModePy).toMatch(/read the `text` field VERBATIM/);
  });

  it('the ask_war_room tool preserves the operator\'s routing intent verbatim', () => {
    // "Market, defend the valuation" must reach the board router intact,
    // or a voice-only routing algorithm grows in the audio layer.
    expect(boardModePy).toContain('Market, defend the valuation');
    expect(boardModePy).toContain('the room\'s own router decides who answers');
  });

  it('every voice turn goes through the ordinary turn engine', () => {
    const turnRoute = dashboardSrc.slice(
      dashboardSrc.indexOf("app.post('/api/warroom/voice/turn'"),
      dashboardSrc.indexOf("// ── War Room voice configuration ──"),
    );
    expect(turnRoute).toContain('handleTextTurn(meetingId, text, clientMsgId, { origin: \'voice\' })');
    // No separate voice router, roster, or context assembly.
    expect(turnRoute).not.toMatch(/routeBoardMessage|runAgentTurn|buildAcquisitionDossier/);
  });
});

describe('turn concurrency', () => {
  it('voice turns share the per-meeting queue with typed turns', () => {
    // Same queue key as POST /text/send, so VAD chatter cannot open a
    // second writable board turn on one meeting.
    const turnRoute = dashboardSrc.slice(
      dashboardSrc.indexOf("app.post('/api/warroom/voice/turn'"),
      dashboardSrc.indexOf("// ── War Room voice configuration ──"),
    );
    expect(turnRoute).toContain('messageQueue.enqueue(`warroom-text:${meetingId}`');
  });

  it('the spoken answer is a persisted response, never a re-summarization', () => {
    // pickSpokenText selects the turn's final persisted response: the
    // chair's synthesis on a board turn, the seat's own answer on a direct
    // question.
    expect(pickSpokenText([])).toBeNull();
    expect(pickSpokenText([
      { agentId: 'market', name: 'Market + Area', text: 'market position' },
    ])).toBe('market position');
    expect(pickSpokenText([
      { agentId: 'property', name: 'Property', text: 'property position' },
      { agentId: 'market', name: 'Market + Area', text: 'market position' },
      { agentId: 'deal-brain', name: 'Deal Brain (Chair)', text: 'chair synthesis' },
    ])).toBe('chair synthesis');
  });

  it('incomplete responses are not spoken', () => {
    // An interrupted seat leaves a partial bubble in the transcript; it
    // must not become the board's spoken answer.
    const turnRoute = dashboardSrc.slice(
      dashboardSrc.indexOf("app.post('/api/warroom/voice/turn'"),
      dashboardSrc.indexOf("// ── War Room voice configuration ──"),
    );
    expect(turnRoute).toContain('!ev.incomplete');
  });

  it('the voice clientMsgId is a v4 UUID', () => {
    // rememberClientMsgId rejects any other shape, and a rejected id reads
    // as "already seen" — every spoken utterance would silently no-op.
    const turnRoute = dashboardSrc.slice(
      dashboardSrc.indexOf("app.post('/api/warroom/voice/turn'"),
      dashboardSrc.indexOf("// ── War Room voice configuration ──"),
    );
    expect(turnRoute).toContain('const clientMsgId = crypto.randomUUID();');
    expect(read('src/db.ts')).toContain('4[0-9a-f]{3}');
  });

  it('responses are attributed by latching turn_start, not the return value', () => {
    // Waiting for handleTextTurn to return would miss every agent_done.
    const turnRoute = dashboardSrc.slice(
      dashboardSrc.indexOf("app.post('/api/warroom/voice/turn'"),
      dashboardSrc.indexOf("// ── War Room voice configuration ──"),
    );
    expect(turnRoute).toContain("ev.type === 'turn_start' && ev.clientMsgId === clientMsgId");
  });
});

describe('transcript origin', () => {
  it('the transcript table records the input mode', () => {
    expect(dbSrc).toContain("addColumnIfMissing(database, 'warroom_transcript', 'origin'");
    expect(dbSrc).toContain('INSERT INTO warroom_transcript (meeting_id, speaker, text, created_at, origin)');
  });

  it('the orchestrator stamps voice origin on the persisted user row', () => {
    expect(orchestratorSrc).toContain("addWarRoomTranscript(meetingId, 'user', trimmed, opts.origin)");
  });

  it('voice provenance is a subtle mark, not transcript clutter', () => {
    // One mic glyph on the timestamp, on both the live and the replayed
    // render. No provenance prose in the operator's conversation.
    const micRenders = textPageSrc.match(/\\u\{1F3A4\}/g) ?? [];
    expect(micRenders.length).toBe(2);
  });
});

describe('honest failure and governance', () => {
  it('a missing provider credential fails honestly rather than silently', () => {
    expect(serverPy).toContain('check_required_keys({"GOOGLE_API_KEY"');
    expect(serverPy).toContain('cannot reach the War Room turn engine');
  });

  it('board turns report failure instead of inventing an answer', () => {
    expect(boardModePy).toContain('or "the board produced no answer"');
    expect(boardModePy).toContain('Do not fill the silence with an opinion.');
  });

  it('the voice turn route honors both war room kill switches', () => {
    const turnRoute = dashboardSrc.slice(
      dashboardSrc.indexOf("app.post('/api/warroom/voice/turn'"),
      dashboardSrc.indexOf("// ── War Room voice configuration ──"),
    );
    expect(turnRoute).toContain("killSwitches.isEnabled('WARROOM_TEXT_ENABLED')");
    expect(turnRoute).toContain("killSwitches.isEnabled('WARROOM_VOICE_ENABLED')");
  });

  it('capability governance is untouched — no new tool surface for voice', () => {
    // The deferred generic invoke_capability verb stays deferred; board
    // mode adds exactly one tool and it only carries text.
    expect(boardModePy).not.toMatch(/invoke_capability|Bash|browser|sqlite/i);
  });

  it('no secret is written into source or logged', () => {
    expect(boardModePy).not.toMatch(/AIza|GOOGLE_API_KEY\s*=\s*["']/);
    // The dashboard token arrives from the environment, is URL-escaped into
    // a loopback request, and appears in no log line.
    expect(boardModePy).toContain('urllib.parse.quote(token');
    expect(boardModePy).not.toMatch(/logger\.\w+\([^)]*token/);
  });
});

describe('windows-safe runtime paths', () => {
  it('no War Room runtime file resolves to a literal /tmp path', () => {
    for (const src of [serverPy, configPy, read('warroom/router.py'), read('warroom/personas.py')]) {
      expect(src).not.toMatch(/["']\/tmp\/warroom/);
    }
    expect(read('src/agent-config.ts')).not.toContain("'/tmp/warroom-agents.json'");
    expect(read('src/index.ts')).not.toContain("'/tmp/warroom-debug.log'");
  });

  it('both halves agree on the shared runtime directory', () => {
    expect(configPy).toContain('RUNTIME_DIR = PROJECT_ROOT / ".runtime" / "warroom"');
    expect(read('src/warroom-runtime-paths.ts'))
      .toContain("path.join(PROJECT_ROOT, '.runtime', 'warroom')");
  });

  it('the Python venv resolver is platform-aware', () => {
    expect(read('src/platform.ts')).toContain("path.join(venvDir, 'Scripts', 'python.exe')");
  });
});

describe('generic rooms are untouched', () => {
  it('a voice page with no board keeps the legacy roster and pin flow', () => {
    expect(voicePageSrc).toContain("/api/warroom/agents?token=");
    expect(voicePageSrc).toContain("/api/warroom/pin?token=");
  });

  it('entering the generic voice room releases a stale deal binding', () => {
    expect(voicePageSrc).toContain('/api/warroom/voice/unbind?token=');
  });

  it('generic voice sessions still run the original personas and toolset', () => {
    expect(serverPy).toContain('system_prompt = get_persona(active_agent, mode=active_mode)');
    expect(serverPy).toContain('llm.register_function("delegate_to_agent", delegate_to_agent_handler)');
  });

  it('a non-deal meetingId does not bind a board', () => {
    const route = dashboardSrc.slice(
      dashboardSrc.indexOf("if (mode === 'voice') {"),
      dashboardSrc.indexOf("if (mode === 'picker'"),
    );
    expect(route).toContain('m.deal_card_id != null');
    expect(route).toContain('m.ended_at === null');
  });
});
