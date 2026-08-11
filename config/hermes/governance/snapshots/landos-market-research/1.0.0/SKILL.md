---
name: landos-market-research
description: Use when building cited LandOS Market Matrix or Market Pulse evidence.
version: 1.0.0
author: LandOS
license: Proprietary
platforms: [windows]
metadata:
  hermes:
    tags: [landos, market-matrix, market-pulse, research, citations]
    related_skills: [maps, landos-property-research]
---

# LandOS market research

## Overview

Build grounded market context without changing LandOS valuation or strategy.
Separate measured observations from interpretation, keep geography and acreage
bands explicit, and retain source dates so stale evidence cannot appear current.

## Coverage

Address the requested Market Matrix and Market Pulse scope across the relevant
state, county, ZIP, and acreage band:

- inventory and active/sold sample sizes;
- listing and sale pricing, price per acre, and distribution notes;
- days on market, sell-through rate, and absorption;
- acreage-band and geographic comparability;
- developments, road/utility/infrastructure announcements, and planning items;
- major employers, population, growth, and other supported demand indicators;
- source publication date, observation window, retrieval time, and freshness.

## Workflow

1. Fix the subject geography, acreage band, and analysis date before collecting
   observations. State exclusions and avoid silently widening the market.
2. Prefer official statistics, planning bodies, transportation agencies,
   utilities, economic-development organizations, employer announcements, and
   traceable listing/transaction sources.
3. Record the numerator, denominator, time window, and formula for rates such as
   sell-through and absorption. Never report a rate without its sample basis.
4. Keep listing, pending, and closed-sale data distinct. Label medians, means,
   ranges, estimates, and observed values correctly.
5. Cite each material claim to a source URL and source date. Mark missing dates,
   stale data, conflicting sources, and uncertain geography explicitly.
6. Reconcile any property-specific comp with exact subject and comp identity;
   surrounding market context does not become subject evidence.
7. Submit verified observations through the approved research boundary and
   return a freshness/coverage matrix. LandOS decides how evidence affects
   valuation or strategy.

## Monitoring use

The `landos-automation` profile may use this skill only for an explicitly
approved target and schedule. A capability definition is not permission to
create a watcher. Record watermark, source, cadence, owner, and stop condition
before activation.

## Verification checklist

- [ ] State, county, ZIP, acreage band, and analysis date are explicit
- [ ] DOM, sell-through, absorption, inventory, and pricing show sample basis
- [ ] Developments, infrastructure, employers, population, and growth are
      sourced when in scope
- [ ] Every material claim has grounded citation, source date, and freshness
- [ ] Observations remain separate from LandOS valuation and strategy

