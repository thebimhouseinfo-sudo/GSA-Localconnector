import { startHttpMcp } from "./http.js";
import { loadToken } from "../local/identity.js";
const rawPort = process.env.MCP_HTTP_PORT ?? "58347";
void (async()=> {
 const token=process.env.MCP_HTTP_TOKEN || await loadToken();
 await startHttpMcp(token,Number(rawPort));
})().catch(e => {
 process.stderr.write("HTTP MCP startup failure: "+String(e)+"\n");
 process.exitCode = 1;
});
