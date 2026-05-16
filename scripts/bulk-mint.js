'use strict';

/**
 * Bulk mint script — mints all cards in the CARD_ROSTER in sequence.
 *
 * Run with: node scripts/bulk-mint.js
 *
 * The server must be running (npm start) before executing this script.
 * Each card is minted via the API, with a 3-second delay between mints
 * to avoid hitting Hedera rate limits.
 *
 * currentSupply starts at 5 (serials 1-5 already minted).
 * Update START_SUPPLY if you've minted more or fewer cards already.
 */

const START_SUPPLY = 5; // how many cards already exist on-chain
const API_BASE = 'http://localhost:3000/api/v1';
const TOKEN_ID = process.env.TOKEN_ID || '0.0.8963536';
const SUPPLY_KEY = process.env.SUPPLY_KEY || '1573d75443d152a9ccd900b9ac49147c65fceffc7be75db29685739d3bdd0844';
const MAX_SUPPLY = 1000;
const DELAY_MS = 3000; // 3 seconds between mints

// Card roster with Pinata image CIDs
// NOTE: Some CIDs below are duplicates from the provided list — replace with
// correct CIDs once you have unique artwork for each card.
const CARD_ROSTER = [
  // Common
  {
    name: 'Iron Soldier',
    role: 'Warrior',
    rarity: 'common',
    attack: 35,
    defense: 30,
    imageCid: 'bafkreihojzbbgecgcjkssxvhkpxapx7bqss2phlgguz2cje7opa4qqf4vi', 
  },
  {
    name: 'Forest Scout',
    role: 'Ranger',
    rarity: 'common',
    attack: 28,
    defense: 38,
    imageCid: 'bafkreia2fsi5ld7dvqx6qfezqqg57hfxnsardij7tnkklqbiyel3agkm2u', 
  },
  {
    name: 'Stone Golem',
    role: 'Guardian',
    rarity: 'common',
    attack: 22,
    defense: 45,
    imageCid: 'bafkreiee3ewkkvmdf26ie7vqwya452vswxhfm7yjktaht76qnm2hrdrz3a',
  },
  {
    name: 'Apprentice Mage',
    role: 'Mage',
    rarity: 'common',
    attack: 40,
    defense: 20,
    imageCid: 'bafybeicuhrviveittd3ja6p3qhfu5cnlofbzl3fwer2xuklhabhcllsaom',
  },
  // Rare
  {
    name: 'Fire Knight',
    role: 'Warrior',
    rarity: 'rare',
    attack: 65,
    defense: 50,
    imageCid: 'bafybeihcpekcqgyzylsbkjse532v6aobkq2eqahq375svatkz567ikadwu',
  },
  {
    name: 'Storm Eagle',
    role: 'Ranger',
    rarity: 'rare',
    attack: 58,
    defense: 55,
    imageCid: 'bafkreieswnnph7yqm2ihkmmr3ys752mr5i6yqab7arljw7sulta6kpoxqm',
  },
  {
    name: 'Ice Witch',
    role: 'Mage',
    rarity: 'rare',
    attack: 70,
    defense: 35,
    imageCid: 'bafkreifuw76xlogqopklz6yhpnvehcmk37ebf6ssbnr4puitotdmgqxlke', 
  },
  {
    name: 'Shield Titan',
    role: 'Guardian',
    rarity: 'rare',
    attack: 40,
    defense: 72,
    imageCid: 'bafkreiddalomyhhfqbqtin6g7pb2lpfu64zmodq5hzvcllabegnmlv7onu',
  },
  // Epic
  {
    name: 'Shadow Archer',
    role: 'Ranger',
    rarity: 'epic',
    attack: 75,
    defense: 68,
    imageCid: 'bafkreifkjq4jget4c3f6z7gxrcxkrnmpt5liwb27zbisrns6bizgvxvif4',
  },
  {
    name: 'Lava Colossus',
    role: 'Warrior',
    rarity: 'epic',
    attack: 82,
    defense: 65,
    imageCid: 'bafkreibh7dy2y2xlzn2qvysungxhzvqm6phqaa7gnflwzxkcbu366ywgy4',
  },
  {
    name: 'Frost Sorceress',
    role: 'Mage',
    rarity: 'epic',
    attack: 80,
    defense: 55,
    imageCid: 'bafkreifuw76xlogqopklz6yhpnvehcmk37ebf6ssbnr4puitotdmgqxlke', 
  },
  {
    name: 'Iron Fortress',
    role: 'Guardian',
    rarity: 'epic',
    attack: 55,
    defense: 85,
    imageCid: 'bafkreigrngrlnvbvghkzt6y6slsub6hogwummbkdfdfp3uks4gbpp7wceu', 
  },
  // Legendary
  {
    name: 'Thunder Phoenix',
    role: 'Ranger',
    rarity: 'legendary',
    attack: 88,
    defense: 82,
    imageCid: 'bafkreiaotdn72pav4hog3zf633lijkexqx5dscdsiobfi7gigrar2zcg4e',
  },
  {
    name: 'Void Witch',
    role: 'Mage',
    rarity: 'legendary',
    attack: 100,
    defense: 60,
    imageCid: 'bafybeiba6trp6sfymxrd2blgo6yrqfdcktd7bc7wgoyz3st6zjswj6r7de',
  },
  {
    name: 'Eternal Guardian',
    role: 'Guardian',
    rarity: 'legendary',
    attack: 70,
    defense: 95,
    imageCid: 'bafkreielkuyslttwodspzviqyzcv4rk2e2rxomdszppnnmpa7czxqyatbi',
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mintCard(card, currentSupply) {
  const body = {
    tokenId: TOKEN_ID,
    supplyKey: SUPPLY_KEY,
    metadata: {
      name: card.name,
      rarity: card.rarity,
      attack: card.attack,
      defense: card.defense,
      image: `ipfs://${card.imageCid}`,
    },
    currentSupply,
    maxSupply: MAX_SUPPLY,
  };

  const response = await fetch(`${API_BASE}/cards/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${data.error || response.statusText}`);
  }
  return data;
}

async function main() {
  console.log(`Starting bulk mint — ${CARD_ROSTER.length} cards to mint`);
  console.log(`Current supply: ${START_SUPPLY}\n`);

  let supply = START_SUPPLY;
  let minted = 0;
  let failed = 0;

  for (const card of CARD_ROSTER) {
    process.stdout.write(`Minting ${card.rarity.toUpperCase()} — ${card.name}... `);
    try {
      const result = await mintCard(card, supply);
      console.log(`✓ serial #${result.serialNumber} (txId: ${result.transactionId})`);
      supply++;
      minted++;
    } catch (err) {
      console.log(`✗ FAILED: ${err.message}`);
      failed++;
    }

    if (minted + failed < CARD_ROSTER.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone. ${minted} minted, ${failed} failed.`);
  console.log(`Total supply now: ${supply}`);
  console.log(`\nView your collection: https://hashscan.io/testnet/token/${TOKEN_ID}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
