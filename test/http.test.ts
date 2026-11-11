import {plannedTools} from "../src/mcp/catalog.js";
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
  assert.deepEqual(ts.body.result.tools.map((t:any)=>t.name),["connector_status","list_workspaces","get_workspace","inspect_workspace_recovery","list_directory","bind_workspaces","unbind_workspace","get_file_info","search","fetch_file_bytes","fetch_file",...plannedTools.map(t=>t.name)]);
  const bad=await rpc(5,"tools/call",{name:"run_command",arguments:{}},{"mcp-protocol-version":"2025-03-26"});
  assert.equal(bad.body.result.isError,true);
  const missing=await rpc(6,"tools/call",{name:"get_workspace",arguments:{workspace_id:"none"}},{"mcp-protocol-version":"2025-03-26"});
  assert.equal(missing.body.result.isError,true);
  assert.equal((await rpc(7,"tools/list")).status,400);
 } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
});
import {createConnection} from 'node:net';
test('HTTP bounds ordinary and urgent calls independently while ping remains available',{timeout:10000},async()=>{
 const result={content:[{type:'text' as const,text:'{}'}]},held:Array<()=>void>=[];
 let entered!:()=>void,controlled!:()=>void,ordinary=0,controls=0;
 const ready=new Promise<void>(r=>entered=r),controlReady=new Promise<void>(r=>controlled=r);
 const server=createHttpMcpServer(token,undefined,async call=>{
  if(call.name==='release_control')return result;
  return new Promise(resolve=>{
   held.push(()=>resolve(result));
   if(call.name==='stop_process'){if(++controls===4)controlled();}else if(++ordinary===32)entered();
  });
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as AddressInfo).port;
 const rpc=async(id:number,name?:string)=>{
  const res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26'},body:JSON.stringify({jsonrpc:'2.0',id,method:name?'tools/call':'ping',params:{name,arguments:{}}})});
  return await res.json() as any;
 };
 const pending:Promise<any>[]=[];
 try{
  for(let i=0;i<32;i++){const p=rpc(i,'run_command');void p.catch(()=>{});pending.push(p);}await ready;
  const excess=await Promise.all(Array.from({length:8},(_,i)=>rpc(40+i,'run_command')));
  assert.ok(excess.every(r=>r.error?.message==='SERVER_BUSY'));assert.equal(ordinary,32);
  assert.ok((await rpc(100,'release_control')).result);assert.ok((await rpc(101)).result);
  for(let i=0;i<4;i++){const p=rpc(110+i,'stop_process');void p.catch(()=>{});pending.push(p);}await controlReady;
  assert.equal((await rpc(120,'stop_process')).error?.message,'SERVER_BUSY');
  assert.equal((await rpc(121,'release_control')).error?.message,'SERVER_BUSY');assert.ok((await rpc(122)).result);
 }finally{
  held.forEach(release=>release());await Promise.allSettled(pending);server.closeAllConnections();
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
});
test('HTTP closes a client stalled during the body within its configured deadline',{timeout:40000},async()=>{
 const server=createHttpMcpServer(token);let socket:ReturnType<typeof createConnection>|undefined;
 try{
  assert.ok(server.requestTimeout>0&&server.requestTimeout<=30000,'bounded request deadline');
  assert.ok(server.headersTimeout>0&&server.headersTimeout<=server.requestTimeout,'bounded header deadline');
  assert.ok(server.timeout>0&&server.timeout<=30000,'body/response inactivity deadline');
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as AddressInfo).port;
  const started=Date.now();
  await new Promise<void>((resolve,reject)=>{
   socket=createConnection({host:'127.0.0.1',port},()=>socket!.write(`POST /mcp HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: 100\r\n\r\n{`));
   socket.on('data',()=>{});socket.on('error',reject);socket.on('close',()=>resolve());
  });
  assert.ok(Date.now()-started<35000);
 }finally{socket?.destroy();server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));}
});
