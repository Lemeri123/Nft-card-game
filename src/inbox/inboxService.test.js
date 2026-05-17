/**
 * InboxService tests — Properties 1 + 2 and unit tests
 *
 * Property 1: Unread-first ordering
 * For any mix of read and unread notifications, getNotifications always
 * returns all unread entries before any read entry.
 *
 * Property 2: Mark-read idempotency
 * Calling markRead on the same notificationId twice returns { read: true }
 * both times without throwing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createNotification, getNotifications, markRead, clearRead } from './inboxService.js';

// In-memory SQLite database for tests
import Database from 'better-sqlite3';

function makeTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notifications (
      notificationId      TEXT PRIMARY KEY,
      recipientAccountId  TEXT NOT NULL,
      type                TEXT NOT NULL,
      payload             TEXT NOT NULL,
      read                INTEGER NOT NULL DEFAULT 0,
      createdAt           INTEGER NOT NULL
    );
  `);
  return db;
}

describe('InboxService — createNotification', () => {
  it('3.1: stores notification with correct fields and read = false', () => {
    const db = makeTestDb();
    const result = createNotification({
      recipientAccountId: '0.0.100',
      type: 'DUEL_CHALLENGE',
      payload: { duelId: 'duel-1', challengerAccountId: '0.0.200' },
      _deps: { db },
    });

    expect(result.notificationId).toBeTruthy();
    expect(result.recipientAccountId).toBe('0.0.100');
    expect(result.type).toBe('DUEL_CHALLENGE');
    expect(result.payload).toEqual({ duelId: 'duel-1', challengerAccountId: '0.0.200' });
    expect(result.read).toBe(false);
    expect(typeof result.createdAt).toBe('number');
  });
});

describe('InboxService — getNotifications', () => {
  it('3.2: returns empty array when no notifications exist', () => {
    const db = makeTestDb();
    const result = getNotifications({ accountId: '0.0.999', _deps: { db } });
    expect(result).toEqual([]);
  });

  // Feature: player-inbox-and-notifications, Property 1: Unread-first ordering
  it('Property 1: unread notifications always come before read ones', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 10 }),
        (readFlags) => {
          const db = makeTestDb();
          const accountId = '0.0.test';

          // Insert notifications with alternating read/unread states
          readFlags.forEach((isRead, i) => {
            const n = createNotification({
              recipientAccountId: accountId,
              type: 'DUEL_CHALLENGE',
              payload: { index: i },
              _deps: { db },
            });
            if (isRead) {
              markRead({ accountId, notificationId: n.notificationId, _deps: { db } });
            }
          });

          const notifications = getNotifications({ accountId, _deps: { db } });

          // Find the index of the first read notification
          const firstReadIdx = notifications.findIndex((n) => n.read === true);
          // All notifications after the first read one must also be read
          if (firstReadIdx !== -1) {
            for (let i = firstReadIdx; i < notifications.length; i++) {
              expect(notifications[i].read).toBe(true);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('InboxService — markRead', () => {
  // Feature: player-inbox-and-notifications, Property 2: Mark-read idempotency
  it('Property 2: calling markRead twice returns { read: true } both times without throwing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (suffix) => {
          const db = makeTestDb();
          const accountId = `0.0.${suffix.replace(/[^a-z0-9]/gi, '1')}`;
          const n = createNotification({
            recipientAccountId: accountId,
            type: 'NEW_MESSAGE',
            payload: { messageId: 'msg-1' },
            _deps: { db },
          });

          const result1 = markRead({ accountId, notificationId: n.notificationId, _deps: { db } });
          const result2 = markRead({ accountId, notificationId: n.notificationId, _deps: { db } });

          expect(result1).toEqual({ notificationId: n.notificationId, read: true });
          expect(result2).toEqual({ notificationId: n.notificationId, read: true });
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('InboxService — clearRead', () => {
  it('3.5: only deletes read notifications, leaves unread intact', () => {
    const db = makeTestDb();
    const accountId = '0.0.clear-test';

    const n1 = createNotification({ recipientAccountId: accountId, type: 'DUEL_CHALLENGE', payload: {}, _deps: { db } });
    const n2 = createNotification({ recipientAccountId: accountId, type: 'DUEL_RESOLVED', payload: {}, _deps: { db } });
    const n3 = createNotification({ recipientAccountId: accountId, type: 'NEW_MESSAGE', payload: {}, _deps: { db } });

    // Mark n1 and n2 as read, leave n3 unread
    markRead({ accountId, notificationId: n1.notificationId, _deps: { db } });
    markRead({ accountId, notificationId: n2.notificationId, _deps: { db } });

    const { deleted } = clearRead({ accountId, _deps: { db } });
    expect(deleted).toBe(2);

    const remaining = getNotifications({ accountId, _deps: { db } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].notificationId).toBe(n3.notificationId);
    expect(remaining[0].read).toBe(false);
  });
});
