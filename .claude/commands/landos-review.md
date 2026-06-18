---
description: "Review a LandOS change for architecture and operator safety"
---

# landos-review

Review the current LandOS change set with a build-memory lens.

## Checks

- No department became the center of gravity.
- LandOS Main and orchestrator architecture are preserved.
- No secrets, tokens, credentials, or private data appear.
- No paid APIs or paid credits are used by default.
- No coordinates, geocoders, proximity, or similar parcel-identification shortcuts are used.
- No broad `git add` or unrelated file staging is proposed.
- The UI stays operator-first, not developer-trace-first.
- Tests and build status are clear.

## Output

- What changed
- What is safe
- What is blocked
- What should be fixed next

