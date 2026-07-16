import assert from "node:assert/strict";
import test from "node:test";
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  isOAuthAccessToken,
  buildWwwAuthenticate,
  redirectUrisError,
  evaluateTokenValidity,
} from "../src/oauth/handlers.js";

const RESOURCE = "https://mcp.graffiticode.org/mcp";
const NOW = 1_000_000_000_000;

test("OAuth access tokens are distinguishable from raw API keys", () => {
  assert.equal(isOAuthAccessToken(`${OAUTH_ACCESS_TOKEN_PREFIX}abc`), true);
  // A raw Graffiticode API key must NOT be mistaken for an OAuth token.
  assert.equal(isOAuthAccessToken("gc_live_deadbeef"), false);
  assert.equal(isOAuthAccessToken("random-bearer"), false);
  // Refresh-token prefix is not an access-token prefix.
  assert.equal(isOAuthAccessToken(`${OAUTH_REFRESH_TOKEN_PREFIX}abc`), false);
});

test("WWW-Authenticate challenge points at protected-resource metadata with invalid_token", () => {
  const header = buildWwwAuthenticate("expired");
  assert.match(header, /^Bearer /);
  assert.match(header, /resource_metadata="https:\/\/mcp\.graffiticode\.org\/\.well-known\/oauth-protected-resource"/);
  assert.match(header, /error="invalid_token"/);
  assert.match(header, /expired/i);
});

test("redirectUrisError rejects empty/missing and non-https, accepts valid https", () => {
  assert.match(redirectUrisError(undefined) ?? "", /non-empty/);
  assert.match(redirectUrisError([]) ?? "", /non-empty/);
  assert.match(redirectUrisError(["not a url"]) ?? "", /Invalid redirect_uri/);
  assert.match(redirectUrisError(["http://evil.example/cb"]) ?? "", /must be https/);
  // ChatGPT's connector callback shape is accepted.
  assert.equal(redirectUrisError(["https://chatgpt.com/connector/oauth/abc123"]), null);
  // localhost tolerated for local dev.
  assert.equal(redirectUrisError(["http://localhost:8080/cb"]), null);
});

test("evaluateTokenValidity enforces expiry, audience, and scope", () => {
  const valid = {
    access_token_expires_at: NOW + 60_000,
    resource: RESOURCE,
    scope: "graffiticode",
  };
  assert.equal(evaluateTokenValidity(valid, RESOURCE, NOW), null);

  // Expired access token.
  assert.equal(
    evaluateTokenValidity({ ...valid, access_token_expires_at: NOW - 1 }, RESOURCE, NOW),
    "expired",
  );
  // Legacy entry with no recorded expiry is treated as expired (forces one relink).
  assert.equal(
    evaluateTokenValidity({ ...valid, access_token_expires_at: undefined }, RESOURCE, NOW),
    "expired",
  );
  // Wrong audience.
  assert.equal(
    evaluateTokenValidity({ ...valid, resource: "https://evil.example/mcp" }, RESOURCE, NOW),
    "resource",
  );
  // Missing required scope.
  assert.equal(
    evaluateTokenValidity({ ...valid, scope: "" }, RESOURCE, NOW),
    "scope",
  );
});
