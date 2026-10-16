import {plannedTools} from "../src/mcp/catalog.js";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

test("real stdio JSON-RPC initialize, list and tool calls", async () => {
 const cli=fileURLToPath(new URL("../src/mcp/cli.js",import.meta.url));
 const child=spawn(process.execPath,[cli],{stdio:["pipe","pipe","pipe"]});
 let pending=new Map<number,(v:any)=>void>(),data="";
 const transcript:any[]=[];
 child.stdout.setEncoding("utf8");
 child.stdout.on("data",(chunk:string)=>{
  data+=chunk;
  let ix:number;
  while((ix=data.indexOf("\n"))>=0){
   const line=data.slice(0,ix); data=data.slice(ix+1);
   if(!line.trim()) continue;
   const msg=JSON.parse(line);transcript.push(msg);
   if(typeof msg.id==="number"){pending.get(msg.id)?.(msg);pending.delete(msg.id);}
  }
 });
 let counter=0;
 const call=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{
  const id=++counter;
  const timeout=setTimeout(()=>{pending.delete(id);reject(new Error("MCP response timeout: "+method));},3000);
  pending.set(id,v=>{clearTimeout(timeout);resolve(v);});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
 });
 try {
  const init=await call("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"test",version:"0.1.0"}});
  assert.equal(init.result.serverInfo.name,"gsa-localconnector");
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
  const tools=await call("tools/list");
  assert.deepEqual(tools.result.tools.map((v:any)=>v.name),["connector_status","list_workspaces","get_workspace","list_directory","bind_workspaces","unbind_workspace","get_file_info","search","fetch_file",...plannedTools.map(t=>t.name)]);
  const res=await call("tools/call",{name:"list_workspaces",arguments:{}});
  assert.deepEqual(JSON.parse(res.result.content[0].text).result,[]);
  const denied=await call("tools/call",{name:"get_workspace",arguments:{workspace_id:"unknown"}});
  assert.equal(denied.result.isError,true);
  const unknown=await call("tools/call",{name:"no_such_tool",arguments:{}});
  assert.equal(unknown.result.isError,true);
  const ping=await call("ping");
  assert.deepEqual(ping.result,{});
 } finally {
  child.stdin.end();
  await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else {child.once("exit",()=>resolve());setTimeout(()=>{child.kill();resolve();},2000).unref();}});
 }
});
