'use strict';

/**
 * Burn NFT card serials on Hedera (permanent — cannot be undone).
 *
 * Hedera only burns serials held by the token treasury. Cards on a player account
 * are transferred back to treasury first (requires that player's private key).
 *
 * Usage:
 *   node scripts/burn-cards.js
 *   node scripts/burn-cards.js --dry-run
 *   node scripts/burn-cards.js --serials 1,2,3,4,21,22,23,24,25,26,27,28,29
 *   node scripts/burn-cards.js --player-account 0.0.8895143 --player-key <hex>
 *
 * Requires in .env: TOKEN_ID, TREASURY_ACCOUNT_ID, TREASURY_PRIVATE_KEY, HEDERA_NETWORK
 */

require('dotenv').config();

const {
  Client,
  AccountId,
  TokenBurnTransaction,
  TransferTransaction,
} = require('@hashgraph/sdk');
const { parsePrivateKey } = require('../src/utils/parsePrivateKey');
const path = require('path');

const DEFAULT_SERIALS = [1, 2, 3, 4, 21, 22, 23, 24, 25, 26, 27, 28, 29];
const MIRROR = process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    serials: [...DEFAULT_SERIALS],
    playerAccount: process.env.PLAYER_ACCOUNT_ID || null,
    playerKey: process.env.PLAYER_PRIVATE_KEY || null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--serials' && argv[i + 1]) {
      opts.serials = [];
      for (const part of argv[++i].split(',')) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
          const [a, b] = trimmed.split('-').map(Number);
          for (let n = a; n <= b; n++) opts.serials.push(n);
        } else if (trimmed) {
          opts.serials.push(Number(trimmed));
        }
      }
    } else if (arg === '--player-account' && argv[i + 1]) {
      opts.playerAccount = argv[++i];
    } else if (arg === '--player-key' && argv[i + 1]) {
      opts.playerKey = argv[++i];
    }
  }

  opts.serials = [...new Set(opts.serials)].sort((a, b) => a - b);
  return opts;
}

function buildClient() {
  const network = process.env.HEDERA_NETWORK || 'testnet';
  const operatorId = AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID);
  const operatorKey = parsePrivateKey(process.env.OPERATOR_PRIVATE_KEY);
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  return client;
}

async function getNftOwner(tokenId, serial) {
  const url = `${MIRROR}/api/v1/tokens/${tokenId}/nfts/${serial}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror Node ${res.status} for serial ${serial}`);
  const data = await res.json();
  return data.account_id || null;
}

async function recallToTreasury(client, { tokenId, serial, fromAccount, toAccount, fromKey }) {
  const tx = await new TransferTransaction()
    .addNftTransfer(tokenId, serial, fromAccount, toAccount)
    .freezeWith(client);
  const signed = await tx.sign(fromKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);
  console.log(`  ↩ Serial #${serial}: recalled ${fromAccount} → ${toAccount}`);
}

async function burnSerials(client, { tokenId, serials, supplyKey }) {
  const tx = await new TokenBurnTransaction()
    .setTokenId(tokenId)
    .setSerials(serials)
    .freezeWith(client);
  const signed = await tx.sign(supplyKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);
  console.log(`  🔥 Burned serials [${serials.join(', ')}] — status ${receipt.status}`);
}

function cleanLocalDb(tokenId, serials) {
  try {
    const { db } = require('../src/db/database');
    const placeholders = serials.map(() => '?').join(',');
    const params = serials;

    db.prepare(`DELETE FROM listings WHERE serialNumber IN (${placeholders})`).run(...params);
    db.prepare(
      `DELETE FROM trades WHERE card1Serial IN (${placeholders}) OR card2Serial IN (${placeholders})`
    ).run(...params, ...params);
    db.prepare(
      `DELETE FROM duels WHERE challengerCardSerial IN (${placeholders}) OR targetCardSerial IN (${placeholders})`
    ).run(...params, ...params);
    const result = db.prepare(
      `DELETE FROM cards WHERE tokenId = ? AND serialNumber IN (${placeholders})`
    ).run(tokenId, ...params);
    console.log(`  🗑 Local DB: removed ${result.changes} card row(s)`);
  } catch (err) {
    console.warn(`  ⚠ Could not update local DB: ${err.message}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const tokenId = process.env.TOKEN_ID;
  const treasuryId = process.env.TREASURY_ACCOUNT_ID;

  if (!tokenId || !treasuryId || !process.env.TREASURY_PRIVATE_KEY) {
    console.error('Set TOKEN_ID, TREASURY_ACCOUNT_ID, and TREASURY_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const supplyKey = parsePrivateKey(process.env.TREASURY_PRIVATE_KEY);
  let playerKey = null;
  if (opts.playerKey) {
    playerKey = parsePrivateKey(opts.playerKey);
  }

  console.log(`Token: ${tokenId}`);
  console.log(`Treasury: ${treasuryId}`);
  console.log(`Serials to burn: ${opts.serials.join(', ')}`);
  if (opts.dryRun) console.log('DRY RUN — no transactions will be submitted\n');

  const client = buildClient();
  const toBurn = [];
  const missing = [];

  for (const serial of opts.serials) {
    const owner = await getNftOwner(tokenId, serial);
    if (!owner) {
      missing.push(serial);
      console.log(`  Serial #${serial}: not found on chain (already burned or never minted)`);
      continue;
    }

    if (owner === treasuryId) {
      toBurn.push(serial);
      console.log(`  Serial #${serial}: on treasury — queued for burn`);
      continue;
    }

    if (opts.playerAccount && owner === opts.playerAccount && playerKey) {
      if (opts.dryRun) {
        console.log(`  Serial #${serial}: on ${owner} — would recall then burn`);
        toBurn.push(serial);
        continue;
      }
      try {
        await recallToTreasury(client, {
          tokenId,
          serial,
          fromAccount: owner,
          toAccount: treasuryId,
          fromKey: playerKey,
        });
        toBurn.push(serial);
      } catch (err) {
        console.error(`  Serial #${serial}: recall failed — ${err.message}`);
      }
      continue;
    }

    console.error(
      `  Serial #${serial}: held by ${owner} — burn blocked. ` +
        `Transfer it to treasury first, or pass --player-account and --player-key for that account.`
    );
  }

  if (missing.length) {
    cleanLocalDb(tokenId, missing);
  }

  if (toBurn.length === 0) {
    console.log('\nNothing to burn on-chain.');
    client.close();
    return;
  }

  if (opts.dryRun) {
    console.log(`\nWould burn ${toBurn.length} serial(s): ${toBurn.join(', ')}`);
    client.close();
    return;
  }

  console.log(`\nBurning ${toBurn.length} serial(s)...`);
  try {
    await burnSerials(client, { tokenId, serials: toBurn, supplyKey });
    cleanLocalDb(tokenId, toBurn);
    if (missing.length) {
      console.log(`Also cleaned local DB for missing serials: ${missing.join(', ')}`);
    }
    console.log('\nDone. Burned serials are gone permanently; total supply on Hedera is reduced.');
  } catch (err) {
    console.error(`\nBurn failed: ${err.message}`);
    process.exit(1);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
