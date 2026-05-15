'use strict';

/**
 * PlayerManager — player registration and account validation
 *
 * Before a player can receive any NFT card, their Hedera account must be
 * "associated" with the card collection token. This is a Hedera-specific
 * requirement that prevents spam — you can't receive a token you haven't
 * opted into.
 *
 * The flow for a new player:
 * 1. Verify their Hedera account exists (AccountBalanceQuery)
 * 2. Check they have enough HBAR to cover transaction fees (min 0.1 HBAR)
 * 3. Submit a TokenAssociateTransaction signed by the player's own key
 *
 * Why does the player sign? Because token association modifies their account.
 * Only the account owner (holder of the private key) can opt into a token.
 * This is a security feature — no one can force tokens onto your account.
 */

const { AccountBalanceQuery, TokenAssociateTransaction, Hbar, HbarUnit, PrivateKey } = require('@hashgraph/sdk');

const MIN_HBAR_BALANCE = 0.1;

function parseKey(key) {
  if (typeof key !== 'string') return key;
  try { return PrivateKey.fromStringECDSA(key); } catch {}
  try { return PrivateKey.fromStringDer(key); } catch {}
  return PrivateKey.fromStringED25519(key);
}

/**
 * Checks whether a Hedera account exists on the network.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.accountId
 * @param {object} [options._deps] - Injectable deps for testing
 * @returns {Promise<boolean>}
 */
async function verifyAccountExists(options) {
  const { client, accountId, _deps } = options;
  const BalanceQuery = (_deps && _deps.AccountBalanceQuery) || AccountBalanceQuery;

  try {
    await new BalanceQuery().setAccountId(accountId).execute(client);
    return true;
  } catch (err) {
    // Hedera returns INVALID_ACCOUNT_ID when the account doesn't exist
    if (err.message && err.message.includes('INVALID_ACCOUNT_ID')) {
      return false;
    }
    throw err;
  }
}

/**
 * Returns the HBAR balance of an account as a plain number.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {Promise<number>} Balance in HBAR
 */
async function getAccountHbarBalance(options) {
  const { client, accountId, _deps } = options;
  const BalanceQuery = (_deps && _deps.AccountBalanceQuery) || AccountBalanceQuery;

  const balance = await new BalanceQuery().setAccountId(accountId).execute(client);
  // balance.hbars is a Hbar object — convert to a plain number for easy comparison
  return balance.hbars.to(HbarUnit.Hbar).toNumber();
}

/**
 * Registers a player by associating their account with the card collection.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.accountId - Player's Hedera account ID
 * @param {import('@hashgraph/sdk').PrivateKey} options.playerKey - Player's private key
 * @param {string} options.tokenId - Card collection token ID
 * @param {object} [options._deps]
 * @returns {Promise<{ success: boolean, alreadyAssociated: boolean }>}
 */
async function registerPlayer(options) {
  const { client, accountId, tokenId, _deps } = options;
  const playerKey = parseKey(options.playerKey);
  const BalanceQuery = (_deps && _deps.AccountBalanceQuery) || AccountBalanceQuery;
  const AssociateTx = (_deps && _deps.TokenAssociateTransaction) || TokenAssociateTransaction;
  const HbarCls = (_deps && _deps.Hbar) || Hbar;
  const HbarUnitCls = (_deps && _deps.HbarUnit) || HbarUnit;

  // Step 1: Verify account exists
  const exists = await verifyAccountExists({ client, accountId, _deps });
  if (!exists) {
    const err = new Error(`ACCOUNT_NOT_FOUND: account ${accountId} does not exist on Hedera`);
    err.code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }

  // Step 2: Check HBAR balance
  const balanceQuery = await new BalanceQuery().setAccountId(accountId).execute(client);
  const hbarBalance = balanceQuery.hbars.to(HbarUnitCls.Hbar).toNumber();

  if (hbarBalance < MIN_HBAR_BALANCE) {
    const err = new Error(
      `INSUFFICIENT_BALANCE: account ${accountId} has ${hbarBalance} HBAR, minimum required is ${MIN_HBAR_BALANCE} HBAR`
    );
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }

  // Step 3: Associate the token
  try {
    const tx = await new AssociateTx()
      .setAccountId(accountId)
      .setTokenIds([tokenId])
      .freezeWith(client);

    const signedTx = await tx.sign(playerKey);
    const response = await signedTx.execute(client);
    await response.getReceipt(client);

    console.log(`[PlayerManager] Player ${accountId} associated with token ${tokenId}`);
    return { success: true, alreadyAssociated: false };
  } catch (err) {
    // TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT is not an error — player is already set up
    if (err.message && err.message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
      console.log(`[PlayerManager] Player ${accountId} already associated — skipping`);
      return { success: true, alreadyAssociated: true };
    }
    throw err;
  }
}

module.exports = { verifyAccountExists, getAccountHbarBalance, registerPlayer };
