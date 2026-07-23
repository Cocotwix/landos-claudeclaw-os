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

import { getLandosStorageProfile } from './storage-profile.js';

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
  'crm_change',
  'offer_price',
  'file_deletion',
  'package_install',
  'config_security_change',
  'data_export',
  'external_connection',
  'ad_change',
  'contract_edit',
] as const;

/** Phase 1 absolute prohibitions. These are not approval-gated: no approval can
 * authorize spending or Jarvis communication with an external party. Internal
 * offer recommendations and contract drafts remain ordinary review artifacts. */
export const PROHIBITED_ACTION_TYPES = [
  'paid_credit',
  'paid_action',
  'landportal_comp_report',
  'comp_credit_use',
  'trained_playbook_paid_action',
  'seller_message',
  'external_message',
  'offer_send',
  'contract_send',
] as const;

export function isProhibitedActionType(actionType: string): boolean {
  return (PROHIBITED_ACTION_TYPES as readonly string[]).includes(actionType);
}

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

    -- Per-deal market scan cache (Data Center Watch + growth signals). One row
    -- per deal card + scan kind; payload is the full MarketScanResult JSON. Lives
    -- in store/landos.db (gitignored) — never property work product in the repo.
    CREATE TABLE IF NOT EXISTS landos_market_scan (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id  INTEGER NOT NULL REFERENCES landos_deal_card(id),
      kind          TEXT NOT NULL DEFAULT 'market_scan',
      payload       TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE (deal_card_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_market_scan ON landos_market_scan(deal_card_id, kind);

    -- Phase 1E living lead-card intake. The original submission is immutable;
    -- routed conclusions live in child rows so conflicts are retained instead
    -- of overwriting an earlier accepted fact.
    CREATE TABLE IF NOT EXISTS landos_intake_submission (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id          INTEGER NOT NULL REFERENCES landos_deal_card(id),
      submission_type       TEXT NOT NULL DEFAULT 'general',
      source                TEXT NOT NULL DEFAULT 'operator',
      original_text         TEXT NOT NULL DEFAULT '',
      original_file_name    TEXT NOT NULL DEFAULT '',
      original_file_url     TEXT NOT NULL DEFAULT '',
      mime_type             TEXT NOT NULL DEFAULT '',
      summary               TEXT NOT NULL DEFAULT '',
      routed_sections_json  TEXT NOT NULL DEFAULT '[]',
      extracted_json        TEXT NOT NULL DEFAULT '{}',
      status                TEXT NOT NULL DEFAULT 'received',
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_intake_submission
      ON landos_intake_submission(deal_card_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS landos_intake_fact (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id  INTEGER NOT NULL REFERENCES landos_intake_submission(id),
      deal_card_id   INTEGER NOT NULL REFERENCES landos_deal_card(id),
      section        TEXT NOT NULL DEFAULT 'activity',
      fact_key       TEXT NOT NULL DEFAULT '',
      value          TEXT NOT NULL DEFAULT '',
      fact_status    TEXT NOT NULL DEFAULT 'stated',
      conflict_note  TEXT NOT NULL DEFAULT '',
      source         TEXT NOT NULL DEFAULT 'operator submission',
      created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_intake_fact
      ON landos_intake_fact(deal_card_id, section, fact_key, created_at DESC);

    -- Government, utility, and vendor resources are separate from seller
    -- people. Representatives are part of the dedupe key, allowing multiple
    -- people at one department without duplicate cards for the same person.
    CREATE TABLE IF NOT EXISTS landos_resource_contact (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id          INTEGER NOT NULL REFERENCES landos_deal_card(id),
      category              TEXT NOT NULL DEFAULT 'other',
      organization          TEXT NOT NULL DEFAULT '',
      department            TEXT NOT NULL DEFAULT '',
      representative        TEXT NOT NULL DEFAULT '',
      role                  TEXT NOT NULL DEFAULT '',
      phone                 TEXT NOT NULL DEFAULT '',
      email                 TEXT NOT NULL DEFAULT '',
      website               TEXT NOT NULL DEFAULT '',
      address               TEXT NOT NULL DEFAULT '',
      jurisdiction          TEXT NOT NULL DEFAULT '',
      notes                 TEXT NOT NULL DEFAULT '',
      source                TEXT NOT NULL DEFAULT '',
      last_contacted_date   TEXT NOT NULL DEFAULT '',
      linked_items_json     TEXT NOT NULL DEFAULT '[]',
      next_follow_up        TEXT NOT NULL DEFAULT '',
      dedupe_key            TEXT NOT NULL DEFAULT '',
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(deal_card_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_resource_contact
      ON landos_resource_contact(deal_card_id, category, organization);

    -- Owner-readable outcomes from the jurisdiction-aware public-record lane.
    -- An inaccessible index is recorded as retrieved_no with the exact reason;
    -- it is never translated into a claim that no lien/deed/restriction exists.
    CREATE TABLE IF NOT EXISTS landos_public_record_outcome (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id      INTEGER NOT NULL REFERENCES landos_deal_card(id),
      category          TEXT NOT NULL,
      title             TEXT NOT NULL DEFAULT '',
      jurisdiction      TEXT NOT NULL DEFAULT '',
      authority         TEXT NOT NULL DEFAULT '',
      retrieval_status  TEXT NOT NULL DEFAULT 'retrieved_no',
      summary           TEXT NOT NULL DEFAULT '',
      facts_json        TEXT NOT NULL DEFAULT '{}',
      source_url        TEXT NOT NULL DEFAULT '',
      screenshot_url    TEXT NOT NULL DEFAULT '',
      document_url      TEXT NOT NULL DEFAULT '',
      searched_at       TEXT NOT NULL DEFAULT '',
      next_follow_up    TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(deal_card_id, category, authority)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_public_record_outcome
      ON landos_public_record_outcome(deal_card_id, category, updated_at DESC);

    -- Explicit aliases reconcile official last-name-first formatting and known
    -- intake corrections to one canonical person while retaining provenance.
    CREATE TABLE IF NOT EXISTS landos_person_alias (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER NOT NULL REFERENCES landos_person(id),
      alias_name   TEXT NOT NULL,
      alias_key    TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT '',
      official_format INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(person_id, alias_key)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_person_alias_key ON landos_person_alias(alias_key);

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
    if (cols.length === 0) return; // table not created yet (its CREATE includes the column)
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn('landos_deal_card', 'lead_type', `lead_type TEXT NOT NULL DEFAULT 'actual'`);
  addColumn('landos_property_card', 'lead_type', `lead_type TEXT NOT NULL DEFAULT 'actual'`);
  // Deal Card Trash (soft delete): a non-null deleted_at moves a card to Trash —
  // it disappears from normal boards/lists but is restorable. Hard delete removes
  // the row (and deal-scoped rows) only from Trash. No auto-purge.
  addColumn('landos_deal_card', 'deleted_at', `deleted_at INTEGER`);
  // Verified-parcel coordinates persisted as ENRICHMENT OUTPUT (supporting
  // context for Realie/Zillow comps, imagery, and map context). They are NEVER
  // used for card identity or merge — identity stays exact-source only. Persisted
  // so a reopened verified parcel keeps its full enrichment pipeline.
  addColumn('landos_property_card', 'lat', `lat REAL`);
  addColumn('landos_property_card', 'lng', `lng REAL`);
  // Platform Intelligence: learned allowed/restricted/forbidden work surfaces.
  addColumn('landos_platform_intel', 'task_boundary_json', `task_boundary_json TEXT NOT NULL DEFAULT '{}'`);
  // Market Matrix: per-snapshot data-quality flags (accepted-but-unusual values,
  // e.g. LandPortal STR > 100%). Migration for existing store DBs.
  addColumn('landos_market_snapshot', 'flags_json', `flags_json TEXT NOT NULL DEFAULT '[]'`);
  // Comp coordinates for the embedded LandOS comp map. ENRICHMENT ONLY (plot +
  // straight-line distance): providers supply them when available, otherwise a
  // bounded cached geocode fills them. Never used for comp identity/dedup
  // decisions beyond the existing coordinate matcher.
  addColumn('landos_comp', 'lat', `lat REAL`);
  addColumn('landos_comp', 'lng', `lng REAL`);
  // Phase 1D normalized comparable record. landos_comp remains the one shared
  // registry; these additive fields carry provider-complete evidence without
  // weakening the legacy manual-comp constraints.
  addColumn('landos_comp', 'canonical_source', `canonical_source TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'city', `city TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'zip', `zip TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'distance_miles', `distance_miles REAL`);
  addColumn('landos_comp', 'listing_date', `listing_date TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'days_on_market', `days_on_market INTEGER`);
  addColumn('landos_comp', 'property_class', `property_class TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'classification', `classification TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'thumbnail_url', `thumbnail_url TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'retrieved_at', `retrieved_at TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'radius_miles', `radius_miles REAL`);
  addColumn('landos_comp', 'date_window_months', `date_window_months INTEGER`);
  addColumn('landos_comp', 'inclusion_reason', `inclusion_reason TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'source_attributions_json', `source_attributions_json TEXT NOT NULL DEFAULT '[]'`);
  addColumn('landos_comp', 'canonical_key', `canonical_key TEXT NOT NULL DEFAULT ''`);
  addColumn('landos_comp', 'updated_at', `updated_at INTEGER NOT NULL DEFAULT 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_landos_comp_canonical
           ON landos_comp(deal_card_id, canonical_key)`);
  // Normalize provider-echoed county names to the LandOS bare-name convention
  // ("Pickens", not "Pickens County") — the UI appends "County" itself. US
  // county proper names never end in " County", so this is a safe idempotent
  // migration for rows written before the lane normalization (live QA caught
  // "Pickens County County" in the Deal Card header).
  db.exec(`UPDATE landos_property_card
           SET county = TRIM(SUBSTR(county, 1, LENGTH(county) - 7))
           WHERE county LIKE '% County'`);
  // Shared geocode cache (free Census geocoder results, including misses so a
  // bad address is not re-queried every map load). Enrichment only — never
  // identity. Lives in store/landos.db (gitignored).
  db.exec(`CREATE TABLE IF NOT EXISTS landos_geocode_cache (
    address_key TEXT PRIMARY KEY,
    lat REAL,
    lng REAL,
    provider TEXT NOT NULL DEFAULT 'us_census',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);
  // Browser Agent run: data-quality breakdown (flagged / unknown) alongside
  // accepted / rejected. Migration for existing store DBs.
  addColumn('landos_browser_agent_run', 'rows_flagged', `rows_flagged INTEGER NOT NULL DEFAULT 0`);
  addColumn('landos_browser_agent_run', 'rows_unknown', `rows_unknown INTEGER NOT NULL DEFAULT 0`);

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
      task_boundary_json TEXT NOT NULL DEFAULT '{}',
      confidence      TEXT NOT NULL DEFAULT 'low',
      times_used      INTEGER NOT NULL DEFAULT 0,
      times_succeeded INTEGER NOT NULL DEFAULT 0,
      last_validated_at INTEGER,
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(platform)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_intel ON landos_platform_intel(platform);

    -- ── Browser Training Department ──────────────────────────────────────
    -- Live "teach it like an employee" sessions. Tyler shares a screen and
    -- talks; LandOS records the conversation + browser events, then synthesizes
    -- a reusable Browser Playbook. No secrets, no property work product, no
    -- paid actions are ever stored. Lives in store/landos.db (gitignored).
    CREATE TABLE IF NOT EXISTS landos_training_session (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL DEFAULT '',
      website       TEXT NOT NULL DEFAULT '',
      surface       TEXT NOT NULL DEFAULT 'tab'
                    CHECK (surface IN ('tab','window','desktop')),
      status        TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','ended','aborted')),
      provider      TEXT NOT NULL DEFAULT 'gemini',
      model         TEXT NOT NULL DEFAULT '',
      deal_card_id  INTEGER,
      approval_required INTEGER NOT NULL DEFAULT 0,
      started_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      ended_at      INTEGER,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      audio_in_tokens   INTEGER NOT NULL DEFAULT 0,
      audio_out_tokens  INTEGER NOT NULL DEFAULT 0,
      video_tokens      INTEGER NOT NULL DEFAULT 0,
      text_tokens       INTEGER NOT NULL DEFAULT 0,
      est_cost_usd  REAL NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_training_session_status ON landos_training_session(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_training_event (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL,
      seq           INTEGER NOT NULL DEFAULT 0,
      kind          TEXT NOT NULL DEFAULT 'note'
                    CHECK (kind IN ('operator_speech','ai_speech','nav','click','input','screenshot','system','guard_block')),
      role          TEXT NOT NULL DEFAULT '',
      text          TEXT NOT NULL DEFAULT '',
      url           TEXT NOT NULL DEFAULT '',
      selector      TEXT NOT NULL DEFAULT '',
      meta_json     TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_training_event_session ON landos_training_event(session_id, seq);

    -- Per-field selector bindings captured during a session: when Tyler names a
    -- field ("this is road frontage") the trainer binds it to a stable selector +
    -- nearby label so replay can extract the value. Latest binding per (session,
    -- field) wins. No secrets, no property values are required here (value is a
    -- transient sample from the demo page, kept for operator confirmation only).
    CREATE TABLE IF NOT EXISTS landos_training_field_binding (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL,
      field         TEXT NOT NULL,
      selector      TEXT NOT NULL DEFAULT '',
      label         TEXT NOT NULL DEFAULT '',
      sample_value  TEXT NOT NULL DEFAULT '',
      confidence    TEXT NOT NULL DEFAULT 'low',
      strategy      TEXT NOT NULL DEFAULT 'label',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(session_id, field)
    );
    CREATE INDEX IF NOT EXISTS idx_training_field_binding_session ON landos_training_field_binding(session_id);

    CREATE TABLE IF NOT EXISTS landos_training_playbook (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER,
      slug          TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL DEFAULT '',
      website       TEXT NOT NULL DEFAULT '',
      version       INTEGER NOT NULL DEFAULT 1,
      status        TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','rejected','superseded')),
      body_json     TEXT NOT NULL DEFAULT '{}',
      source_ref    TEXT NOT NULL DEFAULT '',
      decided_by    TEXT NOT NULL DEFAULT '',
      decided_at    INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_training_playbook_slug ON landos_training_playbook(slug, version DESC);
    CREATE INDEX IF NOT EXISTS idx_training_playbook_status ON landos_training_playbook(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS landos_training_knowledge (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER,
      category      TEXT NOT NULL DEFAULT 'business_rule'
                    CHECK (category IN ('business_rule','provider_quirk','operator_preference','website_change','observation','never_do')),
      title         TEXT NOT NULL DEFAULT '',
      body          TEXT NOT NULL DEFAULT '',
      website       TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','saved','discarded')),
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_training_knowledge_status ON landos_training_knowledge(status, created_at DESC);

    -- Execution results: each time the Browser Agent runs an APPROVED trained
    -- playbook (dry-run or live). Captures status, screenshots, extracted fields,
    -- blocked actions, errors, and QA notes. Ties back to the browser-agent run
    -- and (optionally) the Deal Card whose facts were written.
    CREATE TABLE IF NOT EXISTS landos_training_execution (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      playbook_id     INTEGER NOT NULL,
      playbook_slug   TEXT NOT NULL DEFAULT '',
      agent_run_id    TEXT NOT NULL DEFAULT '',
      deal_card_id    INTEGER,
      mode            TEXT NOT NULL DEFAULT 'dry_run'
                      CHECK (mode IN ('dry_run','live')),
      status          TEXT NOT NULL DEFAULT 'succeeded'
                      CHECK (status IN ('succeeded','partial','blocked','failed','not_configured','awaiting_authentication')),
      approval_required INTEGER NOT NULL DEFAULT 0,
      fields_written  INTEGER NOT NULL DEFAULT 0,
      extracted_fields_json TEXT NOT NULL DEFAULT '[]',
      blocked_actions_json  TEXT NOT NULL DEFAULT '[]',
      errors_json     TEXT NOT NULL DEFAULT '[]',
      screenshots_json TEXT NOT NULL DEFAULT '[]',
      qa_notes        TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_training_execution_playbook ON landos_training_execution(playbook_id, created_at DESC);

    -- ── Market Matrix (Market Intelligence department) ───────────────────
    -- The master market-intelligence database: FACTUAL market metrics per
    -- geography (county FIPS / state / ZIP) + acreage band + market side +
    -- quarter. Facts only — derived scores are NEVER stored (they compute at
    -- read time). Every row carries full provenance (provider / source ref /
    -- extraction timestamp / agent run id) + confidence. Unknown metrics are
    -- stored as null inside metrics_json, never 0. Lives in store/landos.db
    -- (gitignored) — no property-specific work product, no secrets.
    CREATE TABLE IF NOT EXISTS landos_market_snapshot (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_key        TEXT NOT NULL UNIQUE,
      geo_level           TEXT NOT NULL DEFAULT 'county'
                          CHECK (geo_level IN ('county','state','zip')),
      state               TEXT NOT NULL DEFAULT '',
      fips                TEXT NOT NULL DEFAULT '',
      county_name         TEXT NOT NULL DEFAULT '',
      zip                 TEXT NOT NULL DEFAULT '',
      acreage_band        TEXT NOT NULL DEFAULT 'all',
      side                TEXT NOT NULL DEFAULT 'sold'
                          CHECK (side IN ('sold','for_sale')),
      period              TEXT NOT NULL DEFAULT '',
      metrics_json        TEXT NOT NULL DEFAULT '{}',
      confidence          TEXT NOT NULL DEFAULT 'low',
      provider            TEXT NOT NULL DEFAULT '',
      source_ref          TEXT NOT NULL DEFAULT '',
      extraction_ts       TEXT NOT NULL DEFAULT '',
      agent_run_id        TEXT NOT NULL DEFAULT '',
      flags_json          TEXT NOT NULL DEFAULT '[]',
      ingested_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_market_snapshot_county ON landos_market_snapshot(fips, side, acreage_band, period DESC);
    CREATE INDEX IF NOT EXISTS idx_market_snapshot_state ON landos_market_snapshot(state, geo_level, side, acreage_band);
    CREATE INDEX IF NOT EXISTS idx_market_snapshot_zip ON landos_market_snapshot(zip, side, acreage_band, period DESC);

    -- Saved MarketQueries — reusable structured market searches that become
    -- durable business assets future departments can consume. query_json holds
    -- the full MarketQuery object; no results are cached (results recompute).
    CREATE TABLE IF NOT EXISTS landos_market_query (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entity        TEXT,
      name          TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      query_json    TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_market_query_name ON landos_market_query(name, created_at DESC);

    -- Ingestion review queue — records REJECTED by validation are parked here
    -- with their exact errors and provenance. Never silently repaired; they
    -- become future Browser Agent / data-quality work.
    CREATE TABLE IF NOT EXISTS landos_market_review_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider      TEXT NOT NULL DEFAULT '',
      raw_json      TEXT NOT NULL DEFAULT '{}',
      errors_json   TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','dismissed','resolved')),
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_market_review_queue ON landos_market_review_queue(status, created_at DESC);

    -- County reference (FIPS identity). County NAME is display-only; the 5-digit
    -- FIPS is identity. Seeded from a reference dataset so the heatmap can render
    -- counties with no data as grey (Unknown, never zero) and exclusion reporting
    -- knows the full county universe in a state.
    CREATE TABLE IF NOT EXISTS landos_market_county_ref (
      fips          TEXT PRIMARY KEY,
      state         TEXT NOT NULL DEFAULT '',
      county_name   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_market_county_ref_state ON landos_market_county_ref(state, county_name);

    -- ── Market Research quarterly snapshot store ─────────────────────────
    -- LandOS-owned retained market research (the Market Research department
    -- workspace). One landos_mr_snapshot per reporting quarter + exact filter
    -- set; metrics live in landos_mr_metric keyed by snapshot + geography and
    -- are NEVER overwritten by a later collection (idempotent INSERT OR
    -- IGNORE; corrections only through the audited correction log). Geography
    -- identity/hierarchy is shared with the Market Matrix (USPS state, county
    -- FIPS, ZIP) — one geography system, not a parallel one.
    CREATE TABLE IF NOT EXISTS landos_mr_snapshot (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      quarter        TEXT NOT NULL DEFAULT '',
      filter_key     TEXT NOT NULL DEFAULT '',
      filters_json   TEXT NOT NULL DEFAULT '{}',
      provider       TEXT NOT NULL DEFAULT '',
      collected_at   TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'collecting'
                     CHECK (status IN ('collecting','retained')),
      created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE (quarter, filter_key)
    );

    CREATE TABLE IF NOT EXISTS landos_mr_geography (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      geo_key        TEXT NOT NULL UNIQUE,
      level          TEXT NOT NULL CHECK (level IN ('state','county','zip')),
      state          TEXT NOT NULL DEFAULT '',
      fips           TEXT NOT NULL DEFAULT '',
      zip            TEXT NOT NULL DEFAULT '',
      name           TEXT NOT NULL DEFAULT '',
      parent_key     TEXT NOT NULL DEFAULT '',
      geometry_ref   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mr_geography_parent ON landos_mr_geography(parent_key, level);

    CREATE TABLE IF NOT EXISTS landos_mr_metric (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id    INTEGER NOT NULL,
      geography_id   INTEGER NOT NULL,
      metrics_json   TEXT NOT NULL DEFAULT '{}',
      county_count   INTEGER,
      zip_count      INTEGER,
      provider       TEXT NOT NULL DEFAULT '',
      source_ref     TEXT NOT NULL DEFAULT '',
      observed_at    TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE (snapshot_id, geography_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mr_metric_snapshot ON landos_mr_metric(snapshot_id, geography_id);

    -- Internal resumable collection state + diagnostics. NEVER owner-facing.
    CREATE TABLE IF NOT EXISTS landos_mr_collection_run (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id    INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','paused','completed','failed')),
      progress_json  TEXT NOT NULL DEFAULT '{}',
      diagnostics    TEXT NOT NULL DEFAULT '',
      started_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mr_run_snapshot ON landos_mr_collection_run(snapshot_id, started_at DESC);

    -- Audited corrections: the ONLY path that may change a retained metric.
    CREATE TABLE IF NOT EXISTS landos_mr_correction (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_id      INTEGER NOT NULL,
      before_json    TEXT NOT NULL DEFAULT '{}',
      after_json     TEXT NOT NULL DEFAULT '{}',
      reason         TEXT NOT NULL DEFAULT '',
      corrected_by   TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- ZIP ↔ county membership as the PROVIDER lists it. A ZIP crossing county
    -- lines appears under EVERY county LandPortal groups it under, while the
    -- geography hierarchy keeps one canonical parent. County ZIP listings
    -- render the union so no provider-listed row is ever invisible.
    CREATE TABLE IF NOT EXISTS landos_mr_zip_county (
      zip            TEXT NOT NULL,
      fips           TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (zip, fips)
    );
    CREATE INDEX IF NOT EXISTS idx_mr_zip_county_fips ON landos_mr_zip_county(fips);

    -- Band-collection unit ledger: one row per (snapshot, request unit) for
    -- the payload-replay collector. Resumable, honest completeness: 'retained'
    -- means items were stored; 'empty' means the provider returned NO rows for
    -- the unit under that band (a real absence, never fabricated).
    CREATE TABLE IF NOT EXISTS landos_mr_band_unit (
      snapshot_id    INTEGER NOT NULL,
      unit_key       TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      items          INTEGER NOT NULL DEFAULT 0,
      updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (snapshot_id, unit_key)
    );
    -- Seed membership from each ZIP's canonical geography parent (idempotent).
    INSERT OR IGNORE INTO landos_mr_zip_county (zip, fips, source)
      SELECT zip, fips, 'geography-parent' FROM landos_mr_geography
      WHERE level = 'zip' AND zip != '' AND fips != '';

    -- Map geometry cache, stored SEPARATELY from market values (efficient
    -- rendering; ZCTA polygons fetched once from the public Census TIGERweb
    -- service and retained).
    CREATE TABLE IF NOT EXISTS landos_mr_geometry (
      geo_key        TEXT PRIMARY KEY,
      geometry_json  TEXT NOT NULL DEFAULT '',
      source         TEXT NOT NULL DEFAULT '',
      fetched_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- Browser Agent run log — the Browser Agent is its OWN employee that owns
    -- browser automation and EXECUTES Browser Playbooks. This table records every
    -- playbook run (not the market data itself — that lives in the Market Matrix)
    -- so the Browser Agent has honest operational status: last run, outcome, the
    -- playbook used, the navigation scope actually visited, and the row counts a
    -- consuming department reported back after ingesting the returned payloads.
    -- The Browser Agent never stores site logic here; playbooks own that.
    CREATE TABLE IF NOT EXISTS landos_browser_agent_run (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_run_id      TEXT NOT NULL UNIQUE,
      playbook_id       TEXT NOT NULL DEFAULT '',
      playbook_label    TEXT NOT NULL DEFAULT '',
      provider          TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'not_configured'
                        CHECK (status IN ('not_configured','configured','running','succeeded','failed','awaiting_authentication')),
      request_json      TEXT NOT NULL DEFAULT '{}',
      scope_visited     TEXT NOT NULL DEFAULT '[]',
      source_page       TEXT NOT NULL DEFAULT '',
      rows_captured     INTEGER NOT NULL DEFAULT 0,
      rows_accepted     INTEGER NOT NULL DEFAULT 0,
      rows_flagged      INTEGER NOT NULL DEFAULT 0,
      rows_unknown      INTEGER NOT NULL DEFAULT 0,
      rows_rejected     INTEGER NOT NULL DEFAULT 0,
      review_queued     INTEGER NOT NULL DEFAULT 0,
      duration_ms       INTEGER NOT NULL DEFAULT 0,
      screenshots_json  TEXT NOT NULL DEFAULT '[]',
      note              TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_browser_agent_run ON landos_browser_agent_run(playbook_id, created_at DESC);

    -- ── Parcel Identity (the acquisition-pipeline spine) ─────────────────
    -- ONE persisted verdict per Deal Card for "has the subject parcel actually
    -- been confirmed?". Computed ONCE by the Property Resolution engine and stored
    -- here; downstream departments read this state and never re-derive it. State
    -- machine: unresolved -> candidate -> confirmed. Only 'confirmed' unlocks
    -- Property Intelligence / Market Pulse / comps / Strategy / Discovery. Never
    -- confirmed from operator-echoed input, coordinates, proximity, or nearest
    -- parcel — the engine's established-identity rule is the only path. No secrets,
    -- no property work product (identity + provenance refs only).
    CREATE TABLE IF NOT EXISTS landos_parcel_identity (
      deal_card_id      INTEGER PRIMARY KEY REFERENCES landos_deal_card(id),
      subject_card_id   INTEGER,
      state             TEXT NOT NULL DEFAULT 'unresolved'
                        CHECK (state IN ('unresolved','candidate','confirmed')),
      basis             TEXT NOT NULL DEFAULT '',
      confidence        REAL NOT NULL DEFAULT 0,
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      confirmed_at      INTEGER,
      confirmed_by      TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_parcel_identity_state ON landos_parcel_identity(state);

    -- Resolution snapshot: the Property Resolution trace captured when a Deal Card
    -- is created for a NOT-yet-confirmed parcel (candidate/unresolved). Drives the
    -- dedicated Resolution view (what LandOS understood, sources searched,
    -- candidates + accept/reject reasons, what's missing, smallest next
    -- identifier). One row per Deal Card; overwritten on re-resolve. No secrets,
    -- no property work product beyond the operator's own intake + provenance.
    CREATE TABLE IF NOT EXISTS landos_resolution_snapshot (
      deal_card_id  INTEGER PRIMARY KEY REFERENCES landos_deal_card(id),
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- Property Summary vertical slice. These tables are additive read-model
    -- infrastructure beneath the legacy Deal Card. They deliberately separate
    -- accepted identity, immutable evidence, durable collector execution, and
    -- immutable operator snapshots so a GET never has to research or reconcile.
    CREATE TABLE IF NOT EXISTS landos_property_identity_version (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id          INTEGER NOT NULL REFERENCES landos_deal_card(id) ON DELETE CASCADE,
      property_card_id      INTEGER REFERENCES landos_property_card(id) ON DELETE SET NULL,
      version               INTEGER NOT NULL,
      status                TEXT NOT NULL
                            CHECK (status IN ('unresolved','candidate','confirmed','disputed','rejected','archived')),
      address               TEXT,
      city                  TEXT,
      county                TEXT,
      state                 TEXT,
      zip                   TEXT,
      apn                   TEXT,
      owner                 TEXT,
      acreage               REAL,
      geometry_json         TEXT,
      basis                 TEXT NOT NULL DEFAULT '',
      confidence            REAL NOT NULL DEFAULT 0,
      source_refs_json      TEXT NOT NULL DEFAULT '[]',
      change_reason         TEXT NOT NULL,
      created_by            TEXT NOT NULL,
      is_current            INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(deal_card_id, version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_property_identity_one_current
      ON landos_property_identity_version(deal_card_id) WHERE is_current = 1;
    CREATE INDEX IF NOT EXISTS idx_property_identity_version_deal
      ON landos_property_identity_version(deal_card_id, version DESC);

    CREATE TABLE IF NOT EXISTS landos_property_evidence_item (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id          INTEGER NOT NULL REFERENCES landos_deal_card(id) ON DELETE CASCADE,
      property_identity_version_id INTEGER NOT NULL REFERENCES landos_property_identity_version(id) ON DELETE CASCADE,
      domain                TEXT NOT NULL,
      evidence_kind         TEXT NOT NULL,
      fact_key              TEXT,
      raw_value_json        TEXT NOT NULL DEFAULT 'null',
      normalized_value_json TEXT NOT NULL DEFAULT 'null',
      source_name           TEXT NOT NULL,
      source_url            TEXT,
      source_tier           TEXT NOT NULL,
      verification_status   TEXT NOT NULL,
      confidence            TEXT NOT NULL,
      collector_key         TEXT NOT NULL,
      retrieved_at          TEXT NOT NULL,
      effective_at          TEXT,
      fresh_until           TEXT,
      artifact_ref          TEXT,
      supersedes_evidence_id INTEGER REFERENCES landos_property_evidence_item(id) ON DELETE SET NULL,
      dispute_group         TEXT,
      idempotency_key       TEXT NOT NULL UNIQUE,
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_property_evidence_deal_domain
      ON landos_property_evidence_item(deal_card_id, domain, id DESC);
    CREATE INDEX IF NOT EXISTS idx_property_evidence_identity
      ON landos_property_evidence_item(property_identity_version_id, id DESC);
    CREATE TRIGGER IF NOT EXISTS trg_property_evidence_immutable_update
      BEFORE UPDATE ON landos_property_evidence_item
      BEGIN
        SELECT RAISE(ABORT, 'property evidence is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_property_evidence_immutable_delete
      BEFORE DELETE ON landos_property_evidence_item
      WHEN COALESCE((SELECT deleted_at FROM landos_deal_card WHERE id=OLD.deal_card_id), 0) = 0
      BEGIN
        SELECT RAISE(ABORT, 'property evidence is append-only');
      END;

    CREATE TABLE IF NOT EXISTS landos_property_collector_job (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id          INTEGER NOT NULL REFERENCES landos_deal_card(id) ON DELETE CASCADE,
      property_identity_version_id INTEGER NOT NULL REFERENCES landos_property_identity_version(id) ON DELETE CASCADE,
      collector_key         TEXT NOT NULL,
      status                TEXT NOT NULL
                            CHECK (status IN ('queued','running','succeeded','partial','blocked','failed')),
      input_hash            TEXT NOT NULL,
      idempotency_key       TEXT NOT NULL UNIQUE,
      dependency_json       TEXT NOT NULL DEFAULT '[]',
      attempt_count         INTEGER NOT NULL DEFAULT 0,
      last_error            TEXT,
      queued_at             INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      started_at            INTEGER,
      finished_at           INTEGER,
      updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_property_collector_job_deal
      ON landos_property_collector_job(deal_card_id, collector_key, id DESC);

    CREATE TABLE IF NOT EXISTS landos_property_collector_attempt (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id                INTEGER NOT NULL REFERENCES landos_property_collector_job(id) ON DELETE CASCADE,
      attempt_number        INTEGER NOT NULL,
      status                TEXT NOT NULL
                            CHECK (status IN ('running','succeeded','partial','blocked','failed')),
      started_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      finished_at           INTEGER,
      error                 TEXT,
      output_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE(job_id, attempt_number)
    );
    CREATE INDEX IF NOT EXISTS idx_property_collector_attempt_job
      ON landos_property_collector_attempt(job_id, attempt_number DESC);

    CREATE TABLE IF NOT EXISTS landos_deal_intelligence_snapshot (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_card_id          INTEGER NOT NULL REFERENCES landos_deal_card(id) ON DELETE CASCADE,
      version               INTEGER NOT NULL,
      property_identity_version_id INTEGER NOT NULL REFERENCES landos_property_identity_version(id) ON DELETE CASCADE,
      prior_snapshot_id     INTEGER REFERENCES landos_deal_intelligence_snapshot(id) ON DELETE SET NULL,
      snapshot_type         TEXT NOT NULL DEFAULT 'property_summary_v1',
      status                TEXT NOT NULL CHECK (status IN ('current','superseded')),
      input_hash            TEXT NOT NULL,
      evidence_max_id       INTEGER,
      completeness_json     TEXT NOT NULL,
      summary_json          TEXT NOT NULL,
      change_reason         TEXT NOT NULL,
      generated_by          TEXT NOT NULL,
      created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(deal_card_id, version),
      UNIQUE(deal_card_id, input_hash)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_intelligence_one_current
      ON landos_deal_intelligence_snapshot(deal_card_id, snapshot_type)
      WHERE status = 'current';
    CREATE INDEX IF NOT EXISTS idx_deal_intelligence_snapshot_deal
      ON landos_deal_intelligence_snapshot(deal_card_id, version DESC);

    -- Auditable guard against prompt/instruction overrides of accepted parcel
    -- evidence, plus a non-destructive correction link for erroneous intakes.
    CREATE TABLE IF NOT EXISTS landos_instruction_contradiction (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      instruction_received TEXT NOT NULL,
      operator_value TEXT NOT NULL DEFAULT '',
      accepted_identifiers_json TEXT NOT NULL DEFAULT '{}',
      external_normalization TEXT NOT NULL DEFAULT '',
      conflict_detected TEXT NOT NULL,
      evidence_supported_interpretation TEXT NOT NULL,
      action_taken TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_instruction_contradiction_card ON landos_instruction_contradiction(card_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS landos_property_correction_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      erroneous_card_id INTEGER NOT NULL,
      canonical_card_id INTEGER NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'erroneous_duplicate',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(erroneous_card_id, canonical_card_id, relationship)
    );

    -- Site Playbook: a REUSABLE, VERSIONED navigation workflow learned when Browser
    -- Intelligence had to inspect a site (evidence-driven retrieval failed / hit an
    -- unexpected path). Captures the learned interactive STRUCTURE (search modes,
    -- dropdowns, required fields, filters, tabs, expandable sections, pagination,
    -- modals, result tables, parcel-detail nav, multi-step deps) + the WORKFLOW
    -- (ordered navigation steps) — never hardcoded values. One row per
    -- (platform, task_type); version bumps when a stale playbook is relearned after
    -- the site changes. No secrets, no per-property data.
    CREATE TABLE IF NOT EXISTS landos_site_playbook (
      platform      TEXT NOT NULL,
      task_type     TEXT NOT NULL DEFAULT 'parcel_lookup',
      version       INTEGER NOT NULL DEFAULT 1,
      structure_json TEXT NOT NULL DEFAULT '{}',
      workflow_json  TEXT NOT NULL DEFAULT '[]',
      notes_json     TEXT NOT NULL DEFAULT '[]',
      times_reused   INTEGER NOT NULL DEFAULT 0,
      learned_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (platform, task_type)
    );

    -- Reusable SITE NAVIGATION MODEL — keyed by platform ONLY (task-agnostic), so
    -- every current/future department that touches a site shares one navigation
    -- model. Stores HOW a site is navigated, never its DATA. Versioned; relearned
    -- section-by-section when a site changes. See browser-navigation-model.ts.
    CREATE TABLE IF NOT EXISTS landos_site_navigation (
      platform      TEXT PRIMARY KEY,
      version       INTEGER NOT NULL DEFAULT 1,
      model_json    TEXT NOT NULL DEFAULT '{}',
      times_reused  INTEGER NOT NULL DEFAULT 0,
      learned_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- Additive, checksummed migration ledger introduced by the Phase 1 reset.
    -- Existing CREATE/ALTER guards remain for compatibility while subsequent
    -- Phase 1 schema changes receive explicit durable identities.
    CREATE TABLE IF NOT EXISTS landos_schema_migration (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Phase 1 opportunity authority. Legacy Deal/Property Cards remain intact
    -- and are linked as migration aliases; lifecycle changes happen on this
    -- one durable row instead of copying a lead into a second deal record.
    CREATE TABLE IF NOT EXISTS landos_opportunity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_uid TEXT NOT NULL UNIQUE,
      entity TEXT NOT NULL REFERENCES landos_business_entity(id),
      title TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      raw_input TEXT NOT NULL DEFAULT '',
      lifecycle TEXT NOT NULL DEFAULT 'lead'
        CHECK (lifecycle IN ('lead', 'deal', 'disposed')),
      disposition TEXT,
      pursued_at INTEGER,
      pursued_by TEXT,
      research_status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (research_status IN ('not_started', 'queued', 'running', 'partial', 'complete', 'failed')),
      discovery_status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (discovery_status IN ('not_started', 'brief_ready', 'call_complete', 'reconciled')),
      legacy_deal_card_id INTEGER UNIQUE REFERENCES landos_deal_card(id),
      primary_property_card_id INTEGER REFERENCES landos_property_card(id),
      legacy_status TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      CHECK (lifecycle = 'disposed' OR disposition IS NULL),
      CHECK (lifecycle <> 'deal' OR (pursued_at IS NOT NULL AND pursued_by IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_opportunity_entity_lifecycle
      ON landos_opportunity(entity, lifecycle, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_landos_opportunity_research
      ON landos_opportunity(research_status, discovery_status);

    -- Durable observe -> act -> verify research missions. Browser/process work
    -- may stop at any time; queued/running rows are recoverable on startup.
    CREATE TABLE IF NOT EXISTS landos_opportunity_research_mission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      run_key TEXT NOT NULL UNIQUE,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'partial', 'complete', 'failed', 'quarantined')),
      attempt INTEGER NOT NULL DEFAULT 0,
      constraints_json TEXT NOT NULL,
      tool_trace_json TEXT NOT NULL DEFAULT '[]',
      verification_json TEXT,
      summary TEXT NOT NULL DEFAULT '',
      safe_next_action TEXT NOT NULL DEFAULT '',
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_research_mission_state
      ON landos_opportunity_research_mission(status, updated_at, opportunity_id);

    -- Wrong-property evidence is retained for audit but excluded from every
    -- canonical consumer. The original activity and files are never deleted.
    CREATE TABLE IF NOT EXISTS landos_quarantined_card_evidence (
      activity_id INTEGER PRIMARY KEY REFERENCES landos_card_activity(id) ON DELETE RESTRICT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      quarantined_by TEXT NOT NULL DEFAULT 'Property Research Agent',
      quarantined_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_quarantined_evidence_opportunity
      ON landos_quarantined_card_evidence(opportunity_id, quarantined_at DESC);

    CREATE TABLE IF NOT EXISTS landos_opportunity_legacy_alias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      alias_type TEXT NOT NULL CHECK (alias_type IN ('deal_card', 'property_card')),
      legacy_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(alias_type, legacy_id),
      UNIQUE(opportunity_id, alias_type, legacy_id)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_opportunity_alias_opportunity
      ON landos_opportunity_legacy_alias(opportunity_id);

    CREATE TABLE IF NOT EXISTS landos_opportunity_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      event_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_lifecycle TEXT,
      to_lifecycle TEXT,
      decision TEXT,
      actor TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      occurred_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(opportunity_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_opportunity_history_timeline
      ON landos_opportunity_history(opportunity_id, occurred_at DESC, id DESC);

    -- One current, versioned discovery-call package per canonical opportunity.
    -- The JSON is the exact projection consumed by the Lead Card and PDF route;
    -- it points at the existing Deal/Property graph rather than creating another
    -- card system. Rebuilding is deterministic over the persisted source rows.
    CREATE TABLE IF NOT EXISTS landos_opportunity_discovery_package (
      opportunity_id INTEGER PRIMARY KEY REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      package_version INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL,
      package_json TEXT NOT NULL,
      source_updated_at INTEGER NOT NULL,
      generated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_by TEXT NOT NULL DEFAULT 'Property Research Agent'
    );
    CREATE INDEX IF NOT EXISTS idx_landos_discovery_package_generated
      ON landos_opportunity_discovery_package(generated_at DESC);

    -- Human discovery-call record. Raw transcript text is deliberately stored
    -- separately from every derived projection and is immutable after insert.
    CREATE TABLE IF NOT EXISTS landos_opportunity_transcript (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      source_type TEXT NOT NULL CHECK (source_type IN ('paste', 'upload')),
      file_name TEXT,
      content_sha256 TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      captured_by TEXT NOT NULL DEFAULT 'operator',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(opportunity_id, content_sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_transcript_opportunity
      ON landos_opportunity_transcript(opportunity_id, created_at DESC, id DESC);
    CREATE TRIGGER IF NOT EXISTS landos_transcript_immutable_update
      BEFORE UPDATE ON landos_opportunity_transcript
      BEGIN SELECT RAISE(ABORT, 'raw transcripts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS landos_transcript_immutable_delete
      BEFORE DELETE ON landos_opportunity_transcript
      BEGIN SELECT RAISE(ABORT, 'raw transcripts are immutable'); END;

    -- Reconciliation is versioned. Each version points back to the exact raw
    -- transcript and discovery-package hash used for comparison.
    CREATE TABLE IF NOT EXISTS landos_opportunity_reconciliation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      transcript_id INTEGER NOT NULL REFERENCES landos_opportunity_transcript(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL,
      discovery_package_hash TEXT,
      reconciliation_json TEXT NOT NULL,
      reconciled_by TEXT NOT NULL DEFAULT 'Acquisitions Agent',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(opportunity_id, version),
      UNIQUE(transcript_id)
    );
    CREATE INDEX IF NOT EXISTS idx_landos_reconciliation_opportunity
      ON landos_opportunity_reconciliation(opportunity_id, version DESC);

    -- Append-only canonical field history. Seller statements never masquerade
    -- as verified research: each value carries its transcript/reconciliation
    -- provenance and conflict disposition.
    CREATE TABLE IF NOT EXISTS landos_opportunity_canonical_fact (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      field_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      classification TEXT NOT NULL CHECK (classification IN ('seller_stated', 'verified')),
      transcript_id INTEGER REFERENCES landos_opportunity_transcript(id) ON DELETE RESTRICT,
      reconciliation_id INTEGER REFERENCES landos_opportunity_reconciliation(id) ON DELETE RESTRICT,
      conflict_status TEXT NOT NULL DEFAULT 'none' CHECK (conflict_status IN ('none', 'possible', 'material')),
      supersedes_fact_id INTEGER REFERENCES landos_opportunity_canonical_fact(id) ON DELETE RESTRICT,
      recorded_by TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_canonical_fact_latest
      ON landos_opportunity_canonical_fact(opportunity_id, field_key, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS landos_opportunity_reconciliation_task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id INTEGER NOT NULL REFERENCES landos_opportunity(id) ON DELETE RESTRICT,
      reconciliation_id INTEGER NOT NULL REFERENCES landos_opportunity_reconciliation(id) ON DELETE RESTRICT,
      task_type TEXT NOT NULL CHECK (task_type IN ('research', 'follow_up')),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete', 'cancelled')),
      assigned_role TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_landos_reconciliation_task_open
      ON landos_opportunity_reconciliation_task(opportunity_id, status, created_at DESC);
  `);
  addColumn('landos_opportunity', 'pipeline_stage', `pipeline_stage TEXT NOT NULL DEFAULT 'new_lead'`);
  db.prepare(`INSERT OR IGNORE INTO landos_schema_migration (migration_id, checksum, description)
              VALUES (?, ?, ?)`).run(
    '20260717_001_phase1_storage_profiles',
    'sha256:dc37498a7d91a3932bd6afcc8445fa58b8dd902602319f97b17aed64bda3df08',
    'Record the additive Phase 1 migration chain after operating/QA storage separation and verified backup.',
  );
  db.prepare(`INSERT OR IGNORE INTO landos_schema_migration (migration_id, checksum, description)
              VALUES (?, ?, ?)`).run(
    '20260717_002_opportunity_authority',
    'sha256:95a64a0fb7b9a0ff8f65bf2721bb315069be215201a3cc6578dd808ba5d1ef8a',
    'Add one durable opportunity authority, legacy aliases, lifecycle state, and decision history.',
  );
  db.prepare(`INSERT OR IGNORE INTO landos_schema_migration (migration_id, checksum, description)
              VALUES (?, ?, ?)`).run(
    '20260717_003_discovery_package',
    'sha256:877c5b740dbe521f76133317ea563aed07dde03d3570f241da0ee54ea5c1694e',
    'Persist one versioned discovery-call package projection per canonical opportunity.',
  );
  db.prepare(`INSERT OR IGNORE INTO landos_schema_migration (migration_id, checksum, description)
              VALUES (?, ?, ?)`).run(
    '20260717_004_transcript_reconciliation',
    'sha256:4f7a5d3e5860ce8e79eff75f3be949e23251ddeedbe8cd4c39e90bb90d214b2e',
    'Add immutable raw transcripts, versioned reconciliation, provenance-linked facts, and shared follow-up work.',
  );
  // Historical QA fixtures predate the explicit lead_type column and therefore
  // entered the operating database as `actual`. Preserve every row and its
  // evidence, but correctly classify the three documented fixtures so they
  // remain isolated from operator-facing operating views.
  const fixtureIsolation = db.prepare(`INSERT OR IGNORE INTO landos_schema_migration (migration_id, checksum, description)
              VALUES (?, ?, ?)`).run(
    '20260718_005_reclassify_legacy_qa_fixtures',
    'sha256:ab346d3ec762dbf8c4c3f9860b5573a9468a536ec4cf5c52b1a48aac7ca53c95',
    'Reclassify documented legacy QA fixtures as TEST LEAD records without deleting their data.',
  );
  if (fixtureIsolation.changes > 0) {
    db.exec(`
      UPDATE landos_deal_card
      SET lead_type = 'test'
      WHERE title IN (
        '999 Model Validation Test Ln, Beaufort County, SC',
        '12345 Sprint Test Rd, Pickens, SC 29671',
        '00000 Nonexistent Qa Fixture Rd, Pickens, SC 29671'
      );

      UPDATE landos_property_card
      SET lead_type = 'test'
      WHERE id IN (
        SELECT dcp.card_id
        FROM landos_deal_card_property dcp
        JOIN landos_deal_card d ON d.id = dcp.deal_card_id
        WHERE d.lead_type = 'test'
      );
    `);
  }

  // Additive legacy backfill. Every existing Deal Card gets exactly one lead
  // opportunity, including soft-deleted/research cards. We deliberately retain
  // the legacy status rather than interpreting old deletion/status semantics as
  // a new pursuit or disposition decision.
  db.exec(`
    INSERT OR IGNORE INTO landos_opportunity (
      public_uid, entity, title, source, lifecycle, legacy_deal_card_id,
      primary_property_card_id, legacy_status, created_at, updated_at
    )
    SELECT
      'opp_' || lower(hex(randomblob(16))),
      d.entity,
      d.title,
      CASE WHEN d.lead_type = 'manual' THEN 'manual' ELSE 'legacy_deal_card' END,
      'lead',
      d.id,
      (SELECT dcp.card_id FROM landos_deal_card_property dcp
       WHERE dcp.deal_card_id = d.id
       ORDER BY CASE WHEN dcp.role = 'subject' THEN 0 ELSE 1 END, dcp.id
       LIMIT 1),
      d.status,
      d.created_at,
      d.updated_at
    FROM landos_deal_card d
    WHERE NOT EXISTS (
      SELECT 1 FROM landos_opportunity o WHERE o.legacy_deal_card_id = d.id
    );

    INSERT OR IGNORE INTO landos_opportunity_legacy_alias
      (opportunity_id, alias_type, legacy_id, created_at)
    SELECT o.id, 'deal_card', o.legacy_deal_card_id, o.created_at
    FROM landos_opportunity o
    WHERE o.legacy_deal_card_id IS NOT NULL;

    INSERT OR IGNORE INTO landos_opportunity_legacy_alias
      (opportunity_id, alias_type, legacy_id, created_at)
    SELECT o.id, 'property_card', dcp.card_id, dcp.created_at
    FROM landos_opportunity o
    JOIN landos_deal_card_property dcp ON dcp.deal_card_id = o.legacy_deal_card_id;

    INSERT OR IGNORE INTO landos_opportunity_history (
      opportunity_id, event_key, event_type, from_lifecycle, to_lifecycle,
      decision, actor, note, occurred_at
    )
    SELECT o.id, 'legacy-backfill', 'backfilled', NULL, 'lead', NULL,
           'phase1-migration',
           'Legacy Deal Card preserved as an alias; no pursuit or disposition inferred.',
           o.created_at
    FROM landos_opportunity o
    WHERE o.legacy_deal_card_id IS NOT NULL;
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
  const storage = getLandosStorageProfile();
  fs.mkdirSync(storage.root, { recursive: true });
  const dbPath = storage.databasePath;
  landosDb = new Database(dbPath);
  landosDb.pragma('journal_mode = WAL');
  landosDb.pragma('busy_timeout = 5000');
  landosDb.pragma('foreign_keys = ON');
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
  if (isProhibitedActionType(opts.actionType)) {
    landosAudit(opts.requestedBy, 'prohibited_action_blocked', `${opts.actionType}: ${opts.title}`, {
      entity: opts.entity ?? null,
      blocked: true,
    });
    throw new Error(`prohibited action cannot be approved: ${opts.actionType}`);
  }
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

  if (isProhibitedActionType(opts.actionType)) {
    landosAudit(opts.requestedBy, 'prohibited_action_blocked', `${opts.actionType}: ${opts.title}`, {
      entity: opts.entity ?? null,
      blocked: true,
    });
    return { allowed: false, approvalId: 0, status: 'prohibited' };
  }

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

// ── Market scan cache (Data Center Watch + growth signals) ────────────────

export function saveMarketScan(dealCardId: number, kind: string, payload: unknown): void {
  const db = getLandosDb();
  db.prepare(
    `INSERT INTO landos_market_scan (deal_card_id, kind, payload, created_at)
     VALUES (?, ?, ?, strftime('%s','now'))
     ON CONFLICT (deal_card_id, kind) DO UPDATE SET payload = excluded.payload, created_at = strftime('%s','now')`,
  ).run(dealCardId, kind, JSON.stringify(payload ?? {}));
}

export function loadMarketScan<T>(dealCardId: number, kind: string): { payload: T; createdAt: number } | null {
  const db = getLandosDb();
  const row = db
    .prepare(`SELECT payload, created_at FROM landos_market_scan WHERE deal_card_id = ? AND kind = ?`)
    .get(dealCardId, kind) as { payload: string; created_at: number } | undefined;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload) as T, createdAt: row.created_at };
  } catch {
    return null;
  }
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
