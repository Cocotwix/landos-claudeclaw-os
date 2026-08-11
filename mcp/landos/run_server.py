"""Portable fixed-entrypoint launcher for the three governed LandOS MCPs."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

ENTRYPOINTS = {
    "landos-read": "landos_read.py",
    "landos-acceptance": "landos_acceptance.py",
    "landos-research": "landos_research.py",
}


def _configured_runtime() -> Path | None:
    configured = os.environ.get("LANDOS_MCP_PYTHON")
    if not configured:
        return None
    candidate = Path(configured)
    if not candidate.is_absolute():
        raise RuntimeError("LANDOS_MCP_PYTHON must be an absolute path to a Python executable")
    if not candidate.is_file():
        raise RuntimeError("LANDOS_MCP_PYTHON does not identify an existing file")
    return candidate.resolve()


def _hermes_runtime() -> Path | None:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        return None
    candidate = Path(local_app_data) / "hermes" / "hermes-agent" / "venv" / "Scripts" / "python.exe"
    return candidate.resolve() if candidate.is_file() else None


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ENTRYPOINTS:
        allowed = ", ".join(sorted(ENTRYPOINTS))
        raise SystemExit(f"usage: run_server.py <server>; server must be one of: {allowed}")

    runtime = _configured_runtime() or _hermes_runtime() or Path(sys.executable).resolve()
    entrypoint = Path(__file__).resolve().parent / ENTRYPOINTS[sys.argv[1]]
    if not entrypoint.is_file():
        raise RuntimeError(f"fixed LandOS MCP entrypoint is missing for {sys.argv[1]!r}")

    completed = subprocess.run(
        [str(runtime), "-B", str(entrypoint)],
        stdin=sys.stdin.buffer,
        stdout=sys.stdout.buffer,
        stderr=sys.stderr.buffer,
        check=False,
    )
    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
