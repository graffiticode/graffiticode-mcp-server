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
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tools, handleToolCall, SERVER_INSTRUCTIONS, toolsForClient, isOpenAIClient } from "./tools.js";
import type { AuthContext } from "./api.js";
import { identify, logConnect, logToolCall, type EventOutcome, type SessionMeta } from "./events.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  generateFormWidgetHtml,
  generateClaudeWidgetHtml,
  WIDGET_RESOURCE_URI,
  WIDGET_MIME_TYPE,
  CLAUDE_WIDGET_RESOURCE_URI,
  CLAUDE_WIDGET_MIME_TYPE,
  CLAUDE_WIDGET_CSP,
  generateSpikeWidgetHtml,
  SPIKE_ENABLED,
  spikeCsp,
  spikeResourceUris,
} from "./widget/index.js";
import { normalizeLanguageId, isNativeLanguage } from "./widget/languages.js";
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
<p class="subtitle">Graffiticode MCP Server &mdash; Effective Date: July 13, 2026</p>

<h2>Overview</h2>
<p>The Graffiticode MCP Server (&ldquo;the Service&rdquo;) is operated by Artcompiler. This policy describes how the Service collects, uses, and protects information when you connect to it through an MCP-compatible client such as Claude, ChatGPT, or another AI assistant.</p>

<h2>Information We Collect</h2>

<h3>Authentication Credentials</h3>
<p>The Service supports three ways to connect, and each handles credentials differently:</p>
<ul>
  <li><strong>No credentials (free plan)</strong> &mdash; you may connect without signing in. We do not collect any account identity. Your items are scoped to an anonymous session identifier (see <em>Free-plan sessions</em> below).</li>
  <li><strong>API keys</strong> &mdash; passed as a Bearer token and forwarded to the Graffiticode platform to authenticate the request. API keys are not written to our logs.</li>
  <li><strong>OAuth 2.1</strong> &mdash; if you authorize through the OAuth flow, we store an OAuth record so your session can be refreshed without asking you to sign in repeatedly. <strong>That record includes the email address of the Google account you authorized with, together with an access token and a refresh token.</strong> It is persisted through the Graffiticode auth service, not merely held in memory.</li>
</ul>

<h3>Content You Create</h3>
<p>When you use the Service&rsquo;s content tools (<code>create_item</code>, <code>update_item</code>, <code>get_item</code>, <code>get_spec</code>), the natural language descriptions you provide and the items you create are sent to the Graffiticode platform and stored there. This includes:</p>
<ul>
  <li>Natural language descriptions and modification requests</li>
  <li>Generated code and compiled output data</li>
  <li>Conversation history for iterative editing (stored per item)</li>
  <li>Item metadata (creation and update timestamps, language, name)</li>
</ul>

<h3>Free-plan Sessions</h3>
<p>If you connect without credentials, items you create are namespaced to the session identifier your MCP client established. The Service can mint a one-time <em>claim link</em>, valid for 24 hours, that lets you transfer those items into a real Graffiticode account the first time you sign in. The claim link contains a signed token derived from the session identifier &mdash; it carries no personal data. If you never claim them, free-plan items remain associated only with that anonymous session.</p>

<h3>Usage Analytics</h3>
<p>The Service emits coarse, privacy-preserving analytics events to measure engagement (connections, tool usage, success rates). These events deliberately exclude personal data:</p>
<ul>
  <li>Sessions and tokens appear only as <strong>one-way hashes</strong>, never in raw form.</li>
  <li>Your prompt text appears only as a <strong>character count</strong> &mdash; never the prompt itself.</li>
  <li>Location is recorded only as a <strong>coarse country</strong> (and, where available, region) derived at our CDN edge. <strong>We do not record your IP address.</strong></li>
  <li>We record the <strong>client kind</strong> (the name your MCP client reports, e.g. &ldquo;claude-ai&rdquo;), which identifies software, not you.</li>
</ul>
<p>One caveat, stated plainly: when a request fails we record a truncated backend error message so we can debug it. Error text is not intended to carry your content, but we cannot categorically rule out that a backend message quotes part of an input.</p>

<h3>Server Logs</h3>
<p>The Service writes operational logs for debugging &mdash; request timestamps, error messages, and diagnostic warnings. Authorization headers are never logged. As noted above, the client IP address is not recorded in our analytics events.</p>

<h2>How We Use Your Information</h2>
<ul>
  <li>Authenticate your requests and authorize access to your items</li>
  <li>Generate, store, and retrieve content you create through the Service</li>
  <li>Maintain conversation history to support iterative editing of items</li>
  <li>Debug errors and maintain service reliability</li>
  <li>Understand aggregate usage so we can improve the Service</li>
</ul>

<h2>Data Sharing</h2>
<p>We do not sell your personal information. Data reaches the following parties in the course of running the Service:</p>
<ul>
  <li><strong>Graffiticode platform</strong> &mdash; the console and API receive the content you create and the requests you make. This is where code generation happens and where your items live.</li>
  <li><strong>Google Cloud Platform</strong> &mdash; hosts the Service (Cloud Run) and receives its operational and analytics logs (Cloud Logging).</li>
  <li><strong>Firebase Authentication (Google)</strong> &mdash; processes authentication tokens. See Google&rsquo;s privacy policy for details.</li>
  <li><strong>Cloudflare</strong> &mdash; sits in front of the Service as our CDN and edge network, and necessarily handles your connection. Cloudflare is also the source of the coarse country/region signal described above.</li>
  <li><strong>GitHub</strong> &mdash; the Service fetches its public agent-skill catalog from a public GitHub repository at request time. <strong>No user data is sent to GitHub</strong>; GitHub sees only the Service&rsquo;s own outbound requests.</li>
  <li><strong>Legal requirements</strong> &mdash; we may disclose information if required by law or legal process.</li>
</ul>

<h2>Data Retention</h2>
<ul>
  <li><strong>Items and content</strong> &mdash; retained as long as your Graffiticode account is active, or until you delete them.</li>
  <li><strong>OAuth records</strong> &mdash; the stored email, access token, and refresh token persist until the token is revoked or expires. Access tokens are valid for 55 minutes and are rotated on refresh.</li>
  <li><strong>API keys</strong> &mdash; not stored by the Service; forwarded per request and discarded.</li>
  <li><strong>Free-plan claim tokens</strong> &mdash; valid for 24 hours, after which the link expires.</li>
  <li><strong>Server logs</strong> &mdash; retained for up to 90 days for debugging purposes.</li>
</ul>

<h2>Security</h2>
<ul>
  <li>HTTPS/TLS encryption for all data in transit</li>
  <li>OAuth 2.1 with PKCE (S256) for secure authentication flows</li>
  <li>Short-lived tokens with automatic refresh and rotation</li>
  <li>Long-lived API keys are exchanged for short-lived tokens rather than being embedded in render URLs</li>
  <li>Deployment on Google Cloud Run with managed infrastructure security</li>
</ul>

<h2>Your Rights</h2>
<p>You may:</p>
<ul>
  <li>Request access to or deletion of your data by contacting us</li>
  <li>Delete items you&rsquo;ve created through the Graffiticode console at <a href="https://console.graffiticode.org">console.graffiticode.org</a></li>
  <li>Revoke API keys at any time through your Graffiticode account settings</li>
  <li>Disconnect the Service from your MCP client at any time, which stops all further data flow</li>
</ul>

<h2>Changes to This Policy</h2>
<p>We may update this policy from time to time. Changes will be posted to this page with an updated effective date.</p>

<h2>Contact</h2>
<p>For questions about this privacy policy or your data, contact:</p>
<ul>
  <li>Email: <a href="mailto:support@graffiticode.org">support@graffiticode.org</a></li>
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
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.3rem; margin-top: 2rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3rem; }
  ul { padding-left: 1.5rem; }
  li { margin-bottom: 0.5rem; }
  a { color: #1a73e8; }
  .subtitle { color: #555; font-size: 0.95rem; margin-bottom: 2rem; }
</style>
</head>
<body>
<h1>Terms of Service</h1>
<p class="subtitle">Graffiticode MCP Server &mdash; Effective Date: July 13, 2026</p>

<h2>Acceptance of Terms</h2>
<p>By connecting to or using the Graffiticode MCP Server ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.</p>

<h2>Description of Service</h2>
<p>The Service provides a Model Context Protocol (MCP) server that enables AI assistants to create, update, and retrieve interactive content using the Graffiticode platform. The Service routes natural language requests to language-specific backends that generate structured output.</p>

<h2>Account and Authentication</h2>
<p>Authentication is optional. You may connect without credentials on the free plan, or authenticate with a Graffiticode API key or through the OAuth 2.1 authorization flow to associate your work with an account. If you do authenticate, you are responsible for keeping your credentials secure and for all activity under your account.</p>
<p>Items created on the free plan are scoped to an anonymous session and can be transferred into an account using a claim link, which is valid for 24 hours. Until claimed, they are not associated with any account and may be removed.</p>

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
<p><strong>Your Content</strong> &mdash; You retain ownership of the content you create through the Service, including natural language descriptions and the resulting generated items.</p>
<p><strong>Graffiticode Platform</strong> &mdash; The Service, its APIs, language backends, and underlying technology are owned by Artcompiler. Nothing in these terms grants you rights to the platform's intellectual property beyond the right to use the Service as described here.</p>
<p><strong>Open Source</strong> &mdash; The MCP server source code is available under the MIT license at <a href="https://github.com/graffiticode/graffiticode-mcp-server">github.com/graffiticode/graffiticode-mcp-server</a>.</p>

<h2>Availability and Changes</h2>
<p>The Service is provided on an "as-is" basis. We may modify, suspend, or discontinue the Service at any time without notice. We may also update these terms from time to time; continued use after changes constitutes acceptance.</p>

<h2>Limitation of Liability</h2>
<p>To the maximum extent permitted by law, Artcompiler shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. The Service is provided without warranties of any kind, express or implied.</p>

<h2>Termination</h2>
<p>We may suspend or terminate your access to the Service at any time for violation of these terms or for any other reason at our discretion. You may stop using the Service at any time by revoking your API key or disconnecting the MCP server from your client.</p>

<h2>Governing Law</h2>
<p>These terms are governed by the laws of the State of California, without regard to conflict of law provisions.</p>

<h2>Contact</h2>
<ul>
  <li>Email: <a href="mailto:support@graffiticode.org">support@graffiticode.org</a></li>
  <li>GitHub: <a href="https://github.com/graffiticode/graffiticode-mcp-server">github.com/graffiticode/graffiticode-mcp-server</a></li>
  <li>About this server: <a href="/about">/about</a></li>
  <li>Privacy policy: <a href="/privacy">/privacy</a></li>
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
  <li><code>list_languages</code> &mdash; discover available languages, optionally filtered by keyword (<code>search</code>) or <code>domain</code>.</li>
  <li><code>get_language_info</code> &mdash; fetch a language&rsquo;s authoring guide, supported item types, and example prompts.</li>
  <li><code>create_item</code> &mdash; create a new item in a chosen language from a natural-language description.</li>
  <li><code>update_item</code> &mdash; iteratively edit an existing item. Conversation history is preserved per item.</li>
  <li><code>get_item</code> &mdash; retrieve an item by id.</li>
  <li><code>get_spec</code> &mdash; get a platform-neutral English description of an item&rsquo;s content.</li>
</ul>
<p>All <code>create_item</code> and <code>update_item</code> requests are natural language &mdash; a language-specific backend handles code generation. Clients should not attempt to write Graffiticode DSL directly.</p>
<p>Generation takes time, so <code>create_item</code> and <code>update_item</code> return immediately with a status of <code>generating</code>; call <code>get_item</code> to wait for the finished result.</p>
<p>An item&rsquo;s <code>src</code> and <code>data</code> are private to its own language. To reuse one item&rsquo;s content in another language, call <code>get_spec</code> and pass the spec to <code>create_item</code> &mdash; never pass a raw item id or its code across languages.</p>

<h2>Resources</h2>
<p>Alongside the tools, the server exposes MCP resources:</p>
<ul>
  <li><strong>Language user guides</strong> &mdash; <code>graffiticode://language/{id}/user-guide</code>, the full authoring reference for a language.</li>
  <li><strong>Agent skills</strong> &mdash; <code>graffiticode://skills/&lt;id&gt;</code>, discovered at request time from the public <a href="https://github.com/graffiticode/graffiticode-skills">graffiticode-skills</a> repo, so new skills appear without a redeploy.</li>
  <li><strong>Inline widgets</strong> &mdash; items render as interactive widgets directly in the chat, both in Claude (MCP Apps) and in ChatGPT (Apps SDK).</li>
</ul>

<h2>When to reach for it</h2>
<p>For human users: when you want an AI assistant to author interactive content that can be embedded, shared, or published.</p>
<p>For agents: call <code>list_languages</code> when a user&rsquo;s request doesn&rsquo;t match a more specific tool you already have. If a language matches, fetch its info and create an item; if nothing matches, this server is the wrong tool.</p>

<h2>Free plan</h2>
<p>The no-auth path lets a user try the server before creating an account. Items created this way live in an anonymous session namespace. Once an item is ready, the response includes a <code>view_url</code> for viewing it and a <code>claim_url</code> the user can open to move the item into a real Graffiticode account on first sign-in. Claim links are valid for 24 hours.</p>

<h2>Operator</h2>
<p>This server is operated by Artcompiler and hosted on Google Cloud Run. Source is available under the MIT license at <a href="https://github.com/graffiticode/graffiticode-mcp-server">github.com/graffiticode/graffiticode-mcp-server</a>.</p>

<h2>Links</h2>
<ul>
  <li><a href="https://console.graffiticode.org">Graffiticode console</a> &mdash; manage your account and items</li>
  <li><a href="/privacy">Privacy policy</a></li>
  <li><a href="/terms">Terms of service</a></li>
  <li>Contact: <a href="mailto:support@graffiticode.org">support@graffiticode.org</a></li>
</ul>
</body>
</html>`;

// Store active transports and servers by session
const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, Server>();

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Coarse, non-PII geo from request headers. We are behind Cloudflare, which
 * injects `CF-IPCountry` (and, on some plans, region) at the edge — so we read
 * country/region only and never touch the raw client IP (`cf-connecting-ip`).
 * Sentinel countries Cloudflare uses for unknown/Tor are dropped.
 */
function geoFromHeaders(headers: IncomingMessage["headers"]): SessionMeta {
  const meta: SessionMeta = {};
  const country = firstHeader(headers["cf-ipcountry"])?.toUpperCase();
  if (country && country !== "XX" && country !== "T1") {
    meta.geoCountry = country;
  }
  const region = firstHeader(headers["cf-region-code"])?.toUpperCase();
  if (region) meta.geoRegion = region;
  return meta;
}

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
  tools: ["create_item", "update_item", "get_item", "get_spec", "list_languages", "get_language_info"],
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

function createMcpServer(authProvider: AuthProvider, sessionMeta: SessionMeta = {}) {
  const server = new Server(
    {
      name: "graffiticode",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        // Lets us emit notifications/message during long tool calls (the
        // keepalive fallback when the client didn't request progress).
        logging: {},
        // Advertise MCP Apps (interactive UI) support. `extensions` is not yet
        // in the SDK's ServerCapabilities type (pending SEP-1724), so cast.
        extensions: {
          [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
        },
      } as Record<string, unknown>,
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // List available tools. The widget a tool's _meta.ui.resourceUri points at is
  // host-dependent (ChatGPT needs the Skybridge widget, Claude the MCP-Apps one) —
  // see toolsForClient(). Log the host so the OpenAI matcher can be tuned if a
  // client name doesn't match.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const clientName = server.getClientVersion()?.name;
    console.log(
      `[widget] tools/list host=${clientName ?? "?"} → ${
        isOpenAIClient(clientName) ? "skybridge" : "mcp-app"
      }`
    );
    return {
      tools: toolsForClient(clientName),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Funnel instrumentation: capture metadata only (never raw prompts).
    const start = Date.now();
    const toolArgs = (args ?? {}) as Record<string, unknown>;
    const lang = typeof toolArgs.language === "string" ? toolArgs.language : undefined;
    const description =
      typeof toolArgs.description === "string"
        ? toolArgs.description
        : typeof toolArgs.modification === "string"
        ? toolArgs.modification
        : undefined;
    const descLen = description?.length;
    let identity: { auth: "freePlan" | "firebase"; session: string } | null = null;

    // clientInfo isn't known when the session id is minted (mcp_connect), but
    // it's set by the time any tool runs — backfill it onto the session meta.
    const clientKind = server.getClientVersion()?.name;
    if (clientKind && !sessionMeta.clientKind) sessionMeta.clientKind = clientKind;

    // Keepalive heartbeat. L0175 create_item/update_item legitimately take
    // 60-90s (LLM generation), which exceeds some MCP clients' read timeout —
    // they declare a "retryable server error" even though the call succeeds.
    // The streamable-HTTP transport holds this POST's SSE stream open until we
    // return; emitting a notification every 10s keeps bytes flowing so the
    // client's read timer never fires. `extra.sendNotification` is
    // request-scoped, so the SDK routes it to this POST's stream.
    // Prefer notifications/progress when the client opted in (sent a
    // progressToken); otherwise fall back to a debug log notification, which
    // needs no token and still resets the timer. Fast tools return before the
    // first tick, so this is a no-op for them.
    const progressToken = request.params._meta?.progressToken;
    let heartbeatTicks = 0;
    const heartbeat = setInterval(() => {
      heartbeatTicks += 1;
      const note: ServerNotification =
        progressToken !== undefined
          ? {
              method: "notifications/progress",
              params: { progressToken, progress: heartbeatTicks, message: "Generating…" },
            }
          : {
              method: "notifications/message",
              params: { level: "debug", data: "Generating…" },
            };
      extra.sendNotification(note).catch(() => {});
    }, 10_000);

    try {
      const auth = await authProvider.getAuth();
      identity = identify(auth);
      const result = await handleToolCall(
        { auth },
        name,
        args as Record<string, unknown>
      ) as Record<string, unknown>;

      // A handled generation error returns status:"failed" rather than throwing.
      const outcome: EventOutcome = result.status === "failed" ? "generation_failed" : "ok";
      logToolCall({
        ...identity,
        tool: name,
        outcome,
        ms: Date.now() - start,
        lang,
        descLen,
        progress: progressToken !== undefined,
        err: outcome === "generation_failed" ? String(result.error ?? "") : undefined,
        meta: sessionMeta,
      });

      // Extract _meta (widget-only data) and the chat-facing `summary` from the
      // result. `summary`, when present, is a concise link-forward string used
      // as the text content for clients that render text instead of the widget
      // iframe (e.g. Codex). It's kept out of structuredContent so the
      // programmatic shape stays clean.
      const { _meta, summary, ...structuredContent } = result;

      // Build response with structuredContent for ChatGPT Apps SDK and content
      // as a summary (when provided) or the full JSON for Claude and other MCP
      // clients. Widget hosts render the iframe and ignore this text.
      const response: Record<string, unknown> = {
        structuredContent,
        content: [
          {
            type: "text",
            text: typeof summary === "string"
              ? summary
              : JSON.stringify(structuredContent, null, 2),
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
      if (identity) {
        logToolCall({
          ...identity,
          tool: name,
          outcome: "error",
          ms: Date.now() - start,
          lang,
          descLen,
          progress: progressToken !== undefined,
          err: message,
          meta: sessionMeta,
        });
      }
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    } finally {
      clearInterval(heartbeat);
    }
  });

  // List available resources (widgets for ChatGPT and Claude, plus skills
  // discovered at request time from the public graffiticode-skills repo).
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const spike = SPIKE_ENABLED ? spikeResourceUris(MCP_SERVER_URL) : null;
    const spikeCspMeta = SPIKE_ENABLED ? spikeCsp(MCP_SERVER_URL) : null;
    const resources: Array<Record<string, unknown>> = [
      ...(spike && spikeCspMeta
        ? [
            {
              uri: spike.openai,
              name: "Graffiticode Loading Spike (ChatGPT)",
              mimeType: WIDGET_MIME_TYPE,
              description: "Temporary widget-loading probe",
              _meta: { ui: { csp: spikeCspMeta.camel }, "openai/widgetCSP": spikeCspMeta.snake },
            },
            {
              uri: spike.mcp,
              name: "Graffiticode Loading Spike (Claude)",
              mimeType: CLAUDE_WIDGET_MIME_TYPE,
              description: "Temporary widget-loading probe",
              _meta: { ui: { csp: spikeCspMeta.camel } },
            },
          ]
        : []),
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

    // SPIKE (temporary): serve the loading probe at its content-hashed URIs, so a
    // rebuilt probe is never served from the host's cache. Declares resourceDomains
    // (the bundle origin) and no frameDomains. Off unless WIDGET_SPIKE=1.
    if (SPIKE_ENABLED) {
      const spike = spikeResourceUris(MCP_SERVER_URL);
      if (uri === spike.openai || uri === spike.mcp) {
        const csp = spikeCsp(MCP_SERVER_URL);
        return {
          contents: [
            {
              uri,
              mimeType: uri === spike.openai ? WIDGET_MIME_TYPE : CLAUDE_WIDGET_MIME_TYPE,
              text: generateSpikeWidgetHtml(MCP_SERVER_URL),
              _meta: { ui: { csp: csp.camel }, "openai/widgetCSP": csp.snake },
            },
          ],
        };
      }
    }

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

  // CORS headers. `mcp-protocol-version` is sent by spec-compliant clients
  // (2025-06-18+) on every request after initialize; omitting it from the
  // allow-list makes the preflight fail for browser-based clients (e.g. the MCP
  // Inspector connecting directly from localhost). `mcp-session-id` must also be
  // exposed so the browser client can read it off the initialize response —
  // otherwise the session id is invisible to JS and the next request 404s.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Free-Plan-Session, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

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

  // Per-language widget bundles. The widget loads these at render time to render
  // an item natively, instead of iframing the /form renderer. Served from our own
  // origin, which the widget resource declares in `_meta.ui.csp.resourceDomains`.
  //
  // These are ES modules, and module scripts are ALWAYS fetched in CORS mode (unlike
  // classic scripts) from an opaque, host-specific sandbox origin — so the
  // `Access-Control-Allow-Origin: *` set above is load-bearing, not incidental.
  const langBundle = url.pathname.match(/^\/widget\/lang\/([A-Za-z0-9]+)(\.iife)?\.(?:m)?js$/);
  if (langBundle) {
    const langId = normalizeLanguageId(langBundle[1]);
    const suffix = langBundle[2] ? "iife.js" : "mjs";
    if (!isNativeLanguage(langId)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Unknown language bundle");
      return;
    }
    try {
      const bundlePath = join(dirname(fileURLToPath(import.meta.url)), "widget", "lang", `${langId}.${suffix}`);
      const bundle = readFileSync(bundlePath);
      // Revalidate rather than cache immutably: the URL is stable across deploys,
      // so `immutable` would pin a stale component bundle after an `npm update` of
      // the language package. The ETag makes the repeat fetch a cheap 304.
      const etag = `"${createHash("sha256").update(bundle).digest("hex").slice(0, 16)}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Length": bundle.length.toString(),
        "Cache-Control": "public, max-age=0, must-revalidate",
        ETag: etag,
      });
      res.end(bundle);
    } catch (err) {
      console.error(`[widget] bundle read failed for ${langId}: ${(err as Error)?.message ?? err}`);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Bundle not built");
    }
    return;
  }

  // SPIKE (temporary): the probe as a plain page, so it can be opened in a browser
  // outside any MCP host. Catches mount/render bugs without a deploy; it does NOT
  // test the host sandbox CSP, which is the whole point of the probe — only
  // ChatGPT/Claude can answer that.
  if (SPIKE_ENABLED && url.pathname === "/spike") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(generateSpikeWidgetHtml(MCP_SERVER_URL));
    return;
  }

  // SPIKE (temporary): the probe beacons its findings here. The host sandbox is
  // opaque (no reachable devtools), so when the widget frame comes up blank this is
  // the only way to see what the probe actually observed inside it.
  if (SPIKE_ENABLED && url.pathname === "/spike/report" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const r = JSON.parse(body);
        const host = /Electron/.test(r.ua ?? "")
          ? "claude-desktop"
          : /HeadlessChrome/.test(r.ua ?? "")
            ? "headless"
            : "browser";
        console.log(
          `[spike-report] host=${host}\n` +
            `  lines:\n${(r.lines ?? []).map((l: string) => "    " + l).join("\n")}\n` +
            `  csp: ${r.csp}\n` +
            `  diagnostics: ${JSON.stringify(r.diagnostics, null, 2).split("\n").join("\n  ")}`
        );
      } catch (err) {
        console.log(`[spike-report] unparseable: ${(err as Error)?.message}`);
      }
      res.writeHead(204);
      res.end();
    });
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
          return { type: "firebase", token: resolved.token, source: resolved.source };
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

    // Coarse geo from the Cloudflare edge (country/region only, never the IP).
    // Shared by reference with the per-session server so the tool handler can
    // backfill clientKind onto the same object after the initialize handshake.
    const sessionMeta: SessionMeta = geoFromHeaders(req.headers);

    // Create new transport and server for new session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId: string) => {
        transports.set(newSessionId, transport);
        servers.set(newSessionId, server);
        // Earliest interest signal: an agent connected. Identify the session
        // the same way tool events do so the funnel report can join them.
        // clientKind isn't known yet (clientInfo arrives with the initialize
        // message, after this fires) — it lands on the session's tool events.
        logConnect(
          identify(
            bearerToken
              ? { type: "firebase", token: bearerToken }
              : { type: "freePlan", sessionId: newSessionId }
          ),
          sessionMeta
        );
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

    const server = createMcpServer(authProvider, sessionMeta);
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
