/**
 * PlayerManager unit tests
 *
 * Tests cover the three guard conditions before token association:
 * 1. Account not found → ACCOUNT_NOT_FOUND error
 * 2. Insufficient HBAR → INSUFFICIENT_BALANCE error
 * 3. Already associated → success with alreadyAssociated: true (no error)
 */

import { describe, it, expect, vi } from 'vitest';
import { registerPlayer, verifyAccountExists } from './playerManager.js';

// Helper: build a fake AccountBalanceQuery that returns a given HBAR balance
function makeBalanceQuery(hbarAmount, throwMessage = null) {
  const instance = {
    setAccountId: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  };

  if (throwMessage) {
    instance.execute.mockRejectedValue(new Error(throwMessage));
  } else {
    instance.execute.mockResolvedValue({
      hbars: {
        to: vi.fn().mockReturnValue({ toNumber: vi.fn().mockReturnValue(hbarAmount) }),
      },
    });
  }

  return vi.fn(function () { return instance; });
}

// Helper: build a fake TokenAssociateTransaction
function makeAssociateTx(throwMessage = null) {
  const instance = {
    setAccountId: vi.fn().mockReturnThis(),
    setTokenIds: vi.fn().mockReturnThis(),
    freezeWith: vi.fn(),
    sign: vi.fn(),
    execute: vi.fn(),
  };

  if (throwMessage) {
    instance.freezeWith.mockRejectedValue(new Error(throwMessage));
  } else {
    instance.freezeWith.mockResolvedValue(instance);
    instance.sign.mockResolvedValue(instance);
    instance.execute.mockResolvedValue({
      getReceipt: vi.fn().mockResolvedValue({}),
    });
  }

  return { Tx: vi.fn(function () { return instance; }), instance };
}

const baseOptions = {
  client: {},
  accountId: '0.0.1234',
  playerKey: { toString: () => 'player-key' },
  tokenId: '0.0.5678',
};

describe('PlayerManager — registerPlayer', () => {
  it('throws ACCOUNT_NOT_FOUND when account does not exist', async () => {
    const deps = {
      AccountBalanceQuery: makeBalanceQuery(0, 'INVALID_ACCOUNT_ID'),
      TokenAssociateTransaction: makeAssociateTx().Tx,
      Hbar: vi.fn(),
      HbarUnit: { Hbar: 'hbar' },
    };

    await expect(registerPlayer({ ...baseOptions, _deps: deps }))
      .rejects.toThrow('ACCOUNT_NOT_FOUND');
  });

  it('throws INSUFFICIENT_BALANCE when HBAR balance is below 0.1', async () => {
    const deps = {
      // First call (verifyAccountExists) succeeds, second call (balance check) returns low balance
      AccountBalanceQuery: makeBalanceQuery(0.05),
      TokenAssociateTransaction: makeAssociateTx().Tx,
      Hbar: vi.fn(),
      HbarUnit: { Hbar: 'hbar' },
    };

    await expect(registerPlayer({ ...baseOptions, _deps: deps }))
      .rejects.toThrow('INSUFFICIENT_BALANCE');
  });

  it('returns alreadyAssociated: true when token is already associated', async () => {
    const { Tx } = makeAssociateTx('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT');
    const deps = {
      AccountBalanceQuery: makeBalanceQuery(10), // plenty of HBAR
      TokenAssociateTransaction: Tx,
      Hbar: vi.fn(),
      HbarUnit: { Hbar: 'hbar' },
    };

    const result = await registerPlayer({ ...baseOptions, _deps: deps });
    expect(result.success).toBe(true);
    expect(result.alreadyAssociated).toBe(true);
  });

  it('returns success: true, alreadyAssociated: false on first registration', async () => {
    const { Tx } = makeAssociateTx();
    const deps = {
      AccountBalanceQuery: makeBalanceQuery(5),
      TokenAssociateTransaction: Tx,
      Hbar: vi.fn(),
      HbarUnit: { Hbar: 'hbar' },
    };

    const result = await registerPlayer({ ...baseOptions, _deps: deps });
    expect(result.success).toBe(true);
    expect(result.alreadyAssociated).toBe(false);
  });
});

describe('PlayerManager — verifyAccountExists', () => {
  it('returns true when account exists', async () => {
    const deps = { AccountBalanceQuery: makeBalanceQuery(1) };
    const result = await verifyAccountExists({ client: {}, accountId: '0.0.1', _deps: deps });
    expect(result).toBe(true);
  });

  it('returns false when INVALID_ACCOUNT_ID is thrown', async () => {
    const deps = { AccountBalanceQuery: makeBalanceQuery(0, 'INVALID_ACCOUNT_ID') };
    const result = await verifyAccountExists({ client: {}, accountId: '0.0.999', _deps: deps });
    expect(result).toBe(false);
  });
});
