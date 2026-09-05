#!/usr/bin/env node
// Canonicalize duplicate Deal Cards onto one active card.
//
// LandOS may hold ONE active Deal Card per acquisition subject. When intake has
// already produced several, this moves the alias cards' evidence onto the
// canonical card, marks the aliases as archived duplicates that resolve to it,
// and writes a durable audit map. It DELETES NOTHING.
//
//   node scripts/data/landos-canonicalize-subject.mjs \
//     --canonical-deal 90 --alias-deals 114,115 \
//     --canonical-property 80 --alias-properties 95,96 \
//     --subject-key "apn:FL:BRADFORD:00083A03400:whole" [--apply]
//
// Without --apply it prints the dry-run map and writes nothing.
//
// Two classes of row are handled differently, and the distinction is the whole
// safety story:
//   * RELINK  — evidence that is additive on the canonical card (comps,
//               snapshots, research attempts, activity, documents...).
//   * HISTORY — rows that must stay with the card that produced them: the
//               subject link itself and the identity lineage. Relinking those
//               would rewrite the canonical card's own identity history, which
//               is exactly what must never happen.
// A table whose deal_card_id is UNIQUE/PK is also left as history, because one
// canonical row already exists and a second cannot be admitted.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const DB_FILE = path.join(ROOT, 'store', 'landos.db');

// Never relinked: these define a card's own identity and provenance.
const HISTORY_ONLY_TABLES = new Set([
  'landos_deal_card_property',        // which property card this deal's subject is
  'landos_property_identity_version', // the card's own immutable identity lineage
  'landos_property_identity_correction',
]);

const PROPERTY_COLUMNS = ['property_card_id', 'card_id', 'subject_card_id'];

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : 'true';
}

function idList(raw) {
  return String(raw ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

/** deal_card_id is UNIQUE or the primary key -> a second row cannot be admitted. */
function columnIsUnique(db, table, column) {
  const info = db.prepare(`SELECT name, pk FROM pragma_table_info('${table}')`).all();
  if (info.some((c) => c.name === column && c.pk > 0)) return true;
  const indexes = db.prepare(`SELECT name, "unique" AS uniq FROM pragma_index_list('${table}')`).all();
  for (const index of indexes) {
    if (!index.uniq) continue;
    const cols = db.prepare(`SELECT name FROM pragma_index_info('${index.name}')`).all().map((c) => c.name);
    if (cols.length === 1 && cols[0] === column) return true;
  }
  return false;
}

/**
 * Ordering columns that share a composite UNIQUE index with the relink key.
 *
 * `(deal_card_id, version)` and `(deal_card_id, sequence)` encode position
 * within one card's history, not identity, so they are safe to renumber when a
 * row moves. Any other companion column (snapshot_type, input_hash, url_key...)
 * encodes what the artifact IS and must never be rewritten to force a move.
 */
function orderingColumns(db, table, keyColumn) {
  const found = new Set();
  const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name);
  for (const index of db.prepare(`SELECT name, "unique" AS uniq FROM pragma_index_list('${table}')`).all()) {
    if (!index.uniq) continue;
    const icols = db.prepare(`SELECT name FROM pragma_index_info('${index.name}')`).all().map((c) => c.name);
    if (!icols.includes(keyColumn)) continue;
    for (const c of icols) {
      if (c !== keyColumn && (c === 'version' || c === 'sequence') && cols.includes(c)) found.add(c);
    }
  }
  return [...found];
}

function tablesWithColumn(db, column) {
  return db.prepare(`
    SELECT m.name AS tbl FROM sqlite_master m
    JOIN pragma_table_info(m.name) p ON p.name = ?
    WHERE m.type = 'table' AND m.name LIKE 'landos_%'
    ORDER BY m.name
  `).all(column).map((r) => r.tbl);
}

function planFor(db, column, canonicalId, aliasIds) {
  const plan = [];
  const placeholders = aliasIds.map(() => '?').join(',');
  for (const table of tablesWithColumn(db, column)) {
    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" IN (${placeholders})`,
    ).get(...aliasIds).n;
    if (count === 0) continue;
    const historyOnly = HISTORY_ONLY_TABLES.has(table);
    const unique = columnIsUnique(db, table, column);
    plan.push({
      table,
      column,
      rows: count,
      action: historyOnly ? 'retain_as_history' : unique ? 'retain_as_history_unique' : 'relink',
      canonicalId,
    });
  }
  return plan;
}

/**
 * A row moves wholly or stays wholly.
 *
 * Some tables carry BOTH a deal_card_id and a property-card column. If one of
 * them is unique-constrained (so its rows must stay as history) while the other
 * is freely relinkable, relinking only the second would leave a row whose deal
 * points at the alias and whose property points at the canonical card — a
 * half-migrated row that belongs to neither. So a single retain decision on any
 * column demotes the whole table to history.
 */
function reconcileWholeRows(plan) {
  const retained = new Set(plan.filter((p) => p.action !== 'relink').map((p) => p.table));
  return plan.map((step) => (
    step.action === 'relink' && retained.has(step.table)
      ? { ...step, action: 'retain_as_history_row_integrity' }
      : step
  ));
}

function main() {
  const canonicalDeal = Number(flag('canonical-deal'));
  const aliasDeals = idList(flag('alias-deals'));
  const canonicalProperty = Number(flag('canonical-property'));
  const aliasProperties = idList(flag('alias-properties'));
  const subjectKey = flag('subject-key') ?? '';
  const apply = flag('apply') === 'true';

  if (!Number.isInteger(canonicalDeal) || aliasDeals.length === 0 || !subjectKey) {
    throw new Error('usage: --canonical-deal <id> --alias-deals <ids> --canonical-property <id> --alias-properties <ids> --subject-key <key> [--apply]');
  }
  if (aliasDeals.includes(canonicalDeal)) throw new Error('canonical deal card cannot also be an alias');
  if (aliasProperties.includes(canonicalProperty)) throw new Error('canonical property card cannot also be an alias');

  const db = new Database(DB_FILE, { readonly: !apply, fileMustExist: true });
  db.pragma('foreign_keys = ON');

  const entity = db.prepare('SELECT entity FROM landos_deal_card WHERE id = ?').get(canonicalDeal)?.entity;
  if (!entity) throw new Error(`canonical deal card ${canonicalDeal} not found`);

  // Refuse to touch anything that is not the same entity.
  for (const id of aliasDeals) {
    const row = db.prepare('SELECT id, entity FROM landos_deal_card WHERE id = ?').get(id);
    if (!row) throw new Error(`alias deal card ${id} not found`);
    if (row.entity !== entity) throw new Error(`alias deal card ${id} belongs to a different entity (${row.entity})`);
  }

  const dealPlan = planFor(db, 'deal_card_id', canonicalDeal, aliasDeals);
  const propertyPlan = aliasProperties.length && Number.isInteger(canonicalProperty)
    ? PROPERTY_COLUMNS.flatMap((col) => planFor(db, col, canonicalProperty, aliasProperties))
    : [];

  const combined = reconcileWholeRows([...dealPlan, ...propertyPlan]);
  const summary = {
    subjectKey,
    entity,
    canonicalDeal,
    aliasDeals,
    canonicalProperty,
    aliasProperties,
    relink: combined.filter((p) => p.action === 'relink'),
    retainedAsHistory: combined.filter((p) => p.action !== 'relink'),
  };
  summary.totalRowsRelinked = summary.relink.reduce((n, p) => n + p.rows, 0);
  summary.totalRowsRetained = summary.retainedAsHistory.reduce((n, p) => n + p.rows, 0);

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2));
    db.close();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const audit = db.prepare(`
    INSERT INTO landos_canonicalization_audit
      (subject_key, entity, scope, from_kind, from_id, to_kind, to_id, table_name, column_name, rows_relinked, detail, created_at)
    VALUES (@subject_key, @entity, @scope, @from_kind, @from_id, @to_kind, @to_id, @table_name, @column_name, @rows_relinked, @detail, @created_at)
  `);

  const migrate = db.transaction(() => {
    for (const step of summary.relink) {
      const isDeal = step.column === 'deal_card_id';
      const targets = isDeal ? aliasDeals : aliasProperties;
      const target = isDeal ? canonicalDeal : canonicalProperty;

      // Ordering columns (version / sequence) participate in composite UNIQUE
      // indexes purely as position. Renumber the incoming rows to continue after
      // the canonical card's highest value so one chronological history results
      // and position alone can never block a move.
      for (const orderCol of orderingColumns(db, step.table, step.column)) {
        const canonicalMax = db.prepare(
          `SELECT COALESCE(MAX("${orderCol}"), 0) AS m FROM "${step.table}" WHERE "${step.column}" = ?`,
        ).get(target).m;
        const globalMax = db.prepare(`SELECT COALESCE(MAX("${orderCol}"), 0) AS m FROM "${step.table}"`).get().m;
        // Not every table carries created_at; rowid preserves insertion order.
        const hasCreatedAt = db.prepare(`SELECT name FROM pragma_table_info('${step.table}')`)
          .all().some((c) => c.name === 'created_at');
        const chronological = hasCreatedAt ? 'COALESCE(created_at, 0), rowid' : 'rowid';
        const incoming = db.prepare(
          `SELECT rowid AS rid FROM "${step.table}" WHERE "${step.column}" IN (${targets.map(() => '?').join(',')})
            ORDER BY ${chronological}`,
        ).all(...targets);
        // Park the incoming rows in a range above every value the table holds.
        // Renumbering in place would collide with the alias card's OWN rows,
        // which still occupy the low positions until they move.
        const parkBase = globalMax + 100000;
        incoming.forEach((row, i) => {
          db.prepare(`UPDATE "${step.table}" SET "${orderCol}" = ? WHERE rowid = ?`).run(parkBase + i + 1, row.rid);
        });
        step.parked = step.parked ?? [];
        step.parked.push({ orderCol, canonicalMax, rids: incoming.map((r) => r.rid) });
      }

      for (const from of targets) {
        // Row by row inside a savepoint: a row that genuinely collides with an
        // artifact the canonical card already holds (same snapshot_type, same
        // input_hash, same idempotency key...) is NOT forced over the top of it.
        // It stays on the alias as labeled history and is counted, so a merge
        // conflict is visible rather than silently resolved by overwrite.
        const rows = db.prepare(
          `SELECT rowid AS rid FROM "${step.table}" WHERE "${step.column}" = ? ORDER BY rowid`,
        ).all(from);
        let moved = 0;
        let conflicted = 0;
        let immutable = 0;
        for (const row of rows) {
          try {
            db.exec('SAVEPOINT relink_row');
            db.prepare(`UPDATE "${step.table}" SET "${step.column}" = ? WHERE rowid = ?`).run(target, row.rid);
            db.exec('RELEASE relink_row');
            moved += 1;
          } catch (error) {
            db.exec('ROLLBACK TO relink_row');
            db.exec('RELEASE relink_row');
            const code = String(error?.code ?? '');
            // UNIQUE: the canonical card already holds this artifact.
            // TRIGGER: the row is deliberately immutable (intake artifacts and
            // submissions are write-once provenance). Neither is forced: the row
            // stays on the alias, which resolves to the canonical card.
            if (code !== 'SQLITE_CONSTRAINT_UNIQUE' && code !== 'SQLITE_CONSTRAINT_TRIGGER') throw error;
            if (code === 'SQLITE_CONSTRAINT_TRIGGER') immutable += 1; else conflicted += 1;
          }
        }
        if (moved === 0 && conflicted === 0 && immutable === 0) continue;
        audit.run({
          subject_key: subjectKey,
          entity,
          scope: isDeal ? 'deal_card' : 'property_card',
          from_kind: isDeal ? 'deal_card' : 'property_card',
          from_id: from,
          to_kind: isDeal ? 'deal_card' : 'property_card',
          to_id: target,
          table_name: step.table,
          column_name: step.column,
          rows_relinked: moved,
          detail: conflicted === 0 && immutable === 0
            ? 'relinked to canonical acquisition subject'
            : `relinked ${moved} row(s); ${conflicted} conflicting and ${immutable} immutable row(s) retained on the alias as labeled history`,
          created_at: now,
        });
        step.movedRows = (step.movedRows ?? 0) + moved;
        step.conflictRows = (step.conflictRows ?? 0) + conflicted;
        step.immutableRows = (step.immutableRows ?? 0) + immutable;
      }

      // Close the parked range back up so the canonical card ends with one
      // continuous chronological history rather than a gap at 100000+.
      for (const parked of step.parked ?? []) {
        const moved = db.prepare(
          `SELECT rowid AS rid FROM "${step.table}"
            WHERE "${step.column}" = ? AND "${parked.orderCol}" > ?
            ORDER BY "${parked.orderCol}"`,
        ).all(target, parked.canonicalMax + 90000);
        moved.forEach((row, i) => {
          db.prepare(`UPDATE "${step.table}" SET "${parked.orderCol}" = ? WHERE rowid = ?`)
            .run(parked.canonicalMax + i + 1, row.rid);
        });
      }
    }

    for (const step of summary.retainedAsHistory) {
      audit.run({
        subject_key: subjectKey,
        entity,
        scope: step.column === 'deal_card_id' ? 'deal_card' : 'property_card',
        from_kind: 'table',
        from_id: 0,
        to_kind: 'history',
        to_id: 0,
        table_name: step.table,
        column_name: step.column,
        rows_relinked: 0,
        detail: `${step.rows} row(s) retained on the alias record as labeled history (${step.action})`,
        created_at: now,
      });
    }

    for (const from of aliasDeals) {
      db.prepare(`
        UPDATE landos_deal_card
           SET canonical_deal_card_id = ?, archived_as_duplicate_at = ?, updated_at = ?
         WHERE id = ?
      `).run(canonicalDeal, now, now, from);
      audit.run({
        subject_key: subjectKey,
        entity,
        scope: 'deal_card',
        from_kind: 'deal_card',
        from_id: from,
        to_kind: 'canonical_deal_card',
        to_id: canonicalDeal,
        table_name: 'landos_deal_card',
        column_name: 'canonical_deal_card_id',
        rows_relinked: 1,
        detail: 'archived as duplicate alias of the canonical Deal Card',
        created_at: now,
      });
    }

    for (const from of aliasProperties) {
      db.prepare(`
        UPDATE landos_property_card
           SET canonical_property_card_id = ?, archived_as_duplicate_at = ?, updated_at = ?
         WHERE id = ?
      `).run(canonicalProperty, now, now, from);
      audit.run({
        subject_key: subjectKey,
        entity,
        scope: 'property_card',
        from_kind: 'property_card',
        from_id: from,
        to_kind: 'canonical_property_card',
        to_id: canonicalProperty,
        table_name: 'landos_property_card',
        column_name: 'canonical_property_card_id',
        rows_relinked: 1,
        detail: 'archived as duplicate alias of the canonical property card',
        created_at: now,
      });
    }

    // The canonical records must never point at anything.
    db.prepare('UPDATE landos_deal_card SET canonical_deal_card_id = NULL, archived_as_duplicate_at = NULL WHERE id = ?')
      .run(canonicalDeal);
    if (Number.isInteger(canonicalProperty)) {
      db.prepare('UPDATE landos_property_card SET canonical_property_card_id = NULL, archived_as_duplicate_at = NULL WHERE id = ?')
        .run(canonicalProperty);
    }
  });

  migrate();
  const violations = db.pragma('foreign_key_check');
  if (violations.length > 0) throw new Error(`foreign key violations after migration: ${JSON.stringify(violations)}`);
  console.log(JSON.stringify({ mode: 'applied', ...summary, foreignKeyViolations: 0 }, null, 2));
  db.close();
}

main();
