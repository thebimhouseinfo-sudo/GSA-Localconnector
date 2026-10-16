import {runStdio} from "./server.js";
// stdio is the only enabled transport during the bootstrap stage.
// No Workspace enrollment from command line, environment or MCP request.
void runStdio().catch(error=>{process.stderr.write(String(error)+"\n");process.exitCode=1;});
