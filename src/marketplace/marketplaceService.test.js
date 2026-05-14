/**
 * MarketplaceService tests — Property 5 + unit tests
 *
 * Property 5: Listing price is always positive
 * For any price <= 0, listCard must reject the listing.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { listCard, purchaseCard, invalidateListing, getActiveListings } from './marketplaceService.js';

const TOKEN_ID = '0.0.1234';
const SELLER = '0.0.SELLER';
const BUYER = '0.0.BUYER';
const fakeKey = { toString: () => 'key' };

// Build a fake db that returns a card owned by the given account
function makeDb({ cardOwner = SELLER, listing = null } = {}) {
  let lastQuery = '';
  const runMock = vi.fn();
  const allMock = vi.fn().mockReturnValue(listing ? [listing] : []);
  const getMock = vi.fn().mockImplementation((...args) => {
    if (lastQuery.includes('listings')) return listing;
    // card lookup — first arg is serialNumber
    return cardOwner ? { ownerAccountId: cardOwner } : null;
  });

  return {
    prepare: vi.fn().mockImplementation((query) => {
      lastQuery = query;
      return { get: getMock, run: runMock, all: allMock };
    }),
    _runMock: runMock,
    _allMock: allMock,
  };
}

// Build a fake TransferTransaction for purchase
function makeTransferTx(txId = '0.0.1@123.000', shouldFail = false) {
  const instance = {
    addNftTransfer: vi.fn().mockReturnThis(),
    addHbarTransfer: vi.fn().mockReturnThis(),
    freezeWith: vi.fn(),
    sign: vi.fn(),
    execute: vi.fn(),
    transactionId: { toString: () => txId },
  };

  if (shouldFail) {
    instance.freezeWith.mockRejectedValue(new Error('INSUFFICIENT_PAYER_BALANCE'));
  } else {
    instance.freezeWith.mockResolvedValue(instance);
    instance.sign.mockResolvedValue(instance);
    instance.execute.mockResolvedValue({
      transactionId: { toString: () => txId },
      getReceipt: vi.fn().mockResolvedValue({}),
    });
  }

  return { Tx: vi.fn(function () { return instance; }), instance };
}

describe('MarketplaceService — listCard', () => {
  // Feature: nft-card-game, Property 5: Listing price is always positive
  // For any price <= 0, listCard must reject with INVALID_PRICE.
  it('Property 5: rejects any listing price <= 0', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(0), fc.integer({ max: -1 })),
        (invalidPrice) => {
          const fakeDb = makeDb();
          expect(() => listCard({
            sellerId: SELLER, tokenId: TOKEN_ID, serialNumber: 1,
            priceHbar: invalidPrice,
            _deps: { db: fakeDb },
          })).toThrow('INVALID_PRICE');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns a listingId when seller owns the card and price is valid', () => {
    const fakeDb = makeDb();
    const result = listCard({
      sellerId: SELLER, tokenId: TOKEN_ID, serialNumber: 1, priceHbar: 5,
      _deps: { db: fakeDb },
    });
    expect(result.listingId).toBeTruthy();
  });

  it('throws CARD_NOT_OWNED when seller does not own the card', () => {
    const fakeDb = makeDb({ cardOwner: '0.0.OTHER' });
    expect(() => listCard({
      sellerId: SELLER, tokenId: TOKEN_ID, serialNumber: 1, priceHbar: 5,
      _deps: { db: fakeDb },
    })).toThrow('CARD_NOT_OWNED');
  });
});

describe('MarketplaceService — purchaseCard', () => {
  const fakeListing = {
    listingId: 'listing-1', tokenId: TOKEN_ID, serialNumber: 1,
    sellerAccountId: SELLER, priceHbar: 10, status: 'active',
  };

  it('constructs an atomic NFT + HBAR transfer', async () => {
    const fakeDb = makeDb({ listing: fakeListing });
    const { Tx, instance } = makeTransferTx();

    await purchaseCard({
      client: {}, listingId: 'listing-1', buyerId: BUYER,
      buyerKey: fakeKey, sellerKey: fakeKey, buyerHbarBalance: 20,
      _deps: { db: fakeDb, TransferTransaction: Tx, Hbar: vi.fn(function (v) { return { v }; }), logTransaction: vi.fn() },
    });

    expect(instance.addNftTransfer).toHaveBeenCalledWith(TOKEN_ID, 1, SELLER, BUYER);
    expect(instance.addHbarTransfer).toHaveBeenCalledTimes(2);
  });

  it('throws INSUFFICIENT_BALANCE when buyer cannot cover price + fees', async () => {
    const fakeDb = makeDb({ listing: fakeListing });
    const { Tx } = makeTransferTx();

    await expect(purchaseCard({
      client: {}, listingId: 'listing-1', buyerId: BUYER,
      buyerKey: fakeKey, sellerKey: fakeKey, buyerHbarBalance: 5, // needs 10.1
      _deps: { db: fakeDb, TransferTransaction: Tx, Hbar: vi.fn(function (v) { return { v }; }), logTransaction: vi.fn() },
    })).rejects.toThrow('INSUFFICIENT_BALANCE');
  });
});

describe('MarketplaceService — invalidateListing / getActiveListings', () => {
  it('invalidateListing marks listing as expired', () => {
    const fakeDb = makeDb();
    invalidateListing({ listingId: 'listing-1', _deps: { db: fakeDb } });
    expect(fakeDb._runMock).toHaveBeenCalledWith('listing-1');
  });

  it('getActiveListings returns only active listings', () => {
    const fakeListing = { listingId: 'l1', status: 'active' };
    const fakeDb = makeDb({ listing: fakeListing });
    const results = getActiveListings({ _deps: { db: fakeDb } });
    expect(results).toEqual([fakeListing]);
  });
});
