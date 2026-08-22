"""
Configuration loader for the War Room voice server.

Resolves the project root, loads agent voice mappings from voices.json,
and exposes environment variable helpers.
"""

import json
import os
import subprocess
from pathlib import Path


def get_project_root() -> Path:
    """Resolve the ClaudeClaw project root via git or file path fallback."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
            cwd=Path(__file__).parent,
        )
        return Path(result.stdout.strip())
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Fallback: warroom/ sits one level below project root
        return Path(__file__).resolve().parent.parent


PROJECT_ROOT = get_project_root()
WARROOM_DIR = PROJECT_ROOT / "warroom"
VOICES_FILE = WARROOM_DIR / "voices.json"

# Shared Node/Python runtime state. These small files used to live at
# literal /tmp paths, which is not a real directory on Windows, so the
# Python half silently never saw what Node wrote. Mirror of
# src/warroom-runtime-paths.ts — keep the two in sync.
RUNTIME_DIR = PROJECT_ROOT / ".runtime" / "warroom"
ROSTER_PATH = RUNTIME_DIR / "warroom-agents.json"
PIN_PATH = RUNTIME_DIR / "warroom-pin.json"
VOICE_SESSION_PATH = RUNTIME_DIR / "warroom-voice-session.json"


def load_voices() -> dict:
    """Load agent voice configs from voices.json.

    Returns a dict mapping agent_id to {voice_id, name}.
    """
    if not VOICES_FILE.exists():
        raise FileNotFoundError(f"Voice config not found at {VOICES_FILE}")

    with open(VOICES_FILE, "r") as f:
        return json.load(f)


# Pre-load at import time so other modules can use it directly
AGENT_VOICES = load_voices()

# Default agent if routing can't determine who should respond
DEFAULT_AGENT = "main"


# ── Network bind ──────────────────────────────────────────────────────
DEFAULT_WARROOM_BIND = "127.0.0.1"


def resolve_bind() -> str:
    """Resolve the War Room WebSocket bind address.

    Loopback by DEFAULT. The War Room socket carries no connection-level
    auth of its own: the dashboard token gates the Hono proxy in
    src/dashboard.ts, and a client that dials this port directly bypasses
    that proxy entirely. Binding 0.0.0.0 therefore published an
    unauthenticated agent-control-and-microphone socket to every host that
    could reach the machine.

    The dashboard proxy already dials 127.0.0.1 (src/dashboard.ts), so a
    normal install is unaffected. An operator who genuinely wants LAN
    exposure opts in explicitly via WARROOM_BIND, mirroring DASHBOARD_BIND
    on the dashboard side. A blank or whitespace-only value is treated as
    unset so a stray `WARROOM_BIND=` in .env cannot silently produce a
    bind-to-everything default.
    """
    raw = os.environ.get("WARROOM_BIND", "")
    return raw.strip() or DEFAULT_WARROOM_BIND
