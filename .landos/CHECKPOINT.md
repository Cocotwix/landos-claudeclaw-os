# LandOS Current Checkpoint

<!-- DERIVED:START -->
- **Generated:** 2026-07-17T19:28:46.5249071-04:00
- **HEAD at generation:** `c5d422d`
- **Worktree:** DIRTY; 128 modified/untracked paths at refresh time. Preserve unrelated work.
- **Managed runtime:** RUNNING healthy at `http://localhost:3141`, PID `100792`, verified 2026-07-17.
<!-- DERIVED:END -->

## Current unfinished work

### Active automatic lien/judgment research and source-link completion (2026-07-18)

- [x] Enforce the system-wide local-government research order: use the subject's
  city, township, or county public-record source before a statewide index, and
  make that order visible in every Lead Card's recorded-lien workflow.
  - Witnessed 2026-07-18: shared routing ranks a Fayette County Clerk source
    ahead of a statewide recorder index, both at source selection and workflow
    execution. The normal Card 28 Owner Brief visibly states this order in
    **2a. Recorded liens and encumbrances**, retains the official Fayette Clerk
    result/link, and its **Record lien review** control opened and closed
    normally. Focused suite passed 31 assertions; production build/restart/
    health passed at PID 109056.
- [ ] Run a free official lien/judgment search automatically for each verified
  Lead Card and render either the returned lien/judgment, instrument type,
  amount, and direct official record link, or “No liens found” only after a
  completed official no-match result.
  - Current state: Fayette County's free Clerk guest index did return a
    Card 28 result, but there is not yet a shared county-specific automatic
    research capability for every verified Lead Card. Do not treat the prior
    GSCCCA login block as a no-lien result or create credentials without the
    owner's identity and authority.
- [x] Render an **Open official record** link alongside every deed or lien
  finding/page that has a retained official direct URL, without substituting a
  generic portal link for an absent exact record URL.
- [x] Run focused tests, production build/restart/health, and personally
  inspect the changed Card 28 owner-facing deed and lien sections.
  - Witnessed 2026-07-18: Card 28 at
    `http://localhost:3141/dept/acquisitions?deal=28` shows its deed-supporting
    source links beside ALEXIA INC, legal description, Book 5523, and Page 741.
    It now truthfully says no verified lien or judgment result has been
    returned, rather than calling an unrun search clear. Recorder-page and
    recorded-lien results render an **Open source record** link only when they
    retain a corresponding source URL. Focused suite passed 13 assertions;
    production build/restart/health passed at PID 41276.

### Active recorded-deed image completion (2026-07-18)

### Active recorded-lien review (2026-07-18)

- [x] Add a shared, card-scoped recorded-lien review that distinguishes an
  index hit, a parcel-confirmed recorded lien, and a released/satisfied/expired
  instrument; never state or imply clear title from an index search.
  - Witnessed 2026-07-18: the normal Card 28 owner brief at
    `http://localhost:3141/dept/acquisitions?deal=28` renders **2a. Recorded
    liens and encumbrances** with the truthful current output that no official
    review is recorded and that this is not a clear-title conclusion. Its
    **Record lien review** control opens a visible official-source form for
    result status, source URL, searched party/reference, recording reference,
    lien type, parcel/legal-description match, notes, and an official-source
    attestation. No lien result was saved because none was actually returned.
- [ ] Let the normal county-record workflow retain official source, recording
  reference, debtor/owner match, property match, status, and any real document
  image alongside the deed gallery on every Lead Card.
- [x] Run focused tests, production build/restart/health, and personal normal
  owner-UI acceptance on Card 28 with real returned business output.
  - Witnessed 2026-07-18: Fayette County Clerk of Superior Court's free guest
    eSearch returned two ALEXIA INC Georgia Standard Lien index records. The
    original 2024 tax Fi.Fa. is Book 242 / Page 623, filed 2025-10-16; its
    cancellation is Book 244 / Page 593, recorded 2026-01-14. The cancellation
    image names Property ID 054507007, matching subject APN 05-45-07-007. Its
    Amount column is blank, so the card accurately says no dollar amount was
    reported. The normal Card 28 UI now renders the released/satisfied result,
    parcel match, references, notes, and direct official Clerk link. Production
    build/restart/health passed after the known sandbox-only Vite config access
    error; healthy PID 220892.
  - Witnessed 2026-07-18: the official GSCCCA Lien Index exposes its free
    name-search form with Fayette as a participating county and party/instrument
    filters. This is a legitimate index-screening path, but it is not a
    property-address/title search and does not itself establish a lien or clear
    title.
  - GitHub review 2026-07-18: GSCCCA's public `ImageAPI-SDK` is an image API
    client that requires an authorized client ID/secret, not an open public
    recorder-retrieval implementation. A separate public `gsccca-lead-gen`
    project requires a GSCCCA Premium subscription and stores browser cookies
    in GitHub Actions secrets; it is rejected under the no-paid/no-cookie
    policy. Anonymous GitHub search then rate-limited further browsing.

### Completed shared lien-status wording and official GIS map (2026-07-18)

- [x] Make lien-screening state explicit on every Lead Card: an unsearched
  card says that no official lien-index search has been completed, while a
  completed no-match search says “No matching liens found in the official
  index search” and retains a clear-title disclaimer. This does not turn an
  unsearched card into a “no liens found” assertion.
- [x] Add a shared Owner Brief section for an official county GIS aerial and
  matched parcel boundary. When an official county GIS lane is unavailable,
  render an explicit unavailable state rather than a generic or broken map.
  - Witnessed 2026-07-18: normal owner UI at
    `http://localhost:3141/dept/acquisitions?deal=28` for **585 MARKSMEN CT**
    visibly showed **2a. Recorded liens and encumbrances** with the truthful
    unsearched status and **3. Official GIS parcel map**. Opening the map
    showed Fayette County official aerial imagery with the matched APN
    `054507007` parcel boundary, captioned as screening evidence and not a
    survey/legal-boundary determination.
  - Focused tests passed: 6 tests across recorded-lien review, county GIS
    capabilities, and opportunity package. Production build passed after the
    known sandbox-only Vite config access failure; canonical restart and health
    passed at `http://localhost:3141` (PID 66940).

- [ ] Add one shared county-recorder research capability: free-only account
  creation where a recorder requires it, DPAPI-protected county credential and
  session reuse, real displayed-page capture, and card-scoped deed finding
  extraction with official provenance. Never create paid access or expose a
  credential.
- [x] Make county research platform-aware system-wide: classify a newly found
  local portal into a supported platform family, reuse only value-free family
  navigation guidance, retain an evidenced county-specific override after a
  successful lookup, and map eligible free-account lifecycle outcomes back to
  the county capability. A family match is a starting point, never a claim that
  the new county has been searched or that access exists.
  - Witnessed 2026-07-18: shared County Research Capability now records local
    source observations, identifies a common platform family, uses a current
    county recipe ahead of any family template, and strips URLs/selectors from
    inherited family guidance. A successful official county record teaches the
    county-specific recipe; a family match alone cannot. Eligible free-access
    coordination maps only safe account lifecycle states into the county
    capability and depends on a supplied registration adapter; it cannot create
    a paid account, bypass CAPTCHA/terms, or expose a credential.
  - Focused suite passed 41 assertions across registry, county-capability,
    browser-routing, and owner-workspace contracts. Production build/restart/
    health passed at PID 29192. In the normal Card 28 owner workflow at
    `http://localhost:3141/dept/acquisitions?deal=28`, Refresh property
    research completed with ALEXIA INC/APN 05-45-07-007 and its released-lien
    record retained. Section 2a visibly states local-first research and shows
    Fayette's local portal classified as `custom county portal`, while honestly
    stating that it requires county verification before reuse. The official
    lien-review form opened and closed normally.
- [ ] Exercise the normal Card 28 recorder workflow against GSCCCA only after
  a free account/session is successfully established; attach each displayed
  Book 5523 / Page 741 page and render deed findings. Record an exact blocker
  if its free account path or document viewing is unavailable.
  - Witnessed 2026-07-18 on GSCCCA's official account page: its free
    `Limited-Use` account may search the index and view summaries but explicitly
    may not view or print document images. Image access is limited to paid
    Single-Use ($5) or paid monthly account types. The owner has prohibited paid
    county-record actions, so no Card 28 recorder image can be captured there.
- [ ] Cover the shared recorder workflow with targeted tests, build, managed
  restart/health, and personal owner-UI walkthrough across every changed
  control and returned business result.

- [ ] Make the shared deed workflow present every real, card-scoped recorder
  page image as an expandable deed-page gallery, with page order and official
  provenance; never represent a book/page reference as an image.
- [ ] Run the normal Card 28 workflow and use existing authorized official
  recorder access to collect and attach every available page for Book 5523 /
  Page 741. Record an exact external blocker if page images cannot be viewed.
  - Witnessed 2026-07-18: on the official Georgia Superior Court Clerks'
    Cooperative Authority book/page search, selecting FAYETTE and submitting
    Book 5523 / Page 741 redirected to its login screen. The visible recorder
    page requires a search account and no authenticated recorder session is
    available. No recorded page was displayed, captured, or attached.
- [ ] Apply the same real-image requirement to every existing and new Lead
  Card, then run focused tests, production build/restart/health, and personal
  visual owner-UI acceptance without fabricating any page.
  - Shared-gallery behavior witnessed 2026-07-18 on the normal Card 14 owner
    brief: seven ordered `DEED TO TRUSTEES` recorder-page thumbnails rendered;
    opening page 1 showed the full-size county-recorded image in the visual
    dialog. The UI permits one real official image at a time, preserving its
    document/page reference and official source URL.

### Active Market Pulse expansion (2026-07-18)

- [x] Extend the shared owner-facing Market Pulse with concise, property-relevant
  movement, demand, population, development, infrastructure, planning, and
  restriction findings from retained evidence.
- [x] Carry each finding's source through the common lead-card projection and
  render the requested sections plus a property-specific deal impact in every
  owner brief.
- [x] Add focused regression coverage, complete the production build, managed
  restart, health check, and a normal Card 28 Refresh property research run.
- [x] Personally exercise and inspect every changed Market Pulse control and
  section in the live Card 28 owner workflow; record only witnessed evidence.
  - Witnessed 2026-07-18 at `http://localhost:3141/dept/acquisitions?deal=28`:
    the normal **Refresh property research** action completed while retaining
    `585 MARKSMEN CT` / APN `05-45-07-007` / `ALEXIA INC`. The rebuilt owner
    brief visibly rendered all eight concise sections. Its current retained
    market facts were 26 closed sales, 58 active listings, ~85 DOM, and a
    26.8-month supply proxy; the returned sale sample was led by vacant land.
    Only a Fayetteville-named mixed-use development item was retained as a
    local catalyst. Statewide/adjacent headlines were visibly excluded after
    the source-area relevance repair. No development, infrastructure, planning,
    or restriction statement was represented as established without retained
    local evidence. Focused regression suite passed 45 assertions; production
    build passed and managed runtime health was verified at PID 230300.

- **Turn integrity correction (2026-07-18):** The agent incorrectly ended an
  active incomplete build turn and then said it was continuing. A final response
  means no live work is occurring. Do not repeat this: report stopped vs active
  status accurately, and do not end an owner-required build before acceptance
  unless an external blocker or new authority is required.
- Owner rejected all earlier completion claims. The system-wide Lead Card build
  is not accepted. `2510 State Highway 153, Winters, TX` (card 1) remains an
  example only: live UI showed no deed, no qualified sold comps, and 0/8 core
  diligence lanes. A prior research-mission "complete" status is not proof.
- Replace the engineering-console-style card for every real lead using shared
  data, research/write-back, and UI—not one-off address logic. Existing partial
  code changes in `src/landos/routes.ts` and
  `web/src/components/LeadWorkspace.tsx` are not the finished product.
- Required card: lead identity then deeded owner(s); correct parcel facts;
  in-card expandable LandPortal image, deed screenshot, and terrain image if
  slope exceeds 10%; deed/owners/easements/restrictions; wetlands, frontage,
  slope, utilities, soils/perk, manufactured-home feasibility; five best
  deduplicated sold comps from LandPortal/Zillow/Redfin; manufactured-home
  comps for $200k-$300k land-home review; market pulse, county growth, and
  future-development/news evidence.
- Remove owner-facing retry rows, zero-result messages, provenance, data gaps,
  traces, queues, open work, and activity logs. Keep diagnostics internal.
- Run real research for every existing real lead and save returned artifacts to
  the correct card. Then personally inspect every card via normal navigation;
  test every section and image expansion. Do not finish while any card fails.
- Live inspection after the most recent build showed card 25 (`272 McAlister
  Road, Kingstree, SC`) carrying stale Lincolnton, NC locality data. Correct the
  identity without silently merging an APN, then run and inspect that card.

## Owner-facing build acceptance checklist

- [ ] Correct card 25's stale locality to the verified Kingstree, Williamsburg
  County, SC identity without merging an unverified APN; run its real research
  workflow and visually inspect every owner-brief section.
  - Progress: the official Williamsburg County parcel map contradicted the
    earlier LandPortal-derived result: the subject property is 272 Mcallister
    Rd, Kingstree, SC / Map #45-177-182 / owner Wragg Jessica Marie / Deed
    Book 795, Page 429. The former 45-177-182.B / WILSON TONY result is a
    distinct parcel that uses 272 Mcallister as a mailing address, and must
    not be merged into the subject. This identity was saved through the normal
    owner-card reconciliation action with the official county source and deed
    reference. An earlier Refresh property research action overwrote that
    owner-confirmed identity; a source safeguard now blocks an automated
    conflicting APN from replacing an owner-confirmed official parcel, the app
    was rebuilt/restarted, and the corrected identity was re-saved live. The
    first live retry exposed a second defect: its mission constraints still
    preferred stale intake APN 45-177-182.B. The retry-constraint authority was
    changed so an owner-confirmed official parcel is the immutable boundary;
    focused regression tests and the production build passed, runtime restarted
    (PID 67392), and the same owner-facing refresh was rerun live. It returned
    the correct 45-177-182 / WRAGG JESSICA MARIE parcel with current 0.8-acre,
    12.48%-wetlands, terrain, frontage, feasibility, legal-description, and
    market data. The owner brief and all returned parcel, wetlands, flood,
    comps, aerial/street, terrain, and contour visual expansions were opened.
    It remains unchecked: a recorded deed image/reference and a
    distance-qualified, decision-usable sold-comp set still must be rendered,
    and the system-wide cards/workflows remain unverified.
  - Current live document-image blocker (2026-07-18): the official Williamsburg
    County Clerk/Registrar route led to SC Land Records, then the county's
    Avenu public-records search. Selecting the verified county routed directly
    to the recorder's email/password login before its Instrument Grid. No
    authenticated county-recorder session is configured. The official site
    visibly confirms it records deeds and makes document images available
    through that search, but no image was fabricated or represented as
    retrieved. An existing authorized county account/session or explicit
    authority to create and configure one is required before the requested
    Book 795 / Page 429 image can be captured and rendered in the card.
  - Reusable document-lane repair (2026-07-18): the owner brief now has
    **Attach recorder page**. The normal operator form requires the image,
    document/book-page reference, official recorder label and URL, plus an
    explicit confirmation that the exact image was displayed by that recorder.
    The backend stores only a card-scoped image and source-linked evidence; it
    never logs into a county site or invents a page. Focused regression tests
    passed (22 assertions across deed-page intake, registry, and mission
    safeguards), production build passed, runtime restarted healthy at PID
    240520, and Card 25 was visually rechecked: the new action opened with all
    provenance requirements, then closed without submission because no real
    county image is available. A test-created four-byte dummy image was caught
    during that visual check and removed before handoff; no synthetic recorder
    artifact remains in the operating store.
  - Current live recheck (2026-07-18, PID 184840): production build and the
    owner-triggered **Refresh property research** action completed normally on
    Card 25. The visible brief retained three recorded source-backed sales and
    four additional clickable local sold-market rows, with the explicit owner
    warning that they are context only until distance, acreage, date, and
    property-type validation passes. The shared report route now calls the
    public Redfin **sold-land** filter rather than its active-listing default;
    an observed sold classification is retained as market context only, never
    promoted to a verified/valuation sale. Focused report and Redfin tests
    passed (34 assertions), and the production build passed.
  - Regression still visible after that live refresh: Card 25 currently renders
    `45-177-182.B` / `WILSON TONY`, which contradicts the checkpointed
    owner-confirmed official subject `45-177-182` / `WRAGG JESSICA MARIE`.
    The conflicting identity must be traced and corrected through the normal
    reconciliation workflow before this item can be checked. Do not mistake
    the returned visuals, market rows, or a successful refresh for parcel
    identity acceptance.
  - Live reconciliation recovery (2026-07-18): the official county Assessor
    GIS was personally searched for `45-177-182`. Its owner-facing record
    showed Map Number `45-177-182`, owner **Wragg Jessica Marie**, property
    and mailing address `272 Mcallister Rd`, and Deed Book `795` / Page `429`.
    Those exact observed facts were saved through Card 25's normal **Reconcile
    verified parcel** form using `https://williamsburgsc.wthgis.com/` as the
    official source. The required new **Refresh property research** completed
    successfully afterward. The owner brief now visibly retains APN
    `45-177-182`, WRAGG JESSICA MARIE, the corrected property facts (including
    477.7 frontage, 12.48% wetlands, 3.81% average terrain grade), all ten
    returned parcel/overlay/aerial/street/terrain image lightboxes, and the
    recorded sale/context tiers. It remains unchecked: the county-recorder
    image is still unavailable without the authenticated county session, and
    the sales are still not a distance/date/type-qualified valuation set.
  - Live comparable-gate correction (2026-07-18, PID 179188): the shared
    memo selector now hard-excludes a sold record whose distance is absent,
    invalid, or outside the local ceiling; it can no longer receive a zero
    distance score and appear eligible. The owner-facing Card 25 brief was
    rebuilt, restarted, and personally re-opened at
    `http://localhost:3141/dept/acquisitions?deal=25`. Its three recorded
    source-backed rows now visibly read **Recorded source-backed sales —
    market context** and explicitly state that distance, acreage band, sale
    date, and property type must pass the shared valuation checks. Its
    additional returned rows retain the same context-only disclosure. Focused
    regression tests passed (85 assertions) and the production build passed.
    This is a truthfulness/qualification repair only: no Card 25 sale has been
    promoted to a qualified valuation comp, and the item remains unchecked.
  - Strict type-gate recheck (2026-07-18, PID 206404): an unknown subject or
    comparable property type is now an explicit valuation exclusion, rather
    than an implicit pass. Focused regression tests passed (86 assertions),
    production build passed, and Card 25 was personally re-opened at
    `http://localhost:3141/dept/acquisitions?deal=25`. The live DOM confirmed
    the recorded-context heading, all four required qualification checks, and
    the returned-sale context disclosure; it did **not** render any selected
    qualified-comparable panel. No sale was promoted. This repair does not
    resolve the still-unchecked deed-image or qualified-comps requirements.
  - Live owner-card deduplication recheck (2026-07-18, PID 211052): an
    enriched, source-backed 20 Samaria sale had exposed the same business sale
    twice in Card 25's recorded-sales table. The shared owner-card projection
    now de-duplicates rows by address, price, acreage, and sale date while
    retaining the row that has the usable source URL. Focused regression tests
    passed (86 assertions), production build passed, and the managed runtime
    was restarted healthy. I personally re-opened
    `http://localhost:3141/dept/acquisitions?deal=25`: the owner brief visibly
    shows one 20 Samaria row ($185,000, 0.3 acres, 2025-02-13) with its Redfin
    link, alongside the two distinct market-context sales. I counted the one
    source link and activated it from the owner UI. This resolves only the
    duplicate presentation defect; 20 Samaria remains market context because
    its 0.3-acre site is outside the subject's 0.8-acre qualification band.
  - Identity-write-path repair and live recheck (2026-07-18, PID 31084): a
    clean Card 25 reload exposed that a same-APN automated enrichment replaced
    the owner-confirmed official provenance, allowing a later retry to replace
    the accepted parcel with `45-177-182.B` / WILSON TONY. The shared property
    card update now preserves the entire owner-reconciled identity and
    provenance during automated enrichment; only the explicit reconciliation
    action can change them. Focused regression tests passed (112 assertions)
    and the production build passed. In the live owner UI, the Browser Agent
    completed two configured LandPortal runs (839 returned rows, 649 accepted,
    190 flagged) and visibly reports a connected live session. Card 25 was
    reconciled again through its normal owner form using the Williamsburg
    County Assessor GIS record, then the normal Refresh property research was
    run and the page was cleanly reloaded. It visibly retained `45-177-182` /
    WRAGG JESSICA MARIE, Book 795 / Page 429, 0.8 acres, 477.7 frontage,
    12.48% wetlands, 3.81% terrain, all ten visual controls, and the
    source-backed market-context rows. This closes the identity persistence
    regression only; the owner-requested deed image and qualified valuation
    comparable set remain missing, so this checklist item stays unchecked.
  - Pending shared comparable-distance repair (2026-07-18): HomeHarvest bridge
    rows already carried latitude/longitude, but the shared provider mapping
    discarded them before the valuation selector could measure subject distance.
    The mapping now preserves those coordinates, calculates only a real
    straight-line subject-to-comp distance, and retains coordinates in the
    canonical registry. Focused regression tests passed (89 assertions). This
    change is not live: the required production `npm run build` was blocked
    before Vite could read its configuration because the platform denied the
    elevated build at the account usage limit. Do not restart or call this
    owner-visible verification until that build can run; the recorder image and
    a distance/date/type-qualified comp set remain unresolved.
- [ ] Create and research the required 585 Marksmen Ct, Fayetteville, GA lead
  from normal operator navigation; visually inspect every owner-brief section.
  - Progress: deal 28 / opportunity 27 was created through New Lead and its
    live research workflow completed. The owner brief visibly shows the
    Fayette County parcel identity (APN 05-45-07-007), owner ALEXIA INC,
    2.03 acres, industrial-vacant use, frontage, wetlands, flood, terrain,
    and expandable LandPortal parcel imagery. A later normal owner-card retry
    returned no selected comparable rows despite returned market data. The
    system-wide owner-brief fallback had been incorrectly limited to
    Kingstree, SC; it was changed to match the subject card's city/state,
    built/restarted, and Card 28 now visibly renders five Fayetteville sold
    sales with clickable Realtor/HomeHarvest source pages. Every Card 28
    returned parcel, wetlands, flood, comps-map, terrain, and contour visual
    was opened in the live owner UI. It remains unchecked: these sales are
    context evidence, not yet a distance/acreage-qualified valuation set, and
    a county-recorded deed image is still missing.
- [ ] Backfill every real existing Lead Card with an owner-of-record/deed
  reference, usable parcel facts, expandable LandPortal imagery, terrain when
  required, feasibility, qualified sold comps, and market evidence.
  - Progress: card 14 (473 Seaside Road, Beaufort SC) was repaired and
    researched using the reusable action. Live owner-card verification now
    shows the correct Coleman-family owner, parcel facts, feasibility,
    LandPortal/Google/terrain visuals, and seven county-recorded deed pages in
    the ownership section; page 1 was opened in the full-size viewer. Six
    source-backed closed-sales are visible with usable source links, including
    five sales in the subject acreage range. They remain recorded evidence—not
    a qualified valuation set—until their 3/5/10-mile distance evidence is
    established. Do not check the system-wide item from this partial backfill.
- [ ] Remove every owner-facing trace, retry/status console, raw gap message,
  placeholder dash, zero-result statement, and malformed/raw record link from
  each changed card.
- [ ] Exercise all owner actions and every relevant section/image expansion on
  every changed card through `http://localhost:3141` normal navigation.
- [ ] Run the production build, restart with the managed runtime, confirm
  healthy localhost response, record the current PID and exact URL, and leave
  LandOS running.

## Pending Tyler decisions

## Phase 1 finalization task list (2026-07-18)

- [x] Inspect the complete dirty worktree and confirm the intended integrated Phase 1 scope; exclude only machine-local, generated, secret-bearing, accidental, or unrelated paths.
  - 2026-07-18 finalization audit: Phase 1 implementation, tests, sprint records, and docs form one integrated milestone. Exclude only `.claude/settings.local.json` as machine-local.
- [x] Run the complete regression suite and production build; repair every material Phase 1 failure.
  - 2026-07-18: Full `npm.cmd test` passed after four regression-contract repairs. The repairs align contract coverage with the canonical opportunity pipeline and correct the 12-month comp-count assertion; focused confirmation passed 187/187. `npm.cmd run build` passed (Vite and TypeScript). Build emits only existing bundle-size advisories.
- [ ] Validate storage isolation and LandPortal replacement behavior, including that QA/synthetic data cannot be presented as operating leads.
- [ ] Rebuild/restart through the managed runtime and confirm the live dashboard health.
- [ ] Personally exercise and visually inspect the normal owner workflows for Mission Control, acquisitions pipeline, Lead Workspace, conversational intake, county research, discovery package, transcript reconciliation, Max, and browser research, using real operating data where applicable.
- [ ] Stage the complete intended Phase 1 milestone, commit `Complete LandOS Phase 1 opportunity and research operating system`, push `origin/main`, and verify local HEAD equals origin/main.
  - Next action: use `npm.cmd run landos:restart`, `npm.cmd run landos:health`, then personally complete the required browser walkthrough on `http://localhost:3141` before staging. Do not commit or push before that owner-visible acceptance.

- None. Existing configured providers and authenticated sessions are authorized
  for ordinary research. Do not create paid accounts/charges, change secrets,
  fabricate evidence, create QA leads, or silently merge different APNs.

## Next recommended system-wide priority

- Audit the current browser-research chain end to end, repair the first real
  failure that prevents deed, evidence, and comps from reaching a card, then
  build the canonical owner-facing brief and backfill/visually verify every
  real Lead Card. Keep LandOS running. Use focused retrieval only when needed.
