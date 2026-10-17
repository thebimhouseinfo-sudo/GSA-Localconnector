import {test} from "node:test";
import assert from "node:assert/strict";
import {DurableProcessManager} from "../src/core/durable-process.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {VerifiedNativeProcessController} from "../src/core/native-io.js";
const request={workspace_id:"A",executable:"node",argv:["--version"],cwd_relative:".",time_limit_ms:30000,max_output_bytes:65536,network_allowed:false};
test("durable process API fails closed without native controller",async()=>{
 const manager=new DurableProcessManager(null);
 await assert.rejects(manager.start(request),(e:any)=>e.code==="SECURITY_BLOCKED");
});
test("durable process identifiers never cross Workspace grants",async()=>{
 const controller:VerifiedNativeProcessController={
  verified:true,platform:"macos",policy_fingerprint:"test-only",
  start:async()=>({native_id:"native-private"}),
  status:async(id)=>({state:"RUNNING",exit_code:null,started_at:id,ended_at:null}),
  output:async()=>({stdout:"OK",stderr:"",next_cursor:null}),
  stop:async()=>({stopped:true,state:"CANCELLED"})
 };
 const manager=new DurableProcessManager(controller);
 const created=await manager.start(request);
 assert.notEqual(created.process_id,"native-private");
 assert.equal((await manager.status("A",created.process_id)).state,"RUNNING");
 assert.equal((await manager.output("A",created.process_id)).stdout,"OK");
 await assert.rejects(manager.status("B",created.process_id),(e:any)=>e.code==="PROCESS_NOT_FOUND");
 await assert.rejects(manager.stop("B",created.process_id),(e:any)=>e.code==="PROCESS_NOT_FOUND");
 assert.equal((await manager.stop("A",created.process_id)).state,"CANCELLED");
 await assert.rejects(manager.start({...request,network_allowed:true}),(e:any)=>e.code==="INVALID_PROCESS_REQUEST");
});

test("MCP native durable process registration is gated and workspace-owned",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-process-"));
 try{
  const registry=new WorkspaceRegistry();await registry.enrollTrusted("A",root,["read","execute"]);await registry.enrollTrusted("B",root,["read","execute"]);
  const native:VerifiedNativeProcessController={verified:true,platform:"macos",policy_fingerprint:"stub",
   start:async()=>({native_id:"hostpid1"}),status:async()=>({state:"RUNNING",exit_code:null,started_at:"now",ended_at:null}),
   output:async()=>({stdout:"ok",stderr:"",next_cursor:null}),stop:async()=>({stopped:true,state:"CANCELLED"})};
  const call=createReadOnlyTools(registry,null,null,null,null,null,native);
  const start=JSON.parse((await call({name:"start_process",arguments:{workspace_id:"A",command:"node",args:["--version"]}})).content[0].text);
  assert.equal(start.ok,true);
  const id=start.result.process_id as string;
  const status=JSON.parse((await call({name:"process_status",arguments:{workspace_id:"A",process_id:id}})).content[0].text);
  assert.equal(status.result.state,"RUNNING");
  const denied=await call({name:"stop_process",arguments:{workspace_id:"B",process_id:id}});
  assert.equal(denied.isError,true);
  const stopped=JSON.parse((await call({name:"stop_process",arguments:{workspace_id:"A",process_id:id}})).content[0].text);
  assert.equal(stopped.result.stopped,true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test("expired native history after 129 shared completions releases capacity without success claims",async()=>{
 let serial=0;const retained=new Set<string>();
 const missing=()=>Object.assign(new Error("Native terminal history expired"),{code:"PROCESS_NOT_FOUND"});
 const native:VerifiedNativeProcessController={verified:true,platform:"macos",policy_fingerprint:"bounded-history",
  start:async()=>{const native_id=String(++serial);retained.add(native_id);if(retained.size>128)retained.delete(retained.values().next().value!);return {native_id};},
  status:async id=>{if(!retained.has(id))throw missing();return {state:"SUCCEEDED",exit_code:0,started_at:"start",ended_at:"end"};},
  output:async id=>{if(!retained.has(id))throw missing();return {stdout:"done",stderr:"",next_cursor:null};},
  stop:async id=>{if(!retained.has(id))throw missing();return {stopped:true,state:"SUCCEEDED"};}};
 const manager=new DurableProcessManager(native,1),first=await manager.start(request);
 for(let i=0;i<129;i++)await native.start(request);
 const next=await manager.start(request);assert.notEqual(next.process_id,first.process_id);
 for(const query of [()=>manager.status("A",first.process_id),()=>manager.output("A",first.process_id),()=>manager.stop("A",first.process_id)]){
  await assert.rejects(query(),(e:any)=>e.code==="PROCESS_NOT_FOUND"&&/expired/.test(e.message));
 }
 assert.equal((await manager.output("A",next.process_id)).stdout,"done");
});
test("unexpected native status errors never reclaim process authority",async()=>{
 let calls=0;const native:VerifiedNativeProcessController={verified:true,platform:"macos",policy_fingerprint:"fixture",
  start:async()=>({native_id:String(++calls)}),status:async()=>{throw Object.assign(new Error("backend unavailable"),{code:"IO_ERROR"});},
  output:async()=>({stdout:"",stderr:"",next_cursor:null}),stop:async()=>({stopped:false,state:"UNKNOWN"})};
 const manager=new DurableProcessManager(native,1);await manager.start(request);
 await assert.rejects(manager.start(request),/backend unavailable/);assert.equal(calls,1);
});
test("confirmed UNKNOWN stop releases capacity while unconfirmed UNKNOWN remains reserved",async()=>{
 let serial=0,confirmed=false;
 const native:VerifiedNativeProcessController={verified:true,platform:"macos",policy_fingerprint:"fixture",start:async()=>({native_id:String(++serial)}),
  status:async()=>({state:"UNKNOWN",exit_code:null,started_at:"start",ended_at:"end"}),output:async()=>({stdout:"",stderr:"",next_cursor:null}),stop:async()=>({stopped:confirmed,state:"UNKNOWN"})};
 const manager=new DurableProcessManager(native,1),first=await manager.start(request);
 assert.deepEqual(await manager.stop("A",first.process_id),{stopped:false,state:"UNKNOWN"});
 await assert.rejects(manager.start(request),(e:any)=>e.code==="PROCESS_LIMIT");
 confirmed=true;assert.deepEqual(await manager.stop("A",first.process_id),{stopped:true,state:"UNKNOWN"});
 const second=await manager.start(request);assert.notEqual(second.process_id,first.process_id);
 assert.equal((await manager.status("A",first.process_id)).state,"UNKNOWN");
});
