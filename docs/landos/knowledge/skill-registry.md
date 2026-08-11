# Governed skill registry

The current `landos` production profile and its LandPortal skill are protected
until the new profiles are proven. Governed profiles receive only their
allowlisted bundled, audited optional, and LandOS-specific skills.

Every nonbundled skill record must include source, version or commit,
installation date, audit result, owning profiles, permissions, and update
policy. A proposed skill write produces a pending diff and dangerous-pattern
scan. It is not provisioned until approved; rejection leaves the active
snapshot unchanged. Hermes may not silently rewrite LandOS acceptance skills.

Required custom skills are:

- `landos-sprint-acceptance`
- `landos-systematic-debug`
- `landos-property-research`
- `landos-market-research`
- `landos-document-intelligence`
- `landos-code-review`

The authoritative approval manifest is created by the governed-profile lane;
this knowledge registry references it after integration rather than maintaining
a second allowlist.

