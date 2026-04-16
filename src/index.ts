#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, handleToolCall, SERVER_INSTRUCTIONS } from "./tools.js";
import { createAuthClient } from "./auth.js";
import {
  userGuideResourceTemplate,
  matchUserGuideUri,
  readUserGuideResource,
} from "./resources.js";

async function main() {
  const apiKey = process.env.GC_API_KEY_SECRET;
  if (!apiKey) {
    console.error("Error: GC_API_KEY_SECRET environment variable is required");
    process.exit(1);
  }

  // Create auth client for token management
  const auth = createAuthClient(apiKey);

  // Create MCP server
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

  // Advertise per-language user-guide resources as a URI template.
  // No concrete resources exposed over stdio — widgets are hosted-only.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [userGuideResourceTemplate],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const langId = matchUserGuideUri(uri);
    if (!langId) {
      throw new Error(`Resource not found: ${uri}`);
    }
    const token = await auth.getToken();
    const content = await readUserGuideResource({ token, uri, langId });
    return { contents: [content] };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const token = await auth.getToken();
      const result = await handleToolCall(
        { token },
        name,
        args as Record<string, unknown>
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
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

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
