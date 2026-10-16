import {enrollReadOnly,loadTrustedRegistry,revokeTrusted} from "./grants.js";
async function main(){
 const [op,id,root]=process.argv.slice(2);
 if(op==="list"&& !id){const reg=await loadTrustedRegistry();process.stdout.write(JSON.stringify(reg.list().map(g=>({workspace_id:g.id,root:g.canonicalRoot,permissions:g.permissions})),null,2)+"\n");return;}
 if(op==="enroll-read"&&id&&root){await enrollReadOnly(id,root);process.stdout.write("Workspace read-only enrollment saved. Restart the MCP tunnel to reload grants.\n");return;}
 if(op==="revoke"&&id&&!root){await revokeTrusted(id);process.stdout.write("Workspace revoked. Restart MCP tunnel to reload grants.\n");return;}
 throw Error("Usage: npm run workspace -- list | enroll-read <id> <absolute-root> | revoke <id>");
}
void main().catch(e=>{process.stderr.write(String(e)+"\n");process.exitCode=1;});
