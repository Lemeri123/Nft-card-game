'use strict';

/**
 * CardMinter — mints individual NFT cards on Hedera
 *
 * How minting works on Hedera:
 * 1. We upload the card's metadata JSON to IPFS and get back a CID
 *    (Content Identifier — a hash of the content, e.g. "QmXyz...").
 * 2. We submit a TokenMintTransaction with that CID as the metadata bytes.
 * 3. Hedera assigns a unique serial number to the new card automatically.
 * 4. We store the serial → metadata mapping locally for fast lookups.
 *
 * Why IPFS for metadata?
 * Storing large JSON on-chain is expensive. IPFS lets us store the data
 * off-chain but still reference it immutably — the CID is a cryptographic
 * hash, so if anyone tampers with the file the CID changes and you'd know.
 */

const { TokenMintTransaction } = require('@hashgraph/sdk');
const { parseCardMetadata, printCardMetadata } = require('./cardMetadata');
const { db } = require('../db/database');

/**
 * Uploads metadata JSON to IPFS and returns the CID.
 * In production, replace this with a real IPFS client (NFT.Storage, Pinata, etc.)
 * In test/dev mode (IPFS_STUB=true or no IPFS_ENDPOINT set), returns a fake CID.
 *
 * @param {string} metadataJson
 * @returns {Promise<string>} IPFS CID
 */
async function uploadToIpfs(metadataJson) {
  if (process.env.IPFS_STUB === 'true' || !process.env.IPFS_ENDPOINT) {
    // Deterministic stub CID based on content length — good enough for dev/test
    const hash = Buffer.from(metadataJson).toString('base64').slice(0, 32);
    return `QmSTUB${hash}`;
  }

  // Real IPFS upload via HTTP (works with NFT.Storage, Pinata, or a local node)
  const response = await fetch(process.env.IPFS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.IPFS_API_KEY ? { Authorization: `Bearer ${process.env.IPFS_API_KEY}` } : {}),
    },
    body: metadataJson,
  });

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.cid || data.IpfsHash; // NFT.Storage returns `cid`, Pinata returns `IpfsHash`
}

/**
 * Mints a single NFT card on Hedera.
 *
 * @param {object} options
 * @param {import('@hashgraph/sdk').Client} options.client
 * @param {string} options.tokenId - The card collection token ID (e.g. "0.0.1234")
 * @param {import('@hashgraph/sdk').PrivateKey} options.supplyKey
 * @param {object} options.metadata - CardMetadata object (will be validated)
 * @param {number} options.currentSupply - Current number of minted cards
 * @param {number} options.maxSupply - Maximum allowed cards
 * @param {object} [options._deps] - Injectable deps for testing
 * @returns {Promise<{ serialNumber: number, transactionId: string }>}
 */
async function mintCard(options) {
  const {
    client,
    tokenId,
    supplyKey,
    metadata,
    currentSupply,
    maxSupply,
    _deps,
  } = options;

  // Guard: reject if collection is full
  if (currentSupply >= maxSupply) {
    const err = new Error(`COLLECTION_FULL: cannot mint, supply is at maximum (${maxSupply})`);
    err.code = 'COLLECTION_FULL';
    throw err;
  }

  // Validate metadata — throws if invalid
  const metadataJson = printCardMetadata(parseCardMetadata(printCardMetadata(metadata)));

  // Upload to IPFS (or stub in dev mode)
  const ipfsUpload = (_deps && _deps.uploadToIpfs) || uploadToIpfs;
  const cid = await ipfsUpload(metadataJson);

  // Mint the NFT on Hedera
  // The metadata bytes on-chain are the UTF-8 encoded CID string
  const MintTx = (_deps && _deps.TokenMintTransaction) || TokenMintTransaction;

  let tx;
  try {
    tx = await new MintTx()
      .setTokenId(tokenId)
      .setMetadata([Buffer.from(cid)])
      .freezeWith(client);

    const signedTx = await tx.sign(supplyKey);
    const response = await signedTx.execute(client);
    const receipt = await response.getReceipt(client);

    // Hedera returns the new serial numbers in the receipt
    const serialNumber = Number(receipt.serials[0]);
    const transactionId = response.transactionId.toString();

    // Persist the serial → metadata mapping locally
    const dbInstance = (_deps && _deps.db) || db;
    dbInstance.prepare(`
      INSERT OR REPLACE INTO cards (tokenId, serialNumber, ownerAccountId, metadataCid, metadataJson)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenId, serialNumber, 'treasury', cid, metadataJson);

    console.log(`[CardMinter] Minted card serial #${serialNumber} (txId: ${transactionId})`);
    return { serialNumber, transactionId };
  } catch (err) {
    if (err.code === 'COLLECTION_FULL') throw err;
    const txId = tx ? tx.transactionId?.toString() : 'unknown';
    throw new Error(`Mint failed (txId: ${txId}): ${err.message}`);
  }
}

module.exports = { mintCard, uploadToIpfs };
