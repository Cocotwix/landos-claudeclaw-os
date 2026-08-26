# Outcome

LandOS reconciles a retained comparable's identity and location evidence before
it decides the record cannot be placed, so every retained comp that LandOS
already holds sufficient legitimate location evidence for is mapped, and every
comp that genuinely lacks that evidence stays explicitly unresolved and is
presented to the operator as unresolved rather than as a silent mapping failure.

This is a reusable behavior fix in the shared retained-comp reconciliation and
mapping path. 9490 Elk Lake Rd is the acceptance example, never the
implementation scope. A per-property special case, an address allow-list, or any
fix keyed to one subject is a failed outcome.

# Acceptance

On the real localhost LandOS Comps & Market / map surface for 9490 Elk Lake Rd:

- Retained comps that LandOS already holds sufficient legitimate location
  evidence for are mapped. Today effectively none of them are, and that is the
  defect.
- Retained, mapped, and unresolved counts add up and accurately describe the
  resulting comparable set.
- A comp that remains unresolved is visibly explained as unresolved to the
  operator, not rendered as an unexplained blank or a missing pin.
- The distinction between valuation-usable comparable records, active vacant-land
  competition, context-only records, and legitimately unresolved records is
  preserved exactly as it is today.
- The already accepted 9490 Elk Lake Rd listing-reconciliation and
  canonical-subject behavior is unchanged.
- A refresh reproduces the same result. Nothing depends on in-memory state.

Hard identity rules, from `.landos/PERMANENT_MEMORY.md` invariants 2-4:

- Never invent, synthesize, approximate, or fabricate a coordinate, address,
  parcel location, or any other locating fact.
- Never infer a location so the map looks fuller. An unmappable comp stays
  unresolved; that is a correct result, not a failure to hide.
- Never carry a fact from another property, parcel, owner, or assignment into
  the subject or into a comp. No cross-property evidence contamination.
- A geocode does not verify parcel identity. Using already-captured legitimate
  location evidence to place a comp on the map is the point; manufacturing that
  evidence is not.

Every mapped comp must be traceable to the specific captured evidence that
located it.

Add focused test coverage for the reusable reconciliation behavior you
implement, including the negative case: insufficient evidence must stay
unresolved. A green suite that only proves the happy path is not acceptance.

# Scope

- src/**
- web/src/**
- scripts/landos/**

# Surface

Do not touch anything under `scripts/devloop/`, `scripts/dev/`, `.landos/`,
`docs/`, `fixtures/`, `package.json`, or the git index. The working tree holds a
deliberately preserved, unaccepted experiment under `scripts/devloop/` plus a
modified `package.json` and `builders.mjs`. It is evidence only: do not stage,
commit, revert, discard, clean, restore, delete, or incorporate any of it, and do
not run `git add`, `git commit`, `git checkout --`, `git restore`, `git reset`,
or `git stash`. There is also a stash named `landos-duke-overarchitecture-hold`;
leave it alone.

The comp path is spread across `src/landos/comp-*.ts` and its `.test.ts`
siblings: ingestion/extraction, classification, lane accountability, listing
capture and projection, registry, retrieval, orchestration, and `comp-map.ts`.
Operator presentation lives under `web/src/`. The accepted canonical-subject work
is in `canonical-identity.ts`, `deal-card-canonical.ts`, and
`exact-address-web-discovery.ts` and must keep passing.

Find the actual root cause by reading the real path from capture through
persistence to what the map surface consumes. Do not assume the defect is in the
map layer because that is where the symptom shows.

Real data for the acceptance case lives in `store/landos.db`. Read it to
understand what location evidence LandOS actually retained per comp. Do not
mutate business rows, do not run destructive or arbitrary write SQL, and do not
hand-edit records to make the surface look right.

A small defect found directly inside this affected path is fixed here rather
than deferred. Anything outside it is recorded, not built. Do not redesign the
comp system, do not add multi-agent orchestration or new data sources, and do not
change valuation or strategy.

# Verify

- npx tsc --noEmit
- npx vitest run src/landos/comp-map.test.ts src/landos/comp-classification.test.ts src/landos/comp-lane-accountability.test.ts
- npx vitest run src/landos/canonical-identity.test.ts src/landos/deal-card-canonical.property-intelligence.test.ts
