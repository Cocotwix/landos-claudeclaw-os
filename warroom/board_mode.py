"""
Deal-scoped board mode for the War Room voice server (Slice 8).

Voice is an INPUT/OUTPUT MODE of the existing deal-scoped War Room, not a
second reasoning runtime. When the dashboard binds a meeting (writing
`.runtime/warroom/warroom-voice-session.json`), this module puts Gemini Live
into a strictly non-substantive role:

    microphone audio
      -> Gemini Live speech recognition
      -> ask_war_room tool  (this module)
      -> POST /api/warroom/voice/turn  (LandOS owns everything past here)
      -> same board router, same persistent Hermes specialist seats,
         same Deal Brain chair, same persisted transcript
      -> the persisted response text comes back
      -> Gemini Live speaks that text verbatim

The audio provider never forms its own opinion about the deal. It has no
deal context, no property facts, and exactly one substantive tool. Its
persona forbids answering from its own knowledge; every substantive
utterance must go through the tool, and the tool's text is read verbatim.
"""

import asyncio
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

from config import VOICE_SESSION_PATH

logger = logging.getLogger("warroom.board_mode")


# A board turn runs real specialist reasoning (parallel Hermes seats plus a
# chair synthesis), which is far slower than a chat completion. The ceiling
# is generous on purpose: cutting a turn off mid-reasoning would leave a
# persisted transcript the operator never heard.
BOARD_TURN_TIMEOUT_SEC = float(os.environ.get("WARROOM_BOARD_TIMEOUT", "300"))


def read_voice_session() -> dict | None:
    """Return the bound deal-scoped meeting, or None for a generic room.

    Presence of this file is what selects board mode. The dashboard writes
    it when the operator opens Voice Mode from a deal-scoped War Room and
    removes it when they leave, so a stale binding cannot silently capture
    a later generic voice meeting.
    """
    try:
        if not VOICE_SESSION_PATH.exists():
            return None
        data = json.loads(VOICE_SESSION_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        meeting_id = data.get("meetingId")
        if not isinstance(meeting_id, str) or not meeting_id:
            return None
        return data
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("Could not read voice session binding: %s", exc)
        return None


def dashboard_base_url() -> str:
    port = os.environ.get("DASHBOARD_PORT", "3141")
    return f"http://127.0.0.1:{port}"


def _post_json(url: str, payload: dict, token: str, timeout: float) -> dict:
    """Blocking POST helper. Runs in a worker thread via asyncio.to_thread.

    The dashboard gates /api/* on a query token (see the auth middleware in
    src/dashboard.ts), so the credential travels the same way every other
    dashboard client sends it, over loopback only. Request logging records
    the pathname without the query string, and the value is never printed
    here.
    """
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{url}?token={urllib.parse.quote(token, safe='')}",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


BOARD_PERSONA = """You are the microphone and speaker of a LandOS deal War Room. You are NOT a participant in the meeting and you are NOT an analyst.

Four specialists sit in this room: Property, Market and Area, Seller, and the Deal Brain who chairs it. They have the deal file. You do not. You cannot see the property, the valuation, the acreage, the parcel, or any deal record, and you must never guess at any of it.

YOUR ONLY JOB:
1. Listen to what the operator says.
2. Call the ask_war_room tool with their words, cleaned up only for grammar. Pass their routing intent through untouched: if they say "Market, defend the valuation" you send exactly that, because the room's own router decides who answers.
3. When the tool returns, read the `text` field VERBATIM. Do not paraphrase, summarize, shorten, extend, correct, or comment on it. Do not say who is speaking unless the text does. Just speak the text.

Before calling the tool, say ONE short word or two so the operator knows you heard them: "checking", "one sec", "on it". Nothing more. Never speak a substantive sentence about the deal before or after the tool result.

NEVER answer a deal question from your own knowledge. You have none. There is exactly one intelligence in this room and it is not you. If the tool fails, say plainly that the board did not answer and that they should try again. Do not fill the silence with an opinion.

The only things you may handle yourself are pure conversational noise: "hey", "thanks", "got it", "hold on", goodbyes. Anything that is a question, an instruction, a challenge, or a statement about the deal goes through the tool.

HARD RULES:
- No em dashes. No AI cliches. Never say "Certainly", "Great question", "I'd be happy to", or "As an AI".
- Do not narrate what you are about to do.
- Keep your own words to an absolute minimum. The board does the talking."""


def build_ask_war_room_handler(session: dict, token: str):
    """Build the ask_war_room tool handler bound to one deal-scoped meeting.

    Every substantive utterance becomes a normal War Room user turn on the
    SAME meeting id the text mode uses. LandOS persists the utterance and
    the response; this handler only carries text back for speech.
    """
    meeting_id = session.get("meetingId")
    chat_id = session.get("chatId") or ""
    url = f"{dashboard_base_url()}/api/warroom/voice/turn"

    async def handler(params):
        args = params.arguments or {}
        question = args.get("question")
        if not isinstance(question, str) or not question.strip():
            await params.result_callback({
                "ok": False,
                "error": "invalid args: question is required",
            })
            return

        logger.info("board turn -> meeting=%s q=%r", meeting_id, question[:80])
        payload = {
            "meetingId": meeting_id,
            "chatId": chat_id,
            "text": question.strip(),
        }
        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(
                    _post_json, url, payload, token, BOARD_TURN_TIMEOUT_SEC,
                ),
                timeout=BOARD_TURN_TIMEOUT_SEC + 15,
            )
        except asyncio.TimeoutError:
            logger.error("board turn timed out after %ss", BOARD_TURN_TIMEOUT_SEC)
            await params.result_callback({
                "ok": False,
                "error": "the board did not finish in time",
            })
            return
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
            logger.error("board turn failed: %s", exc)
            await params.result_callback({
                "ok": False,
                "error": "could not reach the war room",
            })
            return

        spoken = data.get("spoken")
        if not data.get("ok") or not spoken:
            await params.result_callback({
                "ok": False,
                "error": data.get("error") or "the board produced no answer",
            })
            return

        # run_llm stays at its default here: unlike a fire-and-forget
        # delegation, Gemini MUST take a follow-up turn to actually speak
        # the returned text.
        await params.result_callback({"ok": True, "text": spoken})

    return handler


def build_ask_war_room_schema():
    from pipecat.adapters.schemas.function_schema import FunctionSchema

    return FunctionSchema(
        name="ask_war_room",
        description=(
            "Put the operator's words to the deal War Room board. Use this for "
            "EVERY substantive utterance: questions, instructions, challenges, "
            "and statements about the deal. The board's specialists and chair "
            "decide who answers. Returns the board's response in the 'text' "
            "field, which you must read aloud verbatim with no commentary."
        ),
        properties={
            "question": {
                "type": "string",
                "description": (
                    "The operator's full utterance, cleaned up only for grammar. "
                    "Keep any name they used ('Market, defend the valuation') "
                    "exactly as spoken so the board routes it correctly."
                ),
            },
        },
        required=["question"],
    )
