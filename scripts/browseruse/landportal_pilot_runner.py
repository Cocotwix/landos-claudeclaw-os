# LandOS — Browser Use LandPortal pilot runner.
#
# Spawned by the LandOS Node server (see src/landos/landportal-browseruse.ts).
# Attaches to the operator's EXISTING paired Chrome over CDP and lets Browser Use
# act as the adaptive navigation / visual-reasoning layer for the normal visible
# LandPortal website. It never launches a browser of its own, never handles
# credentials (the paired profile already holds the authenticated session), and
# never touches paid features.
#
# Contract:
#   stdin  — one JSON job spec:
#     {
#       "subject": {"address": str, "city": str|null, "state": str|null,
#                    "county": str|null, "apn": str|null},
#       "cdpUrl": str,               # e.g. http://127.0.0.1:9224
#       "outputDir": str,           # absolute dir for evidence screenshots
#       "provider": "anthropic"|"google",  # which configured LLM provider to use
#       "model": str|null,          # model id override (else provider default)
#       "maxSteps": int|null        # agent step budget (default 40)
#     }
#   stdout — exactly one JSON document (the structured pilot result). All logs
#            go to stderr. Exit code 0 even on navigation failure: a failed
#            step is DATA (recorded in the result), not a crash. Non-zero exit
#            only for contract-level failures (bad spec, no CDP, no LLM key).
#
# Secrets: the provider key (ANTHROPIC_API_KEY or GOOGLE_API_KEY) is read from
# the environment by the provider SDK itself. It is never printed, echoed, or
# written to the result. LandPortal credentials are never read at all — if the
# session is logged out the runner reports auth_required and stops.

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def log(msg: str) -> None:
    print(f"[landportal-pilot] {msg}", file=sys.stderr, flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ─────────────────────────────────────────────────────────────────────────
# Structured result schema (the LLM fills this; the runner wraps it)
# ─────────────────────────────────────────────────────────────────────────

class SubjectIdentity(BaseModel):
    address_queried: str = Field(description="The address LandOS asked to research")
    landportal_address: str | None = Field(None, description="Address exactly as LandPortal displays it, or null")
    apn: str | None = Field(None, description="APN / parcel number shown by LandPortal, or null")
    county: str | None = None
    state: str | None = None
    parcel_match: str = Field(description="'confirmed' | 'likely' | 'uncertain' | 'not_found'")
    match_reasoning: str = Field(description="Why the selected LandPortal parcel does or does not match the subject")


class PropertyFacts(BaseModel):
    acreage: float | None = Field(None, description="Acreage as displayed, null if not shown")
    owner_shown: str | None = Field(None, description="Owner name exactly as displayed, null if not shown")
    coordinates: str | None = Field(None, description="Lat,lon if displayed, null if not shown")
    property_type: str | None = None
    roads_serving: list[str] = Field(default_factory=list, description="Road name(s) that appear to serve the parcel")
    other_characteristics: list[str] = Field(default_factory=list, description="Other visible facts, each as 'label: value'")
    unavailable_fields: list[str] = Field(default_factory=list, description="Fields that were looked for but NOT visible without a paid feature")


class VisualObservations(BaseModel):
    parcel_shape: str | None = Field(None, description="Plain-language interpretation of the parcel outline")
    apparent_road_frontage: str | None = Field(None, description="What the imagery shows about road frontage (use the term 'road frontage')")
    apparent_access: str | None = Field(None, description="Where the access point / access neck appears to be, from imagery")
    surroundings: str | None = Field(None, description="What the wider context view shows")
    notes: list[str] = Field(default_factory=list)


class EvidenceConflict(BaseModel):
    structured_field: str
    structured_value: str
    visual_observation: str
    explanation: str = Field(description="Why these disagree; both pieces of evidence are preserved")


class CompCandidate(BaseModel):
    address: str | None = None
    distance: str | None = None
    sale_date: str | None = None
    sale_price: str | None = None
    acreage: float | None = None
    price_per_acre: str | None = None
    property_type: str | None = None
    source_context: str = Field(description="Where on LandPortal this comp was visible")
    relevance: str = Field(description="Why this comp may or may not be relevant to the subject")


class CompAttempt(BaseModel):
    attempted: bool
    outcome: str = Field(description="What happened when the normal visible comp workflow was tried")
    candidates: list[CompCandidate] = Field(default_factory=list)


class FailedAction(BaseModel):
    action: str
    reason: str


class LandPortalPilotFindings(BaseModel):
    subject_identity: SubjectIdentity
    property_facts: PropertyFacts
    visual_observations: VisualObservations
    conflicts: list[EvidenceConflict] = Field(default_factory=list)
    comp_attempt: CompAttempt
    failed_actions: list[FailedAction] = Field(default_factory=list)
    auth_required: bool = Field(False, description="True if LandPortal showed a login wall instead of the app")
    paid_feature_encountered: str | None = Field(None, description="Description of any paid gate seen; it must have been avoided")
    confidence: str = Field(description="'high' | 'medium' | 'low' with respect to overall result quality")
    confidence_reasoning: str


# ─────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────

SAFE_LABEL = re.compile(r"[^a-z0-9_]+")


PROVIDER_DEFAULT_MODEL = {"anthropic": "claude-sonnet-5", "google": "gemini-2.5-flash"}


def make_llm(provider: str, model: str):
    if provider == "anthropic":
        from browser_use import ChatAnthropic
        return ChatAnthropic(model=model)
    if provider == "google":
        from dataclasses import dataclass
        from browser_use.llm import ChatGoogle

        # ChatGoogle's built-in retry does NOT engage for google-genai's
        # ClientError/ServerError (429 quota, 503 overload fail in ~0.1s,
        # verified against this installation). This wrapper rides out both,
        # honoring the API's own retry hint when one is present.
        TRANSIENT = ("429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE", "500", "502", "504", "INTERNAL", "DEADLINE")

        @dataclass
        class PatientChatGoogle(ChatGoogle):
            async def ainvoke(self, messages, output_format=None, **kwargs):
                last: Exception | None = None
                for _ in range(12):
                    try:
                        return await ChatGoogle.ainvoke(self, messages, output_format, **kwargs)
                    except Exception as exc:
                        text = str(exc)
                        if not any(marker in text for marker in TRANSIENT):
                            raise
                        last = exc
                        m = re.search(r"retry in ([0-9.]+)s", text) or re.search(r"retryDelay': '([0-9.]+)s", text)
                        delay = min(float(m.group(1)) + 2.0 if m else 15.0, 75.0)
                        log(f"gemini transient error; waiting {delay:.0f}s before retrying")
                        await asyncio.sleep(delay)
                raise last if last else RuntimeError("gemini transient-error retries exhausted")

        return PatientChatGoogle(model=model)
    raise ValueError(f"unsupported provider '{provider}'")


async def run(spec: dict) -> dict:
    from browser_use import Agent, Browser, Tools
    from browser_use.browser import BrowserSession

    subject = spec["subject"]
    out_dir = spec["outputDir"]
    cdp_url = spec["cdpUrl"]
    provider = spec.get("provider") or "anthropic"
    model = spec.get("model") or PROVIDER_DEFAULT_MODEL[provider]
    max_steps = int(spec.get("maxSteps") or 40)
    # Hybrid handoff: when the deterministic LandOS lane has already resolved
    # the subject's LandPortal property page, Browser Use starts THERE (opened
    # without spending any LLM budget) and covers interpretation, visual
    # inspection and recovery — the division of labor this pilot exists for.
    start_url = (spec.get("startUrl") or "").strip()
    if start_url and not start_url.startswith("https://landportal.com/"):
        log(f"ignoring non-LandPortal startUrl")
        start_url = ""
    os.makedirs(out_dir, exist_ok=True)

    captures: list[dict] = []
    tools = Tools()

    @tools.action(
        "Save the current page view as labeled evidence for the operator. Use short snake_case labels: "
        "clean_parcel_aerial, parcel_closeup, wider_context, comp_map, comp_list, property_facts_panel, etc. "
        "Call this at every operator-useful view."
    )
    async def capture_evidence(label: str, browser_session: BrowserSession) -> str:
        safe = SAFE_LABEL.sub("_", label.lower()).strip("_")[:60] or "capture"
        fname = f"browseruse_{safe}-{int(time.time() * 1000)}.png"
        path = os.path.join(out_dir, fname)
        await browser_session.take_screenshot(path=path)
        page_url = ""
        try:
            state = await browser_session.get_browser_state_summary(include_screenshot=False)
            page_url = state.url or ""
        except Exception:
            pass
        captures.append({
            "label": safe,
            "file": fname,
            "pageUrl": page_url,
            "capturedAt": now_iso(),
        })
        log(f"captured evidence '{safe}' -> {fname}")
        return f"Saved evidence screenshot labeled '{safe}'."

    def make_browser() -> Browser:
        return Browser(
            cdp_url=cdp_url,
            is_local=False,
            keep_alive=True,
            allowed_domains=["landportal.com", "*.landportal.com"],
        )

    subject_line = ", ".join(
        str(v) for v in [subject.get("address"), subject.get("city"), subject.get("state")] if v
    )
    county_line = subject.get("county") or "unknown county"
    apn_line = subject.get("apn") or "not known yet"

    task = f"""You are the LandPortal research operator for LandOS. Work ONLY on landportal.com in the
already-logged-in browser session. Open a NEW tab for your work; never close or reuse the
operator's existing tabs.

SUBJECT PROPERTY: {subject_line}
County: {county_line}. APN if known: {apn_line}.

HARD RULES:
- If LandPortal shows a login/sign-in wall, STOP immediately and finish with auth_required=true.
  Never type into a login form; you have no credentials.
- NEVER click anything that buys, unlocks, upgrades, exports, or spends credits: no paid reports,
  no skip tracing, no exports, no plan upgrades, no "unlock" buttons. If you see such a gate,
  note it in paid_feature_encountered and go around it.
- Never invent a fact. A field you cannot see goes in unavailable_fields. An action that fails
  goes in failed_actions with the reason.

ACTION BUDGET: you have roughly 14 actions total — be decisive, never repeat a
failed approach twice, and reserve your final action for the complete structured
result. Priority order when the budget runs short: (1) parcel search + match,
(2) visible property facts, (3) clean_parcel_aerial + wider_context captures,
(4) the comp attempt. A skipped comp attempt is recorded honestly as
attempted=false; never invent anything to fill the gap.

WORKFLOW:
1. {'The subject property page is ALREADY OPEN in your tab: a deterministic LandOS lane resolved it earlier. Do not search; verify what you see.' if start_url else 'Open landportal.com, search for the subject property by address. LandPortal search usually needs the suggestion dropdown: type the address, wait for suggestions, click the matching suggestion.'}
2. Confirm the parcel reasonably matches the subject (address, county, size). Record your
   reasoning in subject_identity.match_reasoning.
3. Open the property/parcel view. Read the visible facts: address, APN, county, state, acreage,
   owner shown, coordinates, property type, roads serving the parcel, and any other visible
   characteristics. Call capture_evidence('property_facts_panel') on the facts view.
4. VISUAL INSPECTION — this matters as much as the text. Study the parcel on the map/aerial:
   - frame the parcel cleanly and call capture_evidence('clean_parcel_aerial')
   - zoom closer and call capture_evidence('parcel_closeup')
   - zoom out for surrounding context and call capture_evidence('wider_context')
   Describe the parcel shape, the apparent road frontage (always the term "road frontage"),
   and where the apparent access point or access neck is. If any free overlay adds insight,
   capture it too.
5. Compare what the imagery shows with the structured fields. If a structured field conflicts
   with what you can SEE (for example a frontage field that disagrees with the visible parcel
   shape), record BOTH in conflicts with an explanation. Never let an unsupported structured
   field silently override obvious visual evidence.
6. COMPS: attempt the normal visible LandPortal comp workflow (for example the comps/market
   panel) WITHOUT purchasing anything. Capture what you find: capture_evidence('comp_map') or
   capture_evidence('comp_list'). Record every usable visible comp candidate with its source
   context and why it may or may not be relevant. If no usable comp is visible, say so; the
   attempt itself is the result.
7. Finish with the complete structured result. Honesty over completeness: missing is missing.
"""

    llm = make_llm(provider, model)

    started = now_iso()
    findings: dict | None = None
    agent_errors: list[str] = []
    urls: list[str] = []
    # The paired Chrome can be briefly busy right after another automation lane
    # releases it; a session-start timeout is retried ONCE with a fresh
    # connection before the run is reported as failed.
    for attempt in (1, 2):
        captures.clear()
        browser = make_browser()
        initial_actions = (
            [{"navigate": {"url": start_url, "new_tab": True}}] if start_url else None
        )
        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            tools=tools,
            initial_actions=initial_actions,
            output_model_schema=LandPortalPilotFindings,
            use_vision=True,
            # The patient LLM wrapper waits out free-tier quota windows INSIDE
            # a call; the agent's own per-call and per-step timeouts must leave
            # room for those waits or they kill the call mid-backoff.
            llm_timeout=420,
            step_timeout=600,
        )
        try:
            history = await agent.run(max_steps=max_steps)
            raw = history.final_result()
            if raw:
                findings = LandPortalPilotFindings.model_validate_json(raw).model_dump(mode="json")
            agent_errors = [str(e) for e in history.errors() if e]
            urls = [u for u in history.urls() if u]
        finally:
            try:
                await browser.stop()
            except Exception as exc:
                log(f"browser detach warning: {exc}")
        start_timeout = any("BrowserStartEvent" in e and "timed out" in e for e in agent_errors)
        if findings is not None or not start_timeout or attempt == 2:
            break
        log("browser session start timed out; retrying once with a fresh connection")
        await asyncio.sleep(5)

    return {
        "runner": "browser-use",
        "runnerVersion": _browser_use_version(),
        "startedAt": started,
        "finishedAt": now_iso(),
        "subject": subject,
        "findings": findings,
        "captures": captures,
        "agentErrors": agent_errors,
        "urlsVisited": sorted(set(u.split("?")[0] for u in urls if isinstance(u, str))),
        "complete": findings is not None,
    }


def _browser_use_version() -> str:
    try:
        from importlib.metadata import version
        return version("browser-use")
    except Exception:
        return "unknown"


PROVIDER_KEY_ENV = {"anthropic": "ANTHROPIC_API_KEY", "google": "GOOGLE_API_KEY"}


def main() -> int:
    try:
        spec = json.loads(sys.stdin.read())
        assert isinstance(spec.get("subject"), dict) and spec["subject"].get("address")
        assert spec.get("cdpUrl") and spec.get("outputDir")
    except Exception as exc:
        log(f"bad job spec: {exc}")
        return 2
    provider = spec.get("provider") or "anthropic"
    key_env = PROVIDER_KEY_ENV.get(provider)
    if not key_env:
        log(f"unsupported provider '{provider}'")
        return 2
    if not (os.environ.get(key_env) or "").strip():
        log(f"{key_env} missing from environment")
        return 3
    try:
        result = asyncio.run(run(spec))
    except Exception as exc:
        log(f"runner failure: {type(exc).__name__}: {exc}")
        print(json.dumps({
            "runner": "browser-use",
            "runnerVersion": _browser_use_version(),
            "startedAt": None,
            "finishedAt": now_iso(),
            "subject": spec.get("subject"),
            "findings": None,
            "captures": [],
            "agentErrors": [f"{type(exc).__name__}: {exc}"],
            "urlsVisited": [],
            "complete": False,
        }))
        return 0
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
