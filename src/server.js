'use strict';

/**
 * Server entry point
 *
 * Startup sequence:
 * 1. Load environment variables from .env
 * 2. Initialize the SQLite schema (creates tables if they don't exist)
 * 3. Create the Hedera SDK client from env credentials
 * 4. Mount Express routes
 * 5. Start listening
 *
 * The Hedera client is stored on app.locals.client so all route handlers
 * can access it without importing it directly (makes testing easier).
 */

require('dotenv').config();

const express = require('express');
const { Client, AccountId } = require('@hashgraph/sdk');
const { setupSchema } = require('./db/schema');
const routes = require('./api/routes');
const { parsePrivateKey } = require('./utils/parsePrivateKey');

// Initialize database tables
setupSchema();

// Build the Hedera client from environment variables
function buildClient() {
  const network = process.env.HEDERA_NETWORK || 'testnet';
  const operatorId = AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID);
  const operatorKey = parsePrivateKey(process.env.OPERATOR_PRIVATE_KEY);

  const client = network === 'mainnet'
    ? Client.forMainnet()
    : Client.forTestnet();

  client.setOperator(operatorId, operatorKey);
  return client;
}

const app = express();
app.use(express.json());

// Attach the Hedera client to app.locals so routes can access it
if (process.env.OPERATOR_ACCOUNT_ID && process.env.OPERATOR_PRIVATE_KEY) {
  app.locals.client = buildClient();
}

// Serve static frontend from public/
app.use(express.static('public'));

// Mount all game routes under /api/v1
app.use('/api/v1', routes);

// Health check — also exposes server config the UI needs
app.get('/health', (req, res) => res.json({
  status: 'ok',
  tokenId: process.env.TOKEN_ID || null,
  network: process.env.HEDERA_NETWORK || 'testnet',
}));

const PORT = process.env.PORT || 3000;

// Only start listening when run directly (not when imported in tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] NFT Card Game API running on port ${PORT}`);
    console.log(`[Server] Network: ${process.env.HEDERA_NETWORK || 'testnet'}`);
    console.log(`[Server] Token ID: ${process.env.TOKEN_ID || '(not set — run /api/v1/collection/create first)'}`);
  });
}

module.exports = app;
