/**
 * CardMinter tests — Property 4 + unit tests
 *
 * Property 4: Minting grows the supply
 * For any current supply n below max, after a successful mint the supply
 * is n+1 and the new serial number is unique within the existing set.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { mintCard } from './cardMinter.js';

const validMetadata = {
  name: 'Shadow Dragon',
  rarity: 'legendary',
  attack: 95,
  defense: 80,
  image: 'ipfs://QmDragon',
};

// Fake db — no real SQLite needed in unit tests
const fakeDb = {
  prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
};

// Build injectable fake deps for a mint that returns a given serial number
function makeMintDeps(serialNumber = 1, txId = '0.0.1@123.000') {
  const txInstance = {
    setTokenId: vi.fn().mockReturnThis(),
    setMetadata: vi.fn().mockReturnThis(),
    freezeWith: vi.fn(),
    sign: vi.fn(),
    execute: vi.fn(),
    transactionId: { toString: () => txId },
  };

  txInstance.freezeWith.mockResolvedValue(txInstance);
  txInstance.sign.mockResolvedValue(txInstance);
  txInstance.execute.mockResolvedValue({
    transactionId: { toString: () => txId },
    getReceipt: vi.fn().mockResolvedValue({
      serials: [serialNumber], // plain number — Number(serialNumber) works fine
    }),
  });

  return {
    TokenMintTransaction: vi.fn(function () { return txInstance; }),
    uploadToIpfs: vi.fn().mockResolvedValue('QmFakeCid123'),
    db: fakeDb,
    _txInstance: txInstance,
  };
}

function makeOptions(overrides = {}) {
  return {
    client: {},
    tokenId: '0.0.1234',
    supplyKey: { toString: () => 'supply-key' },
    metadata: validMetadata,
    currentSupply: 0,
    maxSupply: 1000,
    ...overrides,
  };
}

describe('CardMinter', () => {
  // Feature: nft-card-game, Property 4: Minting grows the supply
  // For any starting supply n, two sequential mints produce two distinct serial numbers.
  // fc.asyncProperty is required because the property callback is async.
  it('Property 4: minting grows supply — each serial number is unique', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 998 }),
        async (startSupply) => {
          const serials = new Set();

          for (let i = 0; i < 2; i++) {
            const expectedSerial = startSupply + i + 1;
            const deps = makeMintDeps(expectedSerial);
            const result = await mintCard(
              makeOptions({ currentSupply: startSupply + i, _deps: deps })
            );
            expect(result.serialNumber).toBe(expectedSerial);
            expect(serials.has(result.serialNumber)).toBe(false);
            serials.add(result.serialNumber);
          }

          expect(serials.size).toBe(2);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('rejects mint when collection is full', async () => {
    const deps = makeMintDeps(1);
    await expect(
      mintCard(makeOptions({ currentSupply: 1000, maxSupply: 1000, _deps: deps }))
    ).rejects.toThrow('COLLECTION_FULL');
  });

  it('returns serialNumber and transactionId on success', async () => {
    const deps = makeMintDeps(42, '0.0.99@999.000');
    const result = await mintCard(makeOptions({ _deps: deps }));

    expect(result.serialNumber).toBe(42);
    expect(result.transactionId).toBe('0.0.99@999.000');
  });

  it('calls TokenMintTransaction with the token ID and CID bytes', async () => {
    const deps = makeMintDeps(1);
    await mintCard(makeOptions({ _deps: deps }));

    expect(deps._txInstance.setTokenId).toHaveBeenCalledWith('0.0.1234');
    expect(deps._txInstance.setMetadata).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Buffer)])
    );
  });

  it('wraps SDK errors with mint failed message', async () => {
    const deps = makeMintDeps(1);
    deps._txInstance.freezeWith.mockRejectedValue(new Error('TOKEN_NOT_FOUND'));

    await expect(mintCard(makeOptions({ _deps: deps }))).rejects.toThrow('Mint failed');
  });
});
