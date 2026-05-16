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
  MISSING_PLAYER_KEY: 400,
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
    const { db } = require('../db/database');

    const CARD_ROSTER = [
      { name: 'Shadow Dragon',    role: 'Warrior',  rarity: 'common',    attack: 95,  defense: 80,  image: 'ipfs://bafkreihojzbbgecgcjkssxvhkpxapx7bqss2phlgguz2cje7opa4qqf4vi' },
      { name: 'Iron Soldier',     role: 'Warrior',  rarity: 'common',    attack: 35,  defense: 30,  image: 'ipfs://bafkreihojzbbgecgcjkssxvhkpxapx7bqss2phlgguz2cje7opa4qqf4vi' },
      { name: 'Forest Scout',     role: 'Ranger',   rarity: 'common',    attack: 28,  defense: 38,  image: 'ipfs://bafkreia2fsi5ld7dvqx6qfezqqg57hfxnsardij7tnkklqbiyel3agkm2u' },
      { name: 'Stone Golem',      role: 'Guardian', rarity: 'common',    attack: 22,  defense: 45,  image: 'ipfs://bafkreiee3ewkkvmdf26ie7vqwya452vswxhfm7yjktaht76qnm2hrdrz3a' },
      { name: 'Apprentice Mage',  role: 'Mage',     rarity: 'common',    attack: 40,  defense: 20,  image: 'ipfs://bafybeicuhrviveittd3ja6p3qhfu5cnlofbzl3fwer2xuklhabhcllsaom' },
      { name: 'Fire Knight',      role: 'Warrior',  rarity: 'rare',      attack: 65,  defense: 50,  image: 'ipfs://bafybeihcpekcqgyzylsbkjse532v6aobkq2eqahq375svatkz567ikadwu' },
      { name: 'Storm Eagle',      role: 'Ranger',   rarity: 'rare',      attack: 58,  defense: 55,  image: 'ipfs://bafkreieswnnph7yqm2ihkmmr3ys752mr5i6yqab7arljw7sulta6kpoxqm' },
      { name: 'Ice Witch',        role: 'Mage',     rarity: 'rare',      attack: 70,  defense: 35,  image: 'ipfs://bafkreifuw76xlogqopklz6yhpnvehcmk37ebf6ssbnr4puitotdmgqxlke' },
      { name: 'Shield Titan',     role: 'Guardian', rarity: 'rare',      attack: 40,  defense: 72,  image: 'ipfs://bafkreiddalomyhhfqbqtin6g7pb2lpfu64zmodq5hzvcllabegnmlv7onu' },
      { name: 'Shadow Archer',    role: 'Ranger',   rarity: 'epic',      attack: 75,  defense: 68,  image: 'ipfs://bafkreifkjq4jget4c3f6z7gxrcxkrnmpt5liwb27zbisrns6bizgvxvif4' },
      { name: 'Lava Colossus',    role: 'Warrior',  rarity: 'epic',      attack: 82,  defense: 65,  image: 'ipfs://bafkreibh7dy2y2xlzn2qvysungxhzvqm6phqaa7gnflwzxkcbu366ywgy4' },
      { name: 'Frost Sorceress',  role: 'Mage',     rarity: 'epic',      attack: 80,  defense: 55,  image: 'ipfs://bafkreifuw76xlogqopklz6yhpnvehcmk37ebf6ssbnr4puitotdmgqxlke' },
      { name: 'Iron Fortress',    role: 'Guardian', rarity: 'epic',      attack: 55,  defense: 85,  image: 'ipfs://bafkreigrngrlnvbvghkzt6y6slsub6hogwummbkdfdfp3uks4gbpp7wceu' },
      { name: 'Thunder Phoenix',  role: 'Ranger',   rarity: 'legendary', attack: 88,  defense: 82,  image: 'ipfs://bafkreiaotdn72pav4hog3zf633lijkexqx5dscdsiobfi7gigrar2zcg4e' },
      { name: 'Void Witch',       role: 'Mage',     rarity: 'legendary', attack: 100, defense: 60,  image: 'ipfs://bafybeiba6trp6sfymxrd2blgo6yrqfdcktd7bc7wgoyz3st6zjswj6r7de' },
      { name: 'Eternal Guardian', role: 'Guardian', rarity: 'legendary', attack: 70,  defense: 95,  image: 'ipfs://bafkreielkuyslttwodspzviqyzcv4rk2e2rxomdszppnnmpa7czxqyatbi' },
    ];

    const tokenId   = req.body.tokenId   || process.env.TOKEN_ID;
    const supplyKey = req.body.supplyKey || process.env.TREASURY_PRIVATE_KEY;

    if (!tokenId)   return res.status(400).json({ error: 'tokenId is required', code: 'INVALID_REQUEST' });
    if (!supplyKey) return res.status(400).json({ error: 'supplyKey not configured (set TREASURY_PRIVATE_KEY in .env)', code: 'INVALID_REQUEST' });

    let cardTemplate;
    if (req.body.cardName) {
      cardTemplate = CARD_ROSTER.find((c) => c.name === req.body.cardName);
      if (!cardTemplate) return res.status(400).json({ error: `Unknown card name: ${req.body.cardName}`, code: 'INVALID_REQUEST' });
    } else {
      cardTemplate = CARD_ROSTER[Math.floor(Math.random() * CARD_ROSTER.length)];
    }

    const supplyRow = db.prepare('SELECT COUNT(*) as count FROM cards WHERE tokenId = ?').get(tokenId);
    const currentSupply = supplyRow ? supplyRow.count : 0;
    const maxSupply = Number(req.body.maxSupply) || 1000;

    const result = await mintCard({
      client:        req.app.locals.client,
      tokenId,
      supplyKey,
      metadata:      cardTemplate,
      currentSupply,
      maxSupply,
    });

    res.json({ ...result, name: cardTemplate.name, rarity: cardTemplate.rarity });
  } catch (err) { handleError(res, err); }
});

router.post('/cards/distribute', async (req, res) => {
  try {
    const result = await distributeCard({
      ...req.body,
      tokenId: req.body.tokenId || process.env.TOKEN_ID,
      treasuryAccountId: req.body.treasuryAccountId || process.env.TREASURY_ACCOUNT_ID,
      treasuryKey: req.body.treasuryKey || process.env.TREASURY_PRIVATE_KEY,
      client: req.app.locals.client,
    });
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
    const tokenId = req.body.tokenId || process.env.TOKEN_ID;
    if (!tokenId) {
      return res.status(400).json({ error: 'tokenId is required (or set TOKEN_ID in .env)', code: 'INVALID_REQUEST' });
    }
    const result = await registerPlayer({
      ...req.body,
      tokenId,
      treasuryAccountId: req.body.treasuryAccountId || process.env.TREASURY_ACCOUNT_ID,
      treasuryKey: req.body.treasuryKey || process.env.TREASURY_PRIVATE_KEY,
      client: req.app.locals.client,
    });
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
    const body = { ...req.body };
    if (!body.sellerId && body.sellerAccountId) body.sellerId = body.sellerAccountId;
    const result = listCard(body);
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
    const { db } = require('../db/database');
    const result = await getPlayerInventory({
      accountId: req.params.accountId,
      tokenId: req.query.tokenId || process.env.TOKEN_ID,
    });

    // Enrich each card with local metadata (name, rarity, attack, defense)
    // The on-chain metadata field is an IPFS CID, not the JSON itself.
    // The actual card data lives in the local SQLite cards table.
    const enriched = result.cards.map((card) => {
      const serial = card.serial_number;
      const row = db.prepare('SELECT metadataJson FROM cards WHERE serialNumber = ?').get(serial);
      if (row && row.metadataJson) {
        try {
          const meta = JSON.parse(row.metadataJson);
          return { ...card, metadata: Buffer.from(row.metadataJson).toString('base64'), _meta: meta };
        } catch { /* fall through */ }
      }
      return card;
    });

    res.json({ ...result, cards: enriched });
  } catch (err) { handleError(res, err); }
});

// --- History ---
router.get('/history/:accountId', (req, res) => {
  try {
    const result = getPlayerHistory(req.params.accountId);
    res.json(result);
  } catch (err) { handleError(res, err); }
});

// --- Leaderboard ---
router.get('/leaderboard', (req, res) => {
  try {
    const { db } = require('../db/database');
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    // Count duel wins per account from the audit log
    const rows = db.prepare(`
      SELECT d.winnerId AS accountId, COUNT(*) AS wins
      FROM duels d
      WHERE d.status = 'resolved' AND d.winnerId IS NOT NULL
      GROUP BY d.winnerId
      ORDER BY wins DESC
      LIMIT ?
    `).all(limit);
    res.json({ leaderboard: rows });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
