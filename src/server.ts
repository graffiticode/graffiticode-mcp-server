#!/usr/bin/env node

/**
 * Hosted MCP Server for Graffiticode
 *
 * Runs as an HTTP server with Streamable HTTP transport.
 * Users authenticate by passing their Graffiticode API key in the Authorization header.
 *
 * Usage:
 *   node dist/server.js
 *
 * Client config:
 *   {
 *     "mcpServers": {
 *       "graffiticode": {
 *         "url": "http://localhost:3001/mcp",
 *         "headers": {
 *           "Authorization": "Bearer gc_xxxxx"
 *         }
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { tools, handleToolCall, SERVER_INSTRUCTIONS } from "./tools.js";
import { createAuthClient } from "./auth.js";
import {
  generateFormWidgetHtml,
  generateClaudeWidgetHtml,
  WIDGET_RESOURCE_URI,
  WIDGET_MIME_TYPE,
  CLAUDE_WIDGET_RESOURCE_URI,
  CLAUDE_WIDGET_MIME_TYPE,
} from "./widget/index.js";
import {
  handleProtectedResourceMetadata,
  handleAuthServerMetadata,
  handleClientRegistration,
  handleAuthorize,
  handleCallback,
  handleToken,
  getFirebaseTokenFromAccessToken,
} from "./oauth/handlers.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — Graffiticode MCP Server</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.3rem; margin-top: 2rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin-top: 1.5rem; }
  ul { padding-left: 1.5rem; }
  li { margin-bottom: 0.5rem; }
  a { color: #1a73e8; }
  .subtitle { color: #555; font-size: 0.95rem; margin-bottom: 2rem; }
</style>
</head>
<body>
<h1>Privacy Policy</h1>
<p class="subtitle">Graffiticode MCP Server &mdash; Effective Date: April 1, 2026</p>

<h2>Overview</h2>
<p>The Graffiticode MCP Server (&ldquo;the Service&rdquo;) is operated by Graffiticode. This policy describes how the Service collects, uses, and protects information when you connect to the Graffiticode MCP server through an MCP-compatible client such as Claude, ChatGPT, or other AI assistants.</p>

<h2>Information We Collect</h2>

<h3>Authentication Credentials</h3>
<p>When you connect to the Service, you provide authentication credentials in one of two ways:</p>
<ul>
  <li><strong>OAuth 2.1 access tokens</strong> &mdash; issued during the OAuth authorization flow. These tokens are used to authenticate requests and are not stored persistently by the MCP server.</li>
  <li><strong>API keys</strong> &mdash; passed as Bearer tokens. API keys are exchanged for short-lived session tokens and are not logged or stored beyond the authentication step.</li>
</ul>

<h3>Content You Create</h3>
<p>When you use the Service&rsquo;s tools (create_item, update_item, get_item), the natural language descriptions you provide and the items you create are stored in the Graffiticode platform. This includes:</p>
<ul>
  <li>Natural language descriptions and modification requests</li>
  <li>Generated code and compiled output data</li>
  <li>Conversation history for iterative editing (stored per item)</li>
  <li>Item metadata (creation and update timestamps, language, name)</li>
</ul>

<h3>Automatically Collected Information</h3>
<p>The Service may collect standard server logs including:</p>
<ul>
  <li>IP addresses</li>
  <li>Request timestamps</li>
  <li>HTTP headers (excluding authorization tokens, which are redacted)</li>
  <li>Error messages for debugging</li>
</ul>

<h2>How We Use Your Information</h2>
<p>We use the information described above to:</p>
<ul>
  <li>Authenticate your requests and authorize access to your items</li>
  <li>Generate, store, and retrieve content you create through the Service</li>
  <li>Maintain conversation history to support iterative editing of items</li>
  <li>Debug errors and maintain service reliability</li>
  <li>Improve the Service</li>
</ul>

<h2>Data Sharing</h2>
<p>We do not sell your personal information. We may share data only in the following circumstances:</p>
<ul>
  <li><strong>Service providers</strong> &mdash; We use Google Cloud Platform to host the Service. Data is processed in accordance with Google Cloud&rsquo;s data processing terms.</li>
  <li><strong>Firebase Authentication</strong> &mdash; Authentication tokens are processed through Firebase. See Google&rsquo;s privacy policy for details.</li>
  <li><strong>Legal requirements</strong> &mdash; We may disclose information if required by law or legal process.</li>
</ul>

<h2>Data Retention</h2>
<ul>
  <li><strong>Items and content</strong> &mdash; Retained as long as your Graffiticode account is active, or until you delete them.</li>
  <li><strong>Authentication tokens</strong> &mdash; Cached in memory for up to 55 minutes and discarded when the server session ends.</li>
  <li><strong>Server logs</strong> &mdash; Retained for up to 90 days for debugging purposes.</li>
</ul>

<h2>Security</h2>
<p>We protect your data using:</p>
<ul>
  <li>HTTPS/TLS encryption for all data in transit</li>
  <li>OAuth 2.1 with PKCE for secure authentication flows</li>
  <li>Short-lived authentication tokens with automatic refresh</li>
  <li>Deployment on Google Cloud Run with managed infrastructure security</li>
</ul>

<h2>Your Rights</h2>
<p>You may:</p>
<ul>
  <li>Request access to or deletion of your data by contacting us</li>
  <li>Delete items you&rsquo;ve created through the Graffiticode console at <a href="https://console.graffiticode.org">console.graffiticode.org</a></li>
  <li>Revoke API keys at any time through your Graffiticode account settings</li>
</ul>

<h2>Changes to This Policy</h2>
<p>We may update this policy from time to time. Changes will be posted to this page with an updated effective date.</p>

<h2>Contact</h2>
<p>For questions about this privacy policy or your data, contact:</p>
<ul>
  <li>Email: <a href="mailto:jeff@artcompiler.com">jeff@artcompiler.com</a></li>
  <li>GitHub: <a href="https://github.com/graffiticode/graffiticode-mcp-server">github.com/graffiticode/graffiticode-mcp-server</a></li>
</ul>
</body>
</html>`;

// Store active transports and servers by session
const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, Server>();

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp.graffiticode.org";

function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  // Support "Bearer <token>" format
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return authHeader;
}

/**
 * Try to get a Firebase token from either OAuth access token or API key
 * Returns { token, source } or null if no valid auth
 */
async function resolveFirebaseToken(
  bearerToken: string
): Promise<{ token: string; source: "oauth" | "apikey" } | null> {
  // First, try OAuth access token (now async with auto-refresh)
  const oauthToken = await getFirebaseTokenFromAccessToken(bearerToken);
  if (oauthToken) {
    return { token: oauthToken, source: "oauth" };
  }

  // Fall back to API key authentication
  try {
    const auth = createAuthClient(bearerToken);
    const token = await auth.getToken();
    return { token, source: "apikey" };
  } catch {
    return null;
  }
}

interface TokenProvider {
  getToken(): Promise<string>;
}

function createMcpServer(tokenProvider: TokenProvider) {
  const server = new Server(
    {
      name: "graffiticode",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const token = await tokenProvider.getToken();
      const result = await handleToolCall(
        { token },
        name,
        args as Record<string, unknown>
      ) as Record<string, unknown>;

      // Extract _meta (widget-only data) from result
      const { _meta, ...structuredContent } = result;

      // Build response with structuredContent for ChatGPT Apps SDK
      // and content as text summary for Claude and other MCP clients
      const response: Record<string, unknown> = {
        structuredContent,
        content: [
          {
            type: "text",
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
      };

      // Add _meta at response level for widget access
      if (_meta) {
        response._meta = _meta;
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources (widgets for ChatGPT and Claude)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: WIDGET_RESOURCE_URI,
          name: "Graffiticode Form Widget",
          mimeType: WIDGET_MIME_TYPE,
          description: "Interactive form widget for ChatGPT",
        },
        {
          uri: CLAUDE_WIDGET_RESOURCE_URI,
          name: "Graffiticode Form Widget (Claude)",
          mimeType: CLAUDE_WIDGET_MIME_TYPE,
          description: "Interactive form widget for Claude",
        },
      ],
    };
  });

  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === WIDGET_RESOURCE_URI) {
      return {
        contents: [
          {
            uri: WIDGET_RESOURCE_URI,
            mimeType: WIDGET_MIME_TYPE,
            text: generateFormWidgetHtml(),
          },
        ],
      };
    }

    if (uri === CLAUDE_WIDGET_RESOURCE_URI) {
      return {
        contents: [
          {
            uri: CLAUDE_WIDGET_RESOURCE_URI,
            mimeType: CLAUDE_WIDGET_MIME_TYPE,
            text: generateClaudeWidgetHtml(),
          },
        ],
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  });

  return server;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Favicon
  if (url.pathname === "/favicon.ico") {
    const FAVICON_PNG = Buffer.from(
      "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",
      "base64"
    );
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": FAVICON_PNG.length.toString(),
      "Cache-Control": "public, max-age=86400",
    });
    res.end(FAVICON_PNG);
    return;
  }

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Privacy policy
  if (url.pathname === "/privacy") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PRIVACY_HTML);
    return;
  }

  // OAuth 2.1 Endpoints

  // Protected Resource Metadata (RFC 9728)
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    handleProtectedResourceMetadata(req, res);
    return;
  }

  // Authorization Server Metadata (RFC 8414)
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    handleAuthServerMetadata(req, res);
    return;
  }

  // Dynamic Client Registration (RFC 7591)
  if (url.pathname === "/oauth/register" && req.method === "POST") {
    await handleClientRegistration(req, res);
    return;
  }

  // Authorization Endpoint
  if (url.pathname === "/oauth/authorize" && req.method === "GET") {
    handleAuthorize(req, res);
    return;
  }

  // OAuth Callback (from consent page)
  if (url.pathname === "/oauth/callback" && req.method === "GET") {
    handleCallback(req, res);
    return;
  }

  // Token Endpoint
  if (url.pathname === "/oauth/token" && req.method === "POST") {
    await handleToken(req, res);
    return;
  }

  // MCP endpoint (Streamable HTTP)
  if (url.pathname === "/mcp") {
    const bearerToken = extractBearerToken(req);

    if (!bearerToken) {
      // Return 401 with WWW-Authenticate header pointing to OAuth metadata
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${MCP_SERVER_URL}/.well-known/oauth-protected-resource"`,
      });
      res.end(JSON.stringify({
        error: "Authorization required",
        message: "Include an OAuth access token or API key in the Authorization header"
      }));
      return;
    }

    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport for this session
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    // Handle DELETE for session termination
    if (req.method === "DELETE") {
      if (sessionId && transports.has(sessionId)) {
        transports.delete(sessionId);
        servers.delete(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "session terminated" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      }
      return;
    }

    // Resolve bearer token to Firebase token (OAuth or API key)
    const resolved = await resolveFirebaseToken(bearerToken);
    if (!resolved) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${MCP_SERVER_URL}/.well-known/oauth-protected-resource"`,
      });
      res.end(JSON.stringify({
        error: "invalid_token",
        message: "Invalid or expired access token"
      }));
      return;
    }

    // Create token provider that returns the resolved Firebase token
    const tokenProvider: TokenProvider = {
      async getToken() {
        // For OAuth tokens, the Firebase token is already resolved
        // For API keys, we've already validated and got the token
        return resolved.token;
      }
    };

    // Create new transport and server for new session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId: string) => {
        transports.set(newSessionId, transport);
        servers.set(newSessionId, server);
      }
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        transports.delete(sid);
        servers.delete(sid);
      }
    };

    const server = createMcpServer(tokenProvider);
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // Not found
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

const httpServer = createServer(handleRequest);

httpServer.listen(PORT, () => {
  console.log(`Graffiticode MCP Server (hosted) running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  MCP:     http://localhost:${PORT}/mcp`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`\nOAuth 2.1 Endpoints:`);
  console.log(`  Metadata:     http://localhost:${PORT}/.well-known/oauth-authorization-server`);
  console.log(`  Register:     http://localhost:${PORT}/oauth/register`);
  console.log(`  Authorize:    http://localhost:${PORT}/oauth/authorize`);
  console.log(`  Token:        http://localhost:${PORT}/oauth/token`);
  console.log(`\nAvailable tools:`);
  tools.forEach(tool => {
    console.log(`  - ${tool.name}`);
  });
  console.log(`\nFor Claude Desktop: Add via Settings > Connectors with URL:`);
  console.log(`  ${MCP_SERVER_URL}/mcp`);
  console.log(`\nFor API key auth (legacy):`);
  console.log(JSON.stringify({
    mcpServers: {
      "graffiticode": {
        url: `http://localhost:${PORT}/mcp`,
        headers: {
          Authorization: "Bearer <your-api-key>"
        }
      }
    }
  }, null, 2));
});
