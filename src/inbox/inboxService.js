'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

/**
 * InboxService — per-player notification inbox
 *
 * Stores game event notifications (duel challenges, resolutions, new messages)
 * for each player account. All functions accept _deps for test injection.
 */

/**
 * Creates a new notification for a player.
 *
 * @param {object} options
 * @param {string} options.recipientAccountId
 * @param {string} options.type - e.g. 'DUEL_CHALLENGE', 'DUEL_EXPIRED', 'DUEL_RESOLVED', 'NEW_MESSAGE'
 * @param {object} options.payload - JSON-serializable payload object
 * @param {object} [options._deps]
 * @returns {{ notificationId, recipientAccountId, type, payload, read, createdAt }}
 */
function createNotification({ recipientAccountId, type, payload, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;
  const notificationId = uuidv4();
  const createdAt = Date.now();
  const payloadJson = JSON.stringify(payload);

  dbInstance.prepare(`
    INSERT INTO notifications (notificationId, recipientAccountId, type, payload, read, createdAt)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(notificationId, recipientAccountId, type, payloadJson, createdAt);

  return {
    notificationId,
    recipientAccountId,
    type,
    payload,
    read: false,
    createdAt,
  };
}

/**
 * Returns all notifications for an account, unread first then read,
 * both groups ordered by createdAt descending.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {Array}
 */
function getNotifications({ accountId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  const rows = dbInstance.prepare(`
    SELECT * FROM notifications
    WHERE recipientAccountId = ?
    ORDER BY read ASC, createdAt DESC
  `).all(accountId);

  return rows.map((row) => ({
    ...row,
    payload: JSON.parse(row.payload),
    read: row.read === 1,
  }));
}

/**
 * Marks a single notification as read.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {string} options.notificationId
 * @param {object} [options._deps]
 * @returns {{ notificationId, read: true }}
 */
function markRead({ accountId, notificationId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  dbInstance.prepare(`
    UPDATE notifications SET read = 1
    WHERE notificationId = ? AND recipientAccountId = ?
  `).run(notificationId, accountId);

  return { notificationId, read: true };
}

/**
 * Deletes all read notifications for an account.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {{ deleted: number }}
 */
function clearRead({ accountId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  const result = dbInstance.prepare(`
    DELETE FROM notifications
    WHERE recipientAccountId = ? AND read = 1
  `).run(accountId);

  return { deleted: result.changes };
}

module.exports = { createNotification, getNotifications, markRead, clearRead };
