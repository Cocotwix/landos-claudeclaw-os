// LandOS — durable ACCESS knowledge for one official deployment.
//
// "This host wants a free login" is method knowledge about a platform, not
// evidence about a property. It is filed by provider family and host, and it
// deliberately holds no parcel id, owner, address, acreage or deal reference —
// the same shared/isolated boundary the GIS knowledge store enforces, restated
// here because this table sits next to a credential registry and the cost of
// blurring the two is high.
//
// It survives refresh and restart so a second property in the same county
// starts from what the first one learned instead of probing again.

import type Database from 'better-sqlite3';
import { getLandosDb } from './db.js';
import {
  normalizeAccessTarget,
  type AccessRequirement,
  type AccessTarget,
  type RegistrationAvailability,
} from './public-record-access-types.js';
import { mergeAuthDetections, type AuthDetection } from './public-record-auth-detection.js';

export interface DeploymentAccessKnowledge {
  providerFamily: string;
  deploymentDomain: string;
  requirement: AccessRequirement;
  registration: RegistrationAvailability;
  loginUrl: string | null;
  registrationUrl: string | null;
  paidRecordsObserved: boolean;
  signals: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  observations: number;
}

/** Property-shaped fields must never reach this table. */
const PROPERTY_EVIDENCE = /\b(parcel\s?id|apn|owner|acre|deal[_\s-]?card|\bpin\b|address)\b/i;

export function assertNoPropertyEvidence(record: DeploymentAccessKnowledge): void {
  for (const value of [record.providerFamily, record.deploymentDomain, record.loginUrl ?? '', record.registrationUrl ?? '']) {
    if (PROPERTY_EVIDENCE.test(String(value))) {
      throw new Error('Access knowledge is shared platform knowledge and cannot hold property evidence.');
    }
  }
}

export class PublicRecordAccessStore {
  constructor(private readonly db: Database.Database = getLandosDb()) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS landos_public_record_access (
        provider_family      TEXT NOT NULL,
        deployment_domain    TEXT NOT NULL,
        requirement          TEXT NOT NULL,
        registration         TEXT NOT NULL,
        login_url            TEXT,
        registration_url     TEXT,
        paid_records         INTEGER NOT NULL DEFAULT 0,
        signals_json         TEXT NOT NULL DEFAULT '[]',
        first_observed_at    TEXT NOT NULL,
        last_observed_at     TEXT NOT NULL,
        observations         INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (provider_family, deployment_domain)
      );
    `);
  }

  get(target: Pick<AccessTarget, 'providerFamily' | 'deploymentDomain'>): DeploymentAccessKnowledge | null {
    const t = normalizeAccessTarget({ ...target, jurisdiction: '' });
    const row = this.db.prepare(
      'SELECT * FROM landos_public_record_access WHERE provider_family = ? AND deployment_domain = ?',
    ).get(t.providerFamily, t.deploymentDomain);
    return row ? fromRow(row as Record<string, unknown>) : null;
  }

  /** By host alone, for the operator panel, which knows the URL but not the family. */
  getByDomain(domain: string): DeploymentAccessKnowledge | null {
    const host = normalizeAccessTarget({ providerFamily: '', deploymentDomain: domain, jurisdiction: '' }).deploymentDomain;
    if (!host) return null;
    const row = this.db.prepare(
      'SELECT * FROM landos_public_record_access WHERE deployment_domain = ? ORDER BY observations DESC, last_observed_at DESC',
    ).get(host);
    return row ? fromRow(row as Record<string, unknown>) : null;
  }

  /**
   * Fold one observation into what is already known.
   *
   * Merging is not "last write wins": a host that once answered without an
   * account demonstrably does not require one, and a paid signal never
   * downgrades to free.
   */
  observe(target: Pick<AccessTarget, 'providerFamily' | 'deploymentDomain'>, detection: AuthDetection, at: string): DeploymentAccessKnowledge {
    const t = normalizeAccessTarget({ ...target, jurisdiction: '' });
    if (!t.deploymentDomain) throw new Error('Access knowledge requires a deployment host.');
    const previous = this.get(t);
    const merged = mergeAuthDetections(previous ? toDetection(previous) : null, detection);
    const record: DeploymentAccessKnowledge = {
      providerFamily: t.providerFamily,
      deploymentDomain: t.deploymentDomain,
      requirement: merged.requirement,
      registration: merged.registration,
      loginUrl: merged.loginUrl,
      registrationUrl: merged.registrationUrl,
      paidRecordsObserved: merged.paidRecordsObserved,
      signals: merged.signals,
      firstObservedAt: previous?.firstObservedAt ?? at,
      lastObservedAt: at,
      observations: (previous?.observations ?? 0) + 1,
    };
    assertNoPropertyEvidence(record);
    this.db.prepare(`
      INSERT INTO landos_public_record_access (
        provider_family, deployment_domain, requirement, registration, login_url, registration_url,
        paid_records, signals_json, first_observed_at, last_observed_at, observations
      ) VALUES (@providerFamily, @deploymentDomain, @requirement, @registration, @loginUrl, @registrationUrl,
        @paidRecords, @signalsJson, @firstObservedAt, @lastObservedAt, @observations)
      ON CONFLICT(provider_family, deployment_domain) DO UPDATE SET
        requirement = excluded.requirement,
        registration = excluded.registration,
        login_url = excluded.login_url,
        registration_url = excluded.registration_url,
        paid_records = excluded.paid_records,
        signals_json = excluded.signals_json,
        last_observed_at = excluded.last_observed_at,
        observations = excluded.observations
    `).run({
      ...record,
      paidRecords: record.paidRecordsObserved ? 1 : 0,
      signalsJson: JSON.stringify(record.signals),
    });
    return this.get(t)!;
  }
}

export function toDetection(record: DeploymentAccessKnowledge): AuthDetection {
  return {
    requirement: record.requirement,
    registration: record.registration,
    loginUrl: record.loginUrl,
    registrationUrl: record.registrationUrl,
    paidRecordsObserved: record.paidRecordsObserved,
    signals: record.signals,
  };
}

function fromRow(row: Record<string, unknown>): DeploymentAccessKnowledge {
  let signals: string[] = [];
  try { signals = JSON.parse(String(row.signals_json ?? '[]')) as string[]; } catch { signals = []; }
  return {
    providerFamily: String(row.provider_family),
    deploymentDomain: String(row.deployment_domain),
    requirement: String(row.requirement) as AccessRequirement,
    registration: String(row.registration) as RegistrationAvailability,
    loginUrl: row.login_url == null ? null : String(row.login_url),
    registrationUrl: row.registration_url == null ? null : String(row.registration_url),
    paidRecordsObserved: Number(row.paid_records) === 1,
    signals: Array.isArray(signals) ? signals : [],
    firstObservedAt: String(row.first_observed_at),
    lastObservedAt: String(row.last_observed_at),
    observations: Number(row.observations ?? 1),
  };
}
