"""Strict request/response contracts for the three narrow LandOS MCPs."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, AnyUrl, BaseModel, ConfigDict, Field, StringConstraints, UrlConstraints, field_validator, model_validator


def _validate_apn(value: str) -> str:
    if not any(character.isdigit() for character in value):
        raise ValueError("APN must contain a digit")
    if any(not (character.isalnum() or character in " ./-") for character in value):
        raise ValueError("APN contains unsupported characters")
    if any(not token for token in value.replace("/", " ").replace("-", " ").replace(".", " ").split(" ")):
        # Repeated separators and surrounding separators are ambiguous model output.
        raise ValueError("APN contains an empty component")
    return value


def _validate_relative_image_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":"):
        raise ValueError("artifact path must be relative")
    if any(part in {"", ".", ".."} for part in normalized.split("/")):
        raise ValueError("artifact path contains an unsafe component")
    if not normalized.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise ValueError("artifact path must name a supported image")
    if any(not (character.isalnum() or character in "._-/ ") for character in normalized):
        raise ValueError("artifact path contains unsupported characters")
    return value


def _validate_https_url(value: AnyUrl) -> AnyUrl:
    if value.username or value.password:
        raise ValueError("URL credentials are prohibited")
    return value


BoundedText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4_000)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
SafeId = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-z0-9][a-z0-9._:-]{2,179}$")]
ClaimId = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[a-z0-9][a-z0-9-]{2,80}$")]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
PropertyId = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[1-9][0-9]{3,19}$")]
Apn = Annotated[str, StringConstraints(strip_whitespace=True, min_length=4, max_length=96), AfterValidator(_validate_apn)]
RelativeImagePath = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=512), AfterValidator(_validate_relative_image_path)]
HttpsUrl = Annotated[AnyUrl, UrlConstraints(allowed_schemes=["https"], host_required=True, max_length=2_048), AfterValidator(_validate_https_url)]
IsoDatetime = Annotated[datetime, Field(strict=False)]
Scalar = str | int | float | bool | None
Verdict = Literal["PASS", "FAIL"]
ResearchCategory = Literal["subject", "comps", "visuals", "market", "zoning", "environmental", "access_utilities", "documents"]
ExpectedBinding = Literal[
    "property.normalizedAddress",
    "property.apn",
    "property.canonicalPropertyId",
    "property.canonicalCounts.comps",
    "property.canonicalCounts.visuals",
    "expectations.imageryAvailable",
    "expectations.specialistResultsRendered",
    "expectations.noCrossPropertyContamination",
]

SCREENSHOT_ARTIFACTS = (
    "new-lead.png",
    "deal-card-loaded.png",
    "changed-section.png",
    "relevant-tab-or-panel.png",
    "after-refresh.png",
    "after-restart.png",
)
REQUIRED_ACCEPTANCE_ARTIFACTS = (
    "acceptance-contract.json",
    "acceptance-report.md",
    "results.json",
    *SCREENSHOT_ARTIFACTS,
    "trace.zip",
    "video.webm",
    "console.json",
    "network-failures.json",
)
ScreenshotArtifactName = Literal[
    "new-lead.png",
    "deal-card-loaded.png",
    "changed-section.png",
    "relevant-tab-or-panel.png",
    "after-refresh.png",
    "after-restart.png",
]
RequiredArtifactName = Literal[
    "acceptance-contract.json",
    "acceptance-report.md",
    "results.json",
    "new-lead.png",
    "deal-card-loaded.png",
    "changed-section.png",
    "relevant-tab-or-panel.png",
    "after-refresh.png",
    "after-restart.png",
    "trace.zip",
    "video.webm",
    "console.json",
    "network-failures.json",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_assignment=True)


class PropertyIdentity(StrictModel):
    property_card_id: Annotated[int, Field(gt=0)]
    address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    apn: Apn | None = None
    property_id: PropertyId | None = None


class PropertyContext(StrictModel):
    identity: PropertyIdentity
    deal_card_id: Annotated[int, Field(gt=0)] | None = None
    county: ShortText | None = None
    state: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{2}$")] | None = None
    canonical: bool
    retrieved_at: IsoDatetime


class AcceptedEvidence(StrictModel):
    evidence_id: SafeId
    property_card_id: Annotated[int, Field(gt=0)]
    category: ResearchCategory
    kind: Literal["fact", "visual", "comp", "status"]
    field: ShortText
    value: Scalar
    source_url: HttpsUrl | None
    strength: Literal["operator_accepted", "official_record", "provider_verified", "provider_observed"]
    retrieved_at: IsoDatetime


class EvidencePage(StrictModel):
    items: list[AcceptedEvidence]
    total: Annotated[int, Field(ge=0)]
    truncated: bool


class SpecialistStatus(StrictModel):
    category: ResearchCategory
    provider_id: SafeId
    status: Literal["pending", "running", "verified", "failed", "unavailable", "not_applicable"]
    started_at: IsoDatetime | None = None
    completed_at: IsoDatetime | None = None
    note: BoundedText | None = None


class ProviderSpecialistStatus(StrictModel):
    property_card_id: Annotated[int, Field(gt=0)]
    specialists: list[SpecialistStatus]
    retrieved_at: IsoDatetime


class AcceptanceExpectation(StrictModel):
    claim_id: ClaimId
    operator_section: ShortText
    claim: BoundedText
    expected_binding: ExpectedBinding
    expected_value: Scalar
    evidence_artifacts: list[ScreenshotArtifactName]


class AcceptanceExpectations(StrictModel):
    property_card_id: Annotated[int, Field(gt=0)]
    contract_id: SafeId
    sprint_name: ShortText
    independent_authority: Literal["landos-visual-qa"]
    claims: list[AcceptanceExpectation]


class SectionCount(StrictModel):
    operator_section: ShortText
    label: ShortText
    canonical_accepted: Annotated[int, Field(ge=0)]
    visible: Annotated[int, Field(ge=0)]
    rendered_rows: Annotated[int, Field(ge=0)]
    empty_state_visible: bool


class VisibleCanonicalCounts(StrictModel):
    property_card_id: Annotated[int, Field(gt=0)]
    counts: list[SectionCount]
    retrieved_at: IsoDatetime


class MarketResearchContext(StrictModel):
    property_card_id: Annotated[int, Field(gt=0)]
    scope: Literal["state", "county", "zip", "acreage_band"]
    state: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")] | None = None
    county: ShortText | None = None
    zip: Annotated[str, StringConstraints(pattern=r"^[0-9]{5}$")] | None = None
    acreage_band: ShortText | None = None
    metrics: dict[str, float | int | str | None]
    sources: list[HttpsUrl]
    as_of: IsoDatetime | None = None


class SourceRegistryEntry(StrictModel):
    source_id: SafeId
    kind: Literal["assessor", "gis", "zoning", "subdivision", "market", "infrastructure", "development", "demographic"]
    jurisdiction: ShortText
    official_domain: ShortText
    base_url: HttpsUrl
    status: Literal["approved", "restricted", "blocked", "stale"]
    last_verified_at: IsoDatetime


class SourceRegistryPage(StrictModel):
    entries: list[SourceRegistryEntry]
    total: Annotated[int, Field(ge=0)]
    truncated: bool


class CanonicalCounts(StrictModel):
    comps: Annotated[int, Field(ge=0)]
    visuals: Annotated[int, Field(ge=0)]


class AcceptanceProperty(StrictModel):
    address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    normalizedAddress: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    apn: Apn
    canonicalPropertyId: PropertyId
    canonicalCounts: CanonicalCounts


class AcceptanceSemanticExpectations(StrictModel):
    imageryAvailable: bool
    specialistResultsRendered: bool
    noCrossPropertyContamination: Literal[True]


class AcceptanceAuthState(StrictModel):
    importAllowed: bool
    explicitApprovalRequired: Literal[True]
    repositoryPersistenceProhibited: Literal[True]


class AcceptanceRunPolicy(StrictModel):
    mode: Literal["fixture", "live"]
    entryFlow: Literal["new-lead", "existing-deal"]
    freshnessRequired: bool
    requireRefresh: Literal[True]
    requireRestart: Literal[True]
    requireIsolatedContext: Literal[True]
    requireContextCleanup: Literal[True]
    authState: AcceptanceAuthState
    requiredNetworkPatterns: list[BoundedText]
    allowedConsoleErrorPatterns: list[BoundedText]

    @field_validator("requiredNetworkPatterns", "allowedConsoleErrorPatterns")
    @classmethod
    def unique_patterns(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("patterns must be unique")
        return values


class AcceptanceClaimContract(StrictModel):
    id: ClaimId
    operatorSection: ShortText
    claim: BoundedText
    expectedBinding: ExpectedBinding
    expectedValue: Scalar
    comparison: Literal["equals", "count_equals", "contains", "present", "absent", "no_contamination"]
    canonicalSource: BoundedText
    evidenceArtifacts: Annotated[list[ScreenshotArtifactName], Field(min_length=1)]

    @field_validator("evidenceArtifacts")
    @classmethod
    def unique_artifacts(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("evidence artifacts must be unique")
        return values


class AcceptanceContract(StrictModel):
    schemaVersion: Literal["1.0.0"]
    contractId: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=160)]
    sprintName: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    createdAt: IsoDatetime
    independentAuthority: Literal["landos-visual-qa"]
    property: AcceptanceProperty
    expectations: AcceptanceSemanticExpectations
    runPolicy: AcceptanceRunPolicy
    claims: Annotated[list[AcceptanceClaimContract], Field(min_length=1)]
    requiredArtifacts: Annotated[list[RequiredArtifactName], Field(min_length=13, max_length=13)]

    @model_validator(mode="after")
    def exact_contract_sets(self) -> "AcceptanceContract":
        claim_ids = [claim.id for claim in self.claims]
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("claim ids must be unique")
        if set(self.requiredArtifacts) != set(REQUIRED_ACCEPTANCE_ARTIFACTS):
            raise ValueError("requiredArtifacts must contain the exact v1.0.0 artifact set")
        bindings: dict[str, Scalar] = {
            "property.normalizedAddress": self.property.normalizedAddress,
            "property.apn": self.property.apn,
            "property.canonicalPropertyId": self.property.canonicalPropertyId,
            "property.canonicalCounts.comps": self.property.canonicalCounts.comps,
            "property.canonicalCounts.visuals": self.property.canonicalCounts.visuals,
            "expectations.imageryAvailable": self.expectations.imageryAvailable,
            "expectations.specialistResultsRendered": self.expectations.specialistResultsRendered,
            "expectations.noCrossPropertyContamination": self.expectations.noCrossPropertyContamination,
        }
        for claim in self.claims:
            expected = bindings[claim.expectedBinding]
            if type(claim.expectedValue) is not type(expected) or claim.expectedValue != expected:
                raise ValueError(f"claim {claim.id} contradicts {claim.expectedBinding}")
        return self


class AcceptanceRunStarted(StrictModel):
    run_id: SafeId
    contract_id: ShortText
    authority: Literal["landos-visual-qa"]
    state: Literal["recording"]
    started_at: IsoDatetime


class AcceptanceClaimResult(StrictModel):
    claimId: ClaimId
    operatorSection: ShortText
    propertyAddress: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    claim: BoundedText
    expectedValue: Scalar
    visibleValue: Scalar
    status: Verdict
    evidencePath: ScreenshotArtifactName
    timestamp: IsoDatetime
    refreshResult: Verdict
    restartResult: Verdict
    contaminationResult: Verdict


class AcceptanceCheck(StrictModel):
    status: Verdict
    visibleValuesRetained: bool
    timestamp: IsoDatetime


class ContaminationResult(StrictModel):
    status: Verdict
    detectedValues: list[BoundedText]
    timestamp: IsoDatetime

    @field_validator("detectedValues")
    @classmethod
    def unique_values(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("detected contamination values must be unique")
        return values


class ConsoleResult(StrictModel):
    path: Literal["console.json"]
    relevantErrorCount: Annotated[int, Field(ge=0)]
    timestamp: IsoDatetime


class NetworkResult(StrictModel):
    path: Literal["network-failures.json"]
    requiredFailureCount: Annotated[int, Field(ge=0)]
    timestamp: IsoDatetime


class AcceptanceCountResult(StrictModel):
    operatorSection: ShortText
    label: ShortText
    canonicalAccepted: Annotated[int, Field(ge=0)]
    displayed: Annotated[int, Field(ge=0)]
    renderedRows: Annotated[int, Field(ge=0)]
    emptyStateVisible: bool
    timestamp: IsoDatetime


class AcceptanceLifecycle(StrictModel):
    isolatedContext: bool
    contextsCreated: Annotated[int, Field(ge=1)]
    contextsClosed: Annotated[int, Field(ge=0)]
    pagesCreated: Annotated[int, Field(ge=1)]
    pagesClosed: Annotated[int, Field(ge=0)]
    normalOperatorBrowserUntouched: bool
    cleanupCompleted: bool
    verifiedAt: IsoDatetime


class FreshnessResult(StrictModel):
    required: bool
    isFresh: bool
    evidence: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=4_000)]


class ScreenshotContentValidation(StrictModel):
    validated: Literal[True]
    kind: Literal["screenshot"]
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]
    uniqueColorSamples: Annotated[int, Field(gt=0)]


class TraceContentValidation(StrictModel):
    validated: Literal[True]
    kind: Literal["trace"]


class VideoContentValidation(StrictModel):
    validated: Literal[True]
    kind: Literal["video"]


class ConsoleContentValidation(StrictModel):
    validated: Literal[True]
    kind: Literal["console"]


class NetworkContentValidation(StrictModel):
    validated: Literal[True]
    kind: Literal["network"]


ContentValidation = Annotated[
    ScreenshotContentValidation | TraceContentValidation | VideoContentValidation
    | ConsoleContentValidation | NetworkContentValidation,
    Field(discriminator="kind"),
]


class AcceptanceArtifact(StrictModel):
    path: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
    mediaType: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=100)]
    byteLength: Annotated[int, Field(gt=0)]
    sha256: Sha256
    capturedAt: IsoDatetime
    contentValidation: ContentValidation


class AcceptanceResultsDocument(StrictModel):
    schemaVersion: Literal["1.0.0"]
    runId: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=180)]
    contractId: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=160)]
    sprintName: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]
    mode: Literal["fixture", "live"]
    startedAt: IsoDatetime
    completedAt: IsoDatetime
    propertyAddress: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=500)]
    authStateImported: bool
    freshness: FreshnessResult
    claims: Annotated[list[AcceptanceClaimResult], Field(min_length=1)]
    counts: Annotated[list[AcceptanceCountResult], Field(min_length=1)]
    lifecycle: AcceptanceLifecycle
    refresh: AcceptanceCheck
    restart: AcceptanceCheck
    contamination: ContaminationResult
    console: ConsoleResult
    network: NetworkResult
    artifacts: Annotated[list[AcceptanceArtifact], Field(min_length=10)]
    verdict: Verdict


class MutationReceipt(StrictModel):
    accepted: Literal[True]
    record_id: SafeId
    recorded_at: IsoDatetime


class AcceptanceSubmissionReceipt(StrictModel):
    accepted: Literal[True]
    run_id: SafeId
    verdict: Verdict
    submitted_at: IsoDatetime
    immutable: Literal[True]


class VerifiedPropertyFact(StrictModel):
    identity: PropertyIdentity
    category: ResearchCategory
    field: ShortText
    value: Scalar
    evidence_type: Literal["fact"]
    strength: Literal["official_record", "provider_verified"]
    provider_id: SafeId
    source_url: HttpsUrl
    retrieved_at: IsoDatetime
    confidence: Literal["high"]


class VerifiedComp(StrictModel):
    identity: PropertyIdentity
    category: Literal["comps"]
    evidence_type: Literal["comp"]
    provider_id: SafeId
    price: Annotated[float, Field(gt=0)]
    acres: Annotated[float, Field(gt=0)]
    apn: Apn | None = None
    address: ShortText | None = None
    price_per_acre: Annotated[float, Field(gt=0)] | None = None
    sale_date: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None
    source_url: HttpsUrl
    retrieved_at: IsoDatetime

    @model_validator(mode="after")
    def comp_identity_and_math(self) -> "VerifiedComp":
        if not self.apn and not self.address:
            raise ValueError("verified comp requires APN or address identity")
        if self.price_per_acre is not None:
            expected = self.price / self.acres
            if abs(self.price_per_acre - expected) > max(1.0, expected * 0.01):
                raise ValueError("price_per_acre conflicts with price divided by acres")
        return self


class VerifiedVisualArtifact(StrictModel):
    identity: PropertyIdentity
    category: Literal["visuals"]
    evidence_type: Literal["visual"]
    provider_id: SafeId
    key: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9._-]{0,127}$")]
    label: ShortText
    purpose: BoundedText
    artifact_path: RelativeImagePath
    sha256: Sha256
    captured_at: IsoDatetime
    requested_view: Literal["parcel_context", "road_frontage", "wetlands", "fema_flood", "soil", "contours", "front_3d", "rear_3d", "comparables_map"]
    active_view: Literal["parcel_context", "road_frontage", "wetlands", "fema_flood", "soil", "contours", "front_3d", "rear_3d", "comparables_map"]
    boundary_required: bool
    boundary_visible: bool
    tiles_loaded: Literal[True]
    camera_scale: Literal["parcel", "context", "county", "national"]
    clipped: Literal[False]
    obstructions: list[ShortText]

    @model_validator(mode="after")
    def valid_visual_metadata(self) -> "VerifiedVisualArtifact":
        if self.active_view != self.requested_view:
            raise ValueError("active_view must match requested_view")
        if self.boundary_required and not self.boundary_visible:
            raise ValueError("required parcel boundary is not visible")
        return self


class SpecialistProgress(StrictModel):
    identity: PropertyIdentity
    category: ResearchCategory
    provider_id: SafeId
    status: Literal["pending", "running"]
    progress_percent: Annotated[int, Field(ge=0, le=99)]
    note: BoundedText
    reported_at: IsoDatetime


class ResearchCategoryResult(StrictModel):
    identity: PropertyIdentity
    category: ResearchCategory
    provider_id: SafeId
    outcome: Literal["complete", "failed"]
    summary: BoundedText
    completed_at: IsoDatetime
    retained_item_count: Annotated[int, Field(ge=0)]


class CategoryReceipt(StrictModel):
    accepted: Literal[True]
    category: ResearchCategory
    outcome: Literal["complete", "failed"]
    recorded_at: IsoDatetime
