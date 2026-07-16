/**
 * Convert an internal handler result into an MCP CallToolResult.
 *
 * `summary` becomes chat-facing text, `_meta` remains widget-only, and neither is
 * copied into structuredContent. Keeping this seam pure makes the privacy and
 * response-shape contract easy to test without starting the HTTP server.
 */
export function formatToolResult(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const { _meta, summary, ...structuredContent } = result;
  const response: Record<string, unknown> = {
    structuredContent,
    content: [
      {
        type: "text",
        text:
          typeof summary === "string"
            ? summary
            : JSON.stringify(structuredContent, null, 2),
      },
    ],
  };
  if (_meta !== undefined) response._meta = _meta;
  return response;
}
