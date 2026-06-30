// LandOS data layer — OS Spine v1.
//
// Dedicated business database opened alongside the ClaudeClaw framework DB.
// Lives in store/landos.db (gitignored via *.db). All tables are namespaced
// landos_* so they can never collide with framework tables, and the file is
// separate so upstream ClaudeClaw schema migrations can never touch business
// data. Same conventions as src/db.ts: WAL, busy_timeout, idempotent
// CREATE TABLE IF NOT EXISTS, chmod 0600.
//
// Entity separation: every business record carries an entity tag constrained
// to LAND_ALLY | TY_LAND_BIZ. Records never mix across entities.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';

export type LandosEntity = 'LAND_ALLY' | 'TY_LAND_BIZ';
export const LANDOS_ENTITIES: readonly LandosEntity[] = ['LAND_ALLY', 'TY_LAND_BIZ'];

export const FACT_LABELS = [
  'Verified',
  'Seller stated',
  'Assumed',
  'Unknown',
  'Needs verification',
  'Conflicting',
] as const;

export const RULE_STATUSES = ['draft', 'approved', 'deprecated', 'experimental'] as const;

export const PLAYBOOK_STAGES = [
  'raw_training',
  'transcript',
  'cleaned',
  'summary',
  'extracted_lessons',
  'candidate_playbook',
  'reviewed_playbook',
  'approved_rule',
  'agent_instruction_update',
] as const;

export const LEAD_STATUSES = [
  'lead_received',
  'contact_attempted',
  'contacted',
  'discovery_call',
  'due_diligence',
  'offer_made',
  'under_contract',
  'closing',
  'sold',
  'dead',
  'follow_up_later',
  'disqualified',
] as const;

// Property Card / Lead Card verification lifecycle. A card is the property-
// centered source-of-truth container that unifies property + parcel + facts +
// agent work. Identity is never inferred from coordinates/proximity.
export const CARD_VERIFICATION_STATUSES = [
  'unverified_lead',
  'address_matched',
  'verified_property',
  'rejected_mismatch',
  'archived',
] as const;
export type CardVerificationStatus = (typeof CARD_VERIFICATION_STATUSES)[number];

// Relationship of a nearby search-reference address to the (already verified)
// subject parcel. A search convenience only — never the subject parcel.
export const NEARBY_REFERENCE_RELATIONSHIPS = [
  'adjoining_addressed_property',
  'nearby_same_road',
  'nearby_area_reference',
  'unknown',
] as const;
export type NearbyReferenceRelationship = (typeof NEARBY_REFERENCE_RELATIONSHIPS)[number];

/** Required disclaimer wherever a nearby search reference is shown. */
export const NEARBY_REFERENCE_LABEL = 'Nearby search reference only — not the subject parcel address.';

// Seller Lead / Deal Card lifecycle. A Deal Card is a seller opportunity that
// links one OR MORE Property Cards. Deal-level facts (package strategy, asking
// price, seller notes) live here; parcel identity stays on each Property Card.
export const DEAL_CARD_STATUSES = [
  'new',
  'researching',
  'discovery',
  'underwriting',
  'offer_ready',
  'offer_sent',
  'follow_up',
  'under_contract',
  'closed',
  'dead',
  'archived',
] as const;
export type DealCardStatus = (typeof DEAL_CARD_STATUSES)[number];

// How a Property Card relates to a Deal Card.
export const DEAL_PROPERTY_ROLES = ['subject', 'package_member'] as const;
export type DealPropertyRole = (typeof DEAL_PROPERTY_ROLES)[number];

// Contiguity between package parcels is NEVER assumed. Seller statements are
// stored as seller_stated; only official GIS/assessor/plat/deed confirms it.
export const CONTIGUITY_STATUSES = ['unknown', 'seller_stated', 'source_confirmed'] as const;
export type ContiguityStatus = (typeof CONTIGUITY_STATUSES)[number];

// Due Diligence / Research worksheet field confidence labels. A DD field carries
// a label so manually-entered research data NEVER masquerades as a verified
// parcel fact. Mirrors FACT_LABELS plus the explicit local-area-context label.
// 'Verified' requires a named source link (enforced in deal-card-dd.ts).
export const DD_FIELD_LABELS = [
  'Verified',
  'Seller stated',
  'Assumed',
  'Unknown',
  'Needs verification',
  'Local Area Context, Not Parcel Verified',
] as const;
export type DdFieldLabel = (typeof DD_FIELD_LABELS)[number];

// Parcel identity status for a Deal Card DD worksheet. Defaults to
// local-area-context: parcel identity is NEVER assumed verified and is never
// inferred from coordinates, proximity, map pins, or nearest parcel.
// 'source_verified' requires a named source link (enforced in deal-card-dd.ts).
export const DD_PARCEL_IDENTITY_STATUSES = [
  'local_area_context_not_verified',
  'seller_stated',
  'address_only',
  'apn_provided',
  'source_verified',
  'unknown',
] as const;
export type DdParcelIdentityStatus = (typeof DD_PARCEL_IDENTITY_STATUSES)[number];

// Strategy worksheet offer-readiness labels for a Deal Card. Strategy is NEVER
// auto-ready: it defaults to 'not_reviewed' and only Tyler (or a future strategy
// workflow) advances it. These are honest status labels, not offer guidance.
export const STRATEGY_OFFER_READINESS = [
  'not_reviewed',
  'needs_confirmation',
  'blocked',
  'ready_for_offer',
  'pass',
] as const;
export type StrategyOfferReadiness = (typeof STRATEGY_OFFER_READINESS)[number];

// Market Research demand labels for a Deal Card. Market-level context ONLY —
// never a property-level fact and never a comp/price/value. Defaults to
// 'not_reviewed' and is NEVER auto-advanced: a demand rating is only set by Tyler
// from manually-entered notes. 'needs_research' is the honest "looked but no
// basis yet" state. No demand level is ever fabricated.
export const MARKET_DEMAND_LABELS = [
  'not_reviewed',
  'needs_research',
  'weak_demand',
  'moderate_demand',
  'strong_demand',
  'mixed_uncertain',
] as const;
export type MarketDemandLabel = (typeof MARKET_DEMAND_LABELS)[number];

// Source-confidence label for a Deal Card Market Research worksheet. Honest
// confidence in the manually-entered market sources. Defaults to 'unknown';
// 'high' requires at least one named source link (enforced in
// deal-card-market.ts) so confidence is never claimed without a source.
export const MARKET_SOURCE_CONFIDENCE = [
  'unknown',
  'low',
  'medium',
  'high',
  'needs_research',
] as const;
export type MarketSourceConfidence = (typeof MARKET_SOURCE_CONFIDENCE)[number];

// DD + Market + Strategy operational report status for a Deal Card. The report
// is the operational workflow that runs safe (non-credit) parcel verification,
// structures Market Research source targets, applies Strategy logic, and updates
// the three worksheets. 'not_run' is the honest default; 'complete_with_gaps' is
// the normal outcome when data gaps remain (e.g. parcel not source-verified or a
// market lane still needs manual research); 'blocked' means the safe lookup could
// not run (e.g. LandPortal unavailable); 'failed' is an unexpected engine error.
export const DEAL_CARD_REPORT_STATUSES = [
  'not_run',
  'running',
  'complete',
  'complete_with_gaps',
  'blocked',
  'failed',
] as const;
export type DealCardReportStatus = (typeof DEAL_CARD_REPORT_STATUSES)[number];

// Comp source labels. GIS is intentionally NOT a comp source — county/GIS is
// for parcel verification and legal facts, never the first-pass comp engine.
export const COMP_SOURCE_LABELS = [
  'LandPortal',
  'Zillow',
  'Redfin',
  'Land.com',
  'LandWatch',
  'LandsOfAmerica',
  'Realtor',
  'County',
  'Other',
] as const;
export type CompSourceLabel = (typeof COMP_SOURCE_LABELS)[number];

export const COMP_PRICE_KINDS = ['sale', 'list', 'unknown'] as const;
export type CompPriceKind = (typeof COMP_PRICE_KINDS)[number];

// A manual/automated comp's confidence. Manual comps never verify parcel
// identity and never override source-confirmed parcel facts.
export const COMP_STATUSES = ['manual_unverified', 'market_reference', 'verified_sale', 'rejected'] as const;
export type CompStatus = (typeof COMP_STATUSES)[number];

// Roles a person can hold on a deal/property. Being related to the owner never
// implies signing authority.
export const PERSON_ROLES = [
  'seller',
  'lead_contact',
  'wholesaler',
  'agent',
  'record_owner',
  'heir',
  'sibling',
  'spouse',
  'decision_maker',
  'probate_contact',
  'attorney',
  'title_contact',
  'unknown_relation',
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

// Authority/signing status. Defaults to 'unknown' — never auto can_sign.
// Deed/title/authority facts require source evidence or attorney/title
// confirmation before offer/closing logic relies on them.
export const PERSON_AUTHORITY_STATUSES = [
  'unknown',
  'title_to_confirm',
  'attorney_or_title_to_confirm',
  'needs_to_sign',
  'can_sign',
  'cannot_sign',
  'unsure_if_on_deed',
  'heir_claimed',
  'probate_attorney',
] as const;
export type PersonAuthorityStatus = (typeof PERSON_AUTHORITY_STATUSES)[number];

// Kanban pipeline statuses for the property/lead board (property-centered).
export const KANBAN_STATUSES = [
  'new_lead',
  'needs_parcel_verification',
  'needs_seller_discovery',
  'researching',
  'underwriting',
  'offer_ready',
  'offer_sent',
  'follow_up',
  'under_contract',
  'due_diligence',
  'disposition',
  'closed',
  'dead',
  'archived',
] as const;
export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

// Batch lead-intake job lifecycle. Each lead becomes one isolated job; jobs
// never share parcel state.
export const LEAD_JOB_STATUSES = [
  'queued',
  'running',
  'parcel_not_verified',
  'needs_apn_or_owner',
  'verified',
  'complete',
  'failed',
  'blocked_needs_approval',
] as const;
export type LeadJobStatus = (typeof LEAD_JOB_STATUSES)[number];

/** Action types that always require a Tyler-approved landos_approval row. */
export const GATED_ACTION_TYPES = [
  'seller_message',
  'crm_change',
  'paid_credit',
  'offer_price',
  'file_deletion',
  'package_install',
  'config_security_change',
  'data_export',
  'external_connection',
  'ad_change',
  'contract_edit',
] as const;

let landosDb: Database.Database | null = null;

const inList = (vals: readonly string[]): string => vals.map((v) => `'${v}'`).join(',');

function createLandosSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS landos_business_entity (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS landos_contact (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity          TEXT NOT NULL REFERENCES landos_business_entity(id),
      name            TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT '',
      phone           TEXT NOT NULL DEFAULT '',
      email           TEXT NOT NULL DEFAULT '',
      mailing_address TEXT NOT NULL DEFAULT '',
      opt_in_source   TEXT NOT NULL DEFAULT '',
      opt_out         INTEGER NOT NULL DEFAULT 0,
      dnc_flag        INTEGER NOT NULL DEFAULT 0,
      notes           TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_contact_entity ON landos_contact(entity, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_seller (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      entity            TEXT NOT NULL REFERENCES landos_business_entity(id),
      contact_id        INTEGER REFERENCES landos_contact(id),
      name              TEXT NOT NULL,
      authority_status  TEXT NOT NULL DEFAULT 'unverified',
      notes             TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_seller_entity ON landos_seller(entity, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_lead (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT NOT NULL REFERENCES landos_business_entity(id),
      source      TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'lead_received'
                  CHECK (status IN (${inList(LEAD_STATUSES)})),
      seller_id   INTEGER REFERENCES landos_seller(id),
      property_id INTEGER,
      raw_input   TEXT NOT NULL DEFAULT '',
      county      TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT '',
      notes       TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_lead_entity ON landos_lead(entity, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_property (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT NOT NULL REFERENCES landos_business_entity(id),
      address     TEXT NOT NULL DEFAULT '',
      city        TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT '',
      county      TEXT NOT NULL DEFAULT '',
      fips        TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active',
      notes       TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_property_entity ON landos_property(entity, created_at DESC);

    -- Parcel identity + LandPortal persistence (Duke workflow route point).
    -- raw_lp_json holds the shaped lp_resolve_property / lp_property_data
    -- response; normalized_json holds the extracted DD field object.
    CREATE TABLE IF NOT EXISTS landos_parcel (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      entity              TEXT NOT NULL REFERENCES landos_business_entity(id),
      property_id         INTEGER REFERENCES landos_property(id),
      apn                 TEXT NOT NULL DEFAULT '',
      lp_property_id      TEXT NOT NULL DEFAULT '',
      fips                TEXT NOT NULL DEFAULT '',
      county              TEXT NOT NULL DEFAULT '',
      state               TEXT NOT NULL DEFAULT '',
      acres               REAL,
      verified            INTEGER NOT NULL DEFAULT 0,
      verification_source TEXT NOT NULL DEFAULT '',
      verified_at         INTEGER,
      raw_lp_json         TEXT NOT NULL DEFAULT '',
      normalized_json     TEXT NOT NULL DEFAULT '',
      created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_parcel_entity ON landos_parcel(entity, verified, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_parcel_lpid ON landos_parcel(lp_property_id, fips);

    CREATE TABLE IF NOT EXISTS landos_deal (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entity        TEXT NOT NULL REFERENCES landos_business_entity(id),
      lead_id       INTEGER REFERENCES landos_lead(id),
      property_id   INTEGER REFERENCES landos_property(id),
      status        TEXT NOT NULL DEFAULT 'evaluating',
      strategy      TEXT NOT NULL DEFAULT '',
      target_offer  REAL,
      max_offer     REAL,
      walk_away     REAL,
      notes         TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_entity ON landos_deal(entity, status, created_at DESC);

    -- Fact registry with confidence labels and source tracking.
    CREATE TABLE IF NOT EXISTS landos_fact (
      id                              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity                          TEXT NOT NULL REFERENCES landos_business_entity(id),
      deal_id                         INTEGER REFERENCES landos_deal(id),
      parcel_id                       INTEGER REFERENCES landos_parcel(id),
      fact                            TEXT NOT NULL,
      value                           TEXT NOT NULL DEFAULT '',
      label                           TEXT NOT NULL
                                      CHECK (label IN (${inList(FACT_LABELS)})),
      source                          TEXT NOT NULL DEFAULT '',
      source_type                     TEXT NOT NULL DEFAULT '',
      source_ref                      TEXT NOT NULL DEFAULT '',
      date_checked                    TEXT NOT NULL DEFAULT '',
      checked_by                      TEXT NOT NULL DEFAULT '',
      seller_facing_safe              INTEGER NOT NULL DEFAULT 0,
      requires_official_verification  INTEGER NOT NULL DEFAULT 0,
      affects                         TEXT NOT NULL DEFAULT '',
      created_at                      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_fact_parcel ON landos_fact(parcel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_fact_deal ON landos_fact(deal_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_task (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT NOT NULL REFERENCES landos_business_entity(id),
      deal_id     INTEGER REFERENCES landos_deal(id),
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      assignee    TEXT NOT NULL DEFAULT '',
      due_at      INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_task_entity ON landos_task(entity, status, created_at DESC);

    -- Pointers to files that live OUTSIDE the repo (Obsidian vault, PDF
    -- output). Paths only; never file contents and never repo paths.
    CREATE TABLE IF NOT EXISTS landos_file_ref (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      entity       TEXT NOT NULL REFERENCES landos_business_entity(id),
      deal_id      INTEGER REFERENCES landos_deal(id),
      kind         TEXT NOT NULL DEFAULT '',
      path_or_ref  TEXT NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_file_ref_deal ON landos_file_ref(deal_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_note (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT NOT NULL REFERENCES landos_business_entity(id),
      deal_id     INTEGER REFERENCES landos_deal(id),
      body        TEXT NOT NULL,
      author      TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_note_deal ON landos_note(deal_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_agent_run (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL,
      entity      TEXT,
      workflow    TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'running',
      started_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      finished_at INTEGER,
      duration_ms INTEGER,
      summary     TEXT NOT NULL DEFAULT '',
      error       TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_agent_run_agent ON landos_agent_run(agent_id, created_at DESC);

    -- Approval spine. Gated actions block until a pending row is approved.
    -- Approvals are single-use: consumed_at is set when the gated action runs.
    CREATE TABLE IF NOT EXISTS landos_approval (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entity        TEXT,
      action_type   TEXT NOT NULL,
      title         TEXT NOT NULL,
      payload       TEXT NOT NULL DEFAULT '',
      requested_by  TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
      decided_at    INTEGER,
      decided_by    TEXT NOT NULL DEFAULT '',
      decision_note TEXT NOT NULL DEFAULT '',
      consumed_at   INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_approval_status ON landos_approval(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT,
      actor       TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '',
      ref_table   TEXT NOT NULL DEFAULT '',
      ref_id      INTEGER,
      blocked     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_audit_time ON landos_audit_log(created_at DESC);

    -- Rules registry. Raw training never auto-becomes an approved rule.
    CREATE TABLE IF NOT EXISTS landos_rule (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT,
      scope       TEXT NOT NULL DEFAULT 'global'
                  CHECK (scope IN ('global','entity','strategy','deal')),
      name        TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN (${inList(RULE_STATUSES)})),
      source      TEXT NOT NULL DEFAULT '',
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_rule_status ON landos_rule(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_playbook (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT,
      name        TEXT NOT NULL,
      stage       TEXT NOT NULL DEFAULT 'raw_training'
                  CHECK (stage IN (${inList(PLAYBOOK_STAGES)})),
      body        TEXT NOT NULL DEFAULT '',
      source_ref  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_playbook_stage ON landos_playbook(stage, created_at DESC);

    -- Model usage tracking foundation. No providers wired in OS Spine v1;
    -- the schema exists so usage is trackable when routing lands.
    CREATE TABLE IF NOT EXISTS landos_model_call (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id      TEXT NOT NULL DEFAULT '',
      provider      TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT '',
      task_class    TEXT NOT NULL DEFAULT '',
      sensitivity   TEXT NOT NULL DEFAULT '',
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      est_cost_usd  REAL NOT NULL DEFAULT 0,
      workflow      TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_model_call_time ON landos_model_call(created_at DESC);

    -- Sticky model preferences (user overrides of the facts-based suggestion).
    -- Resolution order: sticky override > task-orientation suggestion >
    -- configured default. entity '' = applies across entities. task_type '' =
    -- applies to all task types within a department/sub_agent scope. A reset is
    -- a DELETE of the matching row (resolution falls back to the suggestion).
    CREATE TABLE IF NOT EXISTS landos_model_preference (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT NOT NULL DEFAULT '',
      scope_kind  TEXT NOT NULL
                  CHECK (scope_kind IN ('task_type','department','sub_agent')),
      scope_key   TEXT NOT NULL,
      task_type   TEXT NOT NULL DEFAULT '',
      model_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landos_model_pref_scope
      ON landos_model_preference(entity, scope_kind, scope_key, task_type);
    CREATE INDEX IF NOT EXISTS idx_landos_model_pref_lookup
      ON landos_model_preference(scope_kind, scope_key);

    CREATE TABLE IF NOT EXISTS landos_cost_record (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT,
      category    TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      amount_usd  REAL NOT NULL DEFAULT 0,
      ref_table   TEXT NOT NULL DEFAULT '',
      ref_id      INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_cost_time ON landos_cost_record(created_at DESC);

    -- Security review records: repo / package / MCP review checklist.
    CREATE TABLE IF NOT EXISTS landos_security_review (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_type    TEXT NOT NULL DEFAULT '',
      subject         TEXT NOT NULL,
      maintainer      TEXT NOT NULL DEFAULT '',
      last_commit     TEXT NOT NULL DEFAULT '',
      install_scripts TEXT NOT NULL DEFAULT '',
      network_access  TEXT NOT NULL DEFAULT '',
      file_access     TEXT NOT NULL DEFAULT '',
      env_access      TEXT NOT NULL DEFAULT '',
      telemetry       TEXT NOT NULL DEFAULT '',
      cves            TEXT NOT NULL DEFAULT '',
      license         TEXT NOT NULL DEFAULT '',
      sandbox_tested  INTEGER NOT NULL DEFAULT 0,
      verdict         TEXT NOT NULL DEFAULT 'pending',
      notes           TEXT NOT NULL DEFAULT '',
      reviewer        TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_secreview_time ON landos_security_review(created_at DESC);

    -- Property Card: the property-centered source-of-truth container. Unifies
    -- a lead/property across agents. Identity is keyed by verified parcel
    -- identifiers (lp_property_id+fips or apn+county) for verified cards, or by
    -- the normalized active input address for unverified leads. NEVER keyed or
    -- merged by coordinates, proximity, map pins, or nearest parcel.
    CREATE TABLE IF NOT EXISTS landos_property_card (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      entity                TEXT NOT NULL REFERENCES landos_business_entity(id),
      verification_status   TEXT NOT NULL DEFAULT 'unverified_lead'
                            CHECK (verification_status IN (${inList(CARD_VERIFICATION_STATUSES)})),
      kanban_status         TEXT NOT NULL DEFAULT 'new_lead'
                            CHECK (kanban_status IN (${inList(KANBAN_STATUSES)})),
      active_input_address  TEXT NOT NULL DEFAULT '',
      address_key           TEXT NOT NULL DEFAULT '',
      prior_inputs          TEXT NOT NULL DEFAULT '[]',
      apn                   TEXT NOT NULL DEFAULT '',
      lp_property_id        TEXT NOT NULL DEFAULT '',
      fips                  TEXT NOT NULL DEFAULT '',
      lp_url                TEXT NOT NULL DEFAULT '',
      county                TEXT NOT NULL DEFAULT '',
      state                 TEXT NOT NULL DEFAULT '',
      city                  TEXT NOT NULL DEFAULT '',
      owner                 TEXT NOT NULL DEFAULT '',
      acres                 REAL,
      verification_source   TEXT NOT NULL DEFAULT '',
      property_id           INTEGER REFERENCES landos_property(id),
      parcel_id             INTEGER REFERENCES landos_parcel(id),
      open_risks            TEXT NOT NULL DEFAULT '[]',
      summary               TEXT NOT NULL DEFAULT '',
      last_refreshed_at     INTEGER,
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_card_entity ON landos_property_card(entity, kanban_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_card_addrkey ON landos_property_card(entity, address_key);
    CREATE INDEX IF NOT EXISTS idx_landos_card_parcel ON landos_property_card(entity, lp_property_id, fips);

    -- Source evidence attached to a card. usable_for_offer_logic is decided by
    -- the Source Evidence Standard (requires a real source link + verification).
    CREATE TABLE IF NOT EXISTS landos_card_source_evidence (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id                 INTEGER NOT NULL REFERENCES landos_property_card(id),
      fact                    TEXT NOT NULL DEFAULT '',
      source_type             TEXT NOT NULL DEFAULT 'unknown',
      source_url              TEXT NOT NULL DEFAULT '',
      date_accessed           TEXT NOT NULL DEFAULT '',
      note                    TEXT NOT NULL DEFAULT '',
      usable_for_offer_logic  INTEGER NOT NULL DEFAULT 0,
      created_at              INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_card_evidence ON landos_card_source_evidence(card_id, created_at DESC);

    -- Agent activity timeline on a card (who did what, when).
    CREATE TABLE IF NOT EXISTS landos_card_activity (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id     INTEGER NOT NULL REFERENCES landos_property_card(id),
      agent_id    TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL DEFAULT '',
      summary     TEXT NOT NULL DEFAULT '',
      ref         TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_card_activity ON landos_card_activity(card_id, created_at DESC);

    -- Next actions / open work items on a card.
    CREATE TABLE IF NOT EXISTS landos_card_next_action (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id     INTEGER NOT NULL REFERENCES landos_property_card(id),
      action      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_card_nextaction ON landos_card_next_action(card_id, status, created_at DESC);

    -- Nearby search reference: a convenience addressed property used only to
    -- locate a verified vacant subject parcel that has no street/situs address.
    -- It NEVER identifies, verifies, values, or merges the subject parcel and
    -- is never the active/situs address. Only attachable to a verified_property.
    CREATE TABLE IF NOT EXISTS landos_card_nearby_reference (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id                 INTEGER NOT NULL REFERENCES landos_property_card(id),
      address                 TEXT NOT NULL DEFAULT '',
      relationship            TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (relationship IN (${inList(NEARBY_REFERENCE_RELATIONSHIPS)})),
      source_link             TEXT NOT NULL DEFAULT '',
      note                    TEXT NOT NULL DEFAULT '',
      date_accessed           TEXT NOT NULL DEFAULT '',
      usable_for_identity     INTEGER NOT NULL DEFAULT 0,
      usable_for_offer_logic  INTEGER NOT NULL DEFAULT 0,
      created_at              INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_card_nearby ON landos_card_nearby_reference(card_id, created_at DESC);

    -- Seller Lead / Deal Card: a seller opportunity that links one or more
    -- Property Cards. Deal-level facts live here; parcel identity stays on each
    -- Property Card and is never merged across parcels.
    CREATE TABLE IF NOT EXISTS landos_deal_card (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity                      TEXT NOT NULL REFERENCES landos_business_entity(id),
      title                       TEXT NOT NULL DEFAULT '',
      status                      TEXT NOT NULL DEFAULT 'new'
                                  CHECK (status IN (${inList(DEAL_CARD_STATUSES)})),
      seller_notes                TEXT NOT NULL DEFAULT '',
      asking_price                REAL,
      combined_strategy           TEXT NOT NULL DEFAULT '',
      package_notes               TEXT NOT NULL DEFAULT '',
      -- Combined acreage is only "verified" when EVERY linked parcel's identity
      -- and acreage is verified; otherwise it is preliminary.
      combined_acreage            REAL,
      combined_acreage_verified   INTEGER NOT NULL DEFAULT 0,
      created_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_card_entity ON landos_deal_card(entity, status, created_at DESC);

    -- Link table: Property Cards under a Deal Card (many-to-many). Linking does
    -- NOT merge parcels; each Property Card keeps its own identity/verification.
    CREATE TABLE IF NOT EXISTS landos_deal_card_property (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id        INTEGER NOT NULL REFERENCES landos_deal_card(id),
      card_id             INTEGER NOT NULL REFERENCES landos_property_card(id),
      role                TEXT NOT NULL DEFAULT 'subject'
                          CHECK (role IN (${inList(DEAL_PROPERTY_ROLES)})),
      contiguity_status   TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (contiguity_status IN (${inList(CONTIGUITY_STATUSES)})),
      contiguity_source   TEXT NOT NULL DEFAULT '',
      note                TEXT NOT NULL DEFAULT '',
      created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(deal_card_id, card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_card_property ON landos_deal_card_property(deal_card_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_deal_property_card ON landos_deal_card_property(card_id);

    -- People / Contact Records. Identity of a person; never implies authority.
    CREATE TABLE IF NOT EXISTS landos_person (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      entity                   TEXT NOT NULL REFERENCES landos_business_entity(id),
      name                     TEXT NOT NULL DEFAULT '',
      phone                    TEXT NOT NULL DEFAULT '',
      email                    TEXT NOT NULL DEFAULT '',
      mailing_address          TEXT NOT NULL DEFAULT '',
      preferred_contact_method TEXT NOT NULL DEFAULT '',
      notes                    TEXT NOT NULL DEFAULT '',
      created_at               INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at               INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_person_entity ON landos_person(entity, created_at DESC);

    -- Link a person to a deal and/or a property with a role and authority
    -- status. authority_status defaults to 'unknown' — relationship never
    -- implies signing authority.
    CREATE TABLE IF NOT EXISTS landos_person_link (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id         INTEGER NOT NULL REFERENCES landos_person(id),
      deal_card_id      INTEGER REFERENCES landos_deal_card(id),
      card_id           INTEGER REFERENCES landos_property_card(id),
      role              TEXT NOT NULL DEFAULT 'unknown_relation'
                        CHECK (role IN (${inList(PERSON_ROLES)})),
      authority_status  TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (authority_status IN (${inList(PERSON_AUTHORITY_STATUSES)})),
      authority_source  TEXT NOT NULL DEFAULT '',
      note              TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_person_link_deal ON landos_person_link(deal_card_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_person_link_card ON landos_person_link(card_id, created_at DESC);

    -- Comps attached to a Deal Card (and optionally a specific property card).
    -- Manual or automated. A comp NEVER verifies parcel identity, never merges
    -- APNs, and never overrides source-confirmed parcel facts; its source label
    -- and confidence status always stay visible.
    CREATE TABLE IF NOT EXISTS landos_comp (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      entity              TEXT NOT NULL REFERENCES landos_business_entity(id),
      deal_card_id        INTEGER NOT NULL REFERENCES landos_deal_card(id),
      card_id             INTEGER REFERENCES landos_property_card(id),
      source_label        TEXT NOT NULL DEFAULT 'Other'
                          CHECK (source_label IN (${inList(COMP_SOURCE_LABELS)})),
      source_url          TEXT NOT NULL DEFAULT '',
      address_desc        TEXT NOT NULL DEFAULT '',
      apn                 TEXT NOT NULL DEFAULT '',
      county              TEXT NOT NULL DEFAULT '',
      state               TEXT NOT NULL DEFAULT '',
      price               REAL,
      price_kind          TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (price_kind IN (${inList(COMP_PRICE_KINDS)})),
      sale_or_list_date   TEXT NOT NULL DEFAULT '',
      acres               REAL,
      price_per_acre      REAL,
      notes               TEXT NOT NULL DEFAULT '',
      added_by            TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'manual_unverified'
                          CHECK (status IN (${inList(COMP_STATUSES)})),
      created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_comp_deal ON landos_comp(deal_card_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_comp_card ON landos_comp(card_id, created_at DESC);

    -- Due Diligence / Research worksheet for a Deal Card (one row per deal).
    -- A safe local landing place for manually-entered DD/Research data. Every
    -- parcel fact carries a confidence label so research data is never shown as a
    -- verified fact; parcel identity defaults to local-area-context and is never
    -- inferred from coordinates/proximity/map pins. Lives in store/landos.db
    -- (gitignored) — never property-specific work product in the repo.
    CREATE TABLE IF NOT EXISTS landos_deal_card_dd (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id             INTEGER NOT NULL UNIQUE REFERENCES landos_deal_card(id),
      parcel_identity_status   TEXT NOT NULL DEFAULT 'local_area_context_not_verified'
                               CHECK (parcel_identity_status IN (${inList(DD_PARCEL_IDENTITY_STATUSES)})),
      apn                      TEXT NOT NULL DEFAULT '',
      apn_label                TEXT NOT NULL DEFAULT 'Unknown' CHECK (apn_label IN (${inList(DD_FIELD_LABELS)})),
      county                   TEXT NOT NULL DEFAULT '',
      state                    TEXT NOT NULL DEFAULT '',
      location_label           TEXT NOT NULL DEFAULT 'Unknown' CHECK (location_label IN (${inList(DD_FIELD_LABELS)})),
      acreage                  REAL,
      acreage_label            TEXT NOT NULL DEFAULT 'Unknown' CHECK (acreage_label IN (${inList(DD_FIELD_LABELS)})),
      zoning                   TEXT NOT NULL DEFAULT '',
      zoning_label             TEXT NOT NULL DEFAULT 'Unknown' CHECK (zoning_label IN (${inList(DD_FIELD_LABELS)})),
      access_status            TEXT NOT NULL DEFAULT '',
      access_label             TEXT NOT NULL DEFAULT 'Unknown' CHECK (access_label IN (${inList(DD_FIELD_LABELS)})),
      utilities_status         TEXT NOT NULL DEFAULT '',
      utilities_label          TEXT NOT NULL DEFAULT 'Unknown' CHECK (utilities_label IN (${inList(DD_FIELD_LABELS)})),
      flood_status             TEXT NOT NULL DEFAULT '',
      flood_label              TEXT NOT NULL DEFAULT 'Unknown' CHECK (flood_label IN (${inList(DD_FIELD_LABELS)})),
      wetlands_status          TEXT NOT NULL DEFAULT '',
      wetlands_label           TEXT NOT NULL DEFAULT 'Unknown' CHECK (wetlands_label IN (${inList(DD_FIELD_LABELS)})),
      road_frontage_notes      TEXT NOT NULL DEFAULT '',
      source_links             TEXT NOT NULL DEFAULT '[]',
      data_gaps                TEXT NOT NULL DEFAULT '[]',
      risk_flags               TEXT NOT NULL DEFAULT '[]',
      notes                    TEXT NOT NULL DEFAULT '',
      updated_by               TEXT NOT NULL DEFAULT '',
      created_at               INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at               INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_card_dd ON landos_deal_card_dd(deal_card_id);

    -- Strategy worksheet for a Deal Card (one row per deal). A safe local landing
    -- place for the Strategy leg: manual/local strategy analysis only. Strategy
    -- is NEVER a verified fact and NEVER a final offer. Distinct exit strategies
    -- keep distinct note fields (quick flip, subdivide, land-home package,
    -- improved/mobile-home value-add, teardown/land-only, pass) and are never
    -- collapsed into one generic range. offer_readiness defaults to 'not_reviewed'.
    -- No offer math, no comps, no EVs are computed here. Lives in store/landos.db
    -- (gitignored) — never property-specific work product in the repo.
    CREATE TABLE IF NOT EXISTS landos_deal_card_strategy (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id                INTEGER NOT NULL UNIQUE REFERENCES landos_deal_card(id),
      offer_readiness             TEXT NOT NULL DEFAULT 'not_reviewed'
                                  CHECK (offer_readiness IN (${inList(STRATEGY_OFFER_READINESS)})),
      strategy_candidates         TEXT NOT NULL DEFAULT '[]',
      blockers                    TEXT NOT NULL DEFAULT '[]',
      next_confirmations          TEXT NOT NULL DEFAULT '[]',
      current_recommendation      TEXT NOT NULL DEFAULT '',
      most_viable_strategy        TEXT NOT NULL DEFAULT '',
      pre_call_strategy_notes     TEXT NOT NULL DEFAULT '',
      quick_flip_notes            TEXT NOT NULL DEFAULT '',
      subdivide_notes             TEXT NOT NULL DEFAULT '',
      land_home_package_notes     TEXT NOT NULL DEFAULT '',
      improved_value_add_notes    TEXT NOT NULL DEFAULT '',
      teardown_land_only_notes    TEXT NOT NULL DEFAULT '',
      pass_no_offer_reason        TEXT NOT NULL DEFAULT '',
      risk_adjusted_notes         TEXT NOT NULL DEFAULT '',
      target_profit_note          TEXT NOT NULL DEFAULT '',
      notes                       TEXT NOT NULL DEFAULT '',
      updated_by                  TEXT NOT NULL DEFAULT '',
      created_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_card_strategy ON landos_deal_card_strategy(deal_card_id);

    -- Market Research worksheet for a Deal Card (one row per deal). A safe local
    -- landing place for the Market Research leg: MARKET-LEVEL context only,
    -- manually entered. This is NOT property-level due diligence and never
    -- verifies parcel identity. No comps, actives, solds, days-on-market, demand,
    -- pricing, or county-growth facts are computed or fabricated here — every
    -- value is a manual note or carries an honest demand label that defaults to
    -- 'not_reviewed'. Demand/listing/sold/growth notes, source links, source
    -- confidence, data gaps, and risk flags are kept in separate fields. Lives in
    -- store/landos.db (gitignored) — never property-specific work product in repo.
    CREATE TABLE IF NOT EXISTS landos_deal_card_market (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id                  INTEGER NOT NULL UNIQUE REFERENCES landos_deal_card(id),
      market_review_status          TEXT NOT NULL DEFAULT 'not_reviewed'
                                    CHECK (market_review_status IN (${inList(MARKET_DEMAND_LABELS)})),
      target_area_label             TEXT NOT NULL DEFAULT '',
      county_city_region_notes      TEXT NOT NULL DEFAULT '',
      buyer_demand_notes            TEXT NOT NULL DEFAULT '',
      buyer_demand_label            TEXT NOT NULL DEFAULT 'not_reviewed'
                                    CHECK (buyer_demand_label IN (${inList(MARKET_DEMAND_LABELS)})),
      active_listing_notes          TEXT NOT NULL DEFAULT '',
      sold_comp_context_notes       TEXT NOT NULL DEFAULT '',
      days_on_market_notes          TEXT NOT NULL DEFAULT '',
      manufactured_home_demand_notes TEXT NOT NULL DEFAULT '',
      manufactured_home_demand_label TEXT NOT NULL DEFAULT 'not_reviewed'
                                    CHECK (manufactured_home_demand_label IN (${inList(MARKET_DEMAND_LABELS)})),
      subdivision_demand_notes      TEXT NOT NULL DEFAULT '',
      subdivision_demand_label      TEXT NOT NULL DEFAULT 'not_reviewed'
                                    CHECK (subdivision_demand_label IN (${inList(MARKET_DEMAND_LABELS)})),
      infill_lot_demand_notes       TEXT NOT NULL DEFAULT '',
      infill_lot_demand_label       TEXT NOT NULL DEFAULT 'not_reviewed'
                                    CHECK (infill_lot_demand_label IN (${inList(MARKET_DEMAND_LABELS)})),
      rural_acreage_demand_notes    TEXT NOT NULL DEFAULT '',
      rural_acreage_demand_label    TEXT NOT NULL DEFAULT 'not_reviewed'
                                    CHECK (rural_acreage_demand_label IN (${inList(MARKET_DEMAND_LABELS)})),
      county_growth_planning_notes  TEXT NOT NULL DEFAULT '',
      exit_strategy_support_notes   TEXT NOT NULL DEFAULT '',
      source_links                  TEXT NOT NULL DEFAULT '[]',
      source_confidence             TEXT NOT NULL DEFAULT 'unknown'
                                    CHECK (source_confidence IN (${inList(MARKET_SOURCE_CONFIDENCE)})),
      data_gaps                     TEXT NOT NULL DEFAULT '[]',
      risk_flags                    TEXT NOT NULL DEFAULT '[]',
      notes                         TEXT NOT NULL DEFAULT '',
      updated_by                    TEXT NOT NULL DEFAULT '',
      created_at                    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at                    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_card_market ON landos_deal_card_market(deal_card_id);

    -- DD + Market + Strategy operational report for a Deal Card (one row per
    -- deal; latest report). The operational workflow runs the existing SAFE,
    -- non-credit LandPortal exact resolve (NEVER a comp credit, NEVER a comp
    -- report tool), structures Market Research source targets, applies the
    -- existing Strategy logic, updates the three worksheets, and persists a
    -- practical local report that survives reload. Structured columns power the
    -- list/badge view; the full structured report is stored in report_json. No
    -- fabricated parcel facts, comps, demand, pricing, EVs, or offers are stored.
    -- Lives in store/landos.db (gitignored) — never property-specific work
    -- product in the repo.
    CREATE TABLE IF NOT EXISTS landos_deal_card_report (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id                INTEGER NOT NULL UNIQUE REFERENCES landos_deal_card(id),
      report_status               TEXT NOT NULL DEFAULT 'not_run'
                                  CHECK (report_status IN (${inList(DEAL_CARD_REPORT_STATUSES)})),
      parcel_verification_status  TEXT NOT NULL DEFAULT '',
      parcel_verified             INTEGER NOT NULL DEFAULT 0,
      dd_summary                  TEXT NOT NULL DEFAULT '',
      market_summary              TEXT NOT NULL DEFAULT '',
      strategy_summary            TEXT NOT NULL DEFAULT '',
      most_viable_strategy        TEXT NOT NULL DEFAULT '',
      offer_readiness             TEXT NOT NULL DEFAULT 'not_reviewed'
                                  CHECK (offer_readiness IN (${inList(STRATEGY_OFFER_READINESS)})),
      -- Credit usage is always explicit: the non-credit exact resolve may be used;
      -- a comp credit is NEVER used by this workflow.
      landportal_noncredit_used   INTEGER NOT NULL DEFAULT 0,
      comp_credit_used            INTEGER NOT NULL DEFAULT 0,
      report_json                 TEXT NOT NULL DEFAULT '{}',
      updated_by                  TEXT NOT NULL DEFAULT '',
      created_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at                  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_deal_card_report ON landos_deal_card_report(deal_card_id);

    -- Batch lead-intake jobs. One row per pasted lead; isolated parcel state.
    CREATE TABLE IF NOT EXISTS landos_lead_job (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity          TEXT NOT NULL REFERENCES landos_business_entity(id),
      batch_id        TEXT NOT NULL DEFAULT '',
      raw_input       TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN (${inList(LEAD_JOB_STATUSES)})),
      card_id         INTEGER REFERENCES landos_property_card(id),
      result_summary  TEXT NOT NULL DEFAULT '',
      next_action     TEXT NOT NULL DEFAULT '',
      error           TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_lead_job_entity ON landos_lead_job(entity, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_lead_job_batch ON landos_lead_job(batch_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_research_item (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL
                  CHECK (kind IN ('market','industry','ai_change')),
      entity      TEXT,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      score       REAL,
      status      TEXT NOT NULL DEFAULT 'new',
      route_to    TEXT NOT NULL DEFAULT '',
      source_url  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_research_kind ON landos_research_item(kind, status, created_at DESC);
  `);

  db.prepare(
    `INSERT OR IGNORE INTO landos_business_entity (id, name) VALUES (?, ?)`,
  ).run('LAND_ALLY', 'Land Ally');
  db.prepare(
    `INSERT OR IGNORE INTO landos_business_entity (id, name) VALUES (?, ?)`,
  ).run('TY_LAND_BIZ', "Ty's Land Biz");

  // ── Additive migrations (idempotent; no data loss) ────────────────────
  // Add lead_type to deal/property cards for existing DBs. CREATE TABLE IF NOT
  // EXISTS does not alter an existing table, so add the column when missing.
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn('landos_deal_card', 'lead_type', `lead_type TEXT NOT NULL DEFAULT 'actual'`);
  addColumn('landos_property_card', 'lead_type', `lead_type TEXT NOT NULL DEFAULT 'actual'`);
  // Verified-parcel coordinates persisted as ENRICHMENT OUTPUT (supporting
  // context for Realie/Zillow comps, imagery, and map context). They are NEVER
  // used for card identity or merge — identity stays exact-source only. Persisted
  // so a reopened verified parcel keeps its full enrichment pipeline.
  addColumn('landos_property_card', 'lat', `lat REAL`);
  addColumn('landos_property_card', 'lng', `lng REAL`);

  // Acquisitions department (CRM-independent intelligence layer) — one row per
  // Deal Card holding the seller profile, communication log, discovery notes, and
  // acquisition stage as JSON. Source of truth is the Deal Card; persists/reloads.
  db.exec(`
    CREATE TABLE IF NOT EXISTS landos_acquisition (
      deal_card_id  INTEGER PRIMARY KEY REFERENCES landos_deal_card(id),
      stage         TEXT NOT NULL DEFAULT 'new_lead',
      profile_json  TEXT NOT NULL DEFAULT '{}',
      comm_log_json TEXT NOT NULL DEFAULT '[]',
      discovery_json TEXT NOT NULL DEFAULT '[]',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  // Acquisition Intelligence Platform (AIP) — the learning engine behind the
  // Acquisitions department. Training ASSETS (metadata; raw media lives in R2,
  // never Git), extracted KNOWLEDGE (with citations + graph links + approval +
  // versioning), and generated PLAYBOOK sections (approval + publish + version).
  db.exec(`
    CREATE TABLE IF NOT EXISTS landos_aip_asset (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type   TEXT NOT NULL DEFAULT 'other',
      title         TEXT NOT NULL DEFAULT '',
      author        TEXT NOT NULL DEFAULT '',
      r2_key        TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      transcript_status TEXT NOT NULL DEFAULT 'pending',
      extraction_status TEXT NOT NULL DEFAULT 'pending',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS landos_aip_knowledge (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category      TEXT NOT NULL DEFAULT 'principle',
      content       TEXT NOT NULL DEFAULT '',
      citations_json TEXT NOT NULL DEFAULT '[]',
      links_json    TEXT NOT NULL DEFAULT '[]',
      confidence    TEXT NOT NULL DEFAULT 'medium',
      status        TEXT NOT NULL DEFAULT 'proposed',
      version       INTEGER NOT NULL DEFAULT 1,
      source_asset_id INTEGER REFERENCES landos_aip_asset(id),
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS landos_aip_playbook (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      section       TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      knowledge_refs_json TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'proposed',
      version       INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aip_knowledge_cat ON landos_aip_knowledge(category, status);
    CREATE INDEX IF NOT EXISTS idx_aip_playbook_section ON landos_aip_playbook(section, status, version DESC);

    -- County Source Map: reusable public-record routing by state + county.
    -- NETR-first; records the official county source links found (assessor / tax /
    -- GIS / recorder / planning / appraiser / building), how they were found
    -- (NETR vs search fallback), status, confidence, and when last checked. No
    -- credentials, no secrets — only public routing metadata.
    CREATE TABLE IF NOT EXISTS landos_county_source_map (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      state           TEXT NOT NULL DEFAULT '',
      county          TEXT NOT NULL DEFAULT '',
      netr_url        TEXT,
      sources_json    TEXT NOT NULL DEFAULT '{}',
      used_search_fallback INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'unknown',
      confidence      TEXT NOT NULL DEFAULT 'low',
      notes           TEXT NOT NULL DEFAULT '',
      last_checked_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(state, county)
    );
    CREATE INDEX IF NOT EXISTS idx_county_source_map ON landos_county_source_map(state, county);

    -- Browser-derived public-record facts, written INCREMENTALLY to a Deal Card as
    -- each is confidently found (with full provenance + status). Never overwrites
    -- verified Realie data. No secrets.
    CREATE TABLE IF NOT EXISTS landos_browser_fact (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id  INTEGER NOT NULL,
      fact_key      TEXT NOT NULL DEFAULT '',
      label         TEXT NOT NULL DEFAULT '',
      value         TEXT NOT NULL DEFAULT '',
      source_name   TEXT NOT NULL DEFAULT '',
      source_type   TEXT NOT NULL DEFAULT '',
      source_url    TEXT NOT NULL DEFAULT '',
      origin        TEXT NOT NULL DEFAULT '',
      confidence    TEXT NOT NULL DEFAULT 'low',
      status        TEXT NOT NULL DEFAULT 'needs_verification',
      extraction_method TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(deal_card_id, fact_key, source_url)
    );
    CREATE INDEX IF NOT EXISTS idx_browser_fact_deal ON landos_browser_fact(deal_card_id, created_at);

    -- Platform Intelligence Library: each website becomes a LEARNED object so
    -- Browser Intelligence gets smarter every time it uses a platform. Generic
    -- (LandPortal/ArcGIS/qPublic/CRM/...); no per-county or vendor code, just the
    -- learned classification + validated navigation strategy + limitations.
    CREATE TABLE IF NOT EXISTS landos_platform_intel (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      platform        TEXT NOT NULL DEFAULT '',
      classification  TEXT NOT NULL DEFAULT 'unknown',
      search_methods_json TEXT NOT NULL DEFAULT '[]',
      validated_strategy_json TEXT,
      nav_patterns    TEXT NOT NULL DEFAULT '',
      auth_required   INTEGER NOT NULL DEFAULT 0,
      known_limitations_json TEXT NOT NULL DEFAULT '[]',
      confidence      TEXT NOT NULL DEFAULT 'low',
      times_used      INTEGER NOT NULL DEFAULT 0,
      times_succeeded INTEGER NOT NULL DEFAULT 0,
      last_validated_at INTEGER,
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(platform)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_intel ON landos_platform_intel(platform);
  `);
}

/** Lead classification for property/deal cards. TEST LEAD records behave like
 *  real leads but are visually distinct and excluded from real-lead reporting. */
export const LEAD_TYPES = ['actual', 'test', 'research', 'imported', 'manual'] as const;
export type LeadType = (typeof LEAD_TYPES)[number];
export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  actual: 'Actual Lead', test: 'TEST LEAD', research: 'Research Lead', imported: 'Imported Lead', manual: 'Manual Lead',
};
export function isLeadType(v: unknown): v is LeadType {
  return typeof v === 'string' && (LEAD_TYPES as readonly string[]).includes(v);
}

/** Open (or return) the LandOS database. Lazy so processes that never touch
 *  LandOS data never create the file. */
export function getLandosDb(): Database.Database {
  if (landosDb) return landosDb;
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const dbPath = path.join(STORE_DIR, 'landos.db');
  landosDb = new Database(dbPath);
  landosDb.pragma('journal_mode = WAL');
  landosDb.pragma('busy_timeout = 5000');
  createLandosSchema(landosDb);
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = dbPath + suffix;
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    }
  } catch { /* non-fatal on platforms without chmod */ }
  return landosDb;
}

/** @internal — tests only. Fresh in-memory LandOS database. */
export function _initTestLandosDb(): void {
  landosDb = new Database(':memory:');
  createLandosSchema(landosDb);
}

// ── Audit ────────────────────────────────────────────────────────────

export function landosAudit(
  actor: string,
  action: string,
  detail = '',
  opts: { entity?: string | null; refTable?: string; refId?: number; blocked?: boolean } = {},
): number {
  const db = getLandosDb();
  const result = db.prepare(
    `INSERT INTO landos_audit_log (entity, actor, action, detail, ref_table, ref_id, blocked)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.entity ?? null,
    actor,
    action,
    detail,
    opts.refTable ?? '',
    opts.refId ?? null,
    opts.blocked ? 1 : 0,
  );
  return result.lastInsertRowid as number;
}

export function listLandosAudit(limit = 100): unknown[] {
  return getLandosDb()
    .prepare('SELECT * FROM landos_audit_log ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit);
}

// ── Approval spine ───────────────────────────────────────────────────

export interface LandosApproval {
  id: number;
  entity: string | null;
  action_type: string;
  title: string;
  payload: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_at: number | null;
  decided_by: string;
  decision_note: string;
  consumed_at: number | null;
  created_at: number;
}

export function createApproval(opts: {
  actionType: string;
  title: string;
  payload?: unknown;
  requestedBy: string;
  entity?: LandosEntity | null;
}): number {
  const db = getLandosDb();
  const result = db.prepare(
    `INSERT INTO landos_approval (entity, action_type, title, payload, requested_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    opts.entity ?? null,
    opts.actionType,
    opts.title,
    opts.payload === undefined ? '' : JSON.stringify(opts.payload),
    opts.requestedBy,
  );
  const id = result.lastInsertRowid as number;
  landosAudit(opts.requestedBy, 'approval_requested', `${opts.actionType}: ${opts.title}`, {
    entity: opts.entity ?? null,
    refTable: 'landos_approval',
    refId: id,
  });
  return id;
}

export function getApproval(id: number): LandosApproval | undefined {
  return getLandosDb()
    .prepare('SELECT * FROM landos_approval WHERE id = ?')
    .get(id) as LandosApproval | undefined;
}

export function listApprovals(status?: string, limit = 100): LandosApproval[] {
  const db = getLandosDb();
  if (status) {
    return db
      .prepare('SELECT * FROM landos_approval WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(status, limit) as LandosApproval[];
  }
  return db
    .prepare('SELECT * FROM landos_approval ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as LandosApproval[];
}

export function decideApproval(
  id: number,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  note = '',
): LandosApproval | undefined {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(
    `UPDATE landos_approval SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(decision, now, decidedBy, note, id);
  if (result.changes === 0) return undefined;
  const row = getApproval(id);
  landosAudit(decidedBy, `approval_${decision}`, `${row?.action_type ?? ''}: ${row?.title ?? ''}${note ? ` — ${note}` : ''}`, {
    entity: row?.entity ?? null,
    refTable: 'landos_approval',
    refId: id,
  });
  return row;
}

export interface GateResult {
  allowed: boolean;
  approvalId: number;
  status: string;
}

/**
 * Approval gate for gated actions. Behavior:
 *  - No approvalId: creates a pending approval, audits as blocked, returns
 *    allowed:false. The caller must surface the approval id and stop.
 *  - approvalId for an approved, unconsumed approval of the same action type:
 *    consumes it (single-use), audits as allowed, returns allowed:true.
 *  - Anything else (pending, rejected, already consumed, wrong type):
 *    audits as blocked, returns allowed:false.
 */
export function gateAction(opts: {
  actionType: string;
  title: string;
  payload?: unknown;
  requestedBy: string;
  entity?: LandosEntity | null;
  approvalId?: number;
}): GateResult {
  const db = getLandosDb();

  if (opts.approvalId !== undefined) {
    const row = getApproval(opts.approvalId);
    if (
      row &&
      row.status === 'approved' &&
      row.consumed_at === null &&
      row.action_type === opts.actionType
    ) {
      const now = Math.floor(Date.now() / 1000);
      db.prepare('UPDATE landos_approval SET consumed_at = ? WHERE id = ?').run(now, row.id);
      landosAudit(opts.requestedBy, 'gated_action_executed', `${opts.actionType}: ${opts.title}`, {
        entity: opts.entity ?? null,
        refTable: 'landos_approval',
        refId: row.id,
      });
      return { allowed: true, approvalId: row.id, status: 'approved' };
    }
    landosAudit(opts.requestedBy, 'gated_action_blocked', `${opts.actionType}: ${opts.title} (approval ${opts.approvalId} not usable: ${row?.status ?? 'missing'}${row?.consumed_at ? ', consumed' : ''})`, {
      entity: opts.entity ?? null,
      refTable: 'landos_approval',
      refId: opts.approvalId,
      blocked: true,
    });
    return { allowed: false, approvalId: opts.approvalId, status: row?.status ?? 'missing' };
  }

  const approvalId = createApproval(opts);
  landosAudit(opts.requestedBy, 'gated_action_blocked', `${opts.actionType}: ${opts.title} (approval required)`, {
    entity: opts.entity ?? null,
    refTable: 'landos_approval',
    refId: approvalId,
    blocked: true,
  });
  return { allowed: false, approvalId, status: 'pending' };
}

// ── Agent runs ───────────────────────────────────────────────────────

export function startAgentRun(agentId: string, workflow: string, entity?: LandosEntity | null): number {
  const result = getLandosDb().prepare(
    `INSERT INTO landos_agent_run (agent_id, entity, workflow, status) VALUES (?, ?, ?, 'running')`,
  ).run(agentId, entity ?? null, workflow);
  const id = result.lastInsertRowid as number;
  landosAudit(agentId, 'agent_run_started', workflow, { entity: entity ?? null, refTable: 'landos_agent_run', refId: id });
  return id;
}

export function finishAgentRun(
  id: number,
  status: 'success' | 'failed' | 'timeout',
  summary = '',
  error = '',
): void {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare('SELECT agent_id, started_at, workflow FROM landos_agent_run WHERE id = ?').get(id) as
    | { agent_id: string; started_at: number; workflow: string }
    | undefined;
  db.prepare(
    `UPDATE landos_agent_run SET status = ?, finished_at = ?, duration_ms = ?, summary = ?, error = ? WHERE id = ?`,
  ).run(status, now, row ? (now - row.started_at) * 1000 : null, summary, error, id);
  landosAudit(row?.agent_id ?? '', 'agent_run_finished', `${row?.workflow ?? ''}: ${status}`, {
    refTable: 'landos_agent_run',
    refId: id,
  });
}

// ── Model calls and costs (foundation only — no providers wired) ────

export function logModelCall(opts: {
  agentId: string;
  provider: string;
  model: string;
  taskClass: string;
  sensitivity?: string;
  inputTokens?: number;
  outputTokens?: number;
  estCostUsd?: number;
  workflow?: string;
}): number {
  const result = getLandosDb().prepare(
    `INSERT INTO landos_model_call
       (agent_id, provider, model, task_class, sensitivity, input_tokens, output_tokens, est_cost_usd, workflow)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.agentId,
    opts.provider,
    opts.model,
    opts.taskClass,
    opts.sensitivity ?? '',
    opts.inputTokens ?? 0,
    opts.outputTokens ?? 0,
    opts.estCostUsd ?? 0,
    opts.workflow ?? '',
  );
  return result.lastInsertRowid as number;
}

export function logCostRecord(opts: {
  entity?: LandosEntity | null;
  category: string;
  description?: string;
  amountUsd: number;
  refTable?: string;
  refId?: number;
}): number {
  const result = getLandosDb().prepare(
    `INSERT INTO landos_cost_record (entity, category, description, amount_usd, ref_table, ref_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(opts.entity ?? null, opts.category, opts.description ?? '', opts.amountUsd, opts.refTable ?? '', opts.refId ?? null);
  return result.lastInsertRowid as number;
}

// ── Sticky model preferences ─────────────────────────────────────────

export type ModelPreferenceScopeKind = 'task_type' | 'department' | 'sub_agent';

export interface ModelPreferenceRow {
  entity: string;
  scopeKind: ModelPreferenceScopeKind;
  scopeKey: string;
  taskType: string;
  modelId: string;
}

/** Set (upsert) a sticky model override for a scope. entity '' = cross-entity;
 *  taskType '' = all task types within a department/sub_agent scope. Idempotent
 *  on the (entity, scope_kind, scope_key, task_type) unique key. */
export function setModelPreference(opts: {
  entity?: string;
  scopeKind: ModelPreferenceScopeKind;
  scopeKey: string;
  taskType?: string;
  modelId: string;
}): void {
  const now = Math.floor(Date.now() / 1000);
  getLandosDb()
    .prepare(
      `INSERT INTO landos_model_preference (entity, scope_kind, scope_key, task_type, model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity, scope_kind, scope_key, task_type)
       DO UPDATE SET model_id = excluded.model_id, updated_at = excluded.updated_at`,
    )
    .run(opts.entity ?? '', opts.scopeKind, opts.scopeKey, opts.taskType ?? '', opts.modelId, now, now);
}

/** Read sticky overrides. With an entity, returns cross-entity ('') rows plus
 *  that entity's rows (both apply); without one, returns all rows. */
export function getModelPreferences(entity?: string): ModelPreferenceRow[] {
  const db = getLandosDb();
  const rows = (entity
    ? db.prepare(`SELECT entity, scope_kind, scope_key, task_type, model_id FROM landos_model_preference WHERE entity = '' OR entity = ? ORDER BY id`).all(entity)
    : db.prepare(`SELECT entity, scope_kind, scope_key, task_type, model_id FROM landos_model_preference ORDER BY id`).all()) as Array<{
    entity: string; scope_kind: ModelPreferenceScopeKind; scope_key: string; task_type: string; model_id: string;
  }>;
  return rows.map((r) => ({ entity: r.entity, scopeKind: r.scope_kind, scopeKey: r.scope_key, taskType: r.task_type, modelId: r.model_id }));
}

/** Reset (delete) a sticky override, falling resolution back to the suggestion.
 *  Returns true when a row was removed. */
export function resetModelPreference(opts: {
  entity?: string;
  scopeKind: ModelPreferenceScopeKind;
  scopeKey: string;
  taskType?: string;
}): boolean {
  const result = getLandosDb()
    .prepare(`DELETE FROM landos_model_preference WHERE entity = ? AND scope_kind = ? AND scope_key = ? AND task_type = ?`)
    .run(opts.entity ?? '', opts.scopeKind, opts.scopeKey, opts.taskType ?? '');
  return result.changes > 0;
}

// ── Generic list/count helpers for the dashboard ─────────────────────

const ENTITY_TABLES = [
  'landos_contact', 'landos_seller', 'landos_lead', 'landos_property',
  'landos_parcel', 'landos_deal', 'landos_fact', 'landos_task',
  'landos_file_ref', 'landos_note', 'landos_property_card', 'landos_lead_job',
] as const;

const NO_ENTITY_TABLES = [
  'landos_agent_run', 'landos_approval', 'landos_audit_log', 'landos_rule',
  'landos_playbook', 'landos_model_call', 'landos_cost_record',
  'landos_security_review', 'landos_research_item',
] as const;

type LandosTable = (typeof ENTITY_TABLES)[number] | (typeof NO_ENTITY_TABLES)[number];

function isEntityTable(table: LandosTable): boolean {
  return (ENTITY_TABLES as readonly string[]).includes(table);
}

export function countRows(table: LandosTable, entity?: string): number {
  const db = getLandosDb();
  if (entity && isEntityTable(table)) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE entity = ?`).get(entity) as { n: number };
    return row.n;
  }
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

export function listRows(table: LandosTable, opts: { entity?: string; limit?: number } = {}): unknown[] {
  const db = getLandosDb();
  const limit = Math.min(opts.limit ?? 100, 500);
  if (opts.entity && isEntityTable(table)) {
    return db
      .prepare(`SELECT * FROM ${table} WHERE entity = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(opts.entity, limit);
  }
  return db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC, id DESC LIMIT ?`).all(limit);
}

export interface LandosOverview {
  entity: string | null;
  counts: Record<string, number>;
  pendingApprovals: number;
  modelCostUsd: number;
  costRecordsUsd: number;
}

export function getOverview(entity?: string): LandosOverview {
  const db = getLandosDb();
  const counts: Record<string, number> = {};
  for (const table of [...ENTITY_TABLES, ...NO_ENTITY_TABLES]) {
    counts[table.replace('landos_', '')] = countRows(table, entity);
  }
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM landos_approval WHERE status = 'pending'`).get() as { n: number };
  const modelCost = db.prepare(`SELECT COALESCE(SUM(est_cost_usd), 0) AS s FROM landos_model_call`).get() as { s: number };
  const costSum = db.prepare(`SELECT COALESCE(SUM(amount_usd), 0) AS s FROM landos_cost_record`).get() as { s: number };
  return {
    entity: entity ?? null,
    counts,
    pendingApprovals: pending.n,
    modelCostUsd: modelCost.s,
    costRecordsUsd: costSum.s,
  };
}
