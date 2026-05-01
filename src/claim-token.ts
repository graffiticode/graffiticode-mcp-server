import crypto from "crypto";
import { SignJWT } from "jose";

/**
 * Mints claim JWTs that the console verifies in `claimFreePlanSession(token)`.
 *
 * Contract (must match `console/src/lib/claim-token.ts` exactly):
 * - Algorithm:  HS256
 * - Secret:     FREE_PLAN_NAMESPACE_SALT (UTF-8 bytes)
 * - Audience:   "graffiticode-claim"
 * - Expiry:     24h from issuance
 * - Payload:
 *     sessionNamespace: sha256(salt + ":" + sessionUuid) — already derived
 *     sessionUuid:      raw MCP transport session uuid (provenance only)
 *
 * The salt MUST be the same value the console deploys with — it's stored in
 * Secret Manager as `FREE_PLAN_NAMESPACE_SALT` (populated by the console's
 * `scripts/set-free-plan-secrets.sh`). Mount it on the mcp-service Cloud Run
 * deploy with:
 *
 *   gcloud run services update mcp-service \
 *     --project graffiticode-app --region us-central1 \
 *     --update-secrets=FREE_PLAN_NAMESPACE_SALT=FREE_PLAN_NAMESPACE_SALT:latest
 */

const AUDIENCE = "graffiticode-claim";
const EXPIRES_IN = "24h";

const salt = process.env.FREE_PLAN_NAMESPACE_SALT || "";
const secret = salt ? new TextEncoder().encode(salt) : null;

if (!salt) {
  console.warn(
    "[claim-token] FREE_PLAN_NAMESPACE_SALT is not set; trial responses will not include claim_url. " +
      "Set the env var (mounted from Secret Manager in production) to enable trial-claim links."
  );
}

function deriveSessionNamespace(sessionUuid: string): string {
  return crypto.createHash("sha256").update(`${salt}:${sessionUuid}`).digest("hex");
}

export async function mintClaimToken(sessionUuid: string): Promise<string | null> {
  if (!secret) return null;
  const sessionNamespace = deriveSessionNamespace(sessionUuid);
  return await new SignJWT({ sessionNamespace, sessionUuid })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(secret);
}
