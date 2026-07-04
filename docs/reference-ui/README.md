# LandOS Reference UI Artifacts

Screenshots and visual references are acceptance artifacts, not inspiration.

This folder stores safe, redacted visual evidence that helps Claude Code and
Codex maintain dashboard continuity across sessions and prove Operator QA.

## Structure

```text
docs/reference-ui/
  Market Intelligence/
  Browser Agent/
  Deal Card/
  Discovery Report/
```

Use the closest product-area folder. Add a short Markdown note next to a
screenshot when the visual needs context.

## Use This For

- Dashboard screenshots proving whether a UI section is visible.
- Before/after UI acceptance captures.
- Cropped component screenshots.
- Visual QA notes.
- Failed Operator QA evidence.
- Reference assets that define acceptance for the next agent.

## Do Not Store

- Secrets, tokens, cookies, `.env` contents, dashboard tokens, or local
  filesystem paths.
- Real APNs, seller details, private addresses, raw parcel reports, or
  unredacted property-specific work product.
- LandPortal credit-consuming reports or paid-provider output.

## Naming

Use:

`YYYY-MM-DD_<area>_<pass-or-fail>_<short-description>.png`

Example:

`2026-07-04_property-card_fail_missing-comps.png`

Context note:

`2026-07-04_property-card_fail_missing-comps.md`

## QA Rule

If a sprint changes the dashboard, the final session memory must say whether a
reference artifact was added or why it was not needed.
