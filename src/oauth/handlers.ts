/**
 * OAuth 2.1 Endpoint Handlers for MCP Server
 */

import type { IncomingMessage, ServerResponse } from "http";
import { oauthStore } from "./firestore-store.js";
import { verifyPKCE, generateRandomString } from "./pkce.js";
import type {
  OAuthClient,
  ClientRegistrationRequest,
  AuthorizationRequest,
  PendingAuth,
  AuthorizationCode,
  TokenEntry,
  ProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OAuthError,
} from "./types.js";

// Environment configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp.graffiticode.org";
const CONSOLE_URL = process.env.CONSOLE_URL || "https://graffiticode.org";
const AUTH_URL = process.env.GRAFFITICODE_AUTH_URL || "https://auth.graffiticode.org";
const FIREBASE_API_KEY = "AIzaSyAoVuUNi8ElnS7cn6wc3D8XExML-URLw0I";

// Token expiration (55 minutes to match Firebase token lifetime with buffer)
const TOKEN_EXPIRES_IN = 55 * 60;

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Send OAuth error response
 */
function sendError(res: ServerResponse, status: number, error: OAuthError): void {
  sendJson(res, status, error);
}

/**
 * Redirect response
 */
function redirect(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url });
  res.end();
}

/**
 * Parse URL-encoded form body
 */
async function parseFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      resolve(new URLSearchParams(body));
    });
    req.on("error", reject);
  });
}

/**
 * Parse JSON body
 */
async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

/**
 * GET /.well-known/oauth-protected-resource
 * RFC 9728 - Protected Resource Metadata
 */
export function handleProtectedResourceMetadata(
  _req: IncomingMessage,
  res: ServerResponse
): void {
  const metadata: ProtectedResourceMetadata = {
    resource: `${MCP_SERVER_URL}/mcp`,
    authorization_servers: [MCP_SERVER_URL],
  };
  sendJson(res, 200, metadata);
}

/**
 * GET /.well-known/oauth-authorization-server
 * RFC 8414 - Authorization Server Metadata
 */
export function handleAuthServerMetadata(
  _req: IncomingMessage,
  res: ServerResponse
): void {
  const metadata: AuthorizationServerMetadata = {
    issuer: MCP_SERVER_URL,
    authorization_endpoint: `${MCP_SERVER_URL}/oauth/authorize`,
    token_endpoint: `${MCP_SERVER_URL}/oauth/token`,
    registration_endpoint: `${MCP_SERVER_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["graffiticode"],
  };
  sendJson(res, 200, metadata);
}

/**
 * POST /oauth/register
 * RFC 7591 - Dynamic Client Registration
 */
export async function handleClientRegistration(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await parseJsonBody(req)) as ClientRegistrationRequest;

  // Generate client credentials
  const clientId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const client: OAuthClient = {
    client_id: clientId,
    client_name: body.client_name || "Unknown Client",
    redirect_uris: body.redirect_uris || [],
    grant_types: body.grant_types || ["authorization_code"],
    response_types: body.response_types || ["code"],
    token_endpoint_auth_method: body.token_endpoint_auth_method || "none",
    client_id_issued_at: now,
  };

  oauthStore.registerClient(client);

  // Return client metadata (RFC 7591 Section 3.2.1)
  sendJson(res, 201, {
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    response_types: client.response_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    client_id_issued_at: client.client_id_issued_at,
  });
}

/**
 * GET /oauth/authorize
 * OAuth 2.1 Authorization Endpoint
 */
export function handleAuthorize(
  req: IncomingMessage,
  res: ServerResponse
): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  // Extract parameters
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const scope = params.get("scope") || "graffiticode";
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const resource = params.get("resource") || `${MCP_SERVER_URL}/mcp`;

  // Validate required parameters
  if (!clientId) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing client_id" });
    return;
  }

  if (!redirectUri) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing redirect_uri" });
    return;
  }

  if (responseType !== "code") {
    sendError(res, 400, { error: "unsupported_response_type", error_description: "Only 'code' response type is supported" });
    return;
  }

  if (!state) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing state parameter" });
    return;
  }

  if (!codeChallenge || !codeChallengeMethod) {
    sendError(res, 400, { error: "invalid_request", error_description: "PKCE required (code_challenge and code_challenge_method)" });
    return;
  }

  if (codeChallengeMethod !== "S256") {
    sendError(res, 400, { error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" });
    return;
  }

  // Validate client exists
  const client = oauthStore.getClient(clientId);
  if (!client) {
    sendError(res, 400, { error: "invalid_client", error_description: "Unknown client_id" });
    return;
  }

  // Validate redirect_uri (if client has registered URIs)
  if (client.redirect_uris.length > 0 && !client.redirect_uris.includes(redirectUri)) {
    sendError(res, 400, { error: "invalid_request", error_description: "Invalid redirect_uri" });
    return;
  }

  // Generate internal state for consent page callback
  const internalState = generateRandomString(32);

  // Store pending auth
  const pending: PendingAuth = {
    state: internalState,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    resource,
    created_at: Date.now(),
  };

  // Also store the client's original state mapped to our internal state
  (pending as any).client_state = state;

  oauthStore.savePendingAuth(pending);

  // Build consent page URL
  const consentUrl = new URL("/oauth/consent", CONSOLE_URL);
  consentUrl.searchParams.set("callback_url", `${MCP_SERVER_URL}/oauth/callback`);
  consentUrl.searchParams.set("state", internalState);
  consentUrl.searchParams.set("app_name", client.client_name || "MCP Client");

  redirect(res, consentUrl.toString());
}

/**
 * GET /oauth/callback
 * Callback from consent page with Google ID token
 */
export function handleCallback(
  req: IncomingMessage,
  res: ServerResponse
): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const googleIdToken = params.get("google_id_token");
  const state = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  // Check for error from consent page
  if (error) {
    const pending = state ? oauthStore.getPendingAuth(state) : null;
    if (pending) {
      const clientState = (pending as any).client_state;
      oauthStore.deletePendingAuth(state!);

      const redirectUrl = new URL(pending.redirect_uri);
      redirectUrl.searchParams.set("error", error);
      if (errorDescription) {
        redirectUrl.searchParams.set("error_description", errorDescription);
      }
      redirectUrl.searchParams.set("state", clientState);
      redirect(res, redirectUrl.toString());
      return;
    }
    sendError(res, 400, { error, error_description: errorDescription || undefined });
    return;
  }

  if (!state) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing state" });
    return;
  }

  if (!googleIdToken) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing google_id_token" });
    return;
  }

  // Look up pending auth
  const pending = oauthStore.getPendingAuth(state);
  if (!pending) {
    sendError(res, 400, { error: "invalid_request", error_description: "Invalid or expired state" });
    return;
  }

  const clientState = (pending as any).client_state;
  oauthStore.deletePendingAuth(state);

  // Generate authorization code
  const code = generateRandomString(64);
  const authCode: AuthorizationCode = {
    code,
    client_id: pending.client_id,
    redirect_uri: pending.redirect_uri,
    scope: pending.scope,
    code_challenge: pending.code_challenge,
    code_challenge_method: pending.code_challenge_method,
    google_id_token: googleIdToken,
    resource: pending.resource,
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
    used: false,
  };

  oauthStore.saveAuthCode(authCode);

  // Redirect to client with authorization code
  const redirectUrl = new URL(pending.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", clientState);

  redirect(res, redirectUrl.toString());
}

/**
 * Exchange Google ID token for Firebase ID token and refresh token
 */
async function exchangeGoogleTokenForFirebaseToken(googleIdToken: string): Promise<{
  firebaseIdToken: string;
  firebaseRefreshToken: string;
  providerId: string;
  expiresAt: number;
}> {
  // Step 1: Exchange Google ID token for Firebase custom token
  const authResponse = await fetch(`${AUTH_URL}/authenticate/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: googleIdToken }),
  });

  if (!authResponse.ok) {
    const error = await authResponse.text();
    throw new Error(`Failed to authenticate with Google: ${error}`);
  }

  const authData = (await authResponse.json()) as {
    status: string;
    error?: { message: string } | null;
    data?: { firebaseCustomToken?: string; uid?: string } | null;
  };

  if (authData.status !== "success" || !authData.data?.firebaseCustomToken) {
    throw new Error(authData.error?.message || "Failed to get Firebase custom token");
  }

  // Step 2: Exchange Firebase custom token for ID token + refresh token
  const firebaseResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: authData.data.firebaseCustomToken,
        returnSecureToken: true,
      }),
    }
  );

  if (!firebaseResponse.ok) {
    const error = await firebaseResponse.text();
    throw new Error(`Failed to exchange custom token: ${error}`);
  }

  const firebaseData = (await firebaseResponse.json()) as {
    idToken?: string;
    refreshToken?: string;
    localId?: string;
    error?: { message: string };
  };

  if (!firebaseData.idToken) {
    throw new Error(firebaseData.error?.message || "No ID token returned");
  }

  if (!firebaseData.refreshToken) {
    throw new Error("No refresh token returned from Firebase");
  }

  // Firebase ID tokens expire in 1 hour, we use 55 minutes with buffer
  const expiresAt = Date.now() + TOKEN_EXPIRES_IN * 1000;

  // The providerId is the Firebase UID from the custom token auth
  // This is the same UID stored in the oauth-links collection
  const providerId = firebaseData.localId || authData.data.uid || "";

  return {
    firebaseIdToken: firebaseData.idToken,
    firebaseRefreshToken: firebaseData.refreshToken,
    providerId,
    expiresAt,
  };
}

/**
 * Refresh Firebase ID token using refresh token
 */
async function refreshFirebaseToken(firebaseRefreshToken: string): Promise<{
  firebaseIdToken: string;
  firebaseRefreshToken: string;
  expiresAt: number;
}> {
  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(firebaseRefreshToken)}`,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Firebase token: ${error}`);
  }

  const data = (await response.json()) as {
    id_token?: string;
    refresh_token?: string;
    error?: { message: string };
  };

  if (!data.id_token) {
    throw new Error(data.error?.message || "No ID token returned from refresh");
  }

  // Firebase ID tokens expire in 1 hour, we use 55 minutes with buffer
  const expiresAt = Date.now() + TOKEN_EXPIRES_IN * 1000;

  return {
    firebaseIdToken: data.id_token,
    firebaseRefreshToken: data.refresh_token || firebaseRefreshToken,
    expiresAt,
  };
}

/**
 * POST /oauth/token
 * OAuth 2.1 Token Endpoint
 */
export async function handleToken(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await parseFormBody(req);

  const grantType = body.get("grant_type");
  const clientId = body.get("client_id");

  if (!grantType) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing grant_type" });
    return;
  }

  if (grantType === "authorization_code") {
    await handleAuthorizationCodeGrant(body, res);
  } else if (grantType === "refresh_token") {
    await handleRefreshTokenGrant(body, res);
  } else {
    sendError(res, 400, { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token grants are supported" });
  }
}

/**
 * Handle authorization_code grant type
 */
async function handleAuthorizationCodeGrant(
  body: URLSearchParams,
  res: ServerResponse
): Promise<void> {
  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const clientId = body.get("client_id");
  const codeVerifier = body.get("code_verifier");

  if (!code) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing code" });
    return;
  }

  if (!codeVerifier) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing code_verifier" });
    return;
  }

  // Look up authorization code
  const authCode = oauthStore.getAuthCode(code);
  if (!authCode) {
    sendError(res, 400, { error: "invalid_grant", error_description: "Invalid or expired authorization code" });
    return;
  }

  // Check if already used
  if (authCode.used) {
    oauthStore.deleteAuthCode(code);
    sendError(res, 400, { error: "invalid_grant", error_description: "Authorization code already used" });
    return;
  }

  // Check expiration
  if (Date.now() > authCode.expires_at) {
    oauthStore.deleteAuthCode(code);
    sendError(res, 400, { error: "invalid_grant", error_description: "Authorization code expired" });
    return;
  }

  // Validate client_id
  if (clientId && clientId !== authCode.client_id) {
    sendError(res, 400, { error: "invalid_grant", error_description: "client_id mismatch" });
    return;
  }

  // Validate redirect_uri
  if (redirectUri && redirectUri !== authCode.redirect_uri) {
    sendError(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
    return;
  }

  // Verify PKCE
  if (!verifyPKCE(codeVerifier, authCode.code_challenge, authCode.code_challenge_method)) {
    sendError(res, 400, { error: "invalid_grant", error_description: "Invalid code_verifier" });
    return;
  }

  // Mark code as used
  oauthStore.markAuthCodeUsed(code);

  try {
    // Exchange Google ID token for Firebase ID token + refresh token
    const { firebaseIdToken, firebaseRefreshToken, providerId, expiresAt } = await exchangeGoogleTokenForFirebaseToken(
      authCode.google_id_token
    );

    // Get client name for token metadata
    const client = oauthStore.getClient(authCode.client_id);
    const clientName = client?.client_name || "Unknown";

    // Generate tokens
    const accessToken = generateRandomString(64);
    const refreshToken = generateRandomString(64);

    // Store token entry (now includes Firebase refresh token for indefinite persistence)
    const tokenEntry: TokenEntry = {
      access_token: accessToken,
      refresh_token: refreshToken,
      client_id: authCode.client_id,
      client_name: clientName,
      scope: authCode.scope,
      firebase_id_token: firebaseIdToken,
      firebase_refresh_token: firebaseRefreshToken,
      firebase_token_expires_at: expiresAt,
      resource: authCode.resource,
      created_at: Date.now(),
    };

    await oauthStore.saveToken(providerId, tokenEntry);

    // Clean up auth code
    oauthStore.deleteAuthCode(code);

    // Return token response
    sendJson(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_EXPIRES_IN,
      refresh_token: refreshToken,
      scope: authCode.scope,
    });
  } catch (error) {
    console.error("Token exchange error:", error);
    sendError(res, 500, {
      error: "server_error",
      error_description: error instanceof Error ? error.message : "Token exchange failed",
    });
  }
}

/**
 * Handle refresh_token grant type
 */
async function handleRefreshTokenGrant(
  body: URLSearchParams,
  res: ServerResponse
): Promise<void> {
  const refreshToken = body.get("refresh_token");
  const clientId = body.get("client_id");

  if (!refreshToken) {
    sendError(res, 400, { error: "invalid_request", error_description: "Missing refresh_token" });
    return;
  }

  try {
    // Look up token by refresh token (now async)
    const tokenEntry = await oauthStore.getTokenByRefreshToken(refreshToken);
    if (!tokenEntry) {
      sendError(res, 400, { error: "invalid_grant", error_description: "Invalid refresh_token" });
      return;
    }

    // Validate client_id if provided
    if (clientId && clientId !== tokenEntry.client_id) {
      sendError(res, 400, { error: "invalid_grant", error_description: "client_id mismatch" });
      return;
    }

    // Check if Firebase token needs refresh
    let firebaseIdToken = tokenEntry.firebase_id_token;
    let firebaseRefreshToken = tokenEntry.firebase_refresh_token;
    let firebaseExpiresAt = tokenEntry.firebase_token_expires_at;

    if (Date.now() > tokenEntry.firebase_token_expires_at) {
      // Firebase token expired - refresh it using the stored Firebase refresh token
      const refreshed = await refreshFirebaseToken(tokenEntry.firebase_refresh_token);
      firebaseIdToken = refreshed.firebaseIdToken;
      firebaseRefreshToken = refreshed.firebaseRefreshToken;
      firebaseExpiresAt = refreshed.expiresAt;
    }

    // Rotate OAuth tokens (OAuth 2.1 requirement)
    const newAccessToken = generateRandomString(64);
    const newRefreshToken = generateRandomString(64);

    // Create new token entry with potentially refreshed Firebase token
    const newTokenEntry: TokenEntry = {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      client_id: tokenEntry.client_id,
      client_name: tokenEntry.client_name,
      scope: tokenEntry.scope,
      firebase_id_token: firebaseIdToken,
      firebase_refresh_token: firebaseRefreshToken,
      firebase_token_expires_at: firebaseExpiresAt,
      resource: tokenEntry.resource,
      created_at: Date.now(),
    };

    // Rotate tokens in Firestore (delete old, create new)
    await oauthStore.rotateTokens(refreshToken, newTokenEntry);

    // Return token response with full expiration time (since we refreshed)
    sendJson(res, 200, {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: TOKEN_EXPIRES_IN,
      refresh_token: newRefreshToken,
      scope: tokenEntry.scope,
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    sendError(res, 500, {
      error: "server_error",
      error_description: error instanceof Error ? error.message : "Token refresh failed",
    });
  }
}

/**
 * Get Firebase ID token from OAuth access token
 * Used by /mcp endpoint to authenticate requests
 *
 * Auto-refreshes expired Firebase tokens using stored refresh token.
 */
export async function getFirebaseTokenFromAccessToken(accessToken: string): Promise<string | null> {
  const tokenEntry = await oauthStore.getTokenByAccessToken(accessToken);
  if (!tokenEntry) {
    return null;
  }

  // Check if Firebase token needs refresh
  if (Date.now() > tokenEntry.firebase_token_expires_at) {
    try {
      // Refresh Firebase token using stored refresh token
      const refreshed = await refreshFirebaseToken(tokenEntry.firebase_refresh_token);

      // Update stored token with new Firebase credentials
      await oauthStore.updateToken(accessToken, {
        firebase_id_token: refreshed.firebaseIdToken,
        firebase_refresh_token: refreshed.firebaseRefreshToken,
        firebase_token_expires_at: refreshed.expiresAt,
      });

      return refreshed.firebaseIdToken;
    } catch (error) {
      console.error("Failed to refresh Firebase token:", error);
      // If refresh fails, delete the token and return null
      await oauthStore.deleteToken(accessToken);
      return null;
    }
  }

  return tokenEntry.firebase_id_token;
}
