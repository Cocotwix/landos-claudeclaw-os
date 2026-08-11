"""Strict shell-free adapter for the application-owned LandOS TypeScript bridge."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from .adapters import AdapterNotConfigured
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
    ResearchCategoryResult,
    SourceRegistryPage,
    SpecialistProgress,
    VerifiedComp,
    VerifiedPropertyFact,
    VerifiedVisualArtifact,
    VisibleCanonicalCounts,
)

sys.dont_write_bytecode = True
ModelT = TypeVar("ModelT", bound=BaseModel)


class CanonicalBridgeError(RuntimeError):
    """The bounded application bridge rejected or could not complete a call."""


class CanonicalBridgeLandosAdapter:
    """Delegate exact MCP calls to canonical LandOS services through Node/tsx.

    The subprocess command, bridge file, working directory, and operation are
    fixed. Arguments travel as JSON on stdin and cannot select a command, path,
    SQL statement, module, or shell mode.
    """

    canonical_service_name = "landos-application-owned-bridge"
    production_ready = True

    def __init__(self, *, timeout_seconds: float = 20.0) -> None:
        repository_root = Path(__file__).resolve().parents[3]
        bridge = repository_root / "src" / "landos" / "governance" / "mcp-bridge.ts"
        if not bridge.is_file():
            raise AdapterNotConfigured("application-owned LandOS MCP bridge is missing")
        node = shutil.which("node")
        if not node:
            raise AdapterNotConfigured("Node.js is required for the application-owned LandOS MCP bridge")
        self._repository_root = repository_root
        self._bridge = bridge
        self._node = node
        self._timeout_seconds = timeout_seconds

    def _call(self, operation: str, arguments: dict[str, Any], output: type[ModelT]) -> ModelT:
        completed = subprocess.run(
            [self._node, "--import", "tsx", str(self._bridge), operation],
            cwd=self._repository_root,
            input=json.dumps({"arguments": arguments}, separators=(",", ":"), ensure_ascii=True),
            text=True,
            capture_output=True,
            timeout=self._timeout_seconds,
            check=False,
            shell=False,
        )
        stdout = completed.stdout.strip()
        if len(stdout.encode("utf-8")) > 2_000_000:
            raise CanonicalBridgeError("LandOS bridge response exceeded 2 MB")
        lines = stdout.splitlines()
        if len(lines) != 1:
            raise CanonicalBridgeError("LandOS bridge did not return one isolated JSON response")
        try:
            response = json.loads(lines[0])
        except json.JSONDecodeError as error:
            raise CanonicalBridgeError("LandOS bridge returned malformed JSON") from error
        if not isinstance(response, dict) or set(response) - {"ok", "result", "error"}:
            raise CanonicalBridgeError("LandOS bridge returned an invalid envelope")
        if response.get("ok") is not True:
            detail = response.get("error")
            message = detail.get("message") if isinstance(detail, dict) else None
            raise CanonicalBridgeError(str(message or "LandOS bridge rejected the call"))
        if completed.returncode != 0:
            raise CanonicalBridgeError("LandOS bridge exited unsuccessfully")
        return output.model_validate(response.get("result"))

    @staticmethod
    def _json(model: BaseModel) -> dict[str, Any]:
        return model.model_dump(mode="json", exclude_none=False)

    def get_property_context(self, property_card_id: int) -> PropertyContext:
        return self._call("get_property_context", {"property_card_id": property_card_id}, PropertyContext)

    def get_accepted_evidence(self, property_card_id: int, category: str | None, limit: int) -> EvidencePage:
        return self._call("get_accepted_evidence", {"property_card_id": property_card_id, "category": category, "limit": limit}, EvidencePage)

    def get_provider_and_specialist_status(self, property_card_id: int) -> ProviderSpecialistStatus:
        return self._call("get_provider_and_specialist_status", {"property_card_id": property_card_id}, ProviderSpecialistStatus)

    def get_acceptance_expectations(self, property_card_id: int, sprint_name: str | None) -> AcceptanceExpectations:
        return self._call("get_acceptance_expectations", {"property_card_id": property_card_id, "sprint_name": sprint_name}, AcceptanceExpectations)

    def get_visible_and_canonical_counts(self, property_card_id: int) -> VisibleCanonicalCounts:
        return self._call("get_visible_and_canonical_counts", {"property_card_id": property_card_id}, VisibleCanonicalCounts)

    def get_market_research_context(self, property_card_id: int, scope: str) -> MarketResearchContext:
        return self._call("get_market_research_context", {"property_card_id": property_card_id, "scope": scope}, MarketResearchContext)

    def get_source_registry_entries(self, kind: str | None, jurisdiction: str | None, limit: int) -> SourceRegistryPage:
        return self._call("get_source_registry_entries", {"kind": kind, "jurisdiction": jurisdiction, "limit": limit}, SourceRegistryPage)

    def begin_acceptance_run(self, contract: AcceptanceContract) -> AcceptanceRunStarted:
        return self._call("begin_acceptance_run", {"contract": self._json(contract)}, AcceptanceRunStarted)

    def record_visual_claim(self, run_id: str, claim: AcceptanceClaimResult) -> MutationReceipt:
        return self._call("record_visual_claim", {"run_id": run_id, "claim": self._json(claim)}, MutationReceipt)

    def record_screenshot_artifact(self, run_id: str, artifact: AcceptanceArtifact) -> MutationReceipt:
        return self._call("record_screenshot_artifact", {"run_id": run_id, "artifact": self._json(artifact)}, MutationReceipt)

    def record_refresh_result(self, run_id: str, result: AcceptanceCheck) -> MutationReceipt:
        return self._call("record_refresh_result", {"run_id": run_id, "result": self._json(result)}, MutationReceipt)

    def record_restart_result(self, run_id: str, result: AcceptanceCheck) -> MutationReceipt:
        return self._call("record_restart_result", {"run_id": run_id, "result": self._json(result)}, MutationReceipt)

    def record_console_result(self, run_id: str, result: ConsoleResult) -> MutationReceipt:
        return self._call("record_console_result", {"run_id": run_id, "result": self._json(result)}, MutationReceipt)

    def record_network_result(self, run_id: str, result: NetworkResult) -> MutationReceipt:
        return self._call("record_network_result", {"run_id": run_id, "result": self._json(result)}, MutationReceipt)

    def submit_pass_or_fail_report(self, run_id: str, report: AcceptanceResultsDocument) -> AcceptanceSubmissionReceipt:
        return self._call("submit_pass_or_fail_report", {"run_id": run_id, "report": self._json(report)}, AcceptanceSubmissionReceipt)

    def save_verified_property_fact(self, fact: VerifiedPropertyFact) -> MutationReceipt:
        return self._call("save_verified_property_fact", {"fact": self._json(fact)}, MutationReceipt)

    def save_verified_comp(self, comp: VerifiedComp) -> MutationReceipt:
        return self._call("save_verified_comp", {"comp": self._json(comp)}, MutationReceipt)

    def save_verified_visual_artifact(self, artifact: VerifiedVisualArtifact) -> MutationReceipt:
        return self._call("save_verified_visual_artifact", {"artifact": self._json(artifact)}, MutationReceipt)

    def report_specialist_progress(self, progress: SpecialistProgress) -> MutationReceipt:
        return self._call("report_specialist_progress", {"progress": self._json(progress)}, MutationReceipt)

    def complete_or_fail_research_category(self, result: ResearchCategoryResult) -> CategoryReceipt:
        return self._call("complete_or_fail_research_category", {"result": self._json(result)}, CategoryReceipt)
