import {runStdio} from "./server.js";
import {loadTrustedRegistry} from "../local/grants.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import {bootstrapMcpTools} from "./runtime-bootstrap.js";
import {withMacOwner} from "../local/mac-owner.js";
import {fileURLToPath} from "node:url";
// stdio is the only enabled transport during the bootstrap stage.
// No Workspace enrollment from command line, environment or MCP request.
void withMacOwner(fileURLToPath(import.meta.url),async owner=>{
 const registry=process.platform==="win32"||process.platform==="darwin"?await loadTrustedRegistry():new WorkspaceRegistry();
 if(process.platform==="darwin"){
  const tools=await bootstrapMcpTools(registry,undefined,undefined,owner);
  if(tools.blockedReason)process.stderr.write("Native execution unavailable: "+tools.blockedReason+"\n");
  return runStdio(registry,tools.invoke);
 }
 return runStdio(registry);
}).catch(error=>{process.stderr.write(String(error)+"\n");process.exitCode=1;});
