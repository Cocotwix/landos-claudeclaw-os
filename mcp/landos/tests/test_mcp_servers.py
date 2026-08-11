from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

import yaml
from pydantic import ValidationError

sys.dont_write_bytecode = True

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
MCP_ROOT = REPOSITORY_ROOT / "mcp" / "landos"
sys.path.insert(0, str(MCP_ROOT))

from landos_mcp.acceptance_schema import repository_acceptance_validator  # noqa: E402
from landos_mcp.adapters import AdapterConflict, FixtureLandosAdapter, SafeJsonFixtureStore  # noqa: E402
from landos_mcp.models import (  # noqa: E402
    AcceptanceArtifact,
    AcceptanceCheck,
    AcceptanceClaimResult,
    AcceptanceContract,
    AcceptanceResultsDocument,
    ConsoleResult,
    NetworkResult,
    PropertyIdentity,
    ResearchCategoryResult,
    SpecialistProgress,
    VerifiedComp,
    VerifiedPropertyFact,
    VerifiedVisualArtifact,
)
from landos_mcp.policy import (  # noqa: E402
    DENIED_TOOL_FILTERS,
    SERVER_TOOL_ALLOWLISTS,
    McpPolicyError,
    assert_exact_tool_surface,
    register_governed_tool,
)
from landos_mcp.servers import create_acceptance_server, create_read_server, create_research_server  # noqa: E402


FIXED_NOW = datetime(2026, 8, 3, 1, 0, 0, tzinfo=UTC)
PROPERTY_IDENTITY = PropertyIdentity(
    property_card_id=77,
    address="704 Bell Rd, Red Creek, NY 13143",
    apn="056400 37.00-1-33",
    property_id="89520173",
)


def model_json(model: object) -> dict[str, object]:
    return model.model_dump(mode="json")  # type: ignore[attr-defined,no-any-return]


def load_contract() -> AcceptanceContract:
    with (REPOSITORY_ROOT / "config" / "acceptance" / "704-bell-known-defect.contract.json").open("r", encoding="utf-8") as handle:
        return AcceptanceContract.model_validate(json.load(handle))


def initial_state() -> dict[str, object]:
    contract = load_contract()
    return {
        "properties": {
            "77": {
                "context": {
                    "identity": model_json(PROPERTY_IDENTITY),
                    "deal_card_id": 501,
                    "county": "Wayne County",
                    "state": "NY",
                    "canonical": True,
                    "retrieved_at": "2026-08-03T00:59:00Z",
                },
                "accepted_evidence": [
                    {
                        "evidence_id": "hermes:comp:001",
                        "property_card_id": 77,
                        "category": "comps",
                        "kind": "comp",
                        "field": "comparable",
                        "value": "4 retained comps",
                        "source_url": "https://landportal.com/",
                        "strength": "provider_verified",
                        "retrieved_at": "2026-08-02T23:06:17Z",
                    },
                    {
                        "evidence_id": "hermes:visual:001",
                        "property_card_id": 77,
                        "category": "visuals",
                        "kind": "visual",
                        "field": "parcel_context",
                        "value": "parcel-context.png",
                        "source_url": "https://landportal.com/",
                        "strength": "provider_verified",
                        "retrieved_at": "2026-08-02T23:06:26Z",
                    },
                ],
                "specialists": [
                    {
                        "category": "comps",
                        "provider_id": "hermes:landportal",
                        "status": "verified",
                        "started_at": "2026-08-02T22:59:22Z",
                        "completed_at": "2026-08-02T23:01:59Z",
                        "note": "Four comparables retained.",
                    }
                ],
                "counts": [
                    {
                        "operator_section": "Comps & Market",
                        "label": "accepted comps",
                        "canonical_accepted": 4,
                        "visible": 0,
                        "rendered_rows": 0,
                        "empty_state_visible": True,
                    },
                    {
                        "operator_section": "Documents & Visuals",
                        "label": "retained visuals",
                        "canonical_accepted": 1,
                        "visible": 0,
                        "rendered_rows": 0,
                        "empty_state_visible": True,
                    },
                ],
                "market_context": {
                    "county": {
                        "property_card_id": 77,
                        "scope": "county",
                        "state": "NY",
                        "county": "Wayne County",
                        "zip": "13143",
                        "acreage_band": "25-100 acres",
                        "metrics": {"inventory": 12, "median_dom": 91},
                        "sources": ["https://example.gov/market"],
                        "as_of": "2026-08-01T00:00:00Z",
                    }
                },
            }
        },
        "source_registry": [
            {
                "source_id": "wayne:gis:official",
                "kind": "gis",
                "jurisdiction": "Wayne County, NY",
                "official_domain": "waynecountyny.gov",
                "base_url": "https://waynecountyny.gov/",
                "status": "approved",
                "last_verified_at": "2026-08-01T00:00:00Z",
            }
        ],
        "acceptance_contracts": [contract.model_dump(mode="json")],
    }


def result_artifacts() -> list[dict[str, object]]:
    values: list[dict[str, object]] = []
    for name in (
        "new-lead.png", "deal-card-loaded.png", "changed-section.png",
        "relevant-tab-or-panel.png", "after-refresh.png", "after-restart.png",
    ):
        values.append({
            "path": name, "mediaType": "image/png", "byteLength": 4096,
            "sha256": "a" * 64, "capturedAt": "2026-08-03T01:01:00Z",
            "contentValidation": {
                "validated": True, "kind": "screenshot", "width": 1280, "height": 720,
                "uniqueColorSamples": 100,
            },
        })
    for name, media_type, kind in (
        ("trace.zip", "application/zip", "trace"),
        ("video.webm", "video/webm", "video"),
        ("console.json", "application/json", "console"),
        ("network-failures.json", "application/json", "network"),
    ):
        values.append({
            "path": name, "mediaType": media_type, "byteLength": 1024,
            "sha256": "b" * 64, "capturedAt": "2026-08-03T01:01:00Z",
            "contentValidation": {"validated": True, "kind": kind},
        })
    return values


def failing_report(contract: AcceptanceContract, run_id: str) -> AcceptanceResultsDocument:
    claims: list[dict[str, object]] = []
    for index, expected in enumerate(contract.claims):
        claims.append({
            "claimId": expected.id,
            "operatorSection": expected.operatorSection,
            "propertyAddress": contract.property.address,
            "claim": expected.claim,
            "expectedValue": expected.expectedValue,
            "visibleValue": 0 if index in {1, 2, 3} else expected.expectedValue,
            "status": "FAIL" if index in {1, 2, 3, 4, 5} else "PASS",
            "evidencePath": expected.evidenceArtifacts[0],
            "timestamp": "2026-08-03T01:01:00Z",
            "refreshResult": "FAIL" if index in {1, 3} else "PASS",
            "restartResult": "FAIL" if index in {1, 3} else "PASS",
            "contaminationResult": "PASS",
        })
    return AcceptanceResultsDocument.model_validate({
        "schemaVersion": "1.0.0", "runId": run_id, "contractId": contract.contractId,
        "sprintName": contract.sprintName, "mode": contract.runPolicy.mode,
        "startedAt": "2026-08-03T01:00:00Z", "completedAt": "2026-08-03T01:05:00Z",
        "propertyAddress": contract.property.address, "authStateImported": True,
        "freshness": {"required": False, "isFresh": False, "evidence": "Known retained property target."},
        "claims": claims,
        "counts": [
            {
                "operatorSection": "Comps & Market", "label": "accepted comps",
                "canonicalAccepted": 4, "displayed": 0, "renderedRows": 0,
                "emptyStateVisible": True, "timestamp": "2026-08-03T01:01:00Z",
            },
            {
                "operatorSection": "Documents & Visuals", "label": "retained visuals",
                "canonicalAccepted": 1, "displayed": 0, "renderedRows": 0,
                "emptyStateVisible": True, "timestamp": "2026-08-03T01:01:00Z",
            },
        ],
        "lifecycle": {
            "isolatedContext": True, "contextsCreated": 1, "contextsClosed": 1,
            "pagesCreated": 1, "pagesClosed": 1, "normalOperatorBrowserUntouched": True,
            "cleanupCompleted": True, "verifiedAt": "2026-08-03T01:05:00Z",
        },
        "refresh": {"status": "FAIL", "visibleValuesRetained": False, "timestamp": "2026-08-03T01:03:00Z"},
        "restart": {"status": "FAIL", "visibleValuesRetained": False, "timestamp": "2026-08-03T01:04:00Z"},
        "contamination": {"status": "PASS", "detectedValues": [], "timestamp": "2026-08-03T01:04:00Z"},
        "console": {"path": "console.json", "relevantErrorCount": 0, "timestamp": "2026-08-03T01:04:00Z"},
        "network": {"path": "network-failures.json", "requiredFailureCount": 0, "timestamp": "2026-08-03T01:04:00Z"},
        "artifacts": result_artifacts(), "verdict": "FAIL",
    })


class GovernedMcpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="landos-mcp-tests-")
        allowed = Path(self.temporary.name)
        self.store = SafeJsonFixtureStore(allowed / "fixture", allowed_root=allowed)
        self.store.replace(initial_state())
        self.adapter = FixtureLandosAdapter(self.store, repository_acceptance_validator(), now=lambda: FIXED_NOW)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_exact_exposed_tool_names_and_denials(self) -> None:
        servers = {
            "landos-read": create_read_server(self.adapter),
            "landos-acceptance": create_acceptance_server(self.adapter),
            "landos-research": create_research_server(self.adapter),
        }
        for name, server in servers.items():
            exposed = asyncio.run(assert_exact_tool_surface(server, name))
            self.assertEqual(set(exposed), set(SERVER_TOOL_ALLOWLISTS[name]))
            for tool in asyncio.run(server.list_tools()):
                self.assertFalse(tool.inputSchema["additionalProperties"])
            with self.assertRaises(Exception):
                asyncio.run(server.call_tool("execute_sql", {"query": "SELECT * FROM secrets"}))

    def test_registration_refuses_extra_and_denied_capabilities(self) -> None:
        server = create_read_server(self.adapter)

        def arbitrary() -> dict[str, bool]:
            return {"ok": True}

        with self.assertRaises(McpPolicyError):
            register_governed_tool(
                server, "landos-read", "get_everything", arbitrary,
                description="Broad read", read_only=True, idempotent=True,
            )
        with self.assertRaises(McpPolicyError):
            register_governed_tool(
                server, "landos-read", "run_shell", arbitrary,
                description="Shell", read_only=False, idempotent=False,
            )

    def test_hermes_and_manifest_filters_are_exact(self) -> None:
        with (REPOSITORY_ROOT / "config" / "landos-mcp" / "hermes-mcp-fragment.yaml").open("r", encoding="utf-8") as handle:
            hermes = yaml.safe_load(handle)
        with (REPOSITORY_ROOT / "config" / "landos-mcp" / "manifest.json").open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        with (REPOSITORY_ROOT / "config" / "landos-mcp" / "mcporter.json").open("r", encoding="utf-8") as handle:
            mcporter = json.load(handle)
        with (REPOSITORY_ROOT / "config" / "landos-mcp" / "profile-governance-fragment.json").open("r", encoding="utf-8") as handle:
            profiles = json.load(handle)
        for name, expected in SERVER_TOOL_ALLOWLISTS.items():
            config = hermes["mcp_servers"][name]
            self.assertEqual(set(config["tools"]["include"]), set(expected))
            self.assertEqual(tuple(config["tools"]["exclude"]), DENIED_TOOL_FILTERS)
            self.assertFalse(config["tools"]["resources"])
            self.assertFalse(config["tools"]["prompts"])
            self.assertEqual(set(manifest["servers"][name]["includeTools"]), set(expected))
            self.assertEqual(mcporter["mcpServers"][name]["args"][0], "-B")
        self.assertEqual(tuple(manifest["denyTools"]), DENIED_TOOL_FILTERS)
        self.assertEqual(profiles["profileMcpAllowlists"]["landos-visual-qa"], ["landos-read", "landos-acceptance"])
        self.assertIn("landos-research", profiles["profileMcpDenylists"]["landos-visual-qa"])
        self.assertNotIn("landos-acceptance", profiles["profileMcpAllowlists"]["landos-research"])

    def test_stdio_entrypoints_use_only_the_canonical_application_bridge(self) -> None:
        factories = {
            "landos_read.py": "create_read_server",
            "landos_acceptance.py": "create_acceptance_server",
            "landos_research.py": "create_research_server",
        }
        for filename, factory in factories.items():
            source = (MCP_ROOT / filename).read_text(encoding="utf-8")
            self.assertIn("CanonicalBridgeLandosAdapter", source)
            self.assertIn(f"{factory}(CanonicalBridgeLandosAdapter())", source)
            self.assertNotIn(f"{factory}()", source)

    def test_fastmcp_calls_read_fixture_without_live_data(self) -> None:
        server = create_read_server(self.adapter)
        result = asyncio.run(server.call_tool("get_property_context", {"property_card_id": 77}))
        serialized = json.dumps([item.model_dump(mode="json") if hasattr(item, "model_dump") else str(item) for item in result])
        self.assertIn("704 Bell Rd", serialized)
        with self.assertRaises(Exception):
            asyncio.run(server.call_tool("get_property_context", {"property_card_id": 77, "sql": "SELECT 1"}))
        evidence = self.adapter.get_accepted_evidence(77, "comps", 10)
        self.assertEqual(evidence.total, 1)
        self.assertEqual(self.adapter.get_provider_and_specialist_status(77).specialists[0].status, "verified")
        self.assertEqual(len(self.adapter.get_acceptance_expectations(77, None).claims), 9)
        self.assertEqual(self.adapter.get_visible_and_canonical_counts(77).counts[0].canonical_accepted, 4)
        self.assertEqual(self.adapter.get_source_registry_entries("gis", "Wayne", 10).total, 1)
        self.assertEqual(self.adapter.get_market_research_context(77, "county").metrics["inventory"], 12)

    def test_acceptance_server_consumes_canonical_schema_and_submits_expected_fail(self) -> None:
        contract = load_contract()
        server = create_acceptance_server(self.adapter)
        raw = asyncio.run(server.call_tool("begin_acceptance_run", {"contract": contract.model_dump(mode="json")}))
        self.assertTrue(raw)
        run_id = next(iter(self.store.snapshot()["acceptance_runs"]))
        first = contract.claims[0]
        claim = AcceptanceClaimResult.model_validate({
            "claimId": first.id, "operatorSection": first.operatorSection,
            "propertyAddress": contract.property.address, "claim": first.claim,
            "expectedValue": first.expectedValue, "visibleValue": first.expectedValue,
            "status": "PASS", "evidencePath": first.evidenceArtifacts[0],
            "timestamp": "2026-08-03T01:01:00Z", "refreshResult": "PASS",
            "restartResult": "PASS", "contaminationResult": "PASS",
        })
        self.adapter.record_visual_claim(run_id, claim)
        screenshot = AcceptanceArtifact.model_validate(result_artifacts()[0])
        self.adapter.record_screenshot_artifact(run_id, screenshot)
        self.adapter.record_refresh_result(run_id, AcceptanceCheck(status="FAIL", visibleValuesRetained=False, timestamp=FIXED_NOW))
        self.adapter.record_restart_result(run_id, AcceptanceCheck(status="FAIL", visibleValuesRetained=False, timestamp=FIXED_NOW))
        self.adapter.record_console_result(run_id, ConsoleResult(path="console.json", relevantErrorCount=0, timestamp=FIXED_NOW))
        self.adapter.record_network_result(run_id, NetworkResult(path="network-failures.json", requiredFailureCount=0, timestamp=FIXED_NOW))
        report = failing_report(contract, run_id)
        receipt = self.adapter.submit_pass_or_fail_report(run_id, report)
        self.assertEqual(receipt.verdict, "FAIL")
        self.assertTrue(receipt.immutable)
        with self.assertRaises(AdapterConflict):
            self.adapter.record_visual_claim(run_id, claim)

    def test_acceptance_rejects_undeclared_evidence_and_indefensible_pass(self) -> None:
        contract = load_contract()
        run = self.adapter.begin_acceptance_run(contract)
        first = contract.claims[0]
        with self.assertRaises(ValidationError):
            AcceptanceClaimResult.model_validate({
                "claimId": first.id, "operatorSection": first.operatorSection,
                "propertyAddress": contract.property.address, "claim": first.claim,
                "expectedValue": first.expectedValue, "visibleValue": first.expectedValue,
                "status": "PASS", "evidencePath": "trace.zip",
                "timestamp": "2026-08-03T01:01:00Z", "refreshResult": "PASS",
                "restartResult": "PASS", "contaminationResult": "PASS",
            })
        with self.assertRaises(AdapterConflict):
            self.adapter.record_screenshot_artifact(
                run.run_id,
                AcceptanceArtifact.model_validate({
                    **result_artifacts()[6],
                    "path": "trace.zip",
                    "contentValidation": {"validated": True, "kind": "trace"},
                }),
            )
        report = failing_report(contract, run.run_id)
        dishonest = report.model_copy(update={"verdict": "PASS"})
        with self.assertRaises(AdapterConflict):
            self.adapter.submit_pass_or_fail_report(run.run_id, dishonest)

    def test_acceptance_schema_rejects_extra_fields_and_wrong_authority(self) -> None:
        document = load_contract().model_dump(mode="json")
        document["unexpected"] = True
        with self.assertRaises(ValidationError):
            AcceptanceContract.model_validate(document)
        wrong = load_contract().model_dump(mode="json")
        wrong["independentAuthority"] = "implementation"
        with self.assertRaises(ValidationError):
            AcceptanceContract.model_validate(wrong)

    def test_research_saves_only_verified_exact_property_scoped_records(self) -> None:
        server = create_research_server(self.adapter)
        fact = VerifiedPropertyFact.model_validate({
            "identity": model_json(PROPERTY_IDENTITY), "category": "subject", "field": "owner",
            "value": "EXAMPLE OWNER", "evidence_type": "fact", "strength": "official_record",
            "provider_id": "wayne:assessor", "source_url": "https://waynecountyny.gov/parcel/77",
            "retrieved_at": "2026-08-03T01:00:00Z", "confidence": "high",
        })
        result = asyncio.run(server.call_tool("save_verified_property_fact", {"fact": fact.model_dump(mode="json")}))
        self.assertTrue(result)
        self.assertEqual(len(self.store.snapshot()["research_records"]["facts"]), 1)
        wrong = fact.model_copy(update={"identity": PROPERTY_IDENTITY.model_copy(update={"address": "12 Other Rd, Auburn, NY 13021"})})
        with self.assertRaises(AdapterConflict):
            self.adapter.save_verified_property_fact(wrong)
        with self.assertRaises(ValidationError):
            VerifiedPropertyFact.model_validate({**fact.model_dump(mode="json"), "evidence_type": "valuation"})
        with self.assertRaises(ValidationError):
            VerifiedPropertyFact.model_validate({**fact.model_dump(mode="json"), "source_url": "http://waynecountyny.gov/parcel/77"})

    def test_research_comp_visual_progress_and_terminal_validation(self) -> None:
        comp = VerifiedComp.model_validate({
            "identity": model_json(PROPERTY_IDENTITY), "category": "comps", "evidence_type": "comp",
            "provider_id": "hermes:landportal", "price": 130000.0, "acres": 34.8,
            "apn": "056400 38.00-1-44", "address": None, "price_per_acre": 3735.63,
            "sale_date": "2026-07-01", "source_url": "https://landportal.com/",
            "retrieved_at": "2026-08-03T01:00:00Z",
        })
        self.adapter.save_verified_comp(comp)
        with self.assertRaises(ValidationError):
            VerifiedComp.model_validate({**comp.model_dump(mode="json"), "price": "130000"})
        with self.assertRaises(ValidationError):
            VerifiedComp.model_validate({**comp.model_dump(mode="json"), "price_per_acre": 9999.0})
        visual_data = {
            "identity": model_json(PROPERTY_IDENTITY), "category": "visuals", "evidence_type": "visual",
            "provider_id": "hermes:landportal", "key": "parcel-context", "label": "Parcel context",
            "purpose": "Exact parcel boundary proof.", "artifact_path": "parcel-context.png", "sha256": "c" * 64,
            "captured_at": "2026-08-03T01:00:00Z", "requested_view": "parcel_context",
            "active_view": "parcel_context", "boundary_required": True, "boundary_visible": True,
            "tiles_loaded": True, "camera_scale": "parcel", "clipped": False, "obstructions": [],
        }
        self.adapter.save_verified_visual_artifact(VerifiedVisualArtifact.model_validate(visual_data))
        with self.assertRaises(ValidationError):
            VerifiedVisualArtifact.model_validate({**visual_data, "artifact_path": "../outside.png"})
        with self.assertRaises(ValidationError):
            VerifiedVisualArtifact.model_validate({**visual_data, "active_view": "wetlands"})
        with self.assertRaises(ValidationError):
            SpecialistProgress.model_validate({
                "identity": model_json(PROPERTY_IDENTITY), "category": "comps",
                "provider_id": "hermes:landportal", "status": "running", "progress_percent": 100,
                "note": "Done", "reported_at": "2026-08-03T01:00:00Z",
            })
        self.adapter.report_specialist_progress(SpecialistProgress.model_validate({
            "identity": model_json(PROPERTY_IDENTITY), "category": "comps",
            "provider_id": "hermes:landportal", "status": "running", "progress_percent": 75,
            "note": "Three of four bounded comp rows verified.", "reported_at": "2026-08-03T01:00:00Z",
        }))
        terminal = ResearchCategoryResult.model_validate({
            "identity": model_json(PROPERTY_IDENTITY), "category": "comps", "provider_id": "hermes:landportal",
            "outcome": "complete", "summary": "Verified comparable category retained.",
            "completed_at": "2026-08-03T01:00:00Z", "retained_item_count": 1,
        })
        self.adapter.complete_or_fail_research_category(terminal)
        with self.assertRaises(AdapterConflict):
            self.adapter.complete_or_fail_research_category(terminal)

    def test_fixture_store_cannot_escape_allowed_temp_root(self) -> None:
        allowed = Path(self.temporary.name) / "allowed"
        allowed.mkdir()
        with self.assertRaises(ValueError):
            SafeJsonFixtureStore(Path(self.temporary.name).parent / "outside", allowed_root=allowed)
        self.assertEqual({path.name for path in self.store.root.iterdir()}, {"state.json"})


if __name__ == "__main__":
    unittest.main()
