const jwt = require("jsonwebtoken");

/**
 * Verifies a Supabase Auth access token and returns { id, email } for the
 * signed-in user, or throws.
 *
 * Supabase issues standard JWTs in the `sub` (user id) / `email` claims.
 * Two verification strategies are supported, tried in this order:
 *
 *   1. HS256 shared secret (SUPABASE_JWT_SECRET) — the "Legacy JWT Secret"
 *      shown in Supabase Dashboard -> Project Settings -> API -> JWT Settings.
 *      This works fully offline, which is why it's what our tests use.
 *
 *   2. Remote JWKS (SUPABASE_URL) — for projects using the newer asymmetric
 *      (RS256/ES256) signing keys. Requires network access to
 *      `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` at verify time, so it
 *      only works where the backend has real internet access (e.g. Render).
 *
 * If neither is configured, every dashboard request is rejected with a
 * clear config error rather than silently accepting unverified tokens.
 */

let jwksClientInstance = null;

function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
}

function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || null;
}

function getJwksClient() {
  if (jwksClientInstance) return jwksClientInstance;
  if (!supabaseUrl()) return null;

  // Lazy require: jwks-rsa is only needed when SUPABASE_JWT_SECRET isn't set.
  const jwksRsa = require("jwks-rsa");
  jwksClientInstance = jwksRsa({
    jwksUri: `${supabaseUrl().replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
  });
  return jwksClientInstance;
}

function getSigningKey(kid) {
  return new Promise((resolve, reject) => {
    const client = getJwksClient();
    if (!client) return reject(new Error("SUPABASE_URL is not configured"));
    client.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

async function verifySupabaseToken(token) {
  if (!token) throw new AuthError("Missing access token");

  // Ask Supabase to validate the current browser session when its public
  // project configuration is available. This supports both legacy HS256 and
  // newer asymmetric signing keys, so Google OAuth sessions cannot be
  // rejected merely because a stale local JWT secret is configured.
  if (supabaseUrl() && supabaseAnonKey() && typeof fetch === "function") {
    try {
      const response = await fetch(`${supabaseUrl().replace(/\/$/, "")}/auth/v1/user`, {
        headers: {
          apikey: supabaseAnonKey(),
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) return toUser(await response.json());
      const detail = await response.json().catch(() => null);
      throw new AuthError(detail?.msg || detail?.message || "Invalid session");
    } catch (error) {
      if (error instanceof AuthError) throw error;
      // If Supabase is temporarily unreachable, fall through to local JWT
      // verification rather than turning a transient network problem into a
      // permanent dashboard outage.
    }
  }

  if (process.env.SUPABASE_JWT_SECRET) {
    try {
      const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, {
        algorithms: ["HS256"],
      });
      return toUser(payload);
    } catch (error) {
      throw new AuthError(`Invalid session: ${error.message}`);
    }
  }

  if (supabaseUrl()) {
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
      throw new AuthError("Invalid session token");
    }
    try {
      const publicKey = await getSigningKey(decodedHeader.header.kid);
      const payload = jwt.verify(token, publicKey, {
        algorithms: ["RS256", "ES256"],
      });
      return toUser(payload);
    } catch (error) {
      throw new AuthError(`Invalid session: ${error.message}`);
    }
  }

  throw new AuthError(
    "Auth is not configured on the backend: set SUPABASE_JWT_SECRET (recommended for self-verification) or SUPABASE_URL.",
    500,
  );
}

function toUser(payload) {
  // Raw JWT claims use `sub`; Supabase's authenticated `/user` response uses
  // `id`. Both identify the same operator and are returned by the two
  // verification paths above.
  const id = payload?.sub || payload?.id;
  if (!id) throw new AuthError("Session token has no subject");
  return {
    id: String(id),
    email: payload.email || null,
    role: payload.role || null,
  };
}

module.exports = { verifySupabaseToken, AuthError };
