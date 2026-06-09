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
import type { AuthContext } from "./api.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  generateFormWidgetHtml,
  generateClaudeWidgetHtml,
  WIDGET_RESOURCE_URI,
  WIDGET_MIME_TYPE,
  CLAUDE_WIDGET_RESOURCE_URI,
  CLAUDE_WIDGET_MIME_TYPE,
  CLAUDE_WIDGET_CSP,
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
  listSkillResources,
  matchSkillUri,
  readSkillResource,
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
  <li>About this server: <a href="/about">/about</a></li>
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
  <li>About this server: <a href="/about">/about</a></li>
</ul>
</body>
</html>`;

const ABOUT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About — Graffiticode MCP Server</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.3rem; margin-top: 2rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin-top: 1.5rem; }
  ul { padding-left: 1.5rem; }
  li { margin-bottom: 0.5rem; }
  a { color: #1a73e8; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
  pre { background: #f5f5f5; padding: 0.75rem 1rem; border-radius: 6px; overflow-x: auto; }
  code { background: #f5f5f5; padding: 0.1rem 0.35rem; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  .subtitle { color: #555; font-size: 0.95rem; margin-bottom: 2rem; }
  .endpoint { font-size: 1.05rem; background: #f5f5f5; padding: 0.75rem 1rem; border-radius: 6px; display: inline-block; margin: 0.25rem 0 1rem; }
</style>
</head>
<body>
<h1>About</h1>
<p class="subtitle">Graffiticode MCP Server</p>

<h2>What it is</h2>
<p>Graffiticode MCP is a hosted Model Context Protocol server that lets AI assistants create and edit interactive content through Graffiticode&rsquo;s language family.</p>

<h2>Connect</h2>
<p>Point any MCP-compatible client at:</p>
<p class="endpoint"><code>https://mcp.graffiticode.org/mcp</code></p>
<p>The server speaks the Streamable HTTP transport. A minimal client config looks like:</p>
<pre><code>{
  "mcpServers": {
    "graffiticode": {
      "url": "https://mcp.graffiticode.org/mcp"
    }
  }
}</code></pre>
<p>Authentication is optional. The server accepts:</p>
<ul>
  <li><strong>OAuth 2.1</strong> &mdash; clients that support dynamic registration can complete the standard authorization flow.</li>
  <li><strong>API key</strong> &mdash; pass a Graffiticode API key as <code>Authorization: Bearer &lt;key&gt;</code>.</li>
  <li><strong>No auth (free plan)</strong> &mdash; connect without credentials to try the server. Items you create can be transferred into a real Graffiticode account via a one-time claim link returned in the tool response.</li>
</ul>

<h2>What it can do</h2>
<p>The server exposes a small, fixed set of language-agnostic tools. The catalog of Graffiticode languages they route to grows over time.</p>
<ul>
  <li><code>list_languages</code> &mdash; discover available languages, optionally filtered by keyword or domain.</li>
  <li><code>get_language_info</code> &mdash; fetch a language&rsquo;s authoring guide, supported item types, and example prompts.</li>
  <li><code>create_item</code> &mdash; create a new item in a chosen language from a natural-language description.</li>
  <li><code>update_item</code> &mdash; iteratively edit an existing item. Conversation history is preserved per item.</li>
  <li><code>get_item</code> &mdash; retrieve an item by id.</li>
</ul>
<p>All <code>create_item</code> and <code>update_item</code> requests are natural language &mdash; a language-specific backend handles code generation. Clients should not attempt to write Graffiticode DSL directly.</p>

<h2>When to reach for it</h2>
<p>For human users: when you want an AI assistant to author interactive content that can be embedded, shared, or published.</p>
<p>For agents: call <code>list_languages</code> when a user&rsquo;s request doesn&rsquo;t match a more specific tool you already have. If a language matches, fetch its info and create an item; if nothing matches, this server is the wrong tool.</p>

<h2>Free plan</h2>
<p>The no-auth path lets a user try the server before creating an account. Items created this way live in an anonymous session namespace. Each tool response includes a <code>view_url</code> for viewing the item and a <code>claim_url</code> the user can open to move the item into a real Graffiticode account on first sign-in. Claim links are valid for 24 hours.</p>

<h2>Operator</h2>
<p>This server is operated by Graffiticode and hosted on Google Cloud Run. Source is available at <a href="https://github.com/graffiticode/graffiticode-mcp-server">github.com/graffiticode/graffiticode-mcp-server</a>.</p>

<h2>Links</h2>
<ul>
  <li><a href="https://console.graffiticode.org">Graffiticode console</a> &mdash; manage your account and items</li>
  <li><a href="/privacy">Privacy policy</a></li>
  <li><a href="/terms">Terms of service</a></li>
  <li>Contact: <a href="mailto:jeff@artcompiler.com">jeff@artcompiler.com</a></li>
</ul>
</body>
</html>`;

// Store active transports and servers by session
const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, Server>();

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "https://mcp.graffiticode.org";

// Machine-readable MCP discovery document. Served at both /mcp.json and
// /.well-known/mcp.json so agents and registries can locate the canonical
// endpoint and tool set without an authenticated call. Trial tokens are NOT
// published here — they are scoped per toolset on the toolset subdomains.
const MCP_DISCOVERY = {
  mcp_endpoint: `${MCP_SERVER_URL}/mcp`,
  site: MCP_SERVER_URL,
  description:
    "Graffiticode is a universal MCP server of smart tools for AI agents and the people who use them. Each tool is one domain language wrapped by a specialized AI; call list_languages to discover what is available.",
  tools: ["create_item", "update_item", "get_item", "list_languages", "get_language_info"],
  product_url: "https://graffiticode.org",
  console_url: "https://console.graffiticode.org",
  forum_url: "https://forum.graffiticode.org",
  github_url: "https://github.com/graffiticode",
};

function handleMcpDiscovery(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
  res.end(JSON.stringify(MCP_DISCOVERY, null, 2));
}

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
 * Resolve the bearer credential to whatever should be forwarded to the
 * console as Authorization. OAuth access tokens are exchanged here for a
 * Firebase ID token (we already hold the refresh token in the OAuth store).
 * Anything else is treated as a Graffiticode api key and forwarded verbatim
 * — the console will exchange it to a Firebase ID token before calling
 * api.graffiticode.org. This keeps the api-key exchange logic in one place.
 */
async function resolveBearer(
  bearerToken: string
): Promise<{ token: string; source: "oauth" | "raw" }> {
  const oauthToken = await getFirebaseTokenFromAccessToken(bearerToken);
  if (oauthToken) {
    return { token: oauthToken, source: "oauth" };
  }
  return { token: bearerToken, source: "raw" };
}

interface AuthProvider {
  getAuth(): Promise<AuthContext>;
}

function createMcpServer(authProvider: AuthProvider) {
  const server = new Server(
    {
      name: "graffiticode",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        // Advertise MCP Apps (interactive UI) support. `extensions` is not yet
        // in the SDK's ServerCapabilities type (pending SEP-1724), so cast.
        extensions: {
          [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
        },
      } as Record<string, unknown>,
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
      const auth = await authProvider.getAuth();
      const result = await handleToolCall(
        { auth },
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

  // List available resources (widgets for ChatGPT and Claude, plus skills
  // discovered at request time from the public graffiticode-skills repo).
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Array<Record<string, unknown>> = [
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
        _meta: { ui: { csp: CLAUDE_WIDGET_CSP } },
      },
    ];
    // Skills are best-effort: a GitHub outage must not break resource listing.
    try {
      resources.push(...(await listSkillResources()));
    } catch (err) {
      console.error(
        `[skills] list failed: ${(err as Error)?.message ?? err}`,
      );
    }
    return { resources };
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
            _meta: { ui: { csp: CLAUDE_WIDGET_CSP } },
          },
        ],
      };
    }

    const skillId = matchSkillUri(uri);
    if (skillId) {
      return { contents: [await readSkillResource(uri, skillId)] };
    }

    const langId = matchUserGuideUri(uri);
    if (langId) {
      const auth = await authProvider.getAuth();
      const content = await readUserGuideResource({ auth, uri, langId });
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Free-Plan-Session, mcp-session-id");

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

  // About
  if (url.pathname === "/about") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ABOUT_HTML);
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

  // Protected Resource Metadata (RFC 9728). Serve both the bare well-known path
  // and the path-scoped variant: for a resource at `${host}/mcp`, RFC 9728 tells
  // clients to insert the well-known label before the resource path and request
  // `/.well-known/oauth-protected-resource/mcp`. Both return identical metadata.
  if (
    url.pathname === "/.well-known/oauth-protected-resource" ||
    url.pathname === "/.well-known/oauth-protected-resource/mcp"
  ) {
    handleProtectedResourceMetadata(req, res);
    return;
  }

  // Authorization Server Metadata (RFC 8414)
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    handleAuthServerMetadata(req, res);
    return;
  }

  // Machine-readable MCP discovery document (canonical endpoint + tool set).
  // Also served at the host root so `/` is a pointer to the canonical entry
  // (and a healthy 200 for health checks) rather than a bare 404.
  if (url.pathname === "/" || url.pathname === "/mcp.json" || url.pathname === "/.well-known/mcp.json") {
    handleMcpDiscovery(res);
    return;
  }

  // Dynamic Client Registration (RFC 7591)
  if (url.pathname === "/oauth/register" && req.method === "POST") {
    await handleClientRegistration(req, res);
    return;
  }

  // Authorization Endpoint
  if (url.pathname === "/oauth/authorize" && req.method === "GET") {
    await handleAuthorize(req, res);
    return;
  }

  // OAuth Callback (from consent page)
  if (url.pathname === "/oauth/callback" && req.method === "GET") {
    await handleCallback(req, res);
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

    // Build the auth provider:
    //   - bearer present  → resolve OAuth or pass api key through to console
    //   - bearer absent   → free-plan: forward calls with X-Free-Plan-Session
    //
    // We don't 401 invalid api keys here anymore; the console rejects them
    // (verifyToken fails, then getCredentialsForApiKey throws), and the
    // GraphQL error path surfaces a clean message.
    let authProvider: AuthProvider;
    if (bearerToken) {
      const resolved = await resolveBearer(bearerToken);
      authProvider = {
        async getAuth() {
          return { type: "firebase", token: resolved.token };
        },
      };
    } else {
      // No bearer → free-plan. The auth provider reads the MCP session id
      // lazily from the transport, which sets it during the initialize POST.
      const transportRef: { current: StreamableHTTPServerTransport | null } = { current: null };
      authProvider = {
        async getAuth() {
          const sid = transportRef.current?.sessionId;
          if (!sid) {
            throw new Error(
              "Free-plan session not yet initialized. Send an MCP `initialize` request first."
            );
          }
          return { type: "freePlan", sessionId: sid };
        },
      };
      // Stash the holder so we can populate it once the transport exists.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (authProvider as any).__transportRef = transportRef;
    }

    // Create new transport and server for new session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId: string) => {
        transports.set(newSessionId, transport);
        servers.set(newSessionId, server);
      }
    });

    // For the free-plan auth provider we just built, point its closure
    // reference at the live transport so getAuth() can read sessionId.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transportRef = (authProvider as any).__transportRef as
      | { current: StreamableHTTPServerTransport | null }
      | undefined;
    if (transportRef) {
      transportRef.current = transport;
    }

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        transports.delete(sid);
        servers.delete(sid);
      }
    };

    const server = createMcpServer(authProvider);
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
  console.log(`\nFor free-plan (no auth) access:`);
  console.log(JSON.stringify({
    mcpServers: {
      "graffiticode": {
        url: `http://localhost:${PORT}/mcp`
      }
    }
  }, null, 2));
});
