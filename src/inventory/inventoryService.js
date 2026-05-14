'use strict';

/**
 * InventoryService — queries player card inventories via the Hedera Mirror Node
 *
 * Why use the Mirror Node instead of consensus node queries?
 * Consensus node queries cost HBAR. Mirror Node REST API queries are free.
 * For read-heavy operations like "show me my cards", the Mirror Node is
 * the right tool. It's eventually consistent (a few seconds behind the
 * consensus nodes) but that's fine for inventory display.
 *
 * Caching strategy:
 * We cache results for 30 seconds. After that, we fetch fresh data.
 * The response always includes { cached: true/false } so the client
 * knows whether they're seeing live or cached data.
 *
 * Mirror Node endpoints used:
 * - GET /api/v1/accounts/{accountId}/nfts?token.id={tokenId}  → player's NFTs
 * - GET /api/v1/tokens/{tokenId}/nfts/{serialNumber}           → single card
 * - GET /api/v1/transactions?account.id={accountId}            → tx history
 */

const CACHE_TTL_MS = 30_000; // 30 seconds

// In-memory cache: key → { data, fetchedAt }
const cache = new Map();

/**
 * Returns the Mirror Node base URL from env, defaulting to testnet.
 */
function getMirrorNodeUrl() {
  return process.env.MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com';
}

/**
 * Fetches a URL, returning parsed JSON. Throws on non-2xx responses.
 * Injectable via _deps.fetch for testing.
 */
async function fetchJson(url, fetchFn) {
  const fn = fetchFn || fetch;
  const response = await fn(url);
  if (!response.ok) {
    throw new Error(`Mirror Node request failed: ${response.status} ${url}`);
  }
  return response.json();
}

/**
 * Gets all NFT cards owned by a player account.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {string} options.tokenId
 * @param {object} [options._deps] - { fetch, now } for testing
 * @returns {Promise<{ cards: object[], cached: boolean }>}
 */
async function getPlayerInventory(options) {
  const { accountId, tokenId, _deps } = options;
  const nowFn = (_deps && _deps.now) || Date.now;
  const fetchFn = _deps && _deps.fetch;

  const cacheKey = `inventory:${accountId}:${tokenId}`;
  const cached = cache.get(cacheKey);

  if (cached && nowFn() - cached.fetchedAt < CACHE_TTL_MS) {
    return { cards: cached.data, cached: true };
  }

  try {
    const baseUrl = getMirrorNodeUrl();
    const data = await fetchJson(
      `${baseUrl}/api/v1/accounts/${accountId}/nfts?token.id=${tokenId}`,
      fetchFn
    );

    cache.set(cacheKey, { data: data.nfts || [], fetchedAt: nowFn() });
    return { cards: data.nfts || [], cached: false };
  } catch (err) {
    // If Mirror Node is down but we have stale cache, return it
    if (cached) {
      return { cards: cached.data, cached: true };
    }
    const serviceErr = new Error('SERVICE_UNAVAILABLE: Mirror Node is unreachable');
    serviceErr.code = 'SERVICE_UNAVAILABLE';
    throw serviceErr;
  }
}

/**
 * Gets details for a single card by serial number.
 *
 * @param {object} options
 * @param {string} options.tokenId
 * @param {number} options.serialNumber
 * @param {object} [options._deps]
 * @returns {Promise<object>}
 */
async function getCardDetails(options) {
  const { tokenId, serialNumber, _deps } = options;
  const fetchFn = _deps && _deps.fetch;

  const baseUrl = getMirrorNodeUrl();
  return fetchJson(
    `${baseUrl}/api/v1/tokens/${tokenId}/nfts/${serialNumber}`,
    fetchFn
  );
}

/**
 * Gets transaction history for an account from the Mirror Node.
 *
 * @param {object} options
 * @param {string} options.accountId
 * @param {object} [options._deps]
 * @returns {Promise<object[]>}
 */
async function getTransactionHistory(options) {
  const { accountId, _deps } = options;
  const fetchFn = _deps && _deps.fetch;

  const baseUrl = getMirrorNodeUrl();
  const data = await fetchJson(
    `${baseUrl}/api/v1/transactions?account.id=${accountId}`,
    fetchFn
  );
  return data.transactions || [];
}

/**
 * Clears the in-memory cache (useful for testing).
 */
function clearCache() {
  cache.clear();
}

module.exports = { getPlayerInventory, getCardDetails, getTransactionHistory, clearCache };
