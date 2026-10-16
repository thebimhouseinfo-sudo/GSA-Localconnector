import {test} from "node:test";
import assert from "node:assert/strict";
import {scheduleValidatedCI} from "../src/core/ci-scheduler.js";
import type {VerifiedNativeSandbox} from "../src/core/native-io.js";
const hash="a".repeat(64);
const workflow={name:"build",jobs:[{id:"test",needs:["compile"],steps:[{id:"t",command:"test-runner"}]},{id:"compile",steps:[{id:"c",command:"compiler"}]}]};
test("CI reference scheduler orders dependencies and records proven outcomes",async()=>{
 const cmds:string[]=[];
 const native:VerifiedNativeSandbox={platform:"macos",verified:true,policy_fingerprint:"test",execute:async req=>{cmds.push(req.executable);return {exit_code:0,signal:null,stdout:"ok",stderr:"",cancelled:false,timed_out:false};}};
 const result=await scheduleValidatedCI(native,"w",workflow,hash);
 assert.deepEqual(cmds,["compiler","test-runner"]);assert.equal(result.record.state,"PASSED");
 assert.equal(result.logs.page().entries.length,2);
});
test("CI cannot execute without native sandbox",async()=>{
 await assert.rejects(scheduleValidatedCI(null,"w",workflow,hash),(e:any)=>e.code==="SECURITY_BLOCKED");
});
test("CI reports failed step, does not run dependents",async()=>{
 const cmds:string[]=[];
 const native:VerifiedNativeSandbox={platform:"macos",verified:true,policy_fingerprint:"test",execute:async req=>{cmds.push(req.executable);return {exit_code:1,signal:null,stdout:"",stderr:"failed",cancelled:false,timed_out:false};}};
 const result=await scheduleValidatedCI(native,"w",workflow,hash);
 assert.deepEqual(cmds,["compiler"]);assert.equal(result.record.state,"FAILED");
});
