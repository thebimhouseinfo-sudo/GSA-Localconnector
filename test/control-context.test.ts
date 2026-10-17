import {test as platformTest} from "node:test";
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX ownership/mode storage test; Windows ACL backend unverified":false},fn);
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {ControlLeaseStore} from "../src/local/control-lease.js";
import {withControlToken,captureControlAuthorization,requireCurrentControl} from "../src/mcp/control-context.js";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import type {VerifiedNativeSandbox} from "../src/core/native-io.js";

test("captured authorization retains its controller and observes later release and expiry",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"control-context-"));let now=1000;
 try{
  const store=new ControlLeaseStore(path.join(tmp,"identity"),100,()=>now),lease=await store.acquire();
  let authorize:()=>Promise<void>=async()=>{};
  await withControlToken(store,lease.control_token,async()=>{authorize=captureControlAuthorization();await requireCurrentControl();});
  await authorize();now=1100;
  await assert.rejects(authorize(),(e:any)=>e.code==="SESSION_EXPIRED");
  now=1001;await store.release(lease.control_token);
  await assert.rejects(authorize(),(e:any)=>e.code==="SESSION_INVALID");
  await assert.rejects(requireCurrentControl(),(e:any)=>e.code==="SESSION_INVALID");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test("production MCP controller tools gate execution, strip credentials, and retain active authorization",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"control-mcp-"));
 try{
  const store=new ControlLeaseStore(path.join(tmp,"identity")),registry=new WorkspaceRegistry();
  await registry.enrollTrusted("A",tmp,["read","execute"]);
  let calls=0,authorize:()=>Promise<void>=async()=>{};
  const sandbox:VerifiedNativeSandbox={platform:"macos",verified:true,policy_fingerprint:"test-only",execute:async()=>{
   calls++;authorize=captureControlAuthorization();await authorize();
   return {exit_code:0,signal:null,stdout:"ok",stderr:"",timed_out:false,cancelled:false,source_verified:true};
  }};
  const invoke=createReadOnlyTools(registry,null,sandbox,null,null,null,null,null,null,null,store);
  const command={workspace_id:"A",command:"/bin/echo",args:["ok"]};
  const missing=JSON.parse((await invoke({name:"run_command",arguments:command})).content[0].text);
  assert.equal(missing.code,"SESSION_INVALID");assert.equal(calls,0);
  const acquired=JSON.parse((await invoke({name:"acquire_control",arguments:{}})).content[0].text);
  assert.equal(acquired.ok,true);const token=acquired.result.control_token;
  const valid=JSON.parse((await invoke({name:"run_command",arguments:{...command,control_token:token}})).content[0].text);
  assert.equal(valid.ok,true);assert.equal(calls,1);
  const renewed=JSON.parse((await invoke({name:"renew_control",arguments:{control_token:token}})).content[0].text);
  assert.equal(renewed.ok,true);
  const released=JSON.parse((await invoke({name:"release_control",arguments:{control_token:token}})).content[0].text);
  assert.equal(released.ok,true);
  await assert.rejects(authorize(),(e:any)=>e.code==="SESSION_INVALID");
  assert.equal(JSON.parse((await invoke({name:"run_command",arguments:{...command,control_token:token}})).content[0].text).code,"SESSION_INVALID");
  const definitions=toolDefinitions();
  for(const name of ["run_command","start_process","ci_run","ci_rerun_failed","bind_workspaces","git_status","create_file"]){
   const definition=definitions.find(value=>value.name===name)!;
   assert.ok(definition.inputSchema.required.includes("control_token"));
  }
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
