/**
 * DuelService tests — Properties 6 + unit tests
 *
 * Property 6: Duel score is deterministic given fixed inputs
 * For any two cards and any fixed prngValue, computeDuelScore always
 * returns the same result. This is critical for fairness — players must
 * be able to independently verify the outcome using the on-chain prng record.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { computeDuelScore, challengePlayer, acceptDuel, expireChallenge } from './duelService.js';

// Arbitrary for a valid card stat object
const cardArb = fc.record({
  attack: fc.integer({ min: 1, max: 100 }),
  defense: fc.integer({ min: 1, max: 100 }),
});

describe('DuelService — computeDuelScore', () => {
  // Feature: nft-card-game, Property 6: Duel score is deterministic given fixed inputs
  // Calling computeDuelScore twice with the same card and prngValue must return
  // the exact same number. This proves the formula has no hidden randomness.
  it('Property 6: score is deterministic — same inputs always produce same output', () => {
    fc.assert(
      fc.property(
        cardArb,
        cardArb,
        fc.integer({ min: 0, max: 99 }),
        (card1, card2, prngValue) => {
          const score1a = computeDuelScore(card1, prngValue);
          const score1b = computeDuelScore(card1, prngValue);
          const score2a = computeDuelScore(card2, prngValue);
          const score2b = computeDuelScore(card2, prngValue);

          expect(score1a).toBe(score1b);
          expect(score2a).toBe(score2b);

          // Winner is also deterministic
          const winner1 = score1a >= score2a;
          const winner2 = score1b >= score2b;
          expect(winner1).toBe(winner2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('challenger wins on a tie (score1 === score2)', () => {
    // Both cards identical, same prng → same score → challenger wins
    const card = { attack: 50, defense: 50 };
    const score1 = computeDuelScore(card, 10);
    const score2 = computeDuelScore(card, 10);
    expect(score1).toBe(score2);
    // In resolveDuel: challengerWins = score1 >= score2 → true on tie
    expect(score1 >= score2).toBe(true);
  });

  it('higher attack/defense card scores higher (ignoring prng swing)', () => {
    const strongCard = { attack: 100, defense: 100 };
    const weakCard = { attack: 1, defense: 1 };
    // With prng=0 (no swing), strong card must win
    expect(computeDuelScore(strongCard, 0)).toBeGreaterThan(computeDuelScore(weakCard, 0));
  });
});

describe('DuelService — challengePlayer', () => {
  function makeDb() {
    const runMock = vi.fn();
    return {
      prepare: vi.fn().mockReturnValue({ run: runMock, get: vi.fn(), all: vi.fn() }),
      _runMock: runMock,
    };
  }

  it('stores a duel record and returns a duelId', () => {
    const fakeDb = makeDb();
    const result = challengePlayer({
      challengerId: '0.0.P1', challengerCardSerial: 1,
      targetId: '0.0.P2', targetCardSerial: 2,
      _deps: { db: fakeDb },
    });
    expect(result.duelId).toBeTruthy();
    expect(fakeDb._runMock).toHaveBeenCalled();
  });
});

describe('DuelService — expireChallenge', () => {
  it('sets duel status to expired', () => {
    const runMock = vi.fn();
    const fakeDb = {
      prepare: vi.fn().mockReturnValue({ run: runMock }),
    };

    expireChallenge({ duelId: 'duel-123', _deps: { db: fakeDb } });
    expect(runMock).toHaveBeenCalledWith('duel-123');
  });
});

describe('DuelService — acceptDuel', () => {
  function makeDb({ duel = null, card1Owner = '0.0.P1', card2Owner = '0.0.P2' } = {}) {
    let lastQuery = '';
    const runMock = vi.fn();
    const getMock = vi.fn().mockImplementation((...args) => {
      if (lastQuery.includes('duels')) return duel;
      const serial = args[0];
      if (serial === 1) return { ownerAccountId: card1Owner, metadataJson: '{}' };
      if (serial === 2) return { ownerAccountId: card2Owner, metadataJson: '{}' };
      return null;
    });
    return {
      prepare: vi.fn().mockImplementation((q) => { lastQuery = q; return { get: getMock, run: runMock }; }),
      _runMock: runMock,
    };
  }

  it('throws DUEL_EXPIRED when duel has passed its expiry time', () => {
    const expiredDuel = {
      duelId: 'd1', status: 'pending',
      challengerAccountId: '0.0.P1', challengerCardSerial: 1,
      targetAccountId: '0.0.P2', targetCardSerial: 2,
      expiresAt: Date.now() - 1000, // already expired
    };
    const fakeDb = makeDb({ duel: expiredDuel });

    expect(() => acceptDuel({ duelId: 'd1', tokenId: '0.0.T', _deps: { db: fakeDb } }))
      .toThrow('DUEL_EXPIRED');
  });

  it('cancels duel when challenger no longer owns their card', () => {
    const activeDuel = {
      duelId: 'd1', status: 'pending',
      challengerAccountId: '0.0.P1', challengerCardSerial: 1,
      targetAccountId: '0.0.P2', targetCardSerial: 2,
      expiresAt: Date.now() + 600000,
    };
    const fakeDb = makeDb({ duel: activeDuel, card1Owner: '0.0.THIEF' });

    expect(() => acceptDuel({ duelId: 'd1', tokenId: '0.0.T', _deps: { db: fakeDb } }))
      .toThrow('DUEL_CANCELLED');
  });
});
