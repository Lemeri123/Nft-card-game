/**
 * CardMetadata property-based tests
 *
 * What is property-based testing?
 * Instead of writing one example ("attack=50 should work"), we describe a
 * *property* that must hold for ALL valid inputs, then fast-check generates
 * hundreds of random inputs to try to break it. If it finds a failing case,
 * it shrinks it to the smallest possible counterexample and shows you exactly
 * what broke. This is far more thorough than hand-picked examples.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCardMetadata, printCardMetadata, VALID_RARITIES } from './cardMetadata.js';

// Arbitrary that generates valid CardMetadata objects.
// fc.record() builds an object where each field uses its own arbitrary generator.
const validMetadataArb = fc.record({
  name: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  rarity: fc.constantFrom(...VALID_RARITIES),
  attack: fc.integer({ min: 1, max: 100 }),
  defense: fc.integer({ min: 1, max: 100 }),
  image: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
});

describe('CardMetadata', () => {
  // Feature: nft-card-game, Property 1: Metadata round-trip
  // For any valid CardMetadata, serialize then parse must return an equivalent object.
  // This proves our JSON serializer and parser are inverses of each other.
  it('Property 1: round-trip — parse(print(m)) equals m', () => {
    fc.assert(
      fc.property(validMetadataArb, (metadata) => {
        const json = printCardMetadata(metadata);
        const parsed = parseCardMetadata(json);
        expect(parsed).toEqual(metadata);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: nft-card-game, Property 2: Whitespace-only names are rejected
  // A card with no real name is meaningless — we must reject it before minting.
  it('Property 2: whitespace-only names are rejected', () => {
    // fc.array + fc.constantFrom builds a list of whitespace chars, then join into a string
    const whitespaceArb = fc
      .array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(whitespaceArb, (wsName) => {
        const json = JSON.stringify({
          name: wsName,
          rarity: 'common',
          attack: 50,
          defense: 50,
          image: 'ipfs://Qmtest',
        });
        expect(() => parseCardMetadata(json)).toThrow();
      }),
      { numRuns: 100 }
    );
  });

  // Feature: nft-card-game, Property 3: Attack and defense are in range after parse
  // After a successful parse, both stats must be integers in [1, 100].
  it('Property 3: parsed attack and defense are integers in [1, 100]', () => {
    fc.assert(
      fc.property(validMetadataArb, (metadata) => {
        const parsed = parseCardMetadata(printCardMetadata(metadata));
        expect(Number.isInteger(parsed.attack)).toBe(true);
        expect(Number.isInteger(parsed.defense)).toBe(true);
        expect(parsed.attack).toBeGreaterThanOrEqual(1);
        expect(parsed.attack).toBeLessThanOrEqual(100);
        expect(parsed.defense).toBeGreaterThanOrEqual(1);
        expect(parsed.defense).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 }
    );
  });

  // Unit tests for specific error cases
  it('rejects invalid JSON', () => {
    expect(() => parseCardMetadata('not json')).toThrow('invalid JSON');
  });

  it('rejects out-of-range attack', () => {
    const json = JSON.stringify({ name: 'Test', rarity: 'common', attack: 0, defense: 50, image: 'ipfs://x' });
    expect(() => parseCardMetadata(json)).toThrow('attack');
  });

  it('rejects unknown rarity', () => {
    const json = JSON.stringify({ name: 'Test', rarity: 'mythic', attack: 50, defense: 50, image: 'ipfs://x' });
    expect(() => parseCardMetadata(json)).toThrow('rarity');
  });
});
