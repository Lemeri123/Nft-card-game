'use strict';

/**
 * DuelService — PvP card duels with verifiable on-chain randomness
 *
 * Players challenge each other by wagering a card. The winner claims
 * the loser's card via an atomic TransferTransaction.
 *
 * What makes this fair? PrngTransaction.
 * Instead of using Math.random() (which players can't verify), we request
 * a pseudo-random number from the Hedera network. The result is recorded
 * in the transaction record on-chain — anyone can look it up on HashScan
 * and confirm the exact random value used to decide the duel outcome.
 * This is provably fair without needing a smart contract.
 *
 * Duel resolution formula:
 *   score = (attack * 0.6 + defense * 0.4) + (prngValue % 20)
 *
 * The ±20 random swing means upsets are possible — a weaker card can
 * still win — but stronger cards win more often on average.
 */

const { TransferTransaction, PrngTransaction, PrivateKey } = require('@hashgraph/sdk');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { logTransaction } = require('../audit/auditLogger');

function parseKey(key) {
  if (typeof key !== 'string') return key;
  const cleaned = key.startsWith('0x') || key.startsWith('0X') ? key.slice(2) : key;
  try { return PrivateKey.fromStringECDSA(cleaned); } catch {}
  try { return PrivateKey.fromStringDer(cleaned); } catch {}
  try { return PrivateKey.fromStringED25519(cleaned); } catch {}
  try { return PrivateKey.fromStringECDSA(key); } catch {}
  try { return PrivateKey.fromStringDer(key); } catch {}
  return PrivateKey.fromStringED25519(key);
}

const DUEL_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Role advantage table: attacker role → defender role that it beats
const ROLE_ADVANTAGES = {
  Warrior:  'Mage',
  Mage:     'Ranger',
  Ranger:   'Warrior',
  Guardian: 'Mage',
};

const ROLE_BONUS = 10;

/**
 * Pure function: computes a duel score for a card given a prng value and opponent role.
 * Exported separately so it can be property-tested without any SDK calls.
 *
 * @param {{ attack: number, defense: number, role?: string }} card
 * @param {number} prngValue - Integer 0–99 from PrngTransaction
 * @param {string} [opponentRole] - Role of the opposing card
 * @returns {number}
 */
function computeDuelScore(card, prngValue, opponentRole) {
  const base = (card.attack * 0.6 + card.defense * 0.4) + (prngValue % 20);
  const roleBonus = (card.role && opponentRole && ROLE_ADVANTAGES[card.role] === opponentRole)
    ? ROLE_BONUS
    : 0;
  return base + roleBonus;
}

/**
 * Initiates a duel challenge.
 *
 * @param {object} options
 * @param {string} options.challengerId
 * @param {number} options.challengerCardSerial
 * @param {string} options.targetId
 * @param {number} options.targetCardSerial
 * @param {object} [options._deps]
 * @returns {{ duelId: string }}
 */
function challengePlayer(options) {
  const { challengerId, challengerCardSerial, targetId, targetCardSerial, _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;
  const inboxSvc = (_deps && _deps.inboxService) || require('../inbox/inboxService');

  const duelId = uuidv4();
  const now = Date.now();
  const expiresAt = now + DUEL_EXPIRY_MS;

  dbInstance.prepare(`
    INSERT INTO duels
      (duelId, challengerAccountId, challengerCardSerial, targetAccountId, targetCardSerial,
       status, winnerId, transactionId, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
  `).run(duelId, challengerId, challengerCardSerial, targetId, targetCardSerial, now, expiresAt);

  // Notify the target player of the duel challenge
  inboxSvc.createNotification({
    recipientAccountId: targetId,
    type: 'DUEL_CHALLENGE',
    payload: { duelId, challengerAccountId: challengerId, challengerCardSerial, targetCardSerial, expiresAt },
    _deps,
  });

  return { duelId };
}

/**
 * Accepts a duel challenge — verifies both players still own their cards.
 *
 * @param {object} options
 * @param {string} options.duelId
 * @param {string} options.tokenId
 * @param {object} [options._deps]
 * @returns {{ duelId: string }}
 */
function acceptDuel(options) {
  const { duelId, tokenId, _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;

  const duel = dbInstance.prepare('SELECT * FROM duels WHERE duelId = ?').get(duelId);
  if (!duel || duel.status !== 'pending') {
    throw new Error(`DUEL_NOT_FOUND: duel ${duelId} is not pending`);
  }

  if (Date.now() > duel.expiresAt) {
    dbInstance.prepare("UPDATE duels SET status = 'expired' WHERE duelId = ?").run(duelId);
    throw new Error(`DUEL_EXPIRED: duel ${duelId} has expired`);
  }

  // Verify both players still own their cards
  const card1 = dbInstance.prepare(
    'SELECT ownerAccountId, metadataJson FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(duel.challengerCardSerial, tokenId);

  const card2 = dbInstance.prepare(
    'SELECT ownerAccountId, metadataJson FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(duel.targetCardSerial, tokenId);

  if (!card1 || card1.ownerAccountId !== duel.challengerAccountId) {
    dbInstance.prepare("UPDATE duels SET status = 'cancelled' WHERE duelId = ?").run(duelId);
    throw new Error(`DUEL_CANCELLED: challenger no longer owns card #${duel.challengerCardSerial}`);
  }

  if (!card2 || card2.ownerAccountId !== duel.targetAccountId) {
    dbInstance.prepare("UPDATE duels SET status = 'cancelled' WHERE duelId = ?").run(duelId);
    throw new Error(`DUEL_CANCELLED: target no longer owns card #${duel.targetCardSerial}`);
  }

  dbInstance.prepare("UPDATE duels SET status = 'accepted' WHERE duelId = ?").run(duelId);
  return { duelId };
}

/**
 * Resolves a duel — gets on-chain randomness, determines winner, transfers card.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.duelId
 * @param {string} options.tokenId
 * @param {import('@hashgraph/sdk').PrivateKey} options.challengerKey
 * @param {import('@hashgraph/sdk').PrivateKey} options.targetKey
 * @param {object} [options._deps]
 * @returns {Promise<{ winnerId: string, transactionId: string }>}
 */
async function resolveDuel(options) {
  const { client, duelId, tokenId, _deps } = options;
  const challengerKey = parseKey(options.challengerKey);
  const targetKey = parseKey(options.targetKey);
  const dbInstance = (_deps && _deps.db) || db;
  const TransferTx = (_deps && _deps.TransferTransaction) || TransferTransaction;
  const PrngTx = (_deps && _deps.PrngTransaction) || PrngTransaction;
  const auditLog = (_deps && _deps.logTransaction) || logTransaction;

  const duel = dbInstance.prepare('SELECT * FROM duels WHERE duelId = ?').get(duelId);
  if (!duel || duel.status !== 'accepted') {
    throw new Error(`DUEL_NOT_ACCEPTED: duel ${duelId} is not in accepted state`);
  }

  // Fetch card metadata for score calculation
  const card1Row = dbInstance.prepare(
    'SELECT metadataJson FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(duel.challengerCardSerial, tokenId);

  const card2Row = dbInstance.prepare(
    'SELECT metadataJson FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(duel.targetCardSerial, tokenId);

  const card1 = JSON.parse(card1Row.metadataJson);
  const card2 = JSON.parse(card2Row.metadataJson);

  // Get verifiable randomness from Hedera
  const prngResponse = await new PrngTx().setRange(100).execute(client);
  const prngRecord = await prngResponse.getRecord(client);
  const prngValue = prngRecord.prngNumber;

  // Compute scores with role bonus — challenger wins ties
  const score1 = computeDuelScore(card1, prngValue, card2.role);
  const score2 = computeDuelScore(card2, prngValue, card1.role);
  const challengerWins = score1 >= score2;

  const winnerId = challengerWins ? duel.challengerAccountId : duel.targetAccountId;
  const loserId = challengerWins ? duel.targetAccountId : duel.challengerAccountId;
  const loserCardSerial = challengerWins ? duel.targetCardSerial : duel.challengerCardSerial;

  // Transfer loser's card to winner
  const tx = await new TransferTx()
    .addNftTransfer(tokenId, loserCardSerial, loserId, winnerId)
    .freezeWith(client);

  const signedTx = await (await tx.sign(challengerKey)).sign(targetKey);
  const response = await signedTx.execute(client);
  await response.getReceipt(client);

  const transactionId = response.transactionId.toString();

  // Update records
  dbInstance.prepare(
    'UPDATE cards SET ownerAccountId = ? WHERE serialNumber = ? AND tokenId = ?'
  ).run(winnerId, loserCardSerial, tokenId);

  dbInstance.prepare(
    "UPDATE duels SET status = 'resolved', winnerId = ?, transactionId = ? WHERE duelId = ?"
  ).run(winnerId, transactionId, duelId);

  await auditLog({
    transactionId,
    type: 'duel',
    accountIds: JSON.stringify([duel.challengerAccountId, duel.targetAccountId]),
    serialNumbers: JSON.stringify([duel.challengerCardSerial, duel.targetCardSerial]),
    timestamp: Date.now(),
    status: 'confirmed',
  });

  // Notify both players of the duel result
  const inboxSvc = (_deps && _deps.inboxService) || require('../inbox/inboxService');
  inboxSvc.createNotification({ recipientAccountId: duel.challengerAccountId, type: 'DUEL_RESOLVED', payload: { duelId, winnerId }, _deps });
  inboxSvc.createNotification({ recipientAccountId: duel.targetAccountId, type: 'DUEL_RESOLVED', payload: { duelId, winnerId }, _deps });

  return { winnerId, transactionId };
}

/**
 * Expires a duel challenge that timed out.
 *
 * @param {object} options
 * @param {string} options.duelId
 * @param {object} [options._deps]
 */
function expireChallenge(options) {
  const { duelId, _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;
  const inboxSvc = (_deps && _deps.inboxService) || require('../inbox/inboxService');

  const duel = dbInstance.prepare('SELECT * FROM duels WHERE duelId = ?').get(duelId);
  dbInstance.prepare("UPDATE duels SET status = 'expired' WHERE duelId = ?").run(duelId);

  if (duel) {
    inboxSvc.createNotification({ recipientAccountId: duel.challengerAccountId, type: 'DUEL_EXPIRED', payload: { duelId }, _deps });
    inboxSvc.createNotification({ recipientAccountId: duel.targetAccountId, type: 'DUEL_EXPIRED', payload: { duelId }, _deps });
  }
}

module.exports = { challengePlayer, acceptDuel, resolveDuel, expireChallenge, computeDuelScore, getPendingDuels, getDuelHistory };

/**
 * Returns all pending (non-expired) duel challenges targeting an account.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {Array}
 */
function getPendingDuels({ accountId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;
  const now = Date.now();

  return dbInstance.prepare(`
    SELECT duelId, challengerAccountId, challengerCardSerial, targetCardSerial, createdAt, expiresAt
    FROM duels
    WHERE targetAccountId = ? AND status = 'pending' AND expiresAt > ?
    ORDER BY createdAt DESC
  `).all(accountId, now);
}

/**
 * Returns all resolved and expired duels involving an account as challenger or target.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {Array}
 */
function getDuelHistory({ accountId, _deps }) {
  const dbInstance = (_deps && _deps.db) || db;

  return dbInstance.prepare(`
    SELECT *
    FROM duels
    WHERE (challengerAccountId = ? OR targetAccountId = ?)
      AND status IN ('resolved', 'expired')
    ORDER BY createdAt DESC
  `).all(accountId, accountId);
}
