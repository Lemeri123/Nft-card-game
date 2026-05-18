# NFT Card Game — Hedera Token Service

A collectible NFT card game built on the [Hedera](https://hedera.com) network. Players collect unique cards minted as NFTs, trade them peer-to-peer, list them on a marketplace, and challenge each other to PvP duels where the winner claims the loser's card — all enforced on-chain with no central authority.

Every card is a Non-Fungible Token on Hedera Token Service (HTS). Ownership is tracked on the Hiero blockchain, not in a database. Duel outcomes use Hedera's `PrngTransaction` for verifiable on-chain randomness.

---

## Live on Hedera Testnet

| Resource | Link |
|---|---|
| Card Collection (HCG) | [0.0.8963536 on HashScan](https://hashscan.io/testnet/token/0.0.8963536) |
| All Minted Cards | [Holders view](https://hashscan.io/testnet/token/0.0.8963536/holders) |

---

## The Cards

16 unique cards across 4 rarities and 4 roles.
<img width="983" height="860" alt="image" src="https://github.com/user-attachments/assets/9b9d6064-af47-46d0-9776-52923fc508a7" />


### Roles

Each role has a strength and weakness — like rock-paper-scissors but with stats.

| Role | Style | Beats |
|---|---|---|
| ⚔️ Warrior | High attack, medium defense | 🔮 Mage |
| 🔮 Mage | High attack, low defense | 🏹 Ranger |
| 🏹 Ranger | Balanced attack and defense | ⚔️ Warrior |
| 🛡️ Guardian | Low attack, very high defense | 🔮 Mage |

If your card's role beats your opponent's role, you get **+10 added to your duel score**.

### Full Card Roster

#### Common
| # | Name | Role | ATK | DEF |
|---|---|---|---|---|
| — | Shadow Dragon | ⚔️ Warrior | 95 | 80 |
| — | Iron Soldier | ⚔️ Warrior | 35 | 30 |
| — | Forest Scout | 🏹 Ranger | 28 | 38 |
| — | Stone Golem | 🛡️ Guardian | 22 | 45 |
| — | Apprentice Mage | 🔮 Mage | 40 | 20 |

#### Rare
| # | Name | Role | ATK | DEF |
|---|---|---|---|---|
| — | Fire Knight | ⚔️ Warrior | 65 | 50 |
| — | Storm Eagle | 🏹 Ranger | 58 | 55 |
| — | Ice Witch | 🔮 Mage | 70 | 35 |
| — | Shield Titan | 🛡️ Guardian | 40 | 72 |

#### Epic
| # | Name | Role | ATK | DEF |
|---|---|---|---|---|
| — | Shadow Archer | 🏹 Ranger | 75 | 68 |
| — | Lava Colossus | ⚔️ Warrior | 82 | 65 |
| — | Frost Sorceress | 🔮 Mage | 80 | 55 |
| — | Iron Fortress | 🛡️ Guardian | 55 | 85 |

#### Legendary
| # | Name | Role | ATK | DEF |
|---|---|---|---|---|
| — | Thunder Phoenix | 🏹 Ranger | 88 | 82 |
| — | Void Witch | 🔮 Mage | 100 | 60 |
| — | Eternal Guardian | 🛡️ Guardian | 70 | 95 |

---

## Gameplay

### Collecting

- New players receive **3 random common cards** when they register
- Cards are NFTs, you truly own them, they live in your Hedera account
- Mint new cards via the web UI or the API

### Dueling

Duels are the core of the game. Here's how one works:

1. **Challenge**: You pick one of your cards and challenge another player, also picking one of their cards as the target. You set a wager amount.
2. **Accept**: The opponent accepts the duel and wagers one of their cards.
3. **Resolve**: The server fetches a random number from Hedera's `PrngTransaction`. This is on-chain and verifiable by anyone.
4. **Score calculation:**

```
score = (attack × 0.6 + defense × 0.4) + (prngValue % 20) + role_bonus
```

- The `prngValue % 20` adds a random swing of 0–19 to each player's score
- `role_bonus` is +10 if your role beats the opponent's role
- Higher score wins both cards

5. **Transfer**: The loser's card is transferred to the winner's Hedera account atomically. No trust required, Hedera enforces it.

#### Example

Void Witch (Mage, ATK 100, DEF 60) vs Thunder Phoenix (Ranger, ATK 88, DEF 82):

```
Void Witch base score:     (100 × 0.6) + (60 × 0.4) = 60 + 24 = 84
Thunder Phoenix base score: (88 × 0.6) + (82 × 0.4) = 52.8 + 32.8 = 85.6

Mage beats Ranger → Void Witch gets +10 role bonus → 84 + 10 = 94

After random swing (0–19 each):
Void Witch:      94 + prng_A % 20
Thunder Phoenix: 85.6 + prng_B % 20
```

Even a legendary card can lose to a lucky common, the ±19 random swing keeps it interesting.

### Trading

- Propose a direct card-for-card swap with any player
- Both players sign the transaction, neither can back out once signed
- Enforced atomically on Hedera, no escrow needed

### Marketplace

- List any card for a fixed HBAR price
- Buyer and seller both sign the purchase transaction
- **5% royalty** automatically goes to the game treasury on every sale, enforced by Hedera's custom fee schedule, not by code

### Winning

There's no single win condition, it's a collector's game.

- Rarity and role matter: legendary cards win more often on average
- But a lucky common can still upset a legendary (the ±19 random swing)
- **Leaderboard** is based on total duel wins, tracked in the audit log

---

## Web UI

Open `http://localhost:3000` after starting the server.

The UI has six sections:

- **Card Gallery**: Enter any account ID to view their card collection. Cards show role badge, rarity glow, ATK/DEF stats, and a role bonus tooltip.
- **Mint a Card**: Choose a specific card from the roster (or pick Random) and mint it to an account.
- **Duel Challenge**: Fill in both players' account IDs and card serials to submit a challenge.
- **Inbox**: Enter your account ID to see all game notifications — duel challenges, resolutions, and new messages. Unread notifications are highlighted. Each can be marked as read individually.
- **Pending Duels**: Enter your account ID to see all active duel challenges waiting for your response. Each row has an Accept button.
- **Chat**: Enter your account ID and a recipient's account ID to load your conversation. Type a message (up to 1000 characters) and hit Send. Messages are displayed in chronological order with sent messages right-aligned.

A server health indicator in the header shows whether the API is reachable.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Blockchain | Hedera Testnet via `@hashgraph/sdk` |
| Database | SQLite (`better-sqlite3`) for local state and audit log |
| API | Express.js |
| Frontend | Single HTML file (`public/index.html`) — no build step |
| Testing | Vitest + fast-check (property-based testing) |

---

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

Edit `.env`:

```env
OPERATOR_ACCOUNT_ID=0.0.XXXXX
OPERATOR_PRIVATE_KEY=your_hex_private_key
TREASURY_ACCOUNT_ID=0.0.XXXXX
TREASURY_PRIVATE_KEY=your_hex_private_key
TOKEN_ID=0.0.8963536
HEDERA_NETWORK=testnet
PORT=3000
```

### Run

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Test

```bash
npm test
```

78 tests — unit + property-based (fast-check).

---

## First-Time Setup

If you're starting from scratch (no existing token collection):

**1. Create the card collection:**
```bash
curl -X POST http://localhost:3000/api/v1/collection/create \
  -H "Content-Type: application/json" \
  -d '{"name":"Hiero Card Game","symbol":"HCG","maxSupply":1000}'
```
Copy the returned `tokenId` into your `.env` as `TOKEN_ID`.

**2. Bulk mint all 16 cards:**
```bash
node scripts/bulk-mint.js
```

**3. Register a player:**
```bash
curl -X POST http://localhost:3000/api/v1/players/register \
  -H "Content-Type: application/json" \
  -d '{"accountId":"0.0.XXXXX","tokenId":"0.0.8963536"}'
```

**4. Distribute starter cards:**
```bash
curl -X POST http://localhost:3000/api/v1/cards/distribute \
  -H "Content-Type: application/json" \
  -d '{"tokenId":"0.0.8963536","serialNumber":5,"recipientAccountId":"0.0.XXXXX"}'
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.

### Collection

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/collection/create` | Create the NFT token collection (run once) |

### Cards

| Method | Endpoint | Body / Params | Description |
|---|---|---|---|
| `POST` | `/cards/mint` | `{ tokenId?, accountId, cardName? }` | Mint a card (random if no cardName) |
| `POST` | `/cards/distribute` | `{ tokenId, serialNumber, recipientAccountId }` | Send a card from Treasury to a player |
| `GET` | `/cards/:serialNumber?tokenId=` | — | Get card details from Mirror Node |

### Players

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/players/register` | `{ accountId, tokenId }` | Associate a player with the token collection |
| `POST` | `/players/ownership-challenge` | `{ accountId }` | Issue a challenge token to prove account ownership |
| `POST` | `/players/verify-ownership` | `{ accountId, challengeToken, signature }` | Verify ownership via signed challenge token |

### Trades

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/trades/propose` | `{ player1Id, card1Serial, player2Id, card2Serial, tokenId }` | Propose a card swap |
| `POST` | `/trades/:tradeId/execute` | `{ tokenId }` | Execute a proposed trade |

### Marketplace

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/marketplace/list` | `{ tokenId, serialNumber, sellerAccountId, priceHbar }` | List a card for sale |
| `POST` | `/marketplace/:listingId/purchase` | `{ buyerAccountId, tokenId }` | Buy a listed card |
| `GET` | `/marketplace` | — | Get all active listings |
| `DELETE` | `/marketplace/:listingId` | — | Cancel a listing |

### Duels

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/duels/challenge` | `{ challengerId, challengerCardSerial, targetId, targetCardSerial, tokenId, wagerAmount }` | Challenge a player |
| `POST` | `/duels/:duelId/accept` | `{ acceptorId }` | Accept a challenge |
| `POST` | `/duels/:duelId/resolve` | `{ tokenId }` | Resolve with on-chain randomness |
| `GET` | `/duels/pending/:accountId` | — | List pending (non-expired) challenges for an account |
| `GET` | `/duels/history/:accountId` | — | List resolved and expired duels for an account |

### Inbox

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `GET` | `/inbox/:accountId` | — | Get all notifications (unread first) |
| `POST` | `/inbox/:accountId/read/:notificationId` | — | Mark a notification as read |
| `DELETE` | `/inbox/:accountId/notifications` | — | Delete all read notifications |

### Chat

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/chat/send` | `{ senderAccountId, recipientAccountId, body }` | Send a direct message (max 1000 chars) |
| `GET` | `/chat/:accountId/messages` | — | Get all received messages (unread first) |
| `GET` | `/chat/conversation/:accountId/:otherAccountId` | — | Get full conversation between two accounts |
| `POST` | `/chat/:accountId/messages/read/:messageId` | — | Mark a message as read |

### Inventory & History

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/inventory/:accountId?tokenId=` | Get all cards owned by an account |
| `GET` | `/history/:accountId` | Get audit log for an account |

### Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health check |

---

## Project Structure

```
nft-card-game/
├── public/
│   └── index.html          # Single-file web UI
├── scripts/
│   └── bulk-mint.js        # Mint all 16 cards in sequence
├── src/
│   ├── api/
│   │   └── routes.js       # Express route handlers
│   ├── audit/              # Audit log — every on-chain event recorded
│   ├── chat/               # Player-to-player direct messaging
│   ├── collection/         # Token collection creation (HTS)
│   ├── db/                 # SQLite schema and connection
│   ├── distribution/       # Card distribution from Treasury to players
│   ├── duels/              # PvP duel system with on-chain randomness
│   ├── frontend-utils.js   # Pure utility functions (shared with UI tests)
│   ├── inbox/              # Per-player notification inbox
│   ├── inventory/          # Mirror Node queries with 30s cache
│   ├── marketplace/        # Card listings and purchases
│   ├── minting/            # Card minting and metadata validation
│   ├── players/            # Player registration, token association, ownership verification
│   └── trading/            # Peer-to-peer card swaps
├── test/
│   └── frontend.test.js    # UI utility unit + property-based tests
├── .env.example
├── package.json
└── vitest.config.js
```

---

## Card Metadata Schema

Each card's on-chain metadata field contains an IPFS CID pointing to:

```json
{
  "name": "Void Witch",
  "rarity": "legendary",
  "attack": 100,
  "defense": 60,
  "image": "ipfs://bafybeiba6trp6sfymxrd2blgo6yrqfdcktd7bc7wgoyz3st6zjswj6r7de"
}
```

Rarity values: `common` · `rare` · `epic` · `legendary`  
Attack and defense: integers 1–100
## Game Preview
<img width="1918" height="878" alt="Screenshot from 2026-05-18 21-09-32" src="https://github.com/user-attachments/assets/28536ef1-c43a-47bc-986b-7b20c8b4d5be" />
<img width="1918" height="932" alt="Screenshot from 2026-05-18 21-10-53" src="https://github.com/user-attachments/assets/76f9051a-4723-4ea3-b325-2f17eb7bd255" />
<img width="1918" height="932" alt="Screenshot from 2026-05-18 21-10-46" src="https://github.com/user-attachments/assets/cbc8355f-0aa5-417f-983c-050f573ff17d" />
<img width="1918" height="878" alt="Screenshot from 2026-05-18 21-08-08" src="https://github.com/user-attachments/assets/25099d5c-434e-4a44-9ce3-8bcd1408b666" />


