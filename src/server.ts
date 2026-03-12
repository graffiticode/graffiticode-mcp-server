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
import { tools, handleToolCall } from "./tools.js";
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

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
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
