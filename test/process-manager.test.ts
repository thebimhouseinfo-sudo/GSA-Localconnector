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
