const jwt = require("jsonwebtoken");

function makeToken(userId) {
  return jwt.sign(
    { sub: String(userId), email: `${userId}@example.test`, role: "authenticated" },
    process.env.SUPABASE_JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" },
  );
}

module.exports = { makeToken };
