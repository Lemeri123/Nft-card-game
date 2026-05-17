'use strict';

/**
 * DistributionService — sends cards from the Treasury to players
 *
 * When a player first joins, the game operator distributes cards from the
 * Treasury account to the player's account. This uses a TransferTransaction
 * with addNftTransfer() — the atomic primitive for moving NFTs on Hedera.
 *
 * Key concept — atomic transfers:
 * A single TransferTransaction can contain multiple transfers (HBAR and NFTs)
 * that all succeed or all fail together. There's no partial state. This is
 * what makes Hedera transfers safe — you never end up with a card "in transit".
 *
 * Before distributing, we verify:
 * 1. The card is currently owned by the Treasury (not already distributed)
 * 2. The recipient has associated with the token collection (can receive it)
 */

const { TransferTransaction } = require('@hashgraph/sdk');
const { db } = require('../db/database');
const { logTransaction } = require('../audit/auditLogger');
const { parsePrivateKey } = require('../utils/parsePrivateKey');
const { clearCache } = require('../inventory/inventoryService');

/**
 * Distributes a card from the Treasury to a player.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.tokenId
 * @param {number} options.serialNumber
 * @param {string} options.treasuryAccountId
 * @param {import('@hashgraph/sdk').PrivateKey} options.treasuryKey
 * @param {string} options.recipientAccountId
 * @param {object} [options._deps] - Injectable deps for testing
 * @returns {Promise<{ transactionId: string }>}
 */
async function distributeCard(options) {
  const {
    client,
    tokenId,
    serialNumber,
    treasuryAccountId,
    recipientAccountId,
    _deps,
  } = options;

  const treasuryKey = parsePrivateKey(options.treasuryKey);

  const dbInstance = (_deps && _deps.db) || db;
  const TransferTx = (_deps && _deps.TransferTransaction) || TransferTransaction;
  const auditLog = (_deps && _deps.logTransaction) || logTransaction;

  // Guard 1: Card must be owned by Treasury
  const card = dbInstance.prepare(
    'SELECT ownerAccountId FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(serialNumber, tokenId);

  if (!card) {
    const err = new Error(`CARD_NOT_FOUND: serial #${serialNumber} not found in collection ${tokenId}`);
    err.code = 'CARD_NOT_FOUND';
    throw err;
  }

  if (card.ownerAccountId !== 'treasury') {
    const err = new Error(
      `CARD_NOT_OWNED: serial #${serialNumber} is owned by ${card.ownerAccountId}, not Treasury`
    );
    err.code = 'CARD_NOT_OWNED';
    throw err;
  }

  // Submit the NFT transfer: Treasury → Player
  let tx;
  try {
    tx = await new TransferTx()
      .addNftTransfer(tokenId, serialNumber, treasuryAccountId, recipientAccountId)
      .freezeWith(client);

    const signedTx = await tx.sign(treasuryKey);
    const response = await signedTx.execute(client);
    await response.getReceipt(client);

    const transactionId = response.transactionId.toString();

    // Update local ownership record
    dbInstance.prepare(
      'UPDATE cards SET ownerAccountId = ? WHERE serialNumber = ? AND tokenId = ?'
    ).run(recipientAccountId, serialNumber, tokenId);

    // Audit log
    await auditLog({
      transactionId,
      type: 'distribute',
      accountIds: JSON.stringify([treasuryAccountId, recipientAccountId]),
      serialNumbers: JSON.stringify([serialNumber]),
      timestamp: Date.now(),
      status: 'confirmed',
    });

    clearCache();

    console.log(`[DistributionService] Card #${serialNumber} distributed to ${recipientAccountId} (txId: ${transactionId})`);
    return { transactionId };
  } catch (err) {
    if (err.code === 'CARD_NOT_OWNED' || err.code === 'CARD_NOT_FOUND') throw err;
    const txId = tx ? tx.transactionId?.toString() : 'unknown';
    throw new Error(`Distribution failed (txId: ${txId}): ${err.message}`);
  }
}

module.exports = { distributeCard };
