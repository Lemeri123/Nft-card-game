'use strict';

const { PrivateKey } = require('@hashgraph/sdk');

/**
 * Parse a Hedera private key from hex (raw or DER) or an SDK PrivateKey instance.
 * Tries ECDSA before ED25519 so 64-char hex keys from the portal are not misread.
 */
function parsePrivateKey(key) {
  if (typeof key !== 'string') return key;
  const cleaned = key.startsWith('0x') || key.startsWith('0X') ? key.slice(2) : key;
  try { return PrivateKey.fromStringECDSA(cleaned); } catch {}
  try { return PrivateKey.fromStringDer(cleaned); } catch {}
  try { return PrivateKey.fromStringED25519(cleaned); } catch {}
  try { return PrivateKey.fromStringECDSA(key); } catch {}
  try { return PrivateKey.fromStringDer(key); } catch {}
  return PrivateKey.fromStringED25519(key);
}

module.exports = { parsePrivateKey };
