import {test} from "node:test";
import assert from "node:assert/strict";
import {ProcessManager} from "../src/core/process-manager.js";
import type {VerifiedNativeSandbox} from "../src/core/native-io.js";
const req={workspace_id:"a",executable:"node",argv:["--version"],cwd_relative:".",time_limit_ms:1000,max_output_bytes:1024,network_allowed:false};
test("native process manager blocks without verified sandbox",async()=>{
 const manager=new ProcessManager(null);
 await assert.rejects(manager.run(req),(e:any)=>e.code==="SECURITY_BLOCKED");
 assert.deepEqual(manager.list("a"),[]);
});
test("verified stub gives workspace-owned process and truthful exit",async()=>{
 const native:VerifiedNativeSandbox={platform:"macos",policy_fingerprint:"test-only",verified:true,execute:async()=>({exit_code:1,signal:null,stdout:"",stderr:"failed",cancelled:false,timed_out:false})};
 const manager=new ProcessManager(native);
 const r=await manager.run(req);
 assert.equal(r.state,"FAILED");assert.equal(manager.get("a",r.process_id).receipt?.exit_code,1);
 assert.throws(()=>manager.get("b",r.process_id),(e:any)=>e.code==="PROCESS_NOT_FOUND");
});

test("process request network and output limits fail closed",async()=>{
 const calls:string[]=[];
 const fake:VerifiedNativeSandbox={platform:"macos",policy_fingerprint:"fake",verified:true,execute:async req=>{calls.push(req.executable);return {exit_code:0,signal:null,stdout:"x".repeat(100),stderr:"",cancelled:false,timed_out:false};}};
 const manager=new ProcessManager(fake);
 await assert.rejects(manager.run({...req,network_allowed:true}),(e:any)=>e.code==="INVALID_PROCESS");
 await assert.rejects(manager.run({...req,cwd_relative:".."}),(e:any)=>e.code==="INVALID_PROCESS");
 assert.deepEqual(calls,[]);
 const result=await manager.run({...req,max_output_bytes:8});
 assert.equal(result.state,"UNKNOWN");
 assert.equal(calls.length,1);
});

test("nonblocking sandbox process supports owned status and eventual receipt",async()=>{
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const native:VerifiedNativeSandbox={platform:"windows",verified:true,policy_fingerprint:"synthetic",execute:async()=>{await gate;return {exit_code:0,signal:null,stdout:"OK",stderr:"",cancelled:false,timed_out:false};}};
 const manager=new ProcessManager(native);
 const started=manager.start(req);
 assert.equal(started.state,"RUNNING");
 assert.equal(manager.get("a",started.process_id).state,"RUNNING");
 assert.throws(()=>manager.get("other",started.process_id),(e:any)=>e.code==="PROCESS_NOT_FOUND");
 release();
 const done=await manager.settle("a",started.process_id);
 assert.equal(done.state,"SUCCEEDED");
 assert.equal(done.receipt?.stdout,"OK");
});
test("unverified process start never invokes host process",()=>{
 const manager=new ProcessManager(null);
 assert.throws(()=>manager.start(req),(e:any)=>e.code==="SECURITY_BLOCKED");
});

test("native cancellation never assumes confirmed termination and denies cross-workspace stop",async()=>{
 let complete!: (x:{exit_code:null;signal:null;stdout:string;stderr:string;cancelled:true;timed_out:false})=>void;
 const pending=new Promise<{exit_code:null;signal:null;stdout:string;stderr:string;cancelled:true;timed_out:false}>(resolve=>{complete=resolve;});
 const stopped:string[]=[];
 const native:VerifiedNativeSandbox={platform:"windows",verified:true,policy_fingerprint:"fake",
  execute:async request=>{assert.ok(request.process_id);return pending;},
  cancel:async (id,workspace)=>{stopped.push(workspace+":"+id);return true;}
 };
 const manager=new ProcessManager(native);
 const started=manager.start(req);
 await assert.rejects(manager.stop("different",started.process_id),(e:any)=>e.code==="PROCESS_NOT_FOUND");
 const acknowledged=await manager.stop("a",started.process_id);
 assert.equal(acknowledged.requested,true);
 assert.equal(manager.get("a",started.process_id).state,"RUNNING");
 assert.equal(stopped.length,1);
 complete({exit_code:null,signal:null,stdout:"",stderr:"",cancelled:true,timed_out:false});
 assert.equal((await manager.settle("a",started.process_id)).state,"CANCELLED");
});
test("missing host cancellation capability returns SECURITY_BLOCKED",async()=>{
 let finish!:()=>void;
 const pending=new Promise<void>(resolve=>{finish=resolve;});
 const native:VerifiedNativeSandbox={platform:"macos",verified:true,policy_fingerprint:"fake",execute:async()=>{await pending;return {exit_code:0,signal:null,stdout:"",stderr:"",cancelled:false,timed_out:false};}};
 const manager=new ProcessManager(native);
 const started=manager.start(req);
 await assert.rejects(manager.stop("a",started.process_id),(e:any)=>e.code==="SECURITY_BLOCKED");
 finish();await manager.settle("a",started.process_id);
});
