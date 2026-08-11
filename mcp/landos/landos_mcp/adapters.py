"""Adapter contracts and a temp/fixture-only reference adapter for MCP tests."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, TypeVar

from .acceptance_schema import CanonicalAcceptanceValidator
from .models import (
    SCREENSHOT_ARTIFACTS,
    AcceptanceArtifact,
    AcceptanceCheck,
    AcceptanceClaimResult,
    AcceptanceContract,
    AcceptanceExpectations,
    AcceptanceSubmissionReceipt,
    AcceptanceResultsDocument,
    AcceptanceRunStarted,
    CategoryReceipt,
    ConsoleResult,
    EvidencePage,
    MarketResearchContext,
    MutationReceipt,
    NetworkResult,
    PropertyContext,
    PropertyIdentity,
    ProviderSpecialistStatus,
    ResearchCategoryResult,
    SourceRegistryPage,
    SpecialistProgress,
    VerifiedComp,
    VerifiedPropertyFact,
    VerifiedVisualArtifact,
    VisibleCanonicalCounts,
)


class AdapterNotConfigured(RuntimeError):
    """The MCP surface is inspectable but has no canonical LandOS adapter yet."""


class AdapterConflict(ValueError):
    """A bounded write conflicts with canonical identity or immutable state."""


class LandosReadAdapter(Protocol):
    def get_property_context(self, property_card_id: int) -> PropertyContext: ...
    def get_accepted_evidence(self, property_card_id: int, category: str | None, limit: int) -> EvidencePage: ...
    def get_provider_and_specialist_status(self, property_card_id: int) -> ProviderSpecialistStatus: ...
    def get_acceptance_expectations(self, property_card_id: int, sprint_name: str | None) -> AcceptanceExpectations: ...
    def get_visible_and_canonical_counts(self, property_card_id: int) -> VisibleCanonicalCounts: ...
    def get_market_research_context(self, property_card_id: int, scope: str) -> MarketResearchContext: ...
    def get_source_registry_entries(self, kind: str | None, jurisdiction: str | None, limit: int) -> SourceRegistryPage: ...


class LandosAcceptanceAdapter(Protocol):
    def begin_acceptance_run(self, contract: AcceptanceContract) -> AcceptanceRunStarted: ...
    def record_visual_claim(self, run_id: str, claim: AcceptanceClaimResult) -> MutationReceipt: ...
    def record_screenshot_artifact(self, run_id: str, artifact: AcceptanceArtifact) -> MutationReceipt: ...
    def record_refresh_result(self, run_id: str, result: AcceptanceCheck) -> MutationReceipt: ...
    def record_restart_result(self, run_id: str, result: AcceptanceCheck) -> MutationReceipt: ...
    def record_console_result(self, run_id: str, result: ConsoleResult) -> MutationReceipt: ...
    def record_network_result(self, run_id: str, result: NetworkResult) -> MutationReceipt: ...
    def submit_pass_or_fail_report(self, run_id: str, report: AcceptanceResultsDocument) -> AcceptanceSubmissionReceipt: ...


class LandosResearchAdapter(Protocol):
    def save_verified_property_fact(self, fact: VerifiedPropertyFact) -> MutationReceipt: ...
    def save_verified_comp(self, comp: VerifiedComp) -> MutationReceipt: ...
    def save_verified_visual_artifact(self, artifact: VerifiedVisualArtifact) -> MutationReceipt: ...
    def report_specialist_progress(self, progress: SpecialistProgress) -> MutationReceipt: ...
    def complete_or_fail_research_category(self, result: ResearchCategoryResult) -> CategoryReceipt: ...


class UnconfiguredLandosAdapter:
    """Fail closed instead of silently writing to a second LandOS store."""

    def __getattr__(self, method: str) -> Callable[..., Any]:
        def unavailable(*_args: Any, **_kwargs: Any) -> Any:
            raise AdapterNotConfigured(
                f"{method} has no canonical LandOS adapter; fixture/reference mode is never a production fallback"
            )
        return unavailable


T = TypeVar("T")


class SafeJsonFixtureStore:
    """One fixed JSON file under an explicitly allowed temp/fixture root."""

    def __init__(self, root: Path, *, allowed_root: Path) -> None:
        self.allowed_root = allowed_root.resolve()
        self.root = root.resolve()
        try:
            self.root.relative_to(self.allowed_root)
        except ValueError as error:
            raise ValueError("fixture root must remain beneath allowed_root") from error
        self.root.mkdir(parents=True, exist_ok=True)
        if self.root.is_symlink():
            raise ValueError("fixture root must not be a symlink")
        self.path = self.root / "state.json"
        if self.path.exists() and self.path.is_symlink():
            raise ValueError("fixture state must not be a symlink")
        self._lock = threading.RLock()
        if not self.path.exists():
            self._write({})

    def _read(self) -> dict[str, Any]:
        with self.path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if not isinstance(value, dict):
            raise ValueError("fixture state root must be an object")
        return value

    def _write(self, value: dict[str, Any]) -> None:
        temporary = self.root / "state.json.tmp"
        payload = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(self.path)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._read())

    def replace(self, value: dict[str, Any]) -> None:
        with self._lock:
            self._write(deepcopy(value))

    def transact(self, operation: Callable[[dict[str, Any]], T]) -> T:
        with self._lock:
            state = self._read()
            result = operation(state)
            self._write(state)
            return result


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _model_json(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    if isinstance(value, dict):
        return {key: _model_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_model_json(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return value


def _record_id(prefix: str, value: Any) -> str:
    encoded = json.dumps(_model_json(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"{prefix}:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:24]}"


def _address_key(value: str) -> str:
    suffix = {
        "road": "rd", "street": "st", "avenue": "ave", "drive": "dr", "lane": "ln",
        "court": "ct", "boulevard": "blvd", "highway": "hwy", "parkway": "pkwy",
    }
    words = re.sub(r"[^a-z0-9]+", " ", value.lower()).split()
    return " ".join(suffix.get(word, word) for word in words)


def _apn_key(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower()).lstrip("0")


def _same_identity(expected: PropertyIdentity, incoming: PropertyIdentity) -> bool:
    return (
        expected.property_card_id == incoming.property_card_id
        and _address_key(expected.address) == _address_key(incoming.address)
        and (expected.apn is None or incoming.apn is not None and _apn_key(expected.apn) == _apn_key(incoming.apn))
        and (expected.property_id is None or incoming.property_id == expected.property_id)
    )


class FixtureLandosAdapter:
    """Reference behavior for tests only; never points at live LandOS data."""

    def __init__(
        self,
        store: SafeJsonFixtureStore,
        acceptance_validator: CanonicalAcceptanceValidator,
        *,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self.store = store
        self.acceptance_validator = acceptance_validator
        self.now = now

    def _property(self, state: dict[str, Any], property_card_id: int) -> dict[str, Any]:
        value = state.get("properties", {}).get(str(property_card_id))
        if not isinstance(value, dict):
            raise KeyError(f"canonical Property Card {property_card_id} was not found")
        return value

    def _assert_identity(self, state: dict[str, Any], identity: PropertyIdentity) -> None:
        record = self._property(state, identity.property_card_id)
        expected = PropertyContext.model_validate(record["context"]).identity
        if not _same_identity(expected, identity):
            raise AdapterConflict("research evidence identity does not match the canonical Property Card")

    def get_property_context(self, property_card_id: int) -> PropertyContext:
        state = self.store.snapshot()
        return PropertyContext.model_validate(self._property(state, property_card_id)["context"])

    def get_accepted_evidence(self, property_card_id: int, category: str | None, limit: int) -> EvidencePage:
        state = self.store.snapshot()
        records = list(self._property(state, property_card_id).get("accepted_evidence", []))
        if category is not None:
            records = [record for record in records if record.get("category") == category]
        total = len(records)
        return EvidencePage.model_validate({"items": records[:limit], "total": total, "truncated": total > limit})

    def get_provider_and_specialist_status(self, property_card_id: int) -> ProviderSpecialistStatus:
        state = self.store.snapshot()
        record = self._property(state, property_card_id)
        return ProviderSpecialistStatus.model_validate({
            "property_card_id": property_card_id,
            "specialists": record.get("specialists", []),
            "retrieved_at": self.now(),
        })

    def get_acceptance_expectations(self, property_card_id: int, sprint_name: str | None) -> AcceptanceExpectations:
        state = self.store.snapshot()
        context = PropertyContext.model_validate(self._property(state, property_card_id)["context"])
        contracts = [AcceptanceContract.model_validate(value) for value in state.get("acceptance_contracts", [])]
        matches = [contract for contract in contracts if _address_key(contract.property.normalizedAddress) == _address_key(context.identity.address)]
        if sprint_name is not None:
            matches = [contract for contract in matches if contract.sprintName == sprint_name]
        if not matches:
            raise KeyError("no acceptance expectations match the canonical property and sprint")
        contract = sorted(matches, key=lambda item: item.createdAt)[-1]
        return AcceptanceExpectations.model_validate({
            "property_card_id": property_card_id,
            "contract_id": contract.contractId,
            "sprint_name": contract.sprintName,
            "independent_authority": contract.independentAuthority,
            "claims": [{
                "claim_id": claim.id,
                "operator_section": claim.operatorSection,
                "claim": claim.claim,
                "expected_binding": claim.expectedBinding,
                "expected_value": claim.expectedValue,
                "evidence_artifacts": claim.evidenceArtifacts,
            } for claim in contract.claims],
        })

    def get_visible_and_canonical_counts(self, property_card_id: int) -> VisibleCanonicalCounts:
        state = self.store.snapshot()
        record = self._property(state, property_card_id)
        return VisibleCanonicalCounts.model_validate({
            "property_card_id": property_card_id,
            "counts": record.get("counts", []),
            "retrieved_at": self.now(),
        })

    def get_market_research_context(self, property_card_id: int, scope: str) -> MarketResearchContext:
        state = self.store.snapshot()
        record = self._property(state, property_card_id)
        contexts = record.get("market_context", {})
        if scope not in contexts:
            raise KeyError(f"no canonical market context exists for scope {scope!r}")
        return MarketResearchContext.model_validate(contexts[scope])

    def get_source_registry_entries(self, kind: str | None, jurisdiction: str | None, limit: int) -> SourceRegistryPage:
        state = self.store.snapshot()
        records = list(state.get("source_registry", []))
        if kind is not None:
            records = [record for record in records if record.get("kind") == kind]
        if jurisdiction is not None:
            needle = jurisdiction.casefold().strip()
            records = [record for record in records if needle in str(record.get("jurisdiction", "")).casefold()]
        total = len(records)
        return SourceRegistryPage.model_validate({"entries": records[:limit], "total": total, "truncated": total > limit})

    def begin_acceptance_run(self, contract: AcceptanceContract) -> AcceptanceRunStarted:
        document = contract.model_dump(mode="json", exclude_none=True)
        self.acceptance_validator.validate_contract(document)
        run_id = _record_id("acceptance", {"contract": contract.contractId, "created": document["createdAt"]})
        started_at = self.now()

        def operation(state: dict[str, Any]) -> AcceptanceRunStarted:
            runs = state.setdefault("acceptance_runs", {})
            if run_id in runs:
                raise AdapterConflict("acceptance run already exists for this immutable contract instance")
            runs[run_id] = {
                "contract": document,
                "started_at": started_at.isoformat().replace("+00:00", "Z"),
                "claims": {}, "artifacts": {}, "refresh": None, "restart": None,
                "console": None, "network": None, "submission": None,
            }
            contracts = state.setdefault("acceptance_contracts", [])
            if not any(value.get("contractId") == contract.contractId for value in contracts if isinstance(value, dict)):
                contracts.append(document)
            return AcceptanceRunStarted(
                run_id=run_id,
                contract_id=contract.contractId,
                authority="landos-visual-qa",
                state="recording",
                started_at=started_at,
            )

        return self.store.transact(operation)

    @staticmethod
    def _run(state: dict[str, Any], run_id: str) -> dict[str, Any]:
        run = state.get("acceptance_runs", {}).get(run_id)
        if not isinstance(run, dict):
            raise KeyError(f"acceptance run {run_id!r} was not found")
        if run.get("submission") is not None:
            raise AdapterConflict("submitted acceptance runs are immutable")
        return run

    def _receipt(self, prefix: str, value: Any) -> MutationReceipt:
        return MutationReceipt(accepted=True, record_id=_record_id(prefix, value), recorded_at=self.now())

    def record_visual_claim(self, run_id: str, claim: AcceptanceClaimResult) -> MutationReceipt:
        def operation(state: dict[str, Any]) -> MutationReceipt:
            run = self._run(state, run_id)
            contract = AcceptanceContract.model_validate(run["contract"])
            expected = next((item for item in contract.claims if item.id == claim.claimId), None)
            if expected is None:
                raise AdapterConflict("claim is not declared by the immutable acceptance contract")
            if claim.evidencePath not in expected.evidenceArtifacts:
                raise AdapterConflict("claim evidence path is not allowed by its contract claim")
            if _address_key(claim.propertyAddress) != _address_key(contract.property.address):
                raise AdapterConflict("claim evidence belongs to a different property")
            if claim.operatorSection != expected.operatorSection or claim.claim != expected.claim or claim.expectedValue != expected.expectedValue:
                raise AdapterConflict("claim text or expectation differs from the immutable contract")
            run["claims"][claim.claimId] = claim.model_dump(mode="json")
            return self._receipt("claim", {"run": run_id, "claim": claim})
        return self.store.transact(operation)

    def record_screenshot_artifact(self, run_id: str, artifact: AcceptanceArtifact) -> MutationReceipt:
        if artifact.path not in SCREENSHOT_ARTIFACTS or artifact.contentValidation.kind != "screenshot":
            raise AdapterConflict("record_screenshot_artifact accepts only the six canonical screenshot artifacts")
        def operation(state: dict[str, Any]) -> MutationReceipt:
            run = self._run(state, run_id)
            contract = AcceptanceContract.model_validate(run["contract"])
            if artifact.path not in contract.requiredArtifacts:
                raise AdapterConflict("screenshot is not declared by the immutable acceptance contract")
            run["artifacts"][artifact.path] = artifact.model_dump(mode="json")
            return self._receipt("artifact", {"run": run_id, "artifact": artifact})
        return self.store.transact(operation)

    def _record_single(self, run_id: str, key: str, value: Any) -> MutationReceipt:
        def operation(state: dict[str, Any]) -> MutationReceipt:
            run = self._run(state, run_id)
            run[key] = _model_json(value)
            return self._receipt(key, {"run": run_id, key: value})
        return self.store.transact(operation)

    def record_refresh_result(self, run_id: str, result: AcceptanceCheck) -> MutationReceipt:
        return self._record_single(run_id, "refresh", result)

    def record_restart_result(self, run_id: str, result: AcceptanceCheck) -> MutationReceipt:
        return self._record_single(run_id, "restart", result)

    def record_console_result(self, run_id: str, result: ConsoleResult) -> MutationReceipt:
        return self._record_single(run_id, "console", result)

    def record_network_result(self, run_id: str, result: NetworkResult) -> MutationReceipt:
        return self._record_single(run_id, "network", result)

    @staticmethod
    def _pass_is_defensible(report: AcceptanceResultsDocument) -> bool:
        return (
            all(claim.status == "PASS" and claim.refreshResult == "PASS" and claim.restartResult == "PASS" and claim.contaminationResult == "PASS" for claim in report.claims)
            and all(count.canonicalAccepted == count.displayed == count.renderedRows and not (count.canonicalAccepted > 0 and count.emptyStateVisible) for count in report.counts)
            and report.refresh.status == "PASS" and report.refresh.visibleValuesRetained
            and report.restart.status == "PASS" and report.restart.visibleValuesRetained
            and report.contamination.status == "PASS" and not report.contamination.detectedValues
            and report.console.relevantErrorCount == 0
            and report.network.requiredFailureCount == 0
            and report.lifecycle.isolatedContext
            and report.lifecycle.contextsCreated == report.lifecycle.contextsClosed
            and report.lifecycle.pagesCreated == report.lifecycle.pagesClosed
            and report.lifecycle.normalOperatorBrowserUntouched
            and report.lifecycle.cleanupCompleted
            and (not report.freshness.required or report.freshness.isFresh)
        )

    def submit_pass_or_fail_report(self, run_id: str, report: AcceptanceResultsDocument) -> AcceptanceSubmissionReceipt:
        document = report.model_dump(mode="json", exclude_none=True)
        self.acceptance_validator.validate_results(document)
        submitted_at = self.now()

        def operation(state: dict[str, Any]) -> AcceptanceSubmissionReceipt:
            run = self._run(state, run_id)
            contract = AcceptanceContract.model_validate(run["contract"])
            if report.runId != run_id or report.contractId != contract.contractId:
                raise AdapterConflict("report run or contract identity does not match the open acceptance run")
            if report.sprintName != contract.sprintName or report.mode != contract.runPolicy.mode:
                raise AdapterConflict("report sprint or mode does not match the immutable contract")
            if _address_key(report.propertyAddress) != _address_key(contract.property.address):
                raise AdapterConflict("report property address does not match the immutable contract")
            expected_claims = {claim.id: claim for claim in contract.claims}
            if {claim.claimId for claim in report.claims} != set(expected_claims):
                raise AdapterConflict("report must contain every contract claim exactly once")
            if len(report.claims) != len(expected_claims):
                raise AdapterConflict("report contains duplicate contract claims")
            for claim in report.claims:
                expected = expected_claims[claim.claimId]
                if claim.evidencePath not in expected.evidenceArtifacts:
                    raise AdapterConflict(f"claim {claim.claimId} uses evidence not allowed by its contract")
                if _address_key(claim.propertyAddress) != _address_key(contract.property.address):
                    raise AdapterConflict(f"claim {claim.claimId} contains cross-property evidence")
            if report.verdict == "PASS" and not self._pass_is_defensible(report):
                raise AdapterConflict("PASS is not defensible from the submitted visual acceptance evidence")
            if report.verdict == "FAIL" and self._pass_is_defensible(report):
                raise AdapterConflict("FAIL report contains no failing acceptance condition")
            paths = [artifact.path for artifact in report.artifacts]
            if len(paths) != len(set(paths)):
                raise AdapterConflict("report artifact paths must be unique")
            for artifact in report.artifacts:
                if artifact.path not in contract.requiredArtifacts:
                    raise AdapterConflict(f"artifact {artifact.path!r} is not declared by the contract")
            run["submission"] = document
            return AcceptanceSubmissionReceipt(
                accepted=True, run_id=run_id, verdict=report.verdict,
                submitted_at=submitted_at, immutable=True,
            )
        return self.store.transact(operation)

    def _save_research(self, prefix: str, value: Any, collection: str) -> MutationReceipt:
        def operation(state: dict[str, Any]) -> MutationReceipt:
            identity = value.identity
            self._assert_identity(state, identity)
            record = _model_json(value)
            record_id = _record_id(prefix, record)
            records = state.setdefault("research_records", {}).setdefault(collection, {})
            records[record_id] = record
            return MutationReceipt(accepted=True, record_id=record_id, recorded_at=self.now())
        return self.store.transact(operation)

    def save_verified_property_fact(self, fact: VerifiedPropertyFact) -> MutationReceipt:
        return self._save_research("fact", fact, "facts")

    def save_verified_comp(self, comp: VerifiedComp) -> MutationReceipt:
        return self._save_research("comp", comp, "comps")

    def save_verified_visual_artifact(self, artifact: VerifiedVisualArtifact) -> MutationReceipt:
        return self._save_research("visual", artifact, "visuals")

    def report_specialist_progress(self, progress: SpecialistProgress) -> MutationReceipt:
        return self._save_research("progress", progress, "progress")

    def complete_or_fail_research_category(self, result: ResearchCategoryResult) -> CategoryReceipt:
        def operation(state: dict[str, Any]) -> CategoryReceipt:
            self._assert_identity(state, result.identity)
            key = f"{result.identity.property_card_id}:{result.category}:{result.provider_id}"
            categories = state.setdefault("research_category_results", {})
            if key in categories:
                raise AdapterConflict("research category already has an immutable terminal result")
            categories[key] = result.model_dump(mode="json")
            return CategoryReceipt(
                accepted=True, category=result.category, outcome=result.outcome, recorded_at=self.now()
            )
        return self.store.transact(operation)
