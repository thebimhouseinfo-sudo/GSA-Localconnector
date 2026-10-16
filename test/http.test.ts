import assert from "node:assert/strict";
import {test} from "node:test";
import {createHttpMcpServer} from "../src/mcp/http.js";
import type {AddressInfo} from "node:net";

const token="test-only-ephemeral-secret-of-at-least-32-chars";
test("stateless authenticated local MCP HTTP protocol", async()=>{
 const server=createHttpMcpServer(token);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as AddressInfo).port;
 const base="http://127.0.0.1:"+port;
 const headers={"authorization":"Bearer "+token,"content-type":"application/json","accept":"application/json, text/event-stream"};
 async function rpc(id:number,method:string,params:unknown={},extra:Record<string,string>={}){
  const res=await fetch(base+"/mcp",{method:"POST",headers:{...headers,...extra},body:JSON.stringify({jsonrpc:"2.0",id,method,params})});
  return {status:res.status,body:await res.json() as any};
 }
 try {
  assert.equal((await fetch(base+"/health")).status,200);
  assert.equal((await rpc(1,"tools/list",{},{"authorization":"Bearer wrong"})).status,401);
  assert.equal((await rpc(2,"tools/list",{},{"origin":"https://attacker.test"})).status,403);
  const init=await rpc(3,"initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"test",version:"1"}});
  assert.equal(init.body.result.serverInfo.name,"gsa-localconnector");
  const ts=await rpc(4,"tools/list",{},{"mcp-protocol-version":"2025-03-26"});
  assert.equal(ts.status,200);
  assert.deepEqual(ts.body.result.tools.map((t:any)=>t.name),["connector_status","list_workspaces","get_workspace"]);
  const bad=await rpc(5,"tools/call",{name:"run_command",arguments:{}},{"mcp-protocol-version":"2025-03-26"});
  assert.equal(bad.body.result.isError,true);
  const missing=await rpc(6,"tools/call",{name:"get_workspace",arguments:{workspace_id:"none"}},{"mcp-protocol-version":"2025-03-26"});
  assert.equal(missing.body.result.isError,true);
  assert.equal((await rpc(7,"tools/list")).status,400);
 } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
});
