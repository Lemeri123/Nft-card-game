'use strict';

/**
 * CardMetadata — parsing and serialization
 *
 * Every NFT card has metadata stored as JSON on IPFS. The CID (Content
 * Identifier) of that JSON is what gets written on-chain as the NFT's
 * metadata bytes. This module handles converting between the raw JSON
 * string and the validated CardMetadata object.
 *
 * Why validate here? Because once a card is minted on Hedera the metadata
 * is immutable — we can't fix a typo after the fact. Strict validation
 * before minting prevents bad data from ever reaching the chain.
 */

const VALID_RARITIES = ['common', 'rare', 'epic', 'legendary'];

/**
 * Parses and validates a JSON string into a CardMetadata object.
 *
 * @param {string} jsonString - Raw JSON string from IPFS or user input
 * @returns {{ name: string, rarity: string, attack: number, defense: number, image: string }}
 * @throws {Error} if the JSON is invalid or any field fails validation
 */
function parseCardMetadata(jsonString) {
  let raw;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    throw new Error('CardMetadata: invalid JSON string');
  }

  // --- name ---
  if (typeof raw.name !== 'string') {
    throw new Error('CardMetadata: "name" must be a string');
  }
  if (raw.name.trim().length === 0) {
    throw new Error('CardMetadata: "name" must not be empty or whitespace-only');
  }

  // --- rarity ---
  if (!VALID_RARITIES.includes(raw.rarity)) {
    throw new Error(
      `CardMetadata: "rarity" must be one of ${VALID_RARITIES.join(', ')} — got "${raw.rarity}"`
    );
  }

  // --- attack ---
  if (!Number.isInteger(raw.attack) || raw.attack < 1 || raw.attack > 100) {
    throw new Error(
      `CardMetadata: "attack" must be an integer between 1 and 100 — got ${raw.attack}`
    );
  }

  // --- defense ---
  if (!Number.isInteger(raw.defense) || raw.defense < 1 || raw.defense > 100) {
    throw new Error(
      `CardMetadata: "defense" must be an integer between 1 and 100 — got ${raw.defense}`
    );
  }

  // --- image ---
  if (typeof raw.image !== 'string' || raw.image.trim().length === 0) {
    throw new Error('CardMetadata: "image" must be a non-empty string (IPFS URI)');
  }

  return {
    name: raw.name,
    rarity: raw.rarity,
    attack: raw.attack,
    defense: raw.defense,
    image: raw.image,
  };
}

/**
 * Serializes a CardMetadata object back to a JSON string.
 * Only the five canonical fields are included — no extra properties leak through.
 *
 * @param {{ name: string, rarity: string, attack: number, defense: number, image: string }} metadata
 * @returns {string} JSON string
 */
function printCardMetadata(metadata) {
  return JSON.stringify({
    name: metadata.name,
    rarity: metadata.rarity,
    attack: metadata.attack,
    defense: metadata.defense,
    image: metadata.image,
  });
}

module.exports = { parseCardMetadata, printCardMetadata, VALID_RARITIES };
