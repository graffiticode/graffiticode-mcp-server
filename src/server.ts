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
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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
import {
  userGuideResourceTemplate,
  matchUserGuideUri,
  readUserGuideResource,
} from "./resources.js";

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

const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terms of Service — Graffiticode MCP Server</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:2rem;line-height:1.6;color:#1a1a1a}h1{font-size:1.8rem;border-bottom:2px solid #c47a5a;padding-bottom:.5rem}h2{font-size:1.2rem;margin-top:2rem;color:#333}ul{padding-left:1.5rem}a{color:#c47a5a}</style>
</head>
<body>
<h1>Terms of Service</h1>
<p><strong>Graffiticode MCP Server</strong><br>Effective Date: April 1, 2026</p>

<h2>Acceptance of Terms</h2>
<p>By connecting to or using the Graffiticode MCP Server ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.</p>

<h2>Description of Service</h2>
<p>The Service provides a Model Context Protocol (MCP) server that enables AI assistants to create, update, and retrieve interactive content using the Graffiticode platform. The Service routes natural language requests to language-specific backends that generate structured output.</p>

<h2>Account and Authentication</h2>
<p>To use the Service, you must authenticate with a valid Graffiticode API key or through the OAuth 2.1 authorization flow. You are responsible for keeping your credentials secure and for all activity under your account.</p>

<h2>Acceptable Use</h2>
<p>You agree not to:</p>
<ul>
  <li>Use the Service to generate content that is illegal, harmful, or violates the rights of others</li>
  <li>Attempt to bypass authentication or access other users' data</li>
  <li>Overload the Service with excessive requests intended to degrade performance</li>
  <li>Reverse-engineer, decompile, or attempt to extract the source code of the backend services</li>
  <li>Use the Service in a way that violates any applicable law or regulation</li>
</ul>

<h2>Intellectual Property</h2>
<p><strong>Your Content</strong> — You retain ownership of the content you create through the Service, including natural language descriptions and the resulting generated items.</p>
<p><strong>Graffiticode Platform</strong> — The Service, its APIs, language backends, and underlying technology are owned by Graffiticode. Nothing in these terms grants you rights to the platform's intellectual property beyond the right to use the Service as described here.</p>
<p><strong>Open Source</strong> — The MCP server source code is available under the terms of its open source license at <a href="https://github.com/graffiticode/graffiticode-mcp-server">github.com/graffiticode/graffiticode-mcp-server</a>.</p>

<h2>Availability and Changes</h2>
<p>The Service is provided on an "as-is" basis. We may modify, suspend, or discontinue the Service at any time without notice. We may also update these terms from time to time; continued use after changes constitutes acceptance.</p>

<h2>Limitation of Liability</h2>
<p>To the maximum extent permitted by law, Graffiticode shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. The Service is provided without warranties of any kind, express or implied.</p>

<h2>Termination</h2>
<p>We may suspend or terminate your access to the Service at any time for violation of these terms or for any other reason at our discretion. You may stop using the Service at any time by revoking your API key or disconnecting the MCP server from your client.</p>

<h2>Governing Law</h2>
<p>These terms are governed by the laws of the State of California, without regard to conflict of law provisions.</p>

<h2>Contact</h2>
<ul>
  <li>Email: <a href="mailto:support@graffiticode.org">support@graffiticode.org</a></li>
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

  // Advertise per-language user-guide resources as a URI template
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [userGuideResourceTemplate],
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

    const langId = matchUserGuideUri(uri);
    if (langId) {
      const token = await tokenProvider.getToken();
      const content = await readUserGuideResource({ token, uri, langId });
      return { contents: [content] };
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
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const faviconPath = join(__dirname, "..", "favicon.ico");
      const faviconData = readFileSync(faviconPath);
      res.writeHead(200, {
        "Content-Type": "image/x-icon",
        "Content-Length": faviconData.length.toString(),
        "Cache-Control": "public, max-age=86400",
      });
      res.end(faviconData);
    } catch {
      res.writeHead(404);
      res.end();
    }
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

  // Terms of service
  if (url.pathname === "/terms") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(TERMS_HTML);
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
