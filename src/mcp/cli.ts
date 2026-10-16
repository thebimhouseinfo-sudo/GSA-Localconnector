import {runStdio} from "./server.js";
import {loadTrustedRegistry} from "../local/grants.js";
// stdio is the only enabled transport during the bootstrap stage.
// No Workspace enrollment from command line, environment or MCP request.
void loadTrustedRegistry().then(registry=>runStdio(registry)).catch(error=>{process.stderr.write(String(error)+"\n");process.exitCode=1;});
