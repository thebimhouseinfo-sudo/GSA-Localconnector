import {runStdio} from "./server.js";
import {loadTrustedRegistry} from "../local/grants.js";
import {WorkspaceRegistry} from "../core/workspace.js";
// stdio is the only enabled transport during the bootstrap stage.
// No Workspace enrollment from command line, environment or MCP request.
void (process.platform==="win32"||process.platform==="darwin"?loadTrustedRegistry():Promise.resolve(new WorkspaceRegistry())).then(registry=>runStdio(registry)).catch(error=>{process.stderr.write(String(error)+"\n");process.exitCode=1;});
