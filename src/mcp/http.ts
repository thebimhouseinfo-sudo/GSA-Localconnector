import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { connectorStatus } from "../index.js";
import {loadTrustedRegistry} from "../local/grants.js";
import { WorkspaceRegistry } from "../core/workspace.js";
import { createReadOnlyTools, toolDefinitions,type ToolCall,type ToolResult } from "./server.js";
import {bootstrapMcpTools} from "./runtime-bootstrap.js";

const DEFAULT_PORT = 58347;
const MAX_REQUEST_BYTES = 1024 * 1024;
const PROTOCOL_VERSION = "2025-03-26";

function respond(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}
function error(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}
function allowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return true;
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch { return false; }
}
function authValid(req: IncomingMessage, token: string): boolean {
  const provided = req.headers.authorization;
  if (typeof provided !== "string" || !provided.startsWith("Bearer ")) return false;
  const actual = Buffer.from(provided.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function bodyJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const item of req) {
    const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Local stateless Streamable HTTP MCP endpoint. Production dispatch enforces
 * Workspace grants, controller leases, and installed native capabilities.
 */
export function createHttpMcpServer(token: string, registry = new WorkspaceRegistry(),invoke:(call:ToolCall)=>Promise<ToolResult>=createReadOnlyTools(registry)) {
  if (token.length < 32) throw Error("MCP_HTTP_TOKEN must be at least 32 characters");
  return createServer(async (req, res) => {
    if (!allowedOrigin(req)) { respond(res, 403, { error: "ORIGIN_FORBIDDEN" }); return; }
    if (req.url === "/health" && req.method === "GET") {
      respond(res, 200, { status: "alive", name: "gsa-localconnector", exposedTools: "capability-gated" });
      return;
    }
    if (req.url !== "/mcp") { respond(res, 404, { error: "NOT_FOUND" }); return; }
    if (!authValid(req, token)) {
      res.setHeader("www-authenticate", 'Bearer realm="gsa-localconnector"');
      respond(res, 401, { error: "UNAUTHORIZED" }); return;
    }
    if (req.method === "GET") { respond(res, 405, { error: "SSE_NOT_IMPLEMENTED" }); return; }
    if (req.method === "DELETE") { respond(res, 405, { error: "STATELESS_SESSION" }); return; }
    if (req.method !== "POST") { respond(res, 405, { error: "METHOD_NOT_ALLOWED" }); return; }
    if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      respond(res, 415, { error: "JSON_REQUIRED" }); return;
    }
    const accept = String(req.headers.accept ?? "");
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      respond(res, 406, { error: "MCP_ACCEPT_REQUIRED" }); return;
    }
    let raw: unknown;
    try { raw = await bodyJson(req); }
    catch (e) {
      respond(res, String(e).includes("REQUEST_TOO_LARGE") ? 413 : 400, error(null, -32700, "Invalid JSON request"));
      return;
    }
    if (!isObject(raw) || raw.jsonrpc !== "2.0" || typeof raw.method !== "string" ||
      (raw.id !== undefined && typeof raw.id !== "number" && typeof raw.id !== "string")) {
      respond(res, 400, error(null, -32600, "Invalid JSON-RPC request")); return;
    }
    const id = raw.id;
    if (id === undefined) { res.writeHead(202); res.end(); return; }
    if (raw.method !== "initialize" && req.headers["mcp-protocol-version"] !== PROTOCOL_VERSION) {
      respond(res, 400, error(id, -32600, "Unsupported MCP protocol version")); return;
    }
    let result: unknown;
    const params = raw.params;
    try {
      switch (raw.method) {
        case "initialize":
          if (!isObject(params) || typeof params.protocolVersion !== "string") throw Error("INVALID_PARAMS");
          result = {protocolVersion: PROTOCOL_VERSION, capabilities:{tools:{listChanged:false}}, serverInfo:{name:"gsa-localconnector",version:"0.1.0"}};
          break;
        case "ping": result = {}; break;
        case "tools/list": result = {tools:toolDefinitions()}; break;
        case "tools/call":
          if (!isObject(params) || typeof params.name !== "string" || (params.arguments !== undefined && !isObject(params.arguments))) throw Error("INVALID_PARAMS");
          result = await invoke({name:params.name, arguments:(params.arguments ?? {}) as Record<string,unknown>});
          break;
        default: respond(res, 200, error(id, -32601, "Method not found")); return;
      }
      respond(res, 200, {jsonrpc:"2.0",id,result});
    } catch {
      respond(res, 200, error(id, -32602, "Invalid params"));
    }
  });
}
export async function startHttpMcp(token: string, port = DEFAULT_PORT,owner?:import("../local/mac-owner.js").MacOwner): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid HTTP MCP port");
  const registry=process.platform==="win32"||process.platform==="darwin"?await loadTrustedRegistry():new WorkspaceRegistry();
  const tools=process.platform==="darwin"?await bootstrapMcpTools(registry,undefined,undefined,owner):null;
  if(tools?.blockedReason)process.stderr.write("Native execution unavailable: "+tools.blockedReason+"\n");
  const server = createHttpMcpServer(token,registry,tools?.invoke);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  process.stderr.write("GSA-Localconnector HTTP MCP listening at 127.0.0.1:" + port + "\n");
}
