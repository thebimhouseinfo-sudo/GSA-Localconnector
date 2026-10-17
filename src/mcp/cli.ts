import {runStdio} from "./server.js";
import {loadTrustedRegistry} from "../local/grants.js";
import {WorkspaceRegistry} from "../core/workspace.js";
import {bootstrapMcpTools} from "./runtime-bootstrap.js";
// stdio is the only enabled transport during the bootstrap stage.
// No Workspace enrollment from command line, environment or MCP request.
void (process.platform==="win32"||process.platform==="darwin"?loadTrustedRegistry():Promise.resolve(new WorkspaceRegistry())).then(async registry=>{
 if(process.platform==="darwin"){
  const tools=await bootstrapMcpTools(registry);
  if(tools.blockedReason)process.stderr.write("Native execution unavailable: "+tools.blockedReason+"\n");
  return runStdio(registry,tools.invoke);
 }
 return runStdio(registry);
}).catch(error=>{process.stderr.write(String(error)+"\n");process.exitCode=1;});
