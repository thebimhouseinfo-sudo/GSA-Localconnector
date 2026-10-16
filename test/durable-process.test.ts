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
