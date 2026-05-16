'use strict';

/**
 * MarketplaceService — list and buy cards for HBAR
 *
 * The marketplace lets players sell cards at a fixed HBAR price. When a
 * purchase happens, a single TransferTransaction atomically moves:
 * - The NFT from seller to buyer
 * - The HBAR price from buyer to seller
 *
 * Royalties are handled automatically by Hedera's custom fee mechanism —
 * no extra code needed. When the NFT transfer settles, the network
 * automatically routes the royalty percentage to the treasury.
 *
 * Listing lifecycle: active → sold (purchased) or expired (card moved away)
 */

const { TransferTransaction, Hbar, PrivateKey } = require('@hashgraph/sdk');
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
 * Lists a card for sale.
 *
 * @param {object} options
 * @param {string} options.sellerId
 * @param {string} options.tokenId
 * @param {number} options.serialNumber
 * @param {number} options.priceHbar - Must be > 0
 * @param {object} [options._deps]
 * @returns {{ listingId: string }}
 */
function listCard(options) {
  const { sellerId, tokenId, serialNumber, priceHbar, _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;

  if (typeof priceHbar !== 'number' || priceHbar <= 0) {
    const err = new Error(`INVALID_PRICE: price must be greater than 0, got ${priceHbar}`);
    err.code = 'INVALID_PRICE';
    throw err;
  }

  // Verify seller owns the card
  const card = dbInstance.prepare(
    'SELECT ownerAccountId FROM cards WHERE serialNumber = ? AND tokenId = ?'
  ).get(serialNumber, tokenId);

  if (!card || card.ownerAccountId !== sellerId) {
    const actualOwner = card ? card.ownerAccountId : 'nobody (card not found in DB)';
    const err = new Error(`CARD_NOT_OWNED: ${sellerId} does not own card #${serialNumber} (current owner: ${actualOwner})`);
    err.code = 'CARD_NOT_OWNED';
    throw err;
  }

  const listingId = uuidv4();
  dbInstance.prepare(`
    INSERT INTO listings (listingId, tokenId, serialNumber, sellerAccountId, priceHbar, status, createdAt)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(listingId, tokenId, serialNumber, sellerId, priceHbar, Date.now());

  return { listingId };
}

/**
 * Purchases a listed card — atomically swaps NFT for HBAR.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.listingId
 * @param {string} options.buyerId
 * @param {import('@hashgraph/sdk').PrivateKey} options.buyerKey
 * @param {import('@hashgraph/sdk').PrivateKey} options.sellerKey
 * @param {number} options.buyerHbarBalance - Buyer's current HBAR balance
 * @param {object} [options._deps]
 * @returns {Promise<{ transactionId: string }>}
 */
async function purchaseCard(options) {
  const { client, listingId, buyerId, buyerHbarBalance, _deps } = options;
  const buyerKey = parseKey(options.buyerKey);
  const sellerKey = parseKey(options.sellerKey);
  const dbInstance = (_deps && _deps.db) || db;
  const TransferTx = (_deps && _deps.TransferTransaction) || TransferTransaction;
  const HbarCls = (_deps && _deps.Hbar) || Hbar;
  const auditLog = (_deps && _deps.logTransaction) || logTransaction;

  const listing = dbInstance.prepare('SELECT * FROM listings WHERE listingId = ?').get(listingId);
  if (!listing || listing.status !== 'active') {
    throw new Error(`LISTING_NOT_FOUND: listing ${listingId} is not active`);
  }

  // Check buyer has enough HBAR (price + ~0.1 HBAR for fees)
  const requiredHbar = listing.priceHbar + 0.1;
  if (buyerHbarBalance < requiredHbar) {
    const err = new Error(
      `INSUFFICIENT_BALANCE: buyer has ${buyerHbarBalance} HBAR, needs ${requiredHbar} HBAR (price + fees)`
    );
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }

  let tx;
  try {
    tx = await new TransferTx()
      .addNftTransfer(listing.tokenId, listing.serialNumber, listing.sellerAccountId, buyerId)
      .addHbarTransfer(buyerId, new HbarCls(-listing.priceHbar))
      .addHbarTransfer(listing.sellerAccountId, new HbarCls(listing.priceHbar))
      .freezeWith(client);

    const signedTx = await (await tx.sign(buyerKey)).sign(sellerKey);
    const response = await signedTx.execute(client);
    await response.getReceipt(client);

    const transactionId = response.transactionId.toString();

    // Update ownership and listing status
    dbInstance.prepare(
      'UPDATE cards SET ownerAccountId = ? WHERE serialNumber = ? AND tokenId = ?'
    ).run(buyerId, listing.serialNumber, listing.tokenId);

    dbInstance.prepare(
      "UPDATE listings SET status = 'sold' WHERE listingId = ?"
    ).run(listingId);

    await auditLog({
      transactionId,
      type: 'purchase',
      accountIds: JSON.stringify([listing.sellerAccountId, buyerId]),
      serialNumbers: JSON.stringify([listing.serialNumber]),
      timestamp: Date.now(),
      status: 'confirmed',
    });

    return { transactionId };
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') throw err;
    const txId = tx ? tx.transactionId?.toString() : 'unknown';
    throw new Error(`Purchase failed (txId: ${txId}): ${err.message}`);
  }
}

/**
 * Marks a listing as expired (e.g. card was transferred away).
 *
 * @param {object} options
 * @param {string} options.listingId
 * @param {object} [options._deps]
 */
function invalidateListing(options) {
  const { listingId, _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;
  dbInstance.prepare("UPDATE listings SET status = 'expired' WHERE listingId = ?").run(listingId);
}

/**
 * Returns all active listings.
 *
 * @param {object} [options]
 * @param {object} [options._deps]
 * @returns {object[]}
 */
function getActiveListings(options = {}) {
  const { _deps } = options;
  const dbInstance = (_deps && _deps.db) || db;
  return dbInstance.prepare("SELECT * FROM listings WHERE status = 'active'").all();
}

module.exports = { listCard, purchaseCard, invalidateListing, getActiveListings };
