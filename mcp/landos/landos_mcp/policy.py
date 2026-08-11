"""Fail-closed registration policy for LandOS MCP tool surfaces."""

from __future__ import annotations

import fnmatch
from collections.abc import Callable
from typing import Any, Final

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations


SERVER_TOOL_ALLOWLISTS: Final[dict[str, frozenset[str]]] = {
    "landos-read": frozenset({
        "get_property_context",
        "get_accepted_evidence",
        "get_provider_and_specialist_status",
        "get_acceptance_expectations",
        "get_visible_and_canonical_counts",
        "get_market_research_context",
        "get_source_registry_entries",
    }),
    "landos-acceptance": frozenset({
        "begin_acceptance_run",
        "record_visual_claim",
        "record_screenshot_artifact",
        "record_refresh_result",
        "record_restart_result",
        "record_console_result",
        "record_network_result",
        "submit_pass_or_fail_report",
    }),
    "landos-research": frozenset({
        "save_verified_property_fact",
        "save_verified_comp",
        "save_verified_visual_artifact",
        "report_specialist_progress",
        "complete_or_fail_research_category",
    }),
}

# These are applied both during registration and again in the Hermes profile
# fragments. Exact allowlists take precedence; deny filters are defense in depth.
DENIED_TOOL_FILTERS: Final[tuple[str, ...]] = (
    "*sql*",
    "*query_database*",
    "*filesystem*",
    "*read_file*",
    "*write_file*",
    "*shell*",
    "*command*",
    "*secret*",
    "*credential*",
    "*token*",
    "*cookie*",
    "*environment*",
    "*env*",
    "*delete*",
    "*destroy*",
    "*valuation*",
    "*strategy*",
    "*offer*",
    "*mutate_deal*",
    "*update_deal*",
    "*implementation*",
)


class McpPolicyError(RuntimeError):
    """Raised when code attempts to expand a narrow MCP surface."""


class GovernedFastMCP(FastMCP):
    """FastMCP that rejects surface expansion and undeclared call arguments."""

    def __init__(self, governed_name: str, **kwargs: Any) -> None:
        if governed_name not in SERVER_TOOL_ALLOWLISTS:
            raise McpPolicyError(f"unknown governed MCP server {governed_name!r}")
        self.governed_name = governed_name
        super().__init__(governed_name, **kwargs)

    def add_tool(
        self,
        fn: Callable[..., Any],
        name: str | None = None,
        **kwargs: Any,
    ) -> None:
        resolved = name or fn.__name__
        if resolved not in SERVER_TOOL_ALLOWLISTS[self.governed_name] or denied_by_filter(resolved):
            raise McpPolicyError(f"tool {resolved!r} is outside the immutable {self.governed_name!r} surface")
        super().add_tool(fn, name=name, **kwargs)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if name not in SERVER_TOOL_ALLOWLISTS[self.governed_name] or denied_by_filter(name):
            raise McpPolicyError(f"tool {name!r} is not callable on {self.governed_name!r}")
        tool = self._tool_manager.get_tool(name)
        if tool is None:
            raise McpPolicyError(f"allowlisted tool {name!r} is not registered")
        allowed_arguments = set(tool.parameters.get("properties", {}))
        extras = sorted(set(arguments) - allowed_arguments)
        if extras:
            raise McpPolicyError(f"tool {name!r} received undeclared arguments: {extras}")
        return await super().call_tool(name, arguments)


def denied_by_filter(tool_name: str) -> bool:
    return any(fnmatch.fnmatchcase(tool_name, pattern) for pattern in DENIED_TOOL_FILTERS)


def register_governed_tool(
    server: FastMCP,
    server_name: str,
    tool_name: str,
    function: Callable[..., Any],
    *,
    description: str,
    read_only: bool,
    idempotent: bool,
) -> None:
    allowlist = SERVER_TOOL_ALLOWLISTS.get(server_name)
    if allowlist is None:
        raise McpPolicyError(f"unknown governed MCP server {server_name!r}")
    if tool_name not in allowlist:
        raise McpPolicyError(f"tool {tool_name!r} is not included by {server_name!r}")
    if denied_by_filter(tool_name):
        raise McpPolicyError(f"tool {tool_name!r} matches a denied capability filter")
    server.add_tool(
        function,
        name=tool_name,
        description=description,
        annotations=ToolAnnotations(
            readOnlyHint=read_only,
            destructiveHint=False,
            idempotentHint=idempotent,
            openWorldHint=False,
        ),
        structured_output=True,
    )
    registered = server._tool_manager.get_tool(tool_name)
    if registered is None:
        raise McpPolicyError(f"FastMCP did not retain registered tool {tool_name!r}")
    # FastMCP 1.28 validates declared parameters but omits this JSON Schema
    # keyword. The governed call override rejects extras at runtime; publish the
    # same fail-closed contract so clients also reject them before transport.
    registered.parameters["additionalProperties"] = False


async def assert_exact_tool_surface(server: FastMCP, server_name: str) -> tuple[str, ...]:
    expected = SERVER_TOOL_ALLOWLISTS[server_name]
    exposed = {tool.name for tool in await server.list_tools()}
    if exposed != expected:
        missing = sorted(expected - exposed)
        extra = sorted(exposed - expected)
        raise McpPolicyError(f"{server_name} surface mismatch: missing={missing}, extra={extra}")
    denied = sorted(tool for tool in exposed if denied_by_filter(tool))
    if denied:
        raise McpPolicyError(f"{server_name} exposed denied tools: {denied}")
    return tuple(sorted(exposed))
