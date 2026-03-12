const AUTH_URL = process.env.GRAFFITICODE_AUTH_URL || "https://auth.graffiticode.org";
const FIREBASE_API_KEY = "AIzaSyAoVuUNi8ElnS7cn6wc3D8XExML-URLw0I";

interface AuthClient {
  getToken(): Promise<string>;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export function createAuthClient(apiKey: string): AuthClient {
  let cache: TokenCache | null = null;

  async function getFirebaseCustomToken(): Promise<string> {
    const response = await fetch(`${AUTH_URL}/authenticate/api-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: apiKey,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to authenticate: ${error}`);
    }

    const data = await response.json() as {
      status: string;
      error?: { message: string } | null;
      data?: { firebaseCustomToken?: string } | null;
    };

    if (data.status !== "success") {
      throw new Error(`Authentication failed: ${data.error?.message || "Unknown error"}`);
    }

    const firebaseCustomToken = data.data?.firebaseCustomToken;
    if (!firebaseCustomToken) {
      throw new Error("No token returned from authentication");
    }

    return firebaseCustomToken;
  }

  async function exchangeCustomTokenForIdToken(customToken: string): Promise<string> {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange custom token: ${error}`);
    }

    const data = await response.json() as {
      idToken?: string;
      error?: { message: string };
    };

    if (!data.idToken) {
      throw new Error(`No ID token returned: ${data.error?.message || "Unknown error"}`);
    }

    return data.idToken;
  }

  return {
    async getToken(): Promise<string> {
      const now = Date.now();

      // Return cached token if still valid (with 5 minute buffer)
      if (cache && cache.expiresAt > now + 5 * 60 * 1000) {
        return cache.token;
      }

      // Step 1: Exchange API key for Firebase custom token
      const customToken = await getFirebaseCustomToken();

      // Step 2: Exchange custom token for Firebase ID token
      const idToken = await exchangeCustomTokenForIdToken(customToken);

      // Cache for 55 minutes (Firebase tokens typically expire in 1 hour)
      cache = {
        token: idToken,
        expiresAt: now + 55 * 60 * 1000,
      };

      return idToken;
    },
  };
}
