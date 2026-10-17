import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {createServer,type AddressInfo} from "node:net";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {enrollReadOnly} from "../src/local/grants.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import {DurableProcessManager} from "../src/core/durable-process.js";
import {applyUnifiedTextPatch} from "../src/core/unified-patch.js";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {CiJournalStore} from "../src/local/ci-store.js";
import {CiLogStore} from "../src/local/ci-log-store.js";
import {createQueuedRun} from "../src/core/ci-journal.js";
import {sha256} from "../src/core/edit-guards.js";
import type {NativeScopedFiles,VerifiedNativeProcessController} from "../src/core/native-io.js";
const parse=(r:{content:Array<{text:string}>})=>JSON.parse(r.content[0].text);
const request={workspace_id:"A",executable:"node",argv:[],cwd_relative:".",time_limit_ms:100,max_output_bytes:65536,network_allowed:false};
function controller():VerifiedNativeProcessController{
 return {verified:true,platform:"macos",policy_fingerprint:"test-only",
  start:async()=>({native_id:randomUUID()}),
  status:async()=>({state:"SUCCEEDED",exit_code:0,started_at:"start",ended_at:"end"}),
  output:async(_id,cursor,limit)=>{const text="first-rest";const next=Math.min(cursor+limit,text.length);return {stdout:text.slice(cursor,next),stderr:"",next_cursor:next<text.length?next:null};},
  stop:async()=>({stopped:true,state:"CANCELLED"})};
}

test("move requires source write permission while copy permits read-only source",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-move-review-"));
 try{
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("A",tmp,["read"]);await reg.enrollTrusted("B",tmp,["write"]);
  const bytes=Buffer.from("source");const files=new Map([["A/f",bytes]]);
  const io:NativeScopedFiles={read:async r=>({bytes:files.get(r.workspace_id+"/"+r.path)!,sha256:sha256(bytes),kind:"file"}),
   createExclusive:async()=>{},replaceIfHash:async()=>{},makeDirectory:async()=>{},trashIfHash:async()=>{},
   copyExclusive:async(s,d)=>{files.set(d.workspace_id+"/"+d.path,files.get(s.workspace_id+"/"+s.path)!);},
   moveExclusive:async(s,d)=>{files.set(d.workspace_id+"/"+d.path,files.get(s.workspace_id+"/"+s.path)!);files.delete(s.workspace_id+"/"+s.path);}};
  const call=createReadOnlyTools(reg,io);const args={source_workspace_id:"A",source_path:"f",destination_workspace_id:"B",destination_path:"g",expected_sha256:sha256(bytes)};
  assert.equal(parse(await call({name:"move_file",arguments:args})).code,"PERMISSION_DENIED");
  assert.equal(files.get("A/f")?.toString(),"source");
  assert.equal(parse(await call({name:"copy_file",arguments:args})).ok,true);
  await reg.enrollTrusted("A",tmp,["read","write"]);
  assert.equal(parse(await call({name:"move_file",arguments:{...args,destination_path:"moved"}})).ok,true);
  assert.equal(files.has("A/f"),false);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("zero-context patches insert after the named old line and into an empty file",()=>{
 assert.equal(applyUnifiedTextPatch("a\nb\n","@@ -1,0 +2 @@\n+x\n"),"a\nx\nb\n");
 assert.equal(applyUnifiedTextPatch("","@@ -0,0 +1 @@\n+x\n"),"x\n");
 assert.equal(applyUnifiedTextPatch("a\n","@@ -0,0 +1 @@\n+x\n"),"x\na\n");
 assert.equal(applyUnifiedTextPatch("a\nb\n","@@ -2,0 +3 @@\n+x\n"),"a\nb\nx\n");
});

test("snapshot verification accepts embedded dots but rejects traversal in stored manifest",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-snap-review-"));
 try{
  const store=new CiSnapshotStore(tmp),id=randomUUID();
  const manifest=await store.persist(id,[{path:"release..txt",bytes:Buffer.from("ok")}]);
  assert.equal((await store.verify(id)).source_sha256,manifest.source_sha256);
  const file=path.join(tmp,id,"manifest.json");await fs.chmod(file,0o600);
  await fs.writeFile(file,JSON.stringify({...manifest,files:[{...manifest.files[0],path:"../outside"}]}));
  await assert.rejects(store.verify(id),(e:any)=>e.code==="SNAPSHOT_INTEGRITY");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("completed native processes release capacity without discarding their output",async()=>{
 const manager=new DurableProcessManager(controller(),1);
 const first=await manager.start(request);
 // No explicit status poll should be necessary before starting the next process.
 const second=await manager.start(request);
 assert.notEqual(first.process_id,second.process_id);
 assert.equal((await manager.output("A",first.process_id)).stdout,"first-rest");
});

test("native process capacity includes starts still awaiting native identity",async()=>{
 let finish!:(value:{native_id:string})=>void;
 let calls=0;
 const native=controller();native.start=async()=>++calls===1?new Promise(resolve=>{finish=resolve;}):{native_id:"unexpected-second"};
 native.status=async()=>({state:"RUNNING",exit_code:null,started_at:"now",ended_at:null});
 const manager=new DurableProcessManager(native,1);
 const first=manager.start(request);
 // Allow start() to reach its asynchronous backend boundary.
 await new Promise(resolve=>setImmediate(resolve));
 try{await assert.rejects(manager.start(request),(e:any)=>e.code==="PROCESS_LIMIT");}
 finally{finish({native_id:"first"});await first;}
});

test("running processes retain their slot until native stop confirms termination",async()=>{
 const native=controller();
 native.status=async()=>({state:"RUNNING",exit_code:null,started_at:"now",ended_at:null});
 const manager=new DurableProcessManager(native,1);
 const first=await manager.start(request);
 await assert.rejects(manager.start(request),(e:any)=>e.code==="PROCESS_LIMIT");
 await manager.stop("A",first.process_id);
 assert.equal((await manager.start(request)).state,"RUNNING");
 assert.equal((await manager.output("A",first.process_id)).stdout,"first-rest");
});

test("failed native starts do not permanently consume capacity",async()=>{
 const native=controller();let failed=false;
 native.start=async()=>{if(!failed){failed=true;throw Error("native start failed");}return {native_id:"ok"};};
 const manager=new DurableProcessManager(native,1);
 await assert.rejects(manager.start(request),/native start failed/);
 assert.equal((await manager.start(request)).state,"RUNNING");
});

test("MCP log and process output cursors reach subsequent pages and retain ownership checks",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-page-review-"));
 try{
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("A",tmp,["read","execute"]);await reg.enrollTrusted("B",tmp,["read","execute"]);
  const journal=new CiJournalStore(path.join(tmp,"runs")),logs=new CiLogStore(path.join(tmp,"logs"));
  const run=createQueuedRun("A","test","a".repeat(64));await journal.save(run,null);
  for(let i=1;i<=51;i++)await logs.append(run.run_id,i,"stdout",String(i));
  const call=createReadOnlyTools(reg,null,null,journal,null,logs,controller());
  const first=parse(await call({name:"ci_logs",arguments:{workspace_id:"A",run_id:run.run_id}}));
  assert.equal(first.result.next_cursor,50);
  const next=parse(await call({name:"ci_logs",arguments:{workspace_id:"A",run_id:run.run_id,cursor:50,limit:1}}));
  assert.equal(next.ok,true);assert.equal(next.result.entries[0].text,"51");assert.equal(next.result.next_cursor,null);
  assert.equal((await call({name:"ci_logs",arguments:{workspace_id:"B",run_id:run.run_id,cursor:50}})).isError,true);
  for(const bad of [{cursor:-1},{cursor:0.5},{limit:0},{limit:101}]){
   assert.equal((await call({name:"ci_logs",arguments:{workspace_id:"A",run_id:run.run_id,...bad}})).isError,true);
  }
  const started=parse(await call({name:"start_process",arguments:{workspace_id:"A",command:"node",args:[]}}));
  const args={workspace_id:"A",process_id:started.result.process_id};
  const page=parse(await call({name:"process_output",arguments:{...args,cursor:0,limit:6}}));
  assert.equal(page.result.stdout,"first-");assert.equal(page.result.next_cursor,6);
  assert.equal(parse(await call({name:"process_output",arguments:{...args,cursor:6,limit:6}})).result.stdout,"rest");
  assert.equal((await call({name:"process_output",arguments:{...args,workspace_id:"B",cursor:6}})).isError,true);
  for(const bad of [{cursor:-1},{cursor:0.5},{limit:0},{limit:65537}]){
   assert.equal((await call({name:"process_output",arguments:{...args,...bad}})).isError,true);
  }
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("HTTP CLI loads persisted workspace grants from an isolated user profile",{skip:process.platform==="win32"?"POSIX protected grant fixture; Windows uses status-only coverage":process.platform!=="darwin"},async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-http-review-"));
 const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once("error",reject);socket.listen(0,"127.0.0.1",resolve);});
 const port=(socket.address() as AddressInfo).port;await new Promise<void>(r=>socket.close(()=>r()));
 const local=path.join(tmp,"local");const grants=process.platform==="win32"?path.join(local,"GSA-Localconnector"):path.join(tmp,"Library","Application Support","GSA-Localconnector");
 await enrollReadOnly("fixture",tmp,grants);
 const token="test-only-http-cli-token-of-at-least-32-chars";
 const child=spawn(process.execPath,[fileURLToPath(new URL("../src/mcp/http-cli.js",import.meta.url))],{env:{...process.env,HOME:tmp,USERPROFILE:tmp,LOCALAPPDATA:local,MCP_HTTP_PORT:String(port),MCP_HTTP_TOKEN:token},stdio:["ignore","ignore","pipe"]});
 try{
  await new Promise<void>((resolve,reject)=>{
   let diagnostics="";
   const timer=setTimeout(()=>reject(Error("HTTP CLI startup timeout: "+diagnostics)),5000);
   child.once("error",e=>{clearTimeout(timer);reject(e);});
   child.once("exit",code=>{clearTimeout(timer);reject(Error("HTTP CLI exited: "+code+" "+diagnostics));});
   child.stderr.on("data",data=>{
    diagnostics=(diagnostics+String(data)).slice(-65536);
    if(diagnostics.includes("listening")){clearTimeout(timer);resolve();}
   });
  });
  const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"list_workspaces",arguments:{}}})});
  const rpc=await response.json() as any;
  assert.deepEqual(parse(rpc.result).result,[{workspace_id:"fixture",permissions:["read"],revision:1}]);
 }finally{
  if(child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}
  await fs.rm(tmp,{recursive:true,force:true});
 }
});

test("workspace enrollment pins root identity and rejects replacement at the same path",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-root-identity-"));
 try{
  const root=path.join(tmp,"root");await fs.mkdir(root);await fs.writeFile(path.join(root,"file"),"approved");
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("A",root,["read"]);
  await fs.rename(root,path.join(tmp,"old"));await fs.mkdir(root);await fs.writeFile(path.join(root,"file"),"replacement");
  await assert.rejects(reg.resolveExistingRead("A","file"),(e:any)=>e.code==="SOURCE_UNVERIFIED");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
