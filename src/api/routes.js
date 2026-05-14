'use strict';

/**
 * API Routes — wires HTTP endpoints to game services
 *
 * Error code → HTTP status mapping:
 *   CARD_NOT_FOUND       → 404
 *   CARD_NOT_OWNED       → 409 (conflict — ownership mismatch)
 *   COLLECTION_FULL      → 409
 *   ACCOUNT_NOT_FOUND    → 404
 *   INSUFFICIENT_BALANCE → 402 (payment required)
 *   INVALID_PRICE        → 400
 *   LISTING_NOT_FOUND    → 404
 *   TRADE_NOT_FOUND      → 404
 *   DUEL_NOT_FOUND       → 404
 *   DUEL_EXPIRED         → 410 (gone)
 *   DUEL_CANCELLED       → 409
 *   SERVICE_UNAVAILABLE  → 503
 *   (default)            → 500
 */

const express = require('express');
const { createCardCollection } = require('../collection/collectionManager');
const { mintCard } = require('../minting/cardMinter');
const { registerPlayer } = require('../players/playerManager');
const { distributeCard } = require('../distribution/distributionService');
const { proposeTrade, executeTrade } = require('../trading/tradeService');
const { listCard, purchaseCard, invalidateListing, getActiveListings } = require('../marketplace/marketplaceService');
const { challengePlayer, acceptDuel, resolveDuel } = require('../duels/duelService');
const { getPlayerInventory, getCardDetails, getTransactionHistory } = require('../inventory/inventoryService');
const { getPlayerHistory } = require('../audit/auditLogger');

const router = express.Router();

// Map application error codes to HTTP status codes
const ERROR_STATUS = {
  CARD_NOT_FOUND: 404,
  ACCOUNT_NOT_FOUND: 404,
  LISTING_NOT_FOUND: 404,
  TRADE_NOT_FOUND: 404,
  DUEL_NOT_FOUND: 404,
  CARD_NOT_OWNED: 409,
  COLLECTION_FULL: 409,
  DUEL_CANCELLED: 409,
  INVALID_PRICE: 400,
  INSUFFICIENT_BALANCE: 402,
  DUEL_EXPIRED: 410,
  SERVICE_UNAVAILABLE: 503,
};

function handleError(res, err) {
  const status = ERROR_STATUS[err.code] || 500;
  res.status(status).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
}

// --- Collection ---
router.post('/collection/create', async (req, res) => {
  try {
    const result = await createCardCollection({ ...req.body, client: req.app.locals.client });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- Cards ---
router.post('/cards/mint', async (req, res) => {
  try {
    const result = await mintCard({ ...req.body, client: req.app.locals.client });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/cards/distribute', async (req, res) => {
  try {
    const result = await distributeCard({ ...req.body, client: req.app.locals.client });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.get('/cards/:serialNumber', async (req, res) => {
  try {
    const result = await getCardDetails({
      tokenId: req.query.tokenId,
      serialNumber: Number(req.params.serialNumber),
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- Players ---
router.post('/players/register', async (req, res) => {
  try {
    const result = await registerPlayer({ ...req.body, client: req.app.locals.client });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- Trades ---
router.post('/trades/propose', (req, res) => {
  try {
    const result = proposeTrade(req.body);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/trades/:tradeId/execute', async (req, res) => {
  try {
    const result = await executeTrade({
      ...req.body,
      tradeId: req.params.tradeId,
      client: req.app.locals.client,
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- Marketplace ---
router.post('/marketplace/list', (req, res) => {
  try {
    const result = listCard(req.body);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/marketplace/:listingId/purchase', async (req, res) => {
  try {
    const result = await purchaseCard({
      ...req.body,
      listingId: req.params.listingId,
      client: req.app.locals.client,
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.get('/marketplace', (req, res) => {
  try {
    const result = getActiveListings();
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.delete('/marketplace/:listingId', (req, res) => {
  try {
    invalidateListing({ listingId: req.params.listingId });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// --- Duels ---
router.post('/duels/challenge', (req, res) => {
  try {
    const result = challengePlayer(req.body);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/duels/:duelId/accept', (req, res) => {
  try {
    const result = acceptDuel({ ...req.body, duelId: req.params.duelId });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

router.post('/duels/:duelId/resolve', async (req, res) => {
  try {
    const result = await resolveDuel({
      ...req.body,
      duelId: req.params.duelId,
      client: req.app.locals.client,
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- Inventory ---
router.get('/inventory/:accountId', async (req, res) => {
  try {
    const result = await getPlayerInventory({
      accountId: req.params.accountId,
      tokenId: req.query.tokenId || process.env.TOKEN_ID,
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- History ---
router.get('/history/:accountId', (req, res) => {
  try {
    const result = getPlayerHistory(req.params.accountId);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

module.exports = router;
