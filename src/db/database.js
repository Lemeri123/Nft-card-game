'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Ensure the data/ directory exists before opening the database file
const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'game.db');

// Singleton SQLite connection — better-sqlite3 is synchronous, so one
// shared instance is safe and efficient for a single-process Node.js server.
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

module.exports = { db };
