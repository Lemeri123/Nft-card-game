/**
 * Frontend utility tests — unit + property-based
 *
 * Tests for the pure functions in src/frontend-utils.js.
 * Uses vitest + fast-check (already in devDependencies).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CARD_ROSTER,
  decodeMetadata,
  lookupRole,
  validateAccountId,
  validateMintForm,
  validateDuelForm,
  buildDuelPayload,
} from '../src/frontend-utils.js';

// ---------------------------------------------------------------------------
// decodeMetadata — unit tests (Task 4.1)
// ---------------------------------------------------------------------------
describe('decodeMetadata', () => {
  it('decodes valid base64 JSON and returns the parsed object', () => {
    const obj = { name: 'Fire Knight', rarity: 'rare', attack: 65, defense: 50 };
    const encoded = Buffer.from(JSON.stringify(obj)).toString('base64');
    expect(decodeMetadata(encoded)).toEqual(obj);
  });

  it('returns null for invalid base64 without throwing', () => {
    expect(decodeMetadata('!!!not-base64!!!')).toBeNull();
  });

  it('returns null for valid base64 that is not JSON without throwing', () => {
    const encoded = Buffer.from('this is not json').toString('base64');
    expect(decodeMetadata(encoded)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeMetadata('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decodeMetadata — property test (Task 4.2)
// Feature: nft-card-game-frontend, Property 10: Card tile rarity class matches metadata
// ---------------------------------------------------------------------------
describe('decodeMetadata property', () => {
  it('Property 10: round-trip preserves rarity field for any object', () => {
    fc.assert(
      fc.property(
        fc.record({
          rarity: fc.constantFrom('common', 'rare', 'epic', 'legendary'),
          name: fc.string({ minLength: 1 }),
          attack: fc.integer({ min: 1, max: 100 }),
          defense: fc.integer({ min: 1, max: 100 }),
        }),
        (obj) => {
          const encoded = Buffer.from(JSON.stringify(obj)).toString('base64');
          const decoded = decodeMetadata(encoded);
          return decoded !== null && decoded.rarity === obj.rarity;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// lookupRole — unit tests (Task 4.3)
// ---------------------------------------------------------------------------
describe('lookupRole', () => {
  it('returns the correct role for a known card name', () => {
    expect(lookupRole('Fire Knight')).toBe('Warrior');
    expect(lookupRole('Void Witch')).toBe('Mage');
    expect(lookupRole('Thunder Phoenix')).toBe('Ranger');
    expect(lookupRole('Eternal Guardian')).toBe('Guardian');
  });

  it('returns null for an unknown card name', () => {
    expect(lookupRole('Unknown Card')).toBeNull();
    expect(lookupRole('')).toBeNull();
  });

  it('is case-sensitive', () => {
    expect(lookupRole('fire knight')).toBeNull();
    expect(lookupRole('FIRE KNIGHT')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateAccountId — property test (Task 4.4)
// Feature: nft-card-game-frontend, Property 3: Whitespace-only account ID is rejected
// ---------------------------------------------------------------------------
describe('validateAccountId', () => {
  it('Property 3: rejects any whitespace-only string', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1 }).map((chars) => chars.join('')),
        (s) => validateAccountId(s) === false
      ),
      { numRuns: 100 }
    );
  });

  it('returns false for empty string', () => {
    expect(validateAccountId('')).toBe(false);
  });

  it('returns true for a non-empty non-whitespace string', () => {
    expect(validateAccountId('0.0.12345')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateMintForm — property test (Task 4.5)
// Feature: nft-card-game-frontend, Property 4: Mint form requires non-empty fields
// ---------------------------------------------------------------------------
describe('validateMintForm', () => {
  it('Property 4: returns false when tokenId is empty or whitespace-only', () => {
    const whitespace = fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1 }).map((c) => c.join(''));
    const emptyOrWhitespace = fc.oneof(fc.constant(''), whitespace);
    const nonEmpty = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(emptyOrWhitespace, nonEmpty, (tokenId, accountId) => {
        return validateMintForm({ tokenId, accountId }) === false;
      }),
      { numRuns: 100 }
    );
  });

  it('Property 4: returns false when accountId is empty or whitespace-only', () => {
    const whitespace = fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1 }).map((c) => c.join(''));
    const emptyOrWhitespace = fc.oneof(fc.constant(''), whitespace);
    const nonEmpty = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(nonEmpty, emptyOrWhitespace, (tokenId, accountId) => {
        return validateMintForm({ tokenId, accountId }) === false;
      }),
      { numRuns: 100 }
    );
  });

  it('returns true when both fields are non-empty', () => {
    expect(validateMintForm({ tokenId: '0.0.123', accountId: '0.0.456' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateDuelForm — property test (Task 4.6)
// Feature: nft-card-game-frontend, Property 5: Duel form requires all six fields
// ---------------------------------------------------------------------------
describe('validateDuelForm', () => {
  const DUEL_KEYS = ['challengerId', 'challengerCardSerial', 'opponentId', 'opponentCardSerial', 'tokenId', 'wagerAmount'];
  const validFields = {
    challengerId: '0.0.1',
    challengerCardSerial: '1',
    opponentId: '0.0.2',
    opponentCardSerial: '2',
    tokenId: '0.0.3',
    wagerAmount: '10',
  };

  it('Property 5: returns false when any single field is empty', () => {
    for (const key of DUEL_KEYS) {
      expect(validateDuelForm({ ...validFields, [key]: '' })).toBe(false);
    }
  });

  it('Property 5: returns false when any single field is whitespace-only', () => {
    for (const key of DUEL_KEYS) {
      expect(validateDuelForm({ ...validFields, [key]: '   ' })).toBe(false);
    }
  });

  it('returns true when all six fields are non-empty', () => {
    expect(validateDuelForm(validFields)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDuelPayload — property test (Task 4.7)
// Feature: nft-card-game-frontend, Property 6: Numeric fields are cast to numbers
// ---------------------------------------------------------------------------
describe('buildDuelPayload numeric casting', () => {
  it('Property 6: numeric fields are typeof number in the output', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 9999 }),
        (serial1, serial2, wager) => {
          const payload = buildDuelPayload({
            challengerId: '0.0.1',
            challengerCardSerial: String(serial1),
            opponentId: '0.0.2',
            opponentCardSerial: String(serial2),
            tokenId: '0.0.3',
            wagerAmount: String(wager),
          });
          return (
            typeof payload.challengerCardSerial === 'number' &&
            typeof payload.targetCardSerial === 'number' &&
            typeof payload.wagerAmount === 'number'
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// buildDuelPayload — unit tests for field mapping (Task 4.8)
// ---------------------------------------------------------------------------
describe('buildDuelPayload field mapping', () => {
  const input = {
    challengerId: '0.0.111',
    challengerCardSerial: '3',
    opponentId: '0.0.222',
    opponentCardSerial: '7',
    tokenId: '0.0.999',
    wagerAmount: '50',
  };

  it('maps opponentId to targetId', () => {
    const payload = buildDuelPayload(input);
    expect(payload.targetId).toBe('0.0.222');
    expect(payload).not.toHaveProperty('opponentId');
  });

  it('maps opponentCardSerial to targetCardSerial', () => {
    const payload = buildDuelPayload(input);
    expect(payload.targetCardSerial).toBe(7);
    expect(payload).not.toHaveProperty('opponentCardSerial');
  });

  it('preserves challengerId and tokenId unchanged', () => {
    const payload = buildDuelPayload(input);
    expect(payload.challengerId).toBe('0.0.111');
    expect(payload.tokenId).toBe('0.0.999');
  });

  it('casts challengerCardSerial to number', () => {
    expect(buildDuelPayload(input).challengerCardSerial).toBe(3);
  });

  it('casts wagerAmount to number', () => {
    expect(buildDuelPayload(input).wagerAmount).toBe(50);
  });
});
