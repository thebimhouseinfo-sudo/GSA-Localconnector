import { startHttpMcp } from "./http.js";
const token = process.env.MCP_HTTP_TOKEN ?? "";
const rawPort = process.env.MCP_HTTP_PORT ?? "43281";
void startHttpMcp(token, Number(rawPort)).catch(e => {
  process.stderr.write("HTTP MCP startup failure: " + String(e) + "\n");
  process.exitCode = 1;
});
