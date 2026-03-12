/**
 * Firestore-backed OAuth token storage via auth service API
 *
 * Uses HTTP calls to the auth service for persistent token storage.
 * Clients, pending auths, and auth codes remain in-memory (short-lived).
 */

import type {
  OAuthClient,
  PendingAuth,
  AuthorizationCode,
  TokenEntry,
} from "./types.js";

const AUTH_URL = process.env.GRAFFITICODE_AUTH_URL || "https://auth.graffiticode.org";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

// Expiration times for in-memory items
const PENDING_AUTH_TTL = 10 * 60 * 1000; // 10 minutes
const AUTH_CODE_TTL = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Make authenticated HTTP request to auth service
 */
async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "X-Internal-API-Key": INTERNAL_API_KEY,
    },
  });
}

export class FirestoreOAuthStore {
  // In-memory storage for short-lived items (OK to lose on restart)
  private clients = new Map<string, OAuthClient>();
  private pendingAuths = new Map<string, PendingAuth>();
  private authCodes = new Map<string, AuthorizationCode>();

  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup for in-memory items
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL);
  }

  // ==================== Client methods (in-memory) ====================

  registerClient(client: OAuthClient): void {
    this.clients.set(client.client_id, client);
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  deleteClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }

  // ==================== Pending auth methods (in-memory) ====================

  savePendingAuth(pending: PendingAuth): void {
    this.pendingAuths.set(pending.state, pending);
  }

  getPendingAuth(state: string): PendingAuth | undefined {
    return this.pendingAuths.get(state);
  }

  deletePendingAuth(state: string): void {
    this.pendingAuths.delete(state);
  }

  // ==================== Authorization code methods (in-memory) ====================

  saveAuthCode(authCode: AuthorizationCode): void {
    this.authCodes.set(authCode.code, authCode);
  }

  getAuthCode(code: string): AuthorizationCode | undefined {
    return this.authCodes.get(code);
  }

  markAuthCodeUsed(code: string): void {
    const authCode = this.authCodes.get(code);
    if (authCode) {
      authCode.used = true;
    }
  }

  deleteAuthCode(code: string): void {
    this.authCodes.delete(code);
  }

  // ==================== Token methods (Firestore via auth service) ====================

  /**
   * Save a new token to Firestore.
   * @param providerId - The Google provider ID (Firebase UID from Google sign-in)
   * @param entry - The token entry to save
   */
  async saveToken(providerId: string, entry: TokenEntry): Promise<void> {
    const response = await authFetch(`${AUTH_URL}/oauth-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_id: providerId,
        access_token: entry.access_token,
        refresh_token: entry.refresh_token,
        firebase_id_token: entry.firebase_id_token,
        firebase_refresh_token: entry.firebase_refresh_token,
        firebase_token_expires_at: entry.firebase_token_expires_at,
        client_id: entry.client_id,
        client_name: entry.client_name,
        scope: entry.scope,
        resource: entry.resource,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to save token: ${error}`);
    }
  }

  /**
   * Get a token by its access token.
   */
  async getTokenByAccessToken(accessToken: string): Promise<TokenEntry | null> {
    const response = await authFetch(
      `${AUTH_URL}/oauth-tokens?access_token=${encodeURIComponent(accessToken)}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`Failed to get token: ${error}`);
    }

    const data = await response.json() as { data?: { token?: unknown } };
    return this.mapTokenResponse(data.data?.token);
  }

  /**
   * Get a token by its refresh token.
   */
  async getTokenByRefreshToken(refreshToken: string): Promise<TokenEntry | null> {
    const response = await authFetch(
      `${AUTH_URL}/oauth-tokens?refresh_token=${encodeURIComponent(refreshToken)}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`Failed to get token: ${error}`);
    }

    const data = await response.json() as { data?: { token?: unknown } };
    return this.mapTokenResponse(data.data?.token);
  }

  /**
   * Update token fields (e.g., after Firebase token refresh).
   */
  async updateToken(
    accessToken: string,
    updates: Partial<Pick<TokenEntry, "firebase_id_token" | "firebase_refresh_token" | "firebase_token_expires_at">>
  ): Promise<void> {
    const response = await authFetch(
      `${AUTH_URL}/oauth-tokens/${encodeURIComponent(accessToken)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update token: ${error}`);
    }
  }

  /**
   * Delete a token by its access token.
   */
  async deleteToken(accessToken: string): Promise<void> {
    const response = await authFetch(
      `${AUTH_URL}/oauth-tokens/${encodeURIComponent(accessToken)}`,
      { method: "DELETE" }
    );

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`Failed to delete token: ${error}`);
    }
  }

  /**
   * Rotate tokens (OAuth 2.1 refresh flow).
   * @param oldRefreshToken - The old refresh token to invalidate
   * @param newEntry - The new token entry
   */
  async rotateTokens(
    oldRefreshToken: string,
    newEntry: TokenEntry
  ): Promise<void> {
    const response = await authFetch(`${AUTH_URL}/oauth-tokens/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        old_refresh_token: oldRefreshToken,
        access_token: newEntry.access_token,
        refresh_token: newEntry.refresh_token,
        firebase_id_token: newEntry.firebase_id_token,
        firebase_refresh_token: newEntry.firebase_refresh_token,
        firebase_token_expires_at: newEntry.firebase_token_expires_at,
        client_id: newEntry.client_id,
        client_name: newEntry.client_name,
        scope: newEntry.scope,
        resource: newEntry.resource,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to rotate tokens: ${error}`);
    }
  }

  /**
   * Map auth service response to TokenEntry
   */
  private mapTokenResponse(token: any): TokenEntry | null {
    if (!token) return null;

    return {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      client_id: token.client_id,
      client_name: token.client_name,
      scope: token.scope,
      firebase_id_token: token.firebase_id_token,
      firebase_refresh_token: token.firebase_refresh_token,
      firebase_token_expires_at: token.firebase_token_expires_at,
      resource: token.resource,
      created_at: token.created_at,
    };
  }

  // ==================== Cleanup ====================

  /**
   * Cleanup expired in-memory entries only.
   * Token cleanup is handled by Firestore TTL or manual deletion.
   */
  cleanupExpired(): void {
    const now = Date.now();

    // Cleanup expired pending auths
    for (const [state, pending] of this.pendingAuths) {
      if (now - pending.created_at > PENDING_AUTH_TTL) {
        this.pendingAuths.delete(state);
      }
    }

    // Cleanup expired auth codes
    for (const [code, authCode] of this.authCodes) {
      if (now > authCode.expires_at || authCode.used) {
        this.authCodes.delete(code);
      }
    }
  }

  // ==================== Shutdown ====================

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// Singleton instance
export const oauthStore = new FirestoreOAuthStore();
