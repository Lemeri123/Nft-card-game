'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');

/**
 * ChatService — player-to-player direct messaging
 *
 * Players send and receive messages identified by their Hedera accountId.
 * All functions accept _deps for test injection.
 */

/**
 * Sends a direct message from one player to another.
 *
 * @param {object} options
 * @param {string} options.senderAccountId
 * @param {string} options.recipientAccountId
 * @param {string} options.body - max 1000 characters
 * @param {object} [options._deps]
 * @returns {{ messageId, senderAccountId, recipientAccountId, body, read, createdAt }}
 */
function sendMessage({ senderAccountId, recipientAccountId, body, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  if (senderAccountId === recipientAccountId) {
    const err = new Error('SELF_MESSAGE: cannot send a message to yourself');
    err.code = 'SELF_MESSAGE';
    throw err;
  }

  if (!body || body.trim() === '') {
    const err = new Error('EMPTY_MESSAGE: message body cannot be empty');
    err.code = 'EMPTY_MESSAGE';
    throw err;
  }

  if (body.length > 1000) {
    const err = new Error('MESSAGE_TOO_LONG: message body cannot exceed 1000 characters');
    err.code = 'MESSAGE_TOO_LONG';
    throw err;
  }

  const messageId = uuidv4();
  const createdAt = Date.now();

  dbInstance.prepare(`
    INSERT INTO chat_messages (messageId, senderAccountId, recipientAccountId, body, read, createdAt)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(messageId, senderAccountId, recipientAccountId, body, createdAt);

  return {
    messageId,
    senderAccountId,
    recipientAccountId,
    body,
    read: false,
    createdAt,
  };
}

/**
 * Returns all messages received by an account, unread first then read,
 * both groups ordered by createdAt descending.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {Array}
 */
function getMessages({ accountId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  const rows = dbInstance.prepare(`
    SELECT * FROM chat_messages
    WHERE recipientAccountId = ?
    ORDER BY read ASC, createdAt DESC
  `).all(accountId);

  return rows.map((row) => ({ ...row, read: row.read === 1 }));
}

/**
 * Returns all messages exchanged between two accounts in both directions,
 * ordered by createdAt ascending (chronological).
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {string} options.otherAccountId
 * @param {object} [options._deps]
 * @returns {Array}
 */
function getConversation({ accountId, otherAccountId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  const rows = dbInstance.prepare(`
    SELECT * FROM chat_messages
    WHERE (senderAccountId = ? AND recipientAccountId = ?)
       OR (senderAccountId = ? AND recipientAccountId = ?)
    ORDER BY createdAt ASC
  `).all(accountId, otherAccountId, otherAccountId, accountId);

  return rows.map((row) => ({ ...row, read: row.read === 1 }));
}

/**
 * Marks a single message as read.
 *
 * @param {object} options
 * @param {string} options.accountId - must be the recipient
 * @param {string} options.messageId
 * @param {object} [options._deps]
 * @returns {{ messageId, read: true }}
 */
function markMessageRead({ accountId, messageId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  dbInstance.prepare(`
    UPDATE chat_messages SET read = 1
    WHERE messageId = ? AND recipientAccountId = ?
  `).run(messageId, accountId);

  return { messageId, read: true };
}

module.exports = { sendMessage, getMessages, getConversation, markMessageRead };
