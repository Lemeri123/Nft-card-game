/**
 * InventoryService tests — Property 9 + unit tests
 *
 * Property 9: Cache does not serve stale data beyond TTL
 * For any elapsed time > 30,000ms since last fetch, the service must
 * call the Mirror Node again rather than returning cached data.
 *
 * We mock Date.now() and the fetch function to control time and network
 * responses without making real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { getPlayerInventory, clearCache } from './inventoryService.js';

const ACCOUNT_ID = '0.0.1234';
const TOKEN_ID = '0.0.5678';

// Build a fake fetch that returns a given set of NFTs
function makeFetch(nfts = [{ serial_number: 1 }]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ nfts }),
  });
}

beforeEach(() => {
  clearCache();
  vi.restoreAllMocks();
});

describe('InventoryService', () => {
  // Feature: nft-card-game, Property 9: Cache does not serve stale data beyond TTL
  // For any elapsed time > 30,000ms, the service must fetch fresh data.
  it('Property 9: fetches fresh data when cache is older than 30 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 30_001, max: 600_000 }),
        async (elapsedMs) => {
          clearCache();

          let currentTime = 1_000_000;
          const nowFn = vi.fn().mockReturnValue(currentTime);
          const fetchFn = makeFetch([{ serial_number: 1 }]);

          // First call — populates cache
          await getPlayerInventory({ accountId: ACCOUNT_ID, tokenId: TOKEN_ID, _deps: { fetch: fetchFn, now: nowFn } });
          expect(fetchFn).toHaveBeenCalledTimes(1);

          // Advance time beyond TTL
          currentTime += elapsedMs;
          nowFn.mockReturnValue(currentTime);

          // Second call — cache is stale, must fetch again
          const result = await getPlayerInventory({ accountId: ACCOUNT_ID, tokenId: TOKEN_ID, _deps: { fetch: fetchFn, now: nowFn } });
          expect(fetchFn).toHaveBeenCalledTimes(2);
          expect(result.cached).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('returns cached data when within TTL', async () => {
    let currentTime = 1_000_000;
    const nowFn = vi.fn().mockReturnValue(currentTime);
    const fetchFn = makeFetch();

    // First call
    await getPlayerInventory({ accountId: ACCOUNT_ID, tokenId: TOKEN_ID, _deps: { fetch: fetchFn, now: nowFn } });

    // Advance time by less than 30s
    currentTime += 10_000;
    nowFn.mockReturnValue(currentTime);

    // Second call — should use cache
    const result = await getPlayerInventory({ accountId: ACCOUNT_ID, tokenId: TOKEN_ID, _deps: { fetch: fetchFn, now: nowFn } });
    expect(fetchFn).toHaveBeenCalledTimes(1); // no second fetch
    expect(result.cached).toBe(true);
  });

  it('returns cached data when Mirror Node is unreachable (graceful degradation)', async () => {
    let currentTime = 1_000_000;
    const nowFn = vi.fn().mockReturnValue(currentTime);
    const goodFetch = makeFetch([{ serial_number: 42 }]);

    // Populate cache with good data
    await getPlayerInventory({ accountId: ACCOUNT_ID, tokenId: TOKEN_ID, _deps: { fetch: goodFetch, now: nowFn } });

    // Advance past TTL
    currentTime += 60_000;
    nowFn.mockReturnValue(currentTime);

    // Mirror Node is now down
    const badFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await getPlayerInventory({ accountId: ACCOUNT_ID, tokenId: TOKEN_ID, _deps: { fetch: badFetch, now: nowFn } });

    // Should fall back to stale cache rather than throwing
    expect(result.cached).toBe(true);
    expect(result.cards).toEqual([{ serial_number: 42 }]);
  });

  it('throws SERVICE_UNAVAILABLE when Mirror Node is down and no cache exists', async () => {
    const badFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(
      getPlayerInventory({ accountId: '0.0.NEW', tokenId: TOKEN_ID, _deps: { fetch: badFetch, now: Date.now } })
    ).rejects.toThrow('SERVICE_UNAVAILABLE');
  });
});
