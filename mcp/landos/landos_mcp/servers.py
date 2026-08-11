"""FastMCP factories with exact, policy-checked LandOS tool surfaces."""

from __future__ import annotations

from typing import Annotated, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .adapters import LandosAcceptanceAdapter, LandosReadAdapter, LandosResearchAdapter, UnconfiguredLandosAdapter
from .models import (
    AcceptanceArtifact,
    AcceptanceCheck,
    AcceptanceClaimResult,
    AcceptanceContract,
    AcceptanceExpectations,
    AcceptanceResultsDocument,
    AcceptanceRunStarted,
    AcceptanceSubmissionReceipt,
    CategoryReceipt,
    ConsoleResult,
    EvidencePage,
    MarketResearchContext,
    MutationReceipt,
    NetworkResult,
    PropertyContext,
    ProviderSpecialistStatus,
    ResearchCategory,
    ResearchCategoryResult,
    SafeId,
    SourceRegistryPage,
    SpecialistProgress,
    VerifiedComp,
    VerifiedPropertyFact,
    VerifiedVisualArtifact,
    VisibleCanonicalCounts,
)
from .policy import GovernedFastMCP, register_governed_tool


def _server(name: str, purpose: str) -> FastMCP:
    return GovernedFastMCP(
        name,
        instructions=(
            f"{purpose} LandOS is canonical. This server exposes only its enumerated bounded tools; "
            "it has no shell, arbitrary SQL/filesystem, secret/environment, destructive, valuation, "
            "strategy, offer, or broad Deal Card mutation capability."
        ),
    )


def create_read_server(adapter: LandosReadAdapter | None = None) -> FastMCP:
    boundary = adapter or UnconfiguredLandosAdapter()
    mcp = _server("landos-read", "Read canonical LandOS context through narrow projections only.")

    def get_property_context(
        property_card_id: Annotated[int, Field(gt=0)],
    ) -> PropertyContext:
        """Return the canonical identity and bounded context for one Property Card."""
        return boundary.get_property_context(property_card_id)

    def get_accepted_evidence(
        property_card_id: Annotated[int, Field(gt=0)],
        category: ResearchCategory | None = None,
        limit: Annotated[int, Field(ge=1, le=200)] = 100,
    ) -> EvidencePage:
        """Return accepted, property-scoped evidence with an optional category filter."""
        return boundary.get_accepted_evidence(property_card_id, category, limit)

    def get_provider_and_specialist_status(
        property_card_id: Annotated[int, Field(gt=0)],
    ) -> ProviderSpecialistStatus:
        """Return bounded provider and specialist lifecycle status for one property."""
        return boundary.get_provider_and_specialist_status(property_card_id)

    def get_acceptance_expectations(
        property_card_id: Annotated[int, Field(gt=0)],
        sprint_name: Annotated[str, Field(min_length=3, max_length=120)] | None = None,
    ) -> AcceptanceExpectations:
        """Return immutable visual claims from the canonical acceptance contract."""
        return boundary.get_acceptance_expectations(property_card_id, sprint_name)

    def get_visible_and_canonical_counts(
        property_card_id: Annotated[int, Field(gt=0)],
    ) -> VisibleCanonicalCounts:
        """Return bounded visible/rendered/canonical counts for operator sections."""
        return boundary.get_visible_and_canonical_counts(property_card_id)

    def get_market_research_context(
        property_card_id: Annotated[int, Field(gt=0)],
        scope: Literal["state", "county", "zip", "acreage_band"],
    ) -> MarketResearchContext:
        """Return one existing canonical market-research context projection."""
        return boundary.get_market_research_context(property_card_id, scope)

    def get_source_registry_entries(
        kind: Literal["assessor", "gis", "zoning", "subdivision", "market", "infrastructure", "development", "demographic"] | None = None,
        jurisdiction: Annotated[str, Field(min_length=2, max_length=500)] | None = None,
        limit: Annotated[int, Field(ge=1, le=200)] = 100,
    ) -> SourceRegistryPage:
        """Return approved source-registry entries through bounded filters."""
        return boundary.get_source_registry_entries(kind, jurisdiction, limit)

    tools = {
        "get_property_context": get_property_context,
        "get_accepted_evidence": get_accepted_evidence,
        "get_provider_and_specialist_status": get_provider_and_specialist_status,
        "get_acceptance_expectations": get_acceptance_expectations,
        "get_visible_and_canonical_counts": get_visible_and_canonical_counts,
        "get_market_research_context": get_market_research_context,
        "get_source_registry_entries": get_source_registry_entries,
    }
    for name, function in tools.items():
        register_governed_tool(
            mcp, "landos-read", name, function,
            description=(function.__doc__ or "").strip(), read_only=True, idempotent=True,
        )
    return mcp


def create_acceptance_server(adapter: LandosAcceptanceAdapter | None = None) -> FastMCP:
    boundary = adapter or UnconfiguredLandosAdapter()
    mcp = _server(
        "landos-acceptance",
        "Record independent landos-visual-qa evidence; never implement or repair application work.",
    )

    def begin_acceptance_run(contract: AcceptanceContract) -> AcceptanceRunStarted:
        """Begin one immutable v1.0.0 acceptance contract under landos-visual-qa authority."""
        return boundary.begin_acceptance_run(contract)

    def record_visual_claim(run_id: SafeId, claim: AcceptanceClaimResult) -> MutationReceipt:
        """Record one contract-declared visual claim and its exact screenshot evidence path."""
        return boundary.record_visual_claim(run_id, claim)

    def record_screenshot_artifact(run_id: SafeId, artifact: AcceptanceArtifact) -> MutationReceipt:
        """Record metadata for one of the six contract-defined screenshots; never write a file."""
        return boundary.record_screenshot_artifact(run_id, artifact)

    def record_refresh_result(run_id: SafeId, result: AcceptanceCheck) -> MutationReceipt:
        """Record the visible post-refresh retention check."""
        return boundary.record_refresh_result(run_id, result)

    def record_restart_result(run_id: SafeId, result: AcceptanceCheck) -> MutationReceipt:
        """Record the visible post-managed-restart retention check."""
        return boundary.record_restart_result(run_id, result)

    def record_console_result(run_id: SafeId, result: ConsoleResult) -> MutationReceipt:
        """Record the bounded console summary that points only to console.json."""
        return boundary.record_console_result(run_id, result)

    def record_network_result(run_id: SafeId, result: NetworkResult) -> MutationReceipt:
        """Record the bounded network summary that points only to network-failures.json."""
        return boundary.record_network_result(run_id, result)

    def submit_pass_or_fail_report(
        run_id: SafeId,
        report: AcceptanceResultsDocument,
    ) -> AcceptanceSubmissionReceipt:
        """Validate and immutably submit the complete canonical PASS-or-FAIL results document."""
        return boundary.submit_pass_or_fail_report(run_id, report)

    tools = {
        "begin_acceptance_run": begin_acceptance_run,
        "record_visual_claim": record_visual_claim,
        "record_screenshot_artifact": record_screenshot_artifact,
        "record_refresh_result": record_refresh_result,
        "record_restart_result": record_restart_result,
        "record_console_result": record_console_result,
        "record_network_result": record_network_result,
        "submit_pass_or_fail_report": submit_pass_or_fail_report,
    }
    for name, function in tools.items():
        register_governed_tool(
            mcp, "landos-acceptance", name, function,
            description=(function.__doc__ or "").strip(), read_only=False,
            idempotent=name != "begin_acceptance_run",
        )
    return mcp


def create_research_server(adapter: LandosResearchAdapter | None = None) -> FastMCP:
    boundary = adapter or UnconfiguredLandosAdapter()
    mcp = _server(
        "landos-research",
        "Save only verified, property-scoped research evidence and bounded specialist lifecycle state.",
    )

    def save_verified_property_fact(fact: VerifiedPropertyFact) -> MutationReceipt:
        """Save one verified fact through the canonical adapter after identity checks."""
        return boundary.save_verified_property_fact(fact)

    def save_verified_comp(comp: VerifiedComp) -> MutationReceipt:
        """Save one verified comparable linked to the exact canonical subject identity."""
        return boundary.save_verified_comp(comp)

    def save_verified_visual_artifact(artifact: VerifiedVisualArtifact) -> MutationReceipt:
        """Save metadata for one already-produced verified visual; never write artifact bytes."""
        return boundary.save_verified_visual_artifact(artifact)

    def report_specialist_progress(progress: SpecialistProgress) -> MutationReceipt:
        """Record bounded pending/running specialist progress below 100 percent."""
        return boundary.report_specialist_progress(progress)

    def complete_or_fail_research_category(result: ResearchCategoryResult) -> CategoryReceipt:
        """Record one immutable complete-or-failed terminal result for a research category."""
        return boundary.complete_or_fail_research_category(result)

    tools = {
        "save_verified_property_fact": save_verified_property_fact,
        "save_verified_comp": save_verified_comp,
        "save_verified_visual_artifact": save_verified_visual_artifact,
        "report_specialist_progress": report_specialist_progress,
        "complete_or_fail_research_category": complete_or_fail_research_category,
    }
    for name, function in tools.items():
        register_governed_tool(
            mcp, "landos-research", name, function,
            description=(function.__doc__ or "").strip(), read_only=False, idempotent=True,
        )
    return mcp
