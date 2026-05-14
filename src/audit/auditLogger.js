'use strict';

/**
 * AuditLogger — records every on-chain operation to the local database
 *
 * Every time a card is minted, transferred, traded, or used in a duel,
 * we write an entry here. This gives players a verifiable history they
 * can cross-check against HashScan (Hedera's block explorer).
 *
 * Why keep a local audit log if everything is on-chain?
 * The Mirror Node has the full history, but querying it for every request
 * is slow and rate-limited. The local log is a fast cache of events we
 * care about, enriched with game-specific context (duel outcomes, etc.).
 */

const { db } = require('../db/database');

/**
 * Records an on-chain operation in the audit log.
 *
 * @param {object} entry
 * @param {string} entry.transactionId
 * @param {string} entry.type - 'mint'|'distribute'|'trade'|'purchase'|'duel'|'associate'
 * @param {string} entry.accountIds - JSON array string of involved account IDs
 * @param {string} entry.serialNumbers - JSON array string of involved serial numbers
 * @param {number} entry.timestamp - Unix ms
 * @param {string} [entry.status] - 'confirmed'|'timed_out'|'failed'
 * @param {object} [_db] - Injectable db for testing
 */
function logTransaction(entry, _db) {
  const dbInstance = _db || db;
  dbInstance.prepare(`
    INSERT OR REPLACE INTO audit_log (transactionId, type, accountIds, serialNumbers, timestamp, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.transactionId,
    entry.type,
    entry.accountIds,
    entry.serialNumbers,
    entry.timestamp,
    entry.status || 'confirmed'
  );
}

/**
 * Returns all audit log entries for a given account, newest first.
 *
 * @param {string} accountId
 * @param {object} [_db]
 * @returns {object[]}
 */
function getPlayerHistory(accountId, _db) {
  const dbInstance = _db || db;
  const rows = dbInstance.prepare(`
    SELECT * FROM audit_log
    WHERE accountIds LIKE ?
    ORDER BY timestamp DESC
  `).all(`%${accountId}%`);

  return rows.map((row) => ({
    ...row,
    accountIds: JSON.parse(row.accountIds),
    serialNumbers: JSON.parse(row.serialNumbers),
  }));
}

/**
 * Marks a transaction as timed out in the audit log.
 *
 * @param {string} transactionId
 * @param {object} [_db]
 */
function markTimedOut(transactionId, _db) {
  const dbInstance = _db || db;
  dbInstance.prepare(
    "UPDATE audit_log SET status = 'timed_out' WHERE transactionId = ?"
  ).run(transactionId);
}

module.exports = { logTransaction, getPlayerHistory, markTimedOut };
