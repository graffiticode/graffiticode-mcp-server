import crypto from "crypto";
import { deriveSessionNamespace } from "./claim-token.js";
import type { AuthContext } from "./api.js";

/**
 * Structured funnel events emitted to stdout → Cloud Logging.
 *
 * One JSON line per MCP connect and per tool call. Read back with:
 *   gcloud logging read 'jsonPayload.ev="mcp_tool"' \
 *     --project graffiticode-app --format json
 * and aggregated by the console's scripts/mcp-funnel-report.ts.
 *
 * Privacy contract (see PRIVACY.md):
 *   - never log raw prompts/descriptions — only `desc_len` (char count)
 *   - never log raw session UUIDs or bearer tokens — only a one-way hash
 *
 * The free-plan session hash reuses `deriveSessionNamespace` so the logged
 * `session` equals the `sessionNamespace` the console stamps on items/claims,
 * giving the report a join key without exposing the raw UUID.
 */

export type EventOutcome = "ok" | "generation_failed" | "error";

interface BaseEvent {
  ev: "mcp_connect" | "mcp_tool";
  t: string; // ISO8601
  auth: "freePlan" | "firebase";
  session: string; // sessionNamespace (free-plan) or hashed token id (firebase)
}

interface ToolEvent extends BaseEvent {
  ev: "mcp_tool";
  tool: string;
  outcome: EventOutcome;
  ms: number;
  lang?: string;
  desc_len?: number;
  err?: string;
}

interface ConnectEvent extends BaseEvent {
  ev: "mcp_connect";
}

function emit(event: ConnectEvent | ToolEvent): void {
  // Best-effort: instrumentation must never break a request.
  try {
    console.log(JSON.stringify(event));
  } catch {
    // ignore
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Map an auth context to the `{ auth, session }` pair used on every event.
 * Free-plan sessions hash to the console's `sessionNamespace`; authenticated
 * calls hash the bearer token (they aren't part of the anonymous funnel, but
 * the field keeps the schema uniform).
 */
export function identify(auth: AuthContext): { auth: "freePlan" | "firebase"; session: string } {
  if (auth.type === "freePlan") {
    return { auth: "freePlan", session: deriveSessionNamespace(auth.sessionId) };
  }
  return { auth: "firebase", session: hashToken(auth.token) };
}

export function logConnect(params: { auth: "freePlan" | "firebase"; session: string }): void {
  emit({
    ev: "mcp_connect",
    t: new Date().toISOString(),
    auth: params.auth,
    session: params.session,
  });
}

export function logToolCall(params: {
  auth: "freePlan" | "firebase";
  session: string;
  tool: string;
  outcome: EventOutcome;
  ms: number;
  lang?: string;
  descLen?: number;
  err?: string;
}): void {
  const event: ToolEvent = {
    ev: "mcp_tool",
    t: new Date().toISOString(),
    auth: params.auth,
    session: params.session,
    tool: params.tool,
    outcome: params.outcome,
    ms: params.ms,
  };
  if (params.lang !== undefined) event.lang = params.lang;
  if (params.descLen !== undefined) event.desc_len = params.descLen;
  if (params.err) event.err = params.err.slice(0, 200);
  emit(event);
}
