import {initializeToken,identityDirectory} from "./identity.js";
import {createHostAdapter} from "../hosts/index.js";
import {access} from "node:fs/promises";

async function main(){
 const capabilities=createHostAdapter().capabilities;
 const result=await initializeToken();
 await access(result.path);
 process.stdout.write(JSON.stringify({
  readyForLocalSmoke:true,platform:capabilities.platform,
  identityDirectory:identityDirectory(),tokenCreated:result.created,
  port:58347,host:"127.0.0.1",
  shellIsolation:"blocked",localCi:"blocked",
  next:"Run npm run mcp:http, verify /health, then provision a dedicated tunnel with your Cloudflare account"
 })+"\n");
}
void main().catch(e=>{process.stderr.write("Local setup error: "+String(e)+"\n");process.exitCode=1;});
