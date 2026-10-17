import {test} from "node:test";
import assert from "node:assert/strict";
import {ProcessManager} from "../src/core/process-manager.js";
import {executeGit} from "../src/core/git-engine.js";
import {scheduleValidatedCI} from "../src/core/ci-scheduler.js";
import type {VerifiedNativeSandbox} from "../src/core/native-io.js";
const native:VerifiedNativeSandbox={platform:"macos",verified:true,policy_fingerprint:"fixture",execute:async()=>({exit_code:0,signal:null,stdout:"truncated",stderr:"",cancelled:false,timed_out:false,output_limited:true})};
test("a zero exit with truncated process output cannot succeed",async()=>{
 const result=await new ProcessManager(native).run({workspace_id:"w",executable:"python3",argv:[],cwd_relative:".",time_limit_ms:1000,max_output_bytes:1024,network_allowed:false});
 assert.equal(result.state,"UNKNOWN");
});
test("a zero Git exit with truncated output has no success receipt",async()=>{
 await assert.rejects(executeGit(native,"w","git_status"),(error:any)=>error.code==="GIT_OUTPUT_LIMIT");
});
test("a zero CI exit with truncated output has unknown evidence",async()=>{
 const result=await scheduleValidatedCI(native,"w",{name:"build",jobs:[{id:"test",steps:[{id:"check",command:"python3",args:[]}]}]},"a".repeat(64));
 assert.equal(result.record.state,"UNKNOWN");
});
