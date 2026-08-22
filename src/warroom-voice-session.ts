/**
 * Deal-scoped voice session binding for the unified War Room (Slice 8).
 *
 * Voice Mode is an input/output mode of the SAME deal-scoped War Room
 * meeting as Text Mode — one meeting, one transcript, one specialist
 * board. The browser binds the current meeting before starting a voice
 * session; the Python voice server reads the binding at startup and, when
 * present, runs in "board mode": every substantive recognized utterance is
 * forwarded to `POST /api/warroom/voice/turn`, which runs the normal
 * War Room turn engine (same router, same Hermes specialist seats, same
 * Deal Brain chair) and returns the persisted response text for the voice
 * layer to speak. The voice provider never reasons about the deal itself.
 *
 * The binding file lives in the shared warroom runtime dir (see
 * warroom-runtime-paths.ts); `warroom/board_mode.py` is the Python-side
 * reader. Keep the JSON shape in sync.
 */

import fs from 'fs';

import { warroomRuntimeFile, WARROOM_VOICE_SESSION_FILE } from './warroom-runtime-paths.js';

export interface WarRoomVoiceSession {
  meetingId: string;
  chatId: string;
  dealCardId: number | null;
  dealLabel: string | null;
  boundAt: number;
}

export function writeVoiceSession(session: WarRoomVoiceSession): void {
  fs.writeFileSync(
    warroomRuntimeFile(WARROOM_VOICE_SESSION_FILE),
    JSON.stringify(session, null, 2),
    'utf-8',
  );
}

export function readVoiceSession(): WarRoomVoiceSession | null {
  try {
    const p = warroomRuntimeFile(WARROOM_VOICE_SESSION_FILE);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw || typeof raw.meetingId !== 'string' || !raw.meetingId) return null;
    return {
      meetingId: raw.meetingId,
      chatId: typeof raw.chatId === 'string' ? raw.chatId : '',
      dealCardId: typeof raw.dealCardId === 'number' ? raw.dealCardId : null,
      dealLabel: typeof raw.dealLabel === 'string' ? raw.dealLabel : null,
      boundAt: typeof raw.boundAt === 'number' ? raw.boundAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearVoiceSession(): void {
  try {
    const p = warroomRuntimeFile(WARROOM_VOICE_SESSION_FILE);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* non-fatal */ }
}

export interface VoiceTurnResponse {
  agentId: string;
  name: string;
  text: string;
}

/**
 * Which persisted response the voice layer reads aloud.
 *
 * The spoken answer is always one of the persisted transcript responses —
 * never a re-summarization, so voice can't grow a second intelligence
 * conclusion. For a board turn the chair's synthesis is the last response;
 * for a direct seat question the seat's own answer is the only one. Either
 * way: speak the final response of the turn. Earlier specialist rounds
 * stay visible in the shared transcript.
 */
export function pickSpokenText(responses: VoiceTurnResponse[]): string | null {
  if (responses.length === 0) return null;
  return responses[responses.length - 1].text;
}
