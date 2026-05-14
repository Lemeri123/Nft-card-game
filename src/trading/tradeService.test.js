/**
 * TradeService unit tests
 *
 * Tests verify:
 * 1. A single TransferTransaction is built with two NFT transfers (atomic swap)
 * 2. Rejection when either player no longer owns their card
 * 3. Ownership records are unchanged when the on-chain transaction fails
 */

import { describe, it, expect, vi } from 'vitest';
import { proposeTrade, executeTrade } from './tradeService.js';

// Build a fake TransferTransaction
function makeTransferTx(txId = '0.0.1@123.000', shouldFail = false) {
  const instance = {
    addNftTransfer: vi.fn().mockReturnThis(),
    freezeWith: vi.fn(),
    sign: vi.fn(),
    execute: vi.fn(),
    transactionId: { toString: () => txId },
  };

  if (shouldFail) {
    instance.freezeWith.mockRejectedValue(new Error('TRANSACTION_EXPIRED'));
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

// Build a fake db with configurable card ownership
function makeDb({ card1Owner = '0.0.P1', card2Owner = '0.0.P2', trade = null } = {}) {
  const runMock = vi.fn();

  // Track which query is being prepared so get() returns the right thing
  let lastQuery = '';
  const getMock = vi.fn().mockImplementation((...args) => {
    // Trade lookup: SELECT * FROM trades WHERE tradeId = ?
    if (lastQuery.includes('trades')) return trade;
    // Card lookup: first arg is serialNumber
    const serial = args[0];
    if (serial === 1) return card1Owner ? { ownerAccountId: card1Owner } : null;
    if (serial === 2) return card2Owner ? { ownerAccountId: card2Owner } : null;
    return null;
  });

  return {
    prepare: vi.fn().mockImplementation((query) => {
      lastQuery = query;
      return { get: getMock, run: runMock, all: vi.fn().mockReturnValue([]) };
    }),
    _getMock: getMock,
    _runMock: runMock,
  };
}

const TOKEN_ID = '0.0.1234';
const P1 = '0.0.P1';
const P2 = '0.0.P2';
const fakeKey = { toString: () => 'key' };

describe('TradeService — proposeTrade', () => {
  it('returns a tradeId when both players own their cards', () => {
    const fakeDb = makeDb();
    const result = proposeTrade({
      player1Id: P1, card1Serial: 1,
      player2Id: P2, card2Serial: 2,
      tokenId: TOKEN_ID,
      _deps: { db: fakeDb },
    });
    expect(result.tradeId).toBeTruthy();
    expect(typeof result.tradeId).toBe('string');
  });

  it('throws CARD_NOT_OWNED when player 1 does not own their card', () => {
    const fakeDb = makeDb({ card1Owner: '0.0.OTHER' });
    expect(() => proposeTrade({
      player1Id: P1, card1Serial: 1,
      player2Id: P2, card2Serial: 2,
      tokenId: TOKEN_ID,
      _deps: { db: fakeDb },
    })).toThrow('CARD_NOT_OWNED');
  });

  it('throws CARD_NOT_OWNED when player 2 does not own their card', () => {
    const fakeDb = makeDb({ card2Owner: '0.0.OTHER' });
    expect(() => proposeTrade({
      player1Id: P1, card1Serial: 1,
      player2Id: P2, card2Serial: 2,
      tokenId: TOKEN_ID,
      _deps: { db: fakeDb },
    })).toThrow('CARD_NOT_OWNED');
  });
});

describe('TradeService — executeTrade', () => {
  const fakeTrade = {
    tradeId: 'trade-123',
    player1Id: P1, card1Serial: 1,
    player2Id: P2, card2Serial: 2,
  };

  it('builds a single TransferTransaction with two NFT transfers', async () => {
    const fakeDb = makeDb({ trade: fakeTrade });
    const { Tx, instance } = makeTransferTx();

    await executeTrade({
      client: {}, tradeId: 'trade-123', tokenId: TOKEN_ID,
      sig1: fakeKey, sig2: fakeKey,
      _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() },
    });

    // addNftTransfer must be called exactly twice — once per direction
    expect(instance.addNftTransfer).toHaveBeenCalledTimes(2);
    expect(instance.addNftTransfer).toHaveBeenCalledWith(TOKEN_ID, 1, P1, P2);
    expect(instance.addNftTransfer).toHaveBeenCalledWith(TOKEN_ID, 2, P2, P1);
  });

  it('throws CARD_NOT_OWNED when card has moved since proposal', async () => {
    // card1 now owned by someone else
    const fakeDb = makeDb({ card1Owner: '0.0.THIEF', trade: fakeTrade });
    const { Tx } = makeTransferTx();

    await expect(executeTrade({
      client: {}, tradeId: 'trade-123', tokenId: TOKEN_ID,
      sig1: fakeKey, sig2: fakeKey,
      _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() },
    })).rejects.toThrow('CARD_NOT_OWNED');
  });

  it('leaves ownership records unchanged when on-chain transaction fails', async () => {
    const fakeDb = makeDb({ trade: fakeTrade });
    const { Tx } = makeTransferTx('0.0.1@123.000', true); // shouldFail = true

    await expect(executeTrade({
      client: {}, tradeId: 'trade-123', tokenId: TOKEN_ID,
      sig1: fakeKey, sig2: fakeKey,
      _deps: { db: fakeDb, TransferTransaction: Tx, logTransaction: vi.fn() },
    })).rejects.toThrow('Trade failed');

    // run() should NOT have been called to update ownership
    expect(fakeDb._runMock).not.toHaveBeenCalledWith(P2, 1, TOKEN_ID);
    expect(fakeDb._runMock).not.toHaveBeenCalledWith(P1, 2, TOKEN_ID);
  });
});
