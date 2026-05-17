/**
 * ChatService tests — Properties 3–6 and unit tests
 *
 * Property 3: Self-message rejection
 * Property 4: Body length invariant
 * Property 5: Message integrity
 * Property 6: Conversation symmetry
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sendMessage, getMessages, getConversation, markMessageRead } from './chatService.js';
import Database from 'better-sqlite3';

function makeTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chat_messages (
      messageId           TEXT PRIMARY KEY,
      senderAccountId     TEXT NOT NULL,
      recipientAccountId  TEXT NOT NULL,
      body                TEXT NOT NULL,
      read                INTEGER NOT NULL DEFAULT 0,
      createdAt           INTEGER NOT NULL
    );
  `);
  return db;
}

describe('ChatService — sendMessage', () => {
  it('5.1: stored message has correct fields', () => {
    const db = makeTestDb();
    const result = sendMessage({
      senderAccountId: '0.0.100',
      recipientAccountId: '0.0.200',
      body: 'Hello!',
      _deps: { db },
    });

    expect(result.messageId).toBeTruthy();
    expect(result.senderAccountId).toBe('0.0.100');
    expect(result.recipientAccountId).toBe('0.0.200');
    expect(result.body).toBe('Hello!');
    expect(result.read).toBe(false);
    expect(typeof result.createdAt).toBe('number');
  });

  // Feature: player-inbox-and-notifications, Property 3: Self-message rejection
  it('Property 3: sendMessage with same sender and recipient always throws SELF_MESSAGE', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^0\.0\.[1-9][0-9]{0,6}$/),
        (accountId) => {
          const db = makeTestDb();
          expect(() =>
            sendMessage({ senderAccountId: accountId, recipientAccountId: accountId, body: 'hi', _deps: { db } })
          ).toThrow('SELF_MESSAGE');
        }
      ),
      { numRuns: 30 }
    );
  });

  // Feature: player-inbox-and-notifications, Property 4: Body length invariant
  it('Property 4a: body over 1000 chars always throws MESSAGE_TOO_LONG', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1001, maxLength: 2000 }),
        (longBody) => {
          const db = makeTestDb();
          expect(() =>
            sendMessage({ senderAccountId: '0.0.1', recipientAccountId: '0.0.2', body: longBody, _deps: { db } })
          ).toThrow('MESSAGE_TOO_LONG');
        }
      ),
      { numRuns: 30 }
    );
  });

  it('Property 4b: whitespace-only body always throws EMPTY_MESSAGE', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\s+$/),
        (whitespaceBody) => {
          const db = makeTestDb();
          expect(() =>
            sendMessage({ senderAccountId: '0.0.1', recipientAccountId: '0.0.2', body: whitespaceBody, _deps: { db } })
          ).toThrow('EMPTY_MESSAGE');
        }
      ),
      { numRuns: 20 }
    );
  });

  it('empty string body throws EMPTY_MESSAGE', () => {
    const db = makeTestDb();
    expect(() =>
      sendMessage({ senderAccountId: '0.0.1', recipientAccountId: '0.0.2', body: '', _deps: { db } })
    ).toThrow('EMPTY_MESSAGE');
  });
});

describe('ChatService — getConversation', () => {
  // Feature: player-inbox-and-notifications, Property 5: Message integrity
  it('Property 5: retrieved message has identical fields to what was sent', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }).filter((s) => s.trim().length > 0),
        (body) => {
          const db = makeTestDb();
          const sent = sendMessage({
            senderAccountId: '0.0.A',
            recipientAccountId: '0.0.B',
            body,
            _deps: { db },
          });

          const conversation = getConversation({ accountId: '0.0.A', otherAccountId: '0.0.B', _deps: { db } });
          expect(conversation).toHaveLength(1);
          expect(conversation[0].senderAccountId).toBe(sent.senderAccountId);
          expect(conversation[0].recipientAccountId).toBe(sent.recipientAccountId);
          expect(conversation[0].body).toBe(sent.body);
        }
      ),
      { numRuns: 30 }
    );
  });

  // Feature: player-inbox-and-notifications, Property 6: Conversation symmetry
  it('Property 6: getConversation(A,B) returns same messageIds as getConversation(B,A)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            fromA: fc.boolean(),
            body: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (messages) => {
          const db = makeTestDb();
          for (const { fromA, body } of messages) {
            sendMessage({
              senderAccountId: fromA ? '0.0.A' : '0.0.B',
              recipientAccountId: fromA ? '0.0.B' : '0.0.A',
              body,
              _deps: { db },
            });
          }

          const convAB = getConversation({ accountId: '0.0.A', otherAccountId: '0.0.B', _deps: { db } });
          const convBA = getConversation({ accountId: '0.0.B', otherAccountId: '0.0.A', _deps: { db } });

          const idsAB = convAB.map((m) => m.messageId).sort();
          const idsBA = convBA.map((m) => m.messageId).sort();
          expect(idsAB).toEqual(idsBA);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('ChatService — markMessageRead', () => {
  it('marks a message as read and returns { messageId, read: true }', () => {
    const db = makeTestDb();
    const msg = sendMessage({
      senderAccountId: '0.0.1',
      recipientAccountId: '0.0.2',
      body: 'test',
      _deps: { db },
    });

    const result = markMessageRead({ accountId: '0.0.2', messageId: msg.messageId, _deps: { db } });
    expect(result).toEqual({ messageId: msg.messageId, read: true });

    const messages = getMessages({ accountId: '0.0.2', _deps: { db } });
    expect(messages[0].read).toBe(true);
  });
});
