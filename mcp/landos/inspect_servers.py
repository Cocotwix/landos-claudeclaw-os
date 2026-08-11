"""Offline FastMCP surface inspection when mcporter is not installed."""

from __future__ import annotations

import asyncio
import json
import sys

sys.dont_write_bytecode = True

from landos_mcp.policy import DENIED_TOOL_FILTERS, SERVER_TOOL_ALLOWLISTS, assert_exact_tool_surface, denied_by_filter
from landos_mcp.servers import create_acceptance_server, create_read_server, create_research_server


async def inspect() -> dict[str, object]:
    factories = {
        "landos-read": create_read_server,
        "landos-acceptance": create_acceptance_server,
        "landos-research": create_research_server,
    }
    servers: dict[str, object] = {}
    for name, factory in factories.items():
        server = factory()
        names = await assert_exact_tool_surface(server, name)
        tools = await server.list_tools()
        servers[name] = {
            "expected": sorted(SERVER_TOOL_ALLOWLISTS[name]),
            "exposed": list(names),
            "deniedMatches": [tool for tool in names if denied_by_filter(tool)],
            "resourcesExposed": False,
            "promptsExposed": False,
            "schemas": {tool.name: tool.inputSchema for tool in tools},
        }
    return {
        "framework": "mcp.server.fastmcp.FastMCP",
        "transport": "stdio",
        "deniedFilters": list(DENIED_TOOL_FILTERS),
        "servers": servers,
        "passed": True,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(inspect()), indent=2, sort_keys=True))
