import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

test("real macOS owner MCP survives installer inspect and accepts the next request", {
 skip: process.platform!=="darwin",timeout:30000
},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-inspect-owner-")));
 const home=path.join(root,"home");
 await fs.mkdir(home,{mode:0o700});
 const source=await fs.realpath(process.cwd());
 const cli=spawn(process.execPath,[path.join(source,"dist/src/mcp/cli.js")],{
  cwd:source,env:{...process.env,HOME:home},stdio:["pipe","pipe","pipe"]
 });
 let buffer="",diagnostics="",sequence=0,closed=false;
 const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
 cli.stderr!.on("data",chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4096);});
 cli.stdout!.on("data",chunk=>{
  buffer+=chunk.toString();
  let end:number;
  while((end=buffer.indexOf("\n"))>=0){
   const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
   try{
    const message=JSON.parse(line),waiter=pending.get(message.id);
    if(waiter){clearTimeout(waiter.timer);pending.delete(message.id);waiter.resolve(message);}
   }catch(error){diagnostics=(diagnostics+"\nINVALID_FRAME "+String(error)).slice(-4096);}
  }
 });
 const failPending=(reason:string)=>{
  closed=true;
  for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error(reason+"; "+diagnostics));}
  pending.clear();
 };
 cli.once("exit",(code,signal)=>failPending("MCP exited "+code+"/"+signal));
 cli.once("error",error=>failPending(String(error)));
 const call=(name:string,args:Record<string,unknown>={},limit=12000)=>new Promise<any>((resolve,reject)=>{
  if(closed)return reject(Error("MCP already closed "+diagnostics));
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error("MCP request timeout: "+name+"; "+diagnostics));},limit);
  pending.set(id,{resolve:frame=>{
   try{resolve(JSON.parse(frame.result.content[0].text));}catch(error){reject(Error("Invalid MCP response "+String(error)+"; "+JSON.stringify(frame).slice(0,1000)));}
  },reject,timer});
  cli.stdin!.write(JSON.stringify({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}})+"\n");
 });
 try{
  const lease=await call("acquire_control");
  assert.equal(lease.ok,true,JSON.stringify(lease));
  const bound=await call("bind_workspaces",{roots:[{path:source,role:"workspace"}],control_token:lease.result.control_token});
  assert.equal(bound.ok,true,JSON.stringify(bound));
  const workspace_id=bound.result[0].workspace_id;
  const identity=path.join(home,"Library/Application Support/GSA-Localconnector");
  const inspected=await call("run_command",{
   workspace_id,command:process.execPath,
   args:["scripts/install-mac-scoped-files.mjs","inspect","--identity-root",identity],
   control_token:lease.result.control_token
  });
  assert.equal(inspected.ok,true,JSON.stringify(inspected));
  assert.equal(inspected.result.state,"SUCCEEDED",JSON.stringify(inspected));
  assert.equal(inspected.result.receipt.exit_code,0);
  assert.equal(JSON.parse(inspected.result.receipt.stdout).state,"SCOPED_FILES_PLAN");
  const after=await call("connector_status");
  assert.equal(after.ok,true,"owner MCP must survive inspector");
  assert.equal(after.result.readyForShell,true);
  assert.equal((await call("list_workspaces")).result.length,1);
  assert.equal((await call("release_control",{control_token:lease.result.control_token})).ok,true);
 }finally{
  cli.stdin?.end();
  await Promise.race([
   new Promise<void>(resolve=>cli.once("exit",()=>resolve())),
   new Promise<void>(resolve=>setTimeout(()=>{cli.kill("SIGTERM");resolve();},1500))
  ]);
  await fs.rm(root,{recursive:true,force:true});
 }
});
