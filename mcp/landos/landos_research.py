"""stdio entrypoint for the five-tool landos-research FastMCP server."""

import sys

sys.dont_write_bytecode = True

from landos_mcp.canonical_bridge import CanonicalBridgeLandosAdapter
from landos_mcp.servers import create_research_server

mcp = create_research_server(CanonicalBridgeLandosAdapter())

if __name__ == "__main__":
    mcp.run(transport="stdio")
