"""stdio entrypoint for the seven-tool landos-read FastMCP server."""

import sys

sys.dont_write_bytecode = True

from landos_mcp.canonical_bridge import CanonicalBridgeLandosAdapter
from landos_mcp.servers import create_read_server

mcp = create_read_server(CanonicalBridgeLandosAdapter())

if __name__ == "__main__":
    mcp.run(transport="stdio")
