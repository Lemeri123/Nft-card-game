/**
 * AuditLogger property tests — Properties 7 and 8
 *
 * We use an in-memory SQLite database (':memory:') so tests are fast,
 * isolated, and don't touch the real data/game.db file.
 *
 * Property 7: Audit entries contain required fields
 * For any completed operation, the stored entry must have a non-empty
 * transactionId, at least one accountId, a valid timestamp, and a
 * recognized type.
 *
 * Property 8: Player history is ordered by timestamp descending
 * For any player with multiple entries, getPlayerHistory returns them
 * with each timestamp >= the next (newest first).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { logTransaction, getPlayerHistory, markTimedOut } from './auditLogger.js';

const VALID_TYPES = ['mint', 'distribute', 'trade', 'purchase', 'duel', 'associate'];

// Create a fresh in-memory DB for each test
function makeMemDb() {
  const memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE audit_log (
      transactionId TEXT PRIMARY KEY,
      type          TEXT,
      accountIds    TEXT,
      serialNumbers TEXT,
      timestamp     INTEGER,
      status        TEXT DEFAULT 'confirmed'
    )
  `);
  return memDb;
}

describe('AuditLogger', () => {
  let memDb;

  beforeEach(() => {
    memDb = makeMemDb();
  });

  // Feature: nft-card-game, Property 7: Audit entries contain required fields
  it('Property 7: stored entries always have required fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          transactionId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          type: fc.constantFrom(...VALID_TYPES),
          accountId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          serialNumber: fc.integer({ min: 1, max: 9999 }),
          timestamp: fc.integer({ min: 1 }),
        }),
        ({ transactionId, type, accountId, serialNumber, timestamp }) => {
          logTransaction({
            transactionId,
            type,
            accountIds: JSON.stringify([accountId]),
            serialNumbers: JSON.stringify([serialNumber]),
            timestamp,
            status: 'confirmed',
          }, memDb);

          const row = memDb.prepare('SELECT * FROM audit_log WHERE transactionId = ?').get(transactionId);

          // Required fields must be present and non-empty
          expect(row.transactionId.trim().length).toBeGreaterThan(0);
          expect(VALID_TYPES).toContain(row.type);
          expect(row.timestamp).toBeGreaterThan(0);

          const accounts = JSON.parse(row.accountIds);
          expect(Array.isArray(accounts)).toBe(true);
          expect(accounts.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: nft-card-game, Property 8: Player history is ordered by timestamp descending
  it('Property 8: getPlayerHistory returns entries newest-first', () => {
    fc.assert(
      fc.property(
        // Generate 2-10 distinct timestamps
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 10 })
          .map((arr) => [...new Set(arr)]) // deduplicate
          .filter((arr) => arr.length >= 2),
        (timestamps) => {
          const freshDb = makeMemDb();
          const accountId = '0.0.TEST';

          timestamps.forEach((ts, i) => {
            logTransaction({
              transactionId: `tx-${ts}-${i}`,
              type: 'mint',
              accountIds: JSON.stringify([accountId]),
              serialNumbers: JSON.stringify([i + 1]),
              timestamp: ts,
              status: 'confirmed',
            }, freshDb);
          });

          const history = getPlayerHistory(accountId, freshDb);

          // Verify descending order
          for (let i = 0; i < history.length - 1; i++) {
            expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i + 1].timestamp);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('markTimedOut updates the status to timed_out', () => {
    logTransaction({
      transactionId: 'tx-timeout-test',
      type: 'mint',
      accountIds: JSON.stringify(['0.0.1']),
      serialNumbers: JSON.stringify([1]),
      timestamp: Date.now(),
      status: 'confirmed',
    }, memDb);

    markTimedOut('tx-timeout-test', memDb);

    const row = memDb.prepare('SELECT status FROM audit_log WHERE transactionId = ?').get('tx-timeout-test');
    expect(row.status).toBe('timed_out');
  });
});
