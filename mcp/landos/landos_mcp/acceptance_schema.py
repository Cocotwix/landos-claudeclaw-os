"""Read-only validation against the canonical LandOS acceptance v1 schemas."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError


class AcceptanceSchemaError(ValueError):
    """Raised when an acceptance document violates the canonical schema."""


class CanonicalAcceptanceValidator:
    def __init__(self, schema_root: Path) -> None:
        self._schema_root = schema_root.resolve()
        self._contract = self._load("acceptance-contract.schema.json")
        self._results = self._load("results.schema.json")
        self._contract_validator = Draft202012Validator(self._contract, format_checker=FormatChecker())
        self._results_validator = Draft202012Validator(self._results, format_checker=FormatChecker())

    def _load(self, name: str) -> dict[str, Any]:
        target = (self._schema_root / name).resolve()
        try:
            target.relative_to(self._schema_root)
        except ValueError as error:
            raise AcceptanceSchemaError("acceptance schema path escaped its fixed root") from error
        with target.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if not isinstance(value, dict):
            raise AcceptanceSchemaError(f"{name} is not a JSON object")
        Draft202012Validator.check_schema(value)
        return value

    @staticmethod
    def _raise_first(validator: Draft202012Validator, document: dict[str, Any], label: str) -> None:
        errors = sorted(validator.iter_errors(document), key=lambda error: tuple(str(part) for part in error.absolute_path))
        if not errors:
            return
        error: ValidationError = errors[0]
        path = ".".join(str(part) for part in error.absolute_path) or "payload"
        raise AcceptanceSchemaError(f"{label} rejected by canonical schema at {path}: {error.message}")

    def validate_contract(self, document: dict[str, Any]) -> None:
        self._raise_first(self._contract_validator, document, "acceptance contract")

    def validate_results(self, document: dict[str, Any]) -> None:
        self._raise_first(self._results_validator, document, "acceptance results")


def repository_acceptance_validator() -> CanonicalAcceptanceValidator:
    repository_root = Path(__file__).resolve().parents[3]
    return CanonicalAcceptanceValidator(repository_root / "config" / "acceptance")
