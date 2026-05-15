# NFT Card Game — Hedera Token Service

A collectible NFT card game backend built on the [Hedera](https://hedera.com) network using the [Hiero JS SDK](https://github.com/hiero-ledger/hiero-sdk-js). Players collect unique cards minted as NFTs, trade them peer-to-peer, list them on a marketplace, and challenge each other to PvP duels where the winner claims the loser's card. Every card is a Non-Fungible Token (NFT) on Hedera Token Service (HTS), giving each card provable on-chain ownership with no central database required for ownership tracking. In other words, its a digital trading card game where players can collect, trade, and battle with unique cards, with all ownership tracked on the Hiero blockchain. 


## Live on Hedera Testnet

| Resource | Link |
|---|---|
| Card Collection (HCG) | [0.0.8963536 on HashScan](https://hashscan.io/testnet/token/0.0.8963536) |
| First Minted Card — Shadow Dragon #1 | [Serial #1 on HashScan]
| Mint Transaction | [0.0.6456650@1778821466.777256948](https://hashscan.io/testnet/transaction/0.0.6456650@1778821466.777256948) |


## Tech Stack

- **Runtime:** Node.js
- **Blockchain:** Hedera Testnet via `@hashgraph/sdk`
- **Database:** SQLite (`better-sqlite3`) for local state and audit log
- **API:** Express.js
- **Testing:** Vitest + fast-check (property-based testing)


## Card Metadata Schema

Each card is an NFT whose on-chain metadata field contains an IPFS CID pointing to a JSON object:

```json
{
  "name": "Shadow Dragon",
  "rarity": "legendary",
  "attack": 95,
  "defense": 80,
  "image": "ipfs://..."
}
```

Rarity values: `common`, `rare`, `epic`, `legendary`  
Attack and defense: integers 1–100

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
