import type { IncomingMessage, ServerResponse } from "http";

/**
 * Log why `/mcp` answered 400.
 *
 * Our code never writes a 400 there; the MCP SDK's transport does, for a request it cannot
 * take (no session id on a non-initialize call, a bad protocol-version header, unparseable
 * JSON). Those arrived at a steady few an hour across every revision with nothing saying
 * which, because the request log records only the status. This records the SDK's own error
 * message alongside the shape of the request.
 *
 * Privacy (CLAUDE.md contract): never the request body, never the session id (only whether
 * one was sent), never the IP. The message is server-generated text, capped.
 */
export function watchBadRequests(
  req: IncomingMessage,
  res: ServerResponse,
  log: (line: string) => void = (line) => console.warn(line),
): void {
  let status = 0;
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => ServerResponse;
  res.writeHead = ((code: number, ...rest: unknown[]) => {
    status = code;
    return writeHead(code, ...rest);
  }) as typeof res.writeHead;

  const end = res.end.bind(res) as (...a: unknown[]) => ServerResponse;
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if ((status || res.statusCode) === 400) {
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      log(
        JSON.stringify({
          ev: "mcp_bad_request",
          method: req.method,
          hasSession: !!header("mcp-session-id"),
          protocolVersion: header("mcp-protocol-version") ?? null,
          accept: (header("accept") ?? "").slice(0, 60),
          client: (header("user-agent") ?? "").split(/[\s/]/)[0].slice(0, 40),
          message: errorMessage(chunk),
        }),
      );
    }
    return end(chunk, ...rest);
  }) as typeof res.end;
}

function errorMessage(chunk: unknown): string | null {
  if (chunk === undefined || chunk === null || typeof chunk === "function") return null;
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  try {
    const body = JSON.parse(text);
    const msg = body?.error?.message ?? body?.error ?? null;
    return msg === null ? null : String(msg).slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
