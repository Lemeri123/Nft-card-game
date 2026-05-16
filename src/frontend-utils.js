'use strict';

/**
 * frontend-utils.js
 *
 * Pure utility functions shared between the inline <script> in public/index.html
 * and the vitest test suite in test/frontend.test.js.
 *
 * No DOM access, no fetch, no side effects — all functions are pure.
 */

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

const CARD_ROSTER = [
  // Common
  { name: 'Shadow Dragon',   role: 'Warrior',  rarity: 'common',    attack: 95,  defense: 80 },
  { name: 'Iron Soldier',    role: 'Warrior',  rarity: 'common',    attack: 35,  defense: 30 },
  { name: 'Forest Scout',    role: 'Ranger',   rarity: 'common',    attack: 28,  defense: 38 },
  { name: 'Stone Golem',     role: 'Guardian', rarity: 'common',    attack: 22,  defense: 45 },
  { name: 'Apprentice Mage', role: 'Mage',     rarity: 'common',    attack: 40,  defense: 20 },
  // Rare
  { name: 'Fire Knight',     role: 'Warrior',  rarity: 'rare',      attack: 65,  defense: 50 },
  { name: 'Storm Eagle',     role: 'Ranger',   rarity: 'rare',      attack: 58,  defense: 55 },
  { name: 'Ice Witch',       role: 'Mage',     rarity: 'rare',      attack: 70,  defense: 35 },
  { name: 'Shield Titan',    role: 'Guardian', rarity: 'rare',      attack: 40,  defense: 72 },
  // Epic
  { name: 'Shadow Archer',   role: 'Ranger',   rarity: 'epic',      attack: 75,  defense: 68 },
  { name: 'Lava Colossus',   role: 'Warrior',  rarity: 'epic',      attack: 82,  defense: 65 },
  { name: 'Frost Sorceress', role: 'Mage',     rarity: 'epic',      attack: 80,  defense: 55 },
  { name: 'Iron Fortress',   role: 'Guardian', rarity: 'epic',      attack: 55,  defense: 85 },
  // Legendary
  { name: 'Thunder Phoenix', role: 'Ranger',   rarity: 'legendary', attack: 88,  defense: 82 },
  { name: 'Void Witch',      role: 'Mage',     rarity: 'legendary', attack: 100, defense: 60 },
  { name: 'Eternal Guardian',role: 'Guardian', rarity: 'legendary', attack: 70,  defense: 95 },
];

const ROLE_ICONS = { Warrior: '⚔️', Mage: '🔮', Ranger: '🏹', Guardian: '🛡️' };

const RARITY_COLORS = {
  common:    '#9e9e9e',
  rare:      '#2196f3',
  epic:      '#9c27b0',
  legendary: '#ffc107',
};

const ROLE_BONUSES = [
  { attacker: 'Warrior',  defender: 'Mage',    bonus: 10 },
  { attacker: 'Mage',     defender: 'Ranger',  bonus: 10 },
  { attacker: 'Ranger',   defender: 'Warrior', bonus: 10 },
  { attacker: 'Guardian', defender: 'Mage',    bonus: 10 },
];

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Decode a base64-encoded JSON string.
 * Returns the parsed object, or null if decoding or parsing fails.
 * @param {string} base64
 * @returns {object|null}
 */
function decodeMetadata(base64) {
  try {
    // atob is available in Node 16+ and all modern browsers
    const json = (typeof atob === 'function' ? atob : (s) => Buffer.from(s, 'base64').toString('utf8'))(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Look up a card's role by its name in CARD_ROSTER.
 * Returns the role string, or null if not found.
 * @param {string} name
 * @returns {string|null}
 */
function lookupRole(name) {
  const entry = CARD_ROSTER.find((c) => c.name === name);
  return entry ? entry.role : null;
}

/**
 * Validate that an accountId is non-empty and not whitespace-only.
 * @param {string} value
 * @returns {boolean}
 */
function validateAccountId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that both tokenId and accountId are non-empty.
 * @param {{ tokenId: string, accountId: string }} param0
 * @returns {boolean}
 */
function validateMintForm({ tokenId, accountId }) {
  return validateAccountId(tokenId) && validateAccountId(accountId);
}

/**
 * Validate that all six duel form fields are non-empty.
 * @param {{ challengerId, challengerCardSerial, opponentId, opponentCardSerial, tokenId, wagerAmount }} fields
 * @returns {boolean}
 */
function validateDuelForm(fields) {
  const keys = ['challengerId', 'challengerCardSerial', 'opponentId', 'opponentCardSerial', 'tokenId', 'wagerAmount'];
  return keys.every((k) => String(fields[k] ?? '').trim().length > 0);
}

/**
 * Build the duel API payload from form data.
 * Maps opponentId → targetId, opponentCardSerial → targetCardSerial.
 * Casts serial numbers and wagerAmount to Number.
 * @param {{ challengerId, challengerCardSerial, opponentId, opponentCardSerial, tokenId, wagerAmount }} formData
 * @returns {object}
 */
function buildDuelPayload(formData) {
  return {
    challengerId:        formData.challengerId,
    challengerCardSerial: Number(formData.challengerCardSerial),
    targetId:            formData.opponentId,
    targetCardSerial:    Number(formData.opponentCardSerial),
    tokenId:             formData.tokenId,
    wagerAmount:         Number(formData.wagerAmount),
  };
}

module.exports = {
  CARD_ROSTER,
  ROLE_ICONS,
  RARITY_COLORS,
  ROLE_BONUSES,
  decodeMetadata,
  lookupRole,
  validateAccountId,
  validateMintForm,
  validateDuelForm,
  buildDuelPayload,
};
