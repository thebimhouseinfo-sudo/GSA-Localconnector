import { startHttpMcp } from "./http.js";
import { loadToken } from "../local/identity.js";
import {withMacOwner} from "../local/mac-owner.js";
import {fileURLToPath} from "node:url";
const rawPort = process.env.MCP_HTTP_PORT ?? "58347";
void withMacOwner(fileURLToPath(import.meta.url),async owner=> {
 const token=process.env.MCP_HTTP_TOKEN || await loadToken();
 await startHttpMcp(token,Number(rawPort),owner);
}).catch(e => {
 process.stderr.write("HTTP MCP startup failure: "+String(e)+"\n");
 process.exitCode = 1;
});
