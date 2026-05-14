'use strict';

const { db } = require('./database');

function setupSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      tokenId        TEXT,
      serialNumber   INTEGER PRIMARY KEY,
      ownerAccountId TEXT,
      metadataCid    TEXT,
      metadataJson   TEXT
    );

    CREATE TABLE IF NOT EXISTS listings (
      listingId        TEXT PRIMARY KEY,
      tokenId          TEXT,
      serialNumber     INTEGER,
      sellerAccountId  TEXT,
      priceHbar        REAL,
      status           TEXT DEFAULT 'active',
      createdAt        INTEGER
    );

    CREATE TABLE IF NOT EXISTS trades (
      tradeId      TEXT PRIMARY KEY,
      player1Id    TEXT,
      card1Serial  INTEGER,
      player2Id    TEXT,
      card2Serial  INTEGER,
      status       TEXT DEFAULT 'pending',
      createdAt    INTEGER
    );

    CREATE TABLE IF NOT EXISTS duels (
      duelId                 TEXT PRIMARY KEY,
      challengerAccountId    TEXT,
      challengerCardSerial   INTEGER,
      targetAccountId        TEXT,
      targetCardSerial       INTEGER,
      status                 TEXT DEFAULT 'pending',
      winnerId               TEXT,
      transactionId          TEXT,
      createdAt              INTEGER,
      expiresAt              INTEGER
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      transactionId  TEXT PRIMARY KEY,
      type           TEXT,
      accountIds     TEXT,
      serialNumbers  TEXT,
      timestamp      INTEGER,
      status         TEXT DEFAULT 'confirmed'
    );
  `);
}

module.exports = { setupSchema };
