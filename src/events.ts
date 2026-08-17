import crypto from "crypto";
import { namespaceForSession } from "./claim-token.js";
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
 *   - never log the client IP. We log only COARSE geo (country, optional
 *     region) derived at the Cloudflare edge (`CF-IPCountry`), so the raw IP
 *     (`cf-connecting-ip`) is read by nobody here and never persisted.
 *   - never log a client-supplied string verbatim. `mcp_resource` carries a
 *     URI, which is why it is emitted ONLY for our own `graffiticode://`
 *     namespace: anything else a client asks for is dropped rather than
 *     written, so the field can't become a channel for arbitrary text. `lang`
 *     is the same hazard and gets the same treatment (see `normalizeLang`):
 *     `language` is a free-text tool argument, and clients really do put
 *     prompts in it.
 *
 * The free-plan session hash reuses `namespaceForSession` so the logged
 * `session` equals the `sessionNamespace` the console stamps on items/claims,
 * giving the report a join key without exposing the raw UUID.
 */

export type EventOutcome = "ok" | "generation_failed" | "error";

interface BaseEvent {
  ev: "mcp_connect" | "mcp_listed" | "mcp_resource" | "mcp_session_started" | "mcp_tool";
  t: string; // ISO8601
  auth: "freePlan" | "firebase";
  session: string; // sessionNamespace (free-plan) or hashed token id (firebase)
  // Stable per-TRANSPORT key, always derived from the session uuid the server
  // minted. `session` is not stable: it starts as this same namespace and then
  // follows whatever the free-plan auth context presents, which becomes the
  // console's WORKSPACE handle once a call resolves to an existing workspace.
  // A connect and the tool calls that followed it therefore land under
  // different `session` values for any session that adopts a workspace — the
  // connect reads as a probe and the workspace as having appeared from nowhere.
  // Joining on `tns` instead survives that. Free-plan only; a firebase session
  // is keyed by its token hash and has no transport-scoped identity to add.
  tns?: string;
  // Agent KIND: MCP clientInfo.name (e.g. "claude-ai", "cursor", "codex").
  // Present on every event including mcp_connect, which reads it out of the
  // initialize request's params — the transport mints the session id before
  // that message reaches the server, so the handshake state isn't available
  // yet and the message itself is the only source this early.
  client_kind?: string;
  // Agent GEO: coarse, non-PII. Country is ISO-3166 alpha-2; region only when
  // the edge provides it. Derived from request headers, never from a logged IP.
  geo_country?: string;
  geo_region?: string;
}

interface ToolEvent extends BaseEvent {
  ev: "mcp_tool";
  tool: string;
  outcome: EventOutcome;
  ms: number;
  lang?: string;
  desc_len?: number;
  err?: string;
  // Whether the client requested out-of-band progress (sent a progressToken).
  // Tells us if the keepalive uses notifications/progress or the log fallback.
  progress?: boolean;
}

interface ConnectEvent extends BaseEvent {
  ev: "mcp_connect";
}

/**
 * The session asked us what we have — `tools/list` and friends.
 *
 * This is the stage between "a transport opened" and "someone asked for
 * something", and without it the two are indistinguishable: a directory
 * validator and a real agent host both produce exactly one mcp_connect and
 * nothing else, so every connect that didn't convert had to be written off as
 * an undifferentiated probe. A client that enumerates our catalog and stops
 * loaded our surface and passed on it, which is a positioning result; a client
 * that never enumerates anything never saw it. Emitted at most once per session
 * per `what`, so a host that re-lists on every turn counts once.
 */
interface ListedEvent extends BaseEvent {
  ev: "mcp_listed";
  what: "tools" | "resources" | "prompts";
}

/**
 * A `resources/read` — a language user guide or an agent skill was actually
 * opened. The strongest pre-tool engagement signal we have, and until now
 * entirely invisible: reading a resource is not a tool call, so it produced no
 * event at all.
 */
interface ResourceEvent extends BaseEvent {
  ev: "mcp_resource";
  uri: string;
}

/**
 * A session's FIRST tool call — someone actually asked for something.
 *
 * Distinct from mcp_connect on purpose. A connect is the agent host opening a
 * transport; it happens on probes, health checks, and clients that enumerate
 * tools and stop. This is the event that means a person made a request, so it
 * is what the hourly digest headlines as a new session.
 */
interface SessionStartedEvent extends BaseEvent {
  ev: "mcp_session_started";
  tool: string;
  lang?: string;
}

type Event = ConnectEvent | ListedEvent | ResourceEvent | SessionStartedEvent | ToolEvent;

function emit(event: Event): void {
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
    return { auth: "freePlan", session: namespaceForSession(auth.sessionId) };
  }
  return { auth: "firebase", session: hashToken(auth.token) };
}

/**
 * The workspace to label a tool event with: the one the call actually resolved
 * to, falling back to what `identify()` derived from the credential we presented.
 *
 * These differ whenever the console rebinds us — a sibling create adopts another
 * workspace, and the caller never presented its namespace. Before this, `session`
 * always held the transport's own namespace, so it was identical to `tns` on
 * every event and the drift `session` exists to express never appeared. Joins
 * still key on `tns`, which is exactly why `session` is free to move.
 */
export function effectiveSession(auth: AuthContext, fallback: string): string {
  if (auth.type === "freePlan" && auth.effectiveNamespace) return auth.effectiveNamespace;
  return fallback;
}

export interface SessionMeta {
  clientKind?: string;
  geoCountry?: string;
  geoRegion?: string;
  /** Stable transport-scoped namespace; see `tns` on BaseEvent. */
  transportNamespace?: string;
}

/**
 * Cap a client-declared name before it travels anywhere. `clientInfo.name` is
 * whatever the client says it is, and it now reaches the console's workspace
 * registry as well as our own events — one cap, defined once.
 */
export function normalizeClientKind(v?: string): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, 64);
  return t || undefined;
}

/**
 * A language id we recognise, or the `(invalid)` sentinel. Never the input.
 *
 * `lang` is read straight off the `language` tool argument, which is free text.
 * Clients pass descriptions in it — "create a 3 by 3 table filled with random
 * numbers" and "create a green bar chart using mock data" both reached these
 * logs, which is exactly the raw-prompt content the contract above promises
 * never to write. So this is an allowlist, not a truncation: anything that
 * isn't a language id is replaced, not shortened.
 *
 * It also canonicalises. Handlers strip the leading "L" before calling the API
 * but logged the raw argument, so L0173 / l0173 / 0173 were three separate keys
 * in every per-language count.
 *
 * `(invalid)` rather than dropping the field: a client putting junk in
 * `language` is a routing bug worth seeing, and the sentinel keeps that signal
 * without carrying the content. Deliberately identical to the console's
 * `langKey` (src/lib/funnel-events.ts) — the two streams are joined in the
 * funnel report, and a second normaliser that disagreed would re-fragment the
 * counts this one exists to merge.
 */
export function normalizeLang(v?: string): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const t = v.trim();
  if (/^\d{2,6}$/.test(t)) return `L${t}`;
  if (/^L\d{2,6}$/i.test(t)) return t.toUpperCase();
  return "(invalid)";
}

function applyMeta(event: Event, meta?: SessionMeta): void {
  if (!meta) return;
  if (meta.clientKind) event.client_kind = normalizeClientKind(meta.clientKind);
  if (meta.geoCountry) event.geo_country = meta.geoCountry;
  if (meta.geoRegion) event.geo_region = meta.geoRegion;
  if (meta.transportNamespace) event.tns = meta.transportNamespace;
}

export function logConnect(
  params: { auth: "freePlan" | "firebase"; session: string },
  meta?: SessionMeta
): void {
  const event: ConnectEvent = {
    ev: "mcp_connect",
    t: new Date().toISOString(),
    auth: params.auth,
    session: params.session,
  };
  applyMeta(event, meta);
  emit(event);
}

export function logListed(
  params: { auth: "freePlan" | "firebase"; session: string; what: ListedEvent["what"] },
  meta?: SessionMeta
): void {
  const event: ListedEvent = {
    ev: "mcp_listed",
    t: new Date().toISOString(),
    auth: params.auth,
    session: params.session,
    what: params.what,
  };
  applyMeta(event, meta);
  emit(event);
}

/** Our own resource namespace. Anything else a client reads is not logged. */
const RESOURCE_PREFIX = "graffiticode://";

export function logResource(
  params: { auth: "freePlan" | "firebase"; session: string; uri: string },
  meta?: SessionMeta
): void {
  // Dropping foreign URIs rather than truncating them is the privacy contract:
  // the field can only ever hold a string we defined.
  if (!params.uri.startsWith(RESOURCE_PREFIX)) return;
  const event: ResourceEvent = {
    ev: "mcp_resource",
    t: new Date().toISOString(),
    auth: params.auth,
    session: params.session,
    uri: params.uri.slice(0, 200),
  };
  applyMeta(event, meta);
  emit(event);
}

export function logSessionStarted(
  params: { auth: "freePlan" | "firebase"; session: string; tool: string; lang?: string },
  meta?: SessionMeta,
): void {
  const event: SessionStartedEvent = {
    ev: "mcp_session_started",
    t: new Date().toISOString(),
    auth: params.auth,
    session: params.session,
    tool: params.tool,
  };
  const lang = normalizeLang(params.lang);
  if (lang !== undefined) event.lang = lang;
  applyMeta(event, meta);
  emit(event);
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
  progress?: boolean;
  meta?: SessionMeta;
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
  const lang = normalizeLang(params.lang);
  if (lang !== undefined) event.lang = lang;
  if (params.descLen !== undefined) event.desc_len = params.descLen;
  if (params.err) event.err = params.err.slice(0, 200);
  if (params.progress !== undefined) event.progress = params.progress;
  applyMeta(event, params.meta);
  emit(event);
}
