/**
 * Convert an internal handler result into an MCP CallToolResult.
 *
 * `summary` becomes chat-facing text, `_meta` remains widget-only, and neither is
 * copied into structuredContent. Keeping this seam pure makes the privacy and
 * response-shape contract easy to test without starting the HTTP server.
 *
 * `omitMeta` drops `_meta` entirely: `_meta.graffiticode` carries widget hydration
 * (src, compiled data, claim fields), which is useless to a host that renders no
 * widget. Pass it for OpenAI/ChatGPT clients so that hydration payload never leaves
 * the server for a surface that can't use it (data minimization — the model
 * transcript is already compact either way, since `_meta` is host-facing).
 */
export function formatToolResult(
  result: Record<string, unknown>,
  opts: { omitMeta?: boolean } = {},
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
  if (_meta !== undefined && !opts.omitMeta) response._meta = _meta;
  return response;
}
