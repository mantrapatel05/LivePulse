const crypto = require("crypto");

// base58: drops the ambiguous characters 0, O, I, l (digit 1 is kept).
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PUBLIC_ID_LENGTH = 12;
const PUBLIC_ID_RE = /^[1-9A-HJ-NP-Za-km-z]{12}$/;

function generatePublicId() {
  const bytes = crypto.randomBytes(PUBLIC_ID_LENGTH);
  let out = "";
  // Modulo bias (256 % 58) is irrelevant here: unguessability, not uniformity, is the property.
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function isValidPublicId(id) {
  return typeof id === "string" && PUBLIC_ID_RE.test(id);
}

module.exports = { generatePublicId, isValidPublicId, PUBLIC_ID_LENGTH };
