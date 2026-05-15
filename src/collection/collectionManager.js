'use strict';

/**
 * CollectionManager — creates the NFT token collection on Hedera
 *
 * This is a one-time setup step. Before any cards can be minted, we need a
 * "token collection" on Hedera Token Service (HTS). Think of it like creating
 * a trading card set — you define the rules (max supply, royalties, who can
 * mint) once, and then every card minted belongs to that collection.
 *
 * Key Hedera concepts used here:
 *
 * - TokenCreateTransaction: Creates a new token type on Hedera. We use
 *   TokenType.NonFungibleUnique so each token (card) is unique.
 *
 * - TokenSupplyType.Finite: Caps the total number of cards that can ever
 *   exist. Good for scarcity — like a limited print run.
 *
 * - CustomRoyaltyFee: Hedera's native royalty mechanism. Every time a card
 *   is sold on the secondary market, a percentage automatically goes to the
 *   treasury. No extra code needed — the network enforces it.
 *
 * - supplyKey: Only the holder of this key can mint new cards.
 * - adminKey: Allows updating the collection's metadata in the future.
 */

const {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  CustomRoyaltyFee,
  CustomFixedFee,
  Hbar,
  PrivateKey,
} = require('@hashgraph/sdk');

/**
 * Parses a key value into a PrivateKey object if it's a string.
 * Accepts raw hex (ECDSA), DER-encoded hex, or an already-parsed PrivateKey.
 */
function parseKey(key) {
  if (typeof key !== 'string') return key;
  try {
    return PrivateKey.fromStringECDSA(key);
  } catch {
    try {
      return PrivateKey.fromStringDer(key);
    } catch {
      return PrivateKey.fromStringED25519(key);
    }
  }
}

/**
 * Builds the custom fee objects for the collection.
 * Extracted so it can be overridden in tests via the `_deps` parameter.
 *
 * @param {object} config
 * @param {object} deps - Injectable SDK constructors (for testing)
 */
function buildFees(config, deps) {
  const { CustomFixedFee: FixedFee, CustomRoyaltyFee: RoyaltyFee, Hbar: HbarCls } = deps;

  const fallbackFee = new FixedFee()
    .setHbarAmount(new HbarCls(config.fallbackFeeHbar))
    .setFeeCollectorAccountId(config.treasuryAccountId);

  const royaltyFee = new RoyaltyFee()
    .setNumerator(config.royaltyNumerator)
    .setDenominator(config.royaltyDenominator)
    .setFeeCollectorAccountId(config.treasuryAccountId)
    .setFallbackFee(fallbackFee);

  return [royaltyFee];
}

/**
 * Creates the NFT card collection on Hedera.
 *
 * @param {object} config
 * @param {import('@hashgraph/sdk').Client} config.client
 * @param {string} config.name
 * @param {string} config.symbol
 * @param {number} config.maxSupply
 * @param {number} config.royaltyNumerator
 * @param {number} config.royaltyDenominator
 * @param {number} config.fallbackFeeHbar
 * @param {import('@hashgraph/sdk').AccountId} config.treasuryAccountId
 * @param {import('@hashgraph/sdk').PrivateKey} config.treasuryKey
 * @param {import('@hashgraph/sdk').PrivateKey} config.adminKey
 * @param {import('@hashgraph/sdk').PrivateKey} config.supplyKey
 * @param {object} [config._deps] - Optional injectable SDK deps (used in tests)
 * @returns {Promise<{ tokenId: string, receipt: object }>}
 * @throws {Error} with transaction ID if the creation fails
 */
async function createCardCollection(config) {
  const {
    client,
    name,
    symbol,
    maxSupply,
    treasuryAccountId,
  } = config;

  // Parse string keys into PrivateKey objects — the SDK requires proper key objects, not raw strings
  const treasuryKey = parseKey(config.treasuryKey);
  const adminKey = parseKey(config.adminKey);
  const supplyKey = parseKey(config.supplyKey);

  // Allow tests to inject fake SDK constructors; production uses the real ones
  const deps = config._deps || { CustomFixedFee, CustomRoyaltyFee, Hbar };
  const TxClass = (config._deps && config._deps.TokenCreateTransaction) || TokenCreateTransaction;
  const TType = (config._deps && config._deps.TokenType) || TokenType;
  const TSupplyType = (config._deps && config._deps.TokenSupplyType) || TokenSupplyType;

  const fees = buildFees(config, deps);

  let transaction;
  try {
    transaction = await new TxClass()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setTokenType(TType.NonFungibleUnique)
      .setSupplyType(TSupplyType.Finite)
      .setMaxSupply(maxSupply)
      .setTreasuryAccountId(treasuryAccountId)
      .setAdminKey(adminKey)
      .setSupplyKey(supplyKey)
      .setCustomFees(fees)
      .freezeWith(client);

    const signedTx = await (await transaction.sign(treasuryKey)).sign(adminKey);
    const response = await signedTx.execute(client);
    const receipt = await response.getReceipt(client);
    const tokenId = receipt.tokenId.toString();

    console.log(`[CollectionManager] Card collection created: ${tokenId}`);
    return { tokenId, receipt };
  } catch (err) {
    const txId = transaction ? transaction.transactionId?.toString() : 'unknown';
    console.error(`[CollectionManager] Failed to create collection (txId: ${txId}):`, err.message);
    throw new Error(`Collection creation failed (txId: ${txId}): ${err.message}`);
  }
}

module.exports = { createCardCollection };
