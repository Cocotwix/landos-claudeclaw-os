"""Portable fixed-command launcher for governed LandOS MCP verification."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from run_server import _configured_runtime, _hermes_runtime

sys.dont_write_bytecode = True


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"test", "inspect"}:
        raise SystemExit("usage: run_checks.py <test|inspect>")

    repository_root = Path(__file__).resolve().parents[2]
    runtime = _configured_runtime() or _hermes_runtime() or Path(sys.executable).resolve()
    if sys.argv[1] == "test":
        command = [
            str(runtime), "-B", "-m", "unittest", "discover",
            "-s", "mcp/landos/tests", "-p", "test_*.py", "-v",
        ]
    else:
        command = [str(runtime), "-B", "mcp/landos/inspect_servers.py"]

    completed = subprocess.run(command, cwd=repository_root, check=False, shell=False)
    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
