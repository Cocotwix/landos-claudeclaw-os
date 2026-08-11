"""stdio entrypoint for the eight-tool landos-acceptance FastMCP server."""

import sys

sys.dont_write_bytecode = True

from landos_mcp.canonical_bridge import CanonicalBridgeLandosAdapter
from landos_mcp.servers import create_acceptance_server

mcp = create_acceptance_server(CanonicalBridgeLandosAdapter())

if __name__ == "__main__":
    mcp.run(transport="stdio")
