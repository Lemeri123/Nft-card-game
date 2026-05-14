/**
 * CollectionManager unit tests
 *
 * We inject fake SDK constructors via config._deps — no module mocking needed.
 * This sidesteps the CJS/ESM boundary issue entirely and keeps tests simple.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCardCollection } from './collectionManager.js';

// Build a fresh chainable tx mock for each test
function makeTxMock() {
  const tx = {
    setTokenName: vi.fn().mockReturnThis(),
    setTokenSymbol: vi.fn().mockReturnThis(),
    setTokenType: vi.fn().mockReturnThis(),
    setSupplyType: vi.fn().mockReturnThis(),
    setMaxSupply: vi.fn().mockReturnThis(),
    setTreasuryAccountId: vi.fn().mockReturnThis(),
    setAdminKey: vi.fn().mockReturnThis(),
    setSupplyKey: vi.fn().mockReturnThis(),
    setCustomFees: vi.fn().mockReturnThis(),
    freezeWith: vi.fn(),
    sign: vi.fn(),
    execute: vi.fn(),
    transactionId: { toString: () => '0.0.1234@1234567890.000' },
  };
  return tx;
}

// Chainable fee mock
function makeFeeMock() {
  const fee = {};
  ['setHbarAmount', 'setFeeCollectorAccountId', 'setNumerator',
    'setDenominator', 'setFallbackFee'].forEach((m) => {
    fee[m] = vi.fn().mockReturnValue(fee);
  });
  return fee;
}

const fakeKey = { toString: () => 'fake-key' };
const fakeAccountId = { toString: () => '0.0.999' };
const fakeClient = {};

function makeConfig(txMock) {
  return {
    client: fakeClient,
    name: 'Hiero Card Game',
    symbol: 'HCG',
    maxSupply: 1000,
    royaltyNumerator: 5,
    royaltyDenominator: 100,
    fallbackFeeHbar: 1,
    treasuryAccountId: fakeAccountId,
    treasuryKey: fakeKey,
    adminKey: fakeKey,
    supplyKey: fakeKey,
    // Inject fake SDK constructors — no real Hedera calls made.
    _deps: {
      TokenCreateTransaction: vi.fn(function () { return txMock; }),
      TokenType: { NonFungibleUnique: 'NON_FUNGIBLE_UNIQUE' },
      TokenSupplyType: { Finite: 'FINITE' },
      CustomFixedFee: vi.fn(function () { return makeFeeMock(); }),
      CustomRoyaltyFee: vi.fn(function () { return makeFeeMock(); }),
      Hbar: vi.fn(function (v) { return { amount: v }; }),
    },
  };
}

describe('CollectionManager', () => {
  let tx;
  let config;

  beforeEach(() => {
    tx = makeTxMock();
    config = makeConfig(tx);

    // Happy-path chain: freezeWith → sign → sign → execute → getReceipt
    tx.freezeWith.mockResolvedValue(tx);
    tx.sign.mockResolvedValue(tx);
    tx.execute.mockResolvedValue({
      getReceipt: vi.fn().mockResolvedValue({
        tokenId: { toString: () => '0.0.5678' },
      }),
    });
  });

  it('creates a NonFungibleUnique token with Finite supply', async () => {
    await createCardCollection(config);

    expect(tx.setTokenType).toHaveBeenCalledWith('NON_FUNGIBLE_UNIQUE');
    expect(tx.setSupplyType).toHaveBeenCalledWith('FINITE');
    expect(tx.setMaxSupply).toHaveBeenCalledWith(1000);
  });

  it('sets the correct token name and symbol', async () => {
    await createCardCollection(config);

    expect(tx.setTokenName).toHaveBeenCalledWith('Hiero Card Game');
    expect(tx.setTokenSymbol).toHaveBeenCalledWith('HCG');
  });

  it('attaches adminKey and supplyKey', async () => {
    await createCardCollection(config);

    expect(tx.setAdminKey).toHaveBeenCalledWith(fakeKey);
    expect(tx.setSupplyKey).toHaveBeenCalledWith(fakeKey);
  });

  it('attaches custom fees array with one royalty fee', async () => {
    await createCardCollection(config);

    const [fees] = tx.setCustomFees.mock.calls[0];
    expect(Array.isArray(fees)).toBe(true);
    expect(fees).toHaveLength(1);
  });

  it('returns the tokenId from the receipt', async () => {
    const result = await createCardCollection(config);

    expect(result.tokenId).toBe('0.0.5678');
  });

  it('throws with "Collection creation failed" when the transaction errors', async () => {
    tx.freezeWith.mockRejectedValue(new Error('INSUFFICIENT_PAYER_BALANCE'));

    await expect(createCardCollection(config)).rejects.toThrow('Collection creation failed');
  });
});
