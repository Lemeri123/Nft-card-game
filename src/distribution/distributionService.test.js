/**
 * DistributionService unit tests
 *
 * Tests verify:
 * 1. Rejection when card is not owned by Treasury
 * 2. TransferTransaction is built with correct NFT transfer parameters
 * 3. Ownership record is updated after confirmed transfer
 */

import { describe, it, expect, vi } from 'vitest';
import { distributeCard } from './distributionService.js';

// Build a fake TransferTransaction
function makeTransferTx(txId = '0.0.1@123.000') {
  const instance = {
    addNftTransfer: vi.fn().mockReturnThis(),
    freezeWith: vi.fn(),
    sign: vi.fn(),
    execute: vi.fn(),
    transactionId: { toString: () => txId },
  };

  instance.freezeWith.mockResolvedValue(instance);
  instance.sign.mockResolvedValue(instance);
  instance.execute.mockResolvedValue({
    transactionId: { toString: () => txId },
    getReceipt: vi.fn().mockResolvedValue({}),
  });

  return { Tx: vi.fn(function () { return instance; }), instance };
}

// Build a fake db with a card owned by treasury
function makeDb(ownerAccountId = 'treasury') {
  const runMock = vi.fn();
  const getMock = vi.fn().mockReturnValue(
    ownerAccountId !== null ? { ownerAccountId } : null
  );

  return {
    prepare: vi.fn().mockReturnValue({ get: getMock, run: runMock }),
    _getMock: getMock,
    _runMock: runMock,
  };
}

const baseOptions = {
  client: {},
  tokenId: '0.0.1234',
  serialNumber: 7,
  treasuryAccountId: '0.0.100',
  treasuryKey: { toString: () => 'treasury-key' },
  recipientAccountId: '0.0.200',
};

describe('DistributionService', () => {
  it('rejects when card is not found in the collection', async () => {
    const fakeDb = makeDb(null); // null = card not found
    const { Tx } = makeTransferTx();

    await expect(
      distributeCard({ ...baseOptions, _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() } })
    ).rejects.toThrow('CARD_NOT_FOUND');
  });

  it('rejects when card is not owned by Treasury', async () => {
    const fakeDb = makeDb('0.0.999'); // owned by someone else
    const { Tx } = makeTransferTx();

    await expect(
      distributeCard({ ...baseOptions, _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() } })
    ).rejects.toThrow('CARD_NOT_OWNED');
  });

  it('builds TransferTransaction with correct NFT transfer parameters', async () => {
    const fakeDb = makeDb('treasury');
    const { Tx, instance } = makeTransferTx();

    await distributeCard({
      ...baseOptions,
      _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() },
    });

    expect(instance.addNftTransfer).toHaveBeenCalledWith(
      '0.0.1234', // tokenId
      7,          // serialNumber
      '0.0.100',  // from treasury
      '0.0.200'   // to recipient
    );
  });

  it('updates ownership record after confirmed transfer', async () => {
    const fakeDb = makeDb('treasury');
    const { Tx } = makeTransferTx();

    await distributeCard({
      ...baseOptions,
      _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() },
    });

    // The second prepare().run() call should update the owner
    expect(fakeDb._runMock).toHaveBeenCalledWith('0.0.200', 7, '0.0.1234');
  });

  it('returns the transactionId on success', async () => {
    const fakeDb = makeDb('treasury');
    const { Tx } = makeTransferTx('0.0.1@555.000');

    const result = await distributeCard({
      ...baseOptions,
      _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() },
    });

    expect(result.transactionId).toBe('0.0.1@555.000');
  });
});
