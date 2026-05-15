# NFT Card Game — Hedera Token Service

A collectible NFT card game backend built on the [Hedera](https://hedera.com) network using the [Hiero JS SDK](https://github.com/hiero-ledger/hiero-sdk-js). Players collect unique cards minted as NFTs, trade them peer-to-peer, list them on a marketplace, and challenge each other to PvP duels where the winner claims the loser's card.

## Live on Hedera Testnet

| Resource | Link |
|---|---|
| Card Collection (HCG) | [0.0.8963536 on HashScan](https://hashscan.io/testnet/token/0.0.8963536) |
| First Minted Card — Shadow Dragon #1 | [Serial #1 on HashScan](https://hashscan.io/testnet/token/0.0.8963536/nft/1) |
| Mint Transaction | [0.0.6456650@1778821466.777256948](https://hashscan.io/testnet/transaction/0.0.6456650@1778821466.777256948) |

## What Makes This Interesting

- **No smart contracts needed.** Hedera's Token Service (HTS) handles NFT ownership, transfers, and royalties natively — cheaper and simpler than EVM-based approaches.
- **Provably fair duels.** The duel outcome uses `PrngTransaction` to get verifiable on-chain randomness. Anyone can look up the random value on HashScan and confirm the result wasn't manipulated.
- **Automatic royalties.** A 5% royalty is enforced by the network on every secondary sale — no application code required.
- **55 tests including property-based tests.** Uses [fast-check](https://github.com/dubzzz/fast-check) to verify correctness properties across hundreds of randomly generated inputs — not just hand-picked examples.

## Tech Stack

- **Runtime:** Node.js
- **Blockchain:** Hedera Testnet via `@hashgraph/sdk`
- **Database:** SQLite (`better-sqlite3`) for local state and audit log
- **API:** Express.js
- **Testing:** Vitest + fast-check (property-based testing)

## Architecture

```
Player Client (HTTP)
        │
        ▼
  Game Server (Node.js / Express)
        │
        ├──► Hedera Consensus Nodes  (transactions — mint, transfer, duel)
        ├──► Hedera Mirror Node      (free read queries — inventory, history)
        ├──► IPFS                    (card metadata and artwork)
        └──► SQLite                  (local audit log, listings, duel state)
```

## Card Metadata Schema

Each card is an NFT whose on-chain metadata field contains an IPFS CID pointing to a JSON object:

```json
{
  "name": "Shadow Dragon",
  "rarity": "legendary",
  "attack": 95,
  "defense": 80,
  "image": "ipfs://Qm..."
}
```

Rarity values: `common`, `rare`, `epic`, `legendary`  
Attack and defense: integers 1–100

## Duel Resolution

```
score = (attack × 0.6 + defense × 0.4) + (prngValue % 20)
```

`prngValue` comes from `PrngTransaction.setRange(100)` — a verifiable random number recorded on-chain. The ±20 swing means upsets are possible, keeping duels interesting regardless of card rarity. Challenger wins on a tie.

## Getting Started

### Prerequisites

- Node.js 18+
- A Hedera testnet account — create one free at [portal.hedera.com](https://portal.hedera.com)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/nft-card-game.git
cd nft-card-game
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your Hedera testnet credentials:

```
OPERATOR_ACCOUNT_ID=0.0.XXXXX
OPERATOR_PRIVATE_KEY=your_hex_private_key
TREASURY_ACCOUNT_ID=0.0.XXXXX
TREASURY_PRIVATE_KEY=your_hex_private_key
HEDERA_NETWORK=testnet
PORT=3000
```

### Run

```bash
npm start
```

### Test

```bash
npm test
```

## API Reference

All endpoints are prefixed with `/api/v1`.

### Collection

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/collection/create` | Create the NFT token collection (run once) |

### Cards

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/cards/mint` | Mint a new NFT card |
| `POST` | `/cards/distribute` | Send a card from Treasury to a player |
| `GET` | `/cards/:serialNumber` | Get card details from Mirror Node |

### Players

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/players/register` | Associate a player's account with the token collection |

### Trades

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/trades/propose` | Propose a card-for-card swap |
| `POST` | `/trades/:tradeId/execute` | Execute a proposed trade (requires both signatures) |

### Marketplace

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/marketplace/list` | List a card for sale at a fixed HBAR price |
| `POST` | `/marketplace/:listingId/purchase` | Buy a listed card |
| `GET` | `/marketplace` | Get all active listings |
| `DELETE` | `/marketplace/:listingId` | Invalidate a listing |

### Duels

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/duels/challenge` | Challenge another player to a duel |
| `POST` | `/duels/:duelId/accept` | Accept a duel challenge |
| `POST` | `/duels/:duelId/resolve` | Resolve the duel using on-chain randomness |

### Inventory & History

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/inventory/:accountId` | Get all cards owned by an account (Mirror Node) |
| `GET` | `/history/:accountId` | Get transaction history for an account |

## Project Structure

```
src/
├── api/              # Express routes
├── audit/            # Audit log — every on-chain event recorded
├── collection/       # Token collection creation
├── db/               # SQLite schema and connection
├── distribution/     # Card distribution from Treasury to players
├── duels/            # PvP duel system with on-chain randomness
├── inventory/        # Mirror Node queries with 30s cache
├── marketplace/      # Card listings and purchases
├── minting/          # Card minting and metadata validation
├── players/          # Player registration and token association
└── trading/          # Peer-to-peer card swaps
```

## Correctness Properties (Property-Based Tests)

The test suite verifies 9 formal correctness properties using fast-check:

1. Card metadata round-trip — `parse(print(m))` equals `m`
2. Whitespace-only card names are rejected before minting
3. Attack and defense are always integers in [1, 100]
4. Minting grows supply — each serial number is unique
5. Listing price is always positive
6. Duel score is deterministic given fixed inputs
7. Audit entries always contain required fields
8. Player history is always ordered newest-first
9. Inventory cache never serves data older than 30 seconds

## License

MIT
