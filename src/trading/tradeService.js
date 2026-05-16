'use strict';

/**
 * TradeService — atomic peer-to-peer card swaps
 *
 * A trade is a direct card-for-card swap between two players. The key
 * property is atomicity: both cards move in a single TransferTransaction,
 * so there's no scenario where Player 1 loses their card but Player 2
 * doesn't send theirs. Either both transfers happen, or neither does.
 *
 * Trade flow:
 * 1. proposeTrade() — validates ownership, stores a pending trade record
 * 2. executeTrade() — both players sign, transaction is submitted on-chain
 *
 * Why require both signatures?
 * The TransferTransaction moves assets from both accounts simultaneously.
 * Hedera requires the key of each account that is losing an asset to sign.
 * This prevents anyone from stealing cards — you can only move your own.
 */

const { TransferTransaction, PrivateKey } = require('@hashgraph/sdk');
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

/**
 * Proposes a trade between two players.
 * Validates that both players own their offered cards, then stores a pending trade.
 *
 * @param {object} options
 * @param {string} options.player1Id
 * @param {number} options.card1Serial
 * @param {string} options.player2Id
 * @param {number} options.card2Serial
 * @param {string} options.tokenId
 * @param {object} [options._deps]
 * @returns {{ tradeId: string }}
 */
function proposeTrade(options) {
  const { player1Id, card1Serial, player2Id, card2Serial, tokenId, _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;

  // Verify player 1 owns card 1
  const card1 = dbInstance.prepare(
    'SELECT ownerAccountId FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(card1Serial, tokenId);

  if (!card1 || card1.ownerAccountId !== player1Id) {
    const err = new Error(`CARD_NOT_OWNED: player ${player1Id} does not own card #${card1Serial}`);
    err.code = 'CARD_NOT_OWNED';
    err.player = player1Id;
    err.serial = card1Serial;
    throw err;
  }

  // Verify player 2 owns card 2
  const card2 = dbInstance.prepare(
    'SELECT ownerAccountId FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(card2Serial, tokenId);

  if (!card2 || card2.ownerAccountId !== player2Id) {
    const err = new Error(`CARD_NOT_OWNED: player ${player2Id} does not own card #${card2Serial}`);
    err.code = 'CARD_NOT_OWNED';
    err.player = player2Id;
    err.serial = card2Serial;
    throw err;
  }

  const tradeId = uuidv4();
  const now = Date.now();

  dbInstance.prepare(`
    INSERT INTO trades (tradeId, player1Id, card1Serial, player2Id, card2Serial, status, createdAt)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(tradeId, player1Id, card1Serial, player2Id, card2Serial, now);

  return { tradeId };
}

/**
 * Executes a pending trade — submits the atomic swap on-chain.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.tradeId
 * @param {string} options.tokenId
 * @param {import('@hashgraph/sdk').PrivateKey} options.sig1 - Player 1's key
 * @param {import('@hashgraph/sdk').PrivateKey} options.sig2 - Player 2's key
 * @param {object} [options._deps]
 * @returns {Promise<{ transactionId: string }>}
 */
async function executeTrade(options) {
  const { client, tradeId, tokenId, _deps } = options;
  const sig1 = parseKey(options.sig1);
  const sig2 = parseKey(options.sig2);
  const dbInstance = (_deps && _deps.db) || db;
  const TransferTx = (_deps && _deps.TransferTransaction) || TransferTransaction;
  const auditLog = (_deps && _deps.logTransaction) || logTransaction;

  const trade = dbInstance.prepare('SELECT * FROM trades WHERE tradeId = ?').get(tradeId);
  if (!trade) {
    throw new Error(`TRADE_NOT_FOUND: trade ${tradeId} does not exist`);
  }

  // Re-verify ownership at execution time — cards may have moved since proposal
  const card1 = dbInstance.prepare(
    'SELECT ownerAccountId FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(trade.card1Serial, tokenId);

  const card2 = dbInstance.prepare(
    'SELECT ownerAccountId FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(trade.card2Serial, tokenId);

  if (!card1 || card1.ownerAccountId !== trade.player1Id) {
    const err = new Error(`CARD_NOT_OWNED: card #${trade.card1Serial} no longer owned by ${trade.player1Id}`);
    err.code = 'CARD_NOT_OWNED';
    throw err;
  }

  if (!card2 || card2.ownerAccountId !== trade.player2Id) {
    const err = new Error(`CARD_NOT_OWNED: card #${trade.card2Serial} no longer owned by ${trade.player2Id}`);
    err.code = 'CARD_NOT_OWNED';
    throw err;
  }

  // Build the atomic swap: card1 goes to player2, card2 goes to player1
  let tx;
  try {
    tx = await new TransferTx()
      .addNftTransfer(tokenId, trade.card1Serial, trade.player1Id, trade.player2Id)
      .addNftTransfer(tokenId, trade.card2Serial, trade.player2Id, trade.player1Id)
      .freezeWith(client);

    // Both players must sign — Hedera enforces this
    const signedTx = await (await tx.sign(sig1)).sign(sig2);
    const response = await signedTx.execute(client);
    await response.getReceipt(client);

    const transactionId = response.transactionId.toString();

    // Update ownership records atomically
    dbInstance.prepare(
      'UPDATE cards SET ownerAccountId = ? WHERE serialNumber = ? AND tokenId = ?'
    ).run(trade.player2Id, trade.card1Serial, tokenId);

    dbInstance.prepare(
      'UPDATE cards SET ownerAccountId = ? WHERE serialNumber = ? AND tokenId = ?'
    ).run(trade.player1Id, trade.card2Serial, tokenId);

    dbInstance.prepare(
      "UPDATE trades SET status = 'completed' WHERE tradeId = ?"
    ).run(tradeId);

    await auditLog({
      transactionId,
      type: 'trade',
      accountIds: JSON.stringify([trade.player1Id, trade.player2Id]),
      serialNumbers: JSON.stringify([trade.card1Serial, trade.card2Serial]),
      timestamp: Date.now(),
      status: 'confirmed',
    });

    return { transactionId };
  } catch (err) {
    if (err.code === 'CARD_NOT_OWNED') throw err;
    const txId = tx ? tx.transactionId?.toString() : 'unknown';
    throw new Error(`Trade failed (txId: ${txId}): ${err.message}`);
  }
}

module.exports = { proposeTrade, executeTrade };
