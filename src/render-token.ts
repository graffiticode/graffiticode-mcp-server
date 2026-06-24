/**
 * Exchanges a raw Graffiticode API key for a short-lived (5-min) ES256 access
 * token, used to authenticate the inline render URL (`_meta.form_url`) the
 * widget iframes.
 *
 * Why: api.graffiticode.org only accepts JWTs. Embedding the raw API key in
 * form_url got it rejected (401 → anonymous → 404 on private tasks) AND leaked
 * the long-lived key into URLs and request logs. The auth service's
 * `/authenticate/api-key` endpoint returns a 5-min access token
 * (issuer `urn:graffiticode:auth`, sub = owner uid) that the api validates via
 * its existing JWKS path — so the form view authenticates with a token whose
 * blast radius is ~5 min instead of a permanent credential.
 *
 * Tokens are cached per key just under their TTL and concurrent exchanges for
 * the same key are de-duped, mirroring console/src/lib/api-credentials.ts.
 */

const AUTH_URL = process.env.GRAFFITICODE_AUTH_URL || "https://auth.graffiticode.org";

// Access tokens live 5 min; refresh a touch early so an embedded token always
// has headroom to survive the round-trip to the renderer.
const CACHE_TTL_MS = 4 * 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

async function exchange(apiKey: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/authenticate/api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: apiKey }),
  });
  if (!res.ok) {
    throw new Error(`auth /authenticate/api-key failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    status?: string;
    data?: { accessToken?: string };
  };
  const accessToken = body.data?.accessToken;
  if (body.status !== "success" || !accessToken) {
    throw new Error("auth /authenticate/api-key returned no accessToken");
  }
  return accessToken;
}

/**
 * Returns a 5-min access token for the given raw API key, or null if the
 * exchange fails (caller should fall back rather than break the tool result).
 */
export async function getRenderAccessToken(apiKey: string): Promise<string | null> {
  const cached = cache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  let promise = inFlight.get(apiKey);
  if (!promise) {
    promise = exchange(apiKey)
      .then((accessToken) => {
        cache.set(apiKey, { accessToken, expiresAt: Date.now() + CACHE_TTL_MS });
        inFlight.delete(apiKey);
        return accessToken;
      })
      .catch((err) => {
        inFlight.delete(apiKey);
        throw err;
      });
    inFlight.set(apiKey, promise);
  }

  try {
    return await promise;
  } catch (err) {
    console.warn(
      `[render-token] api-key → access-token exchange failed; form_url will be omitted: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}
