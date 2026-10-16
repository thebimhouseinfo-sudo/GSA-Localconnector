import {test} from "node:test";
import assert from "node:assert/strict";
import {executeGit} from "../src/core/git-engine.js";
import type {VerifiedNativeSandbox} from "../src/core/native-io.js";
test("Git cannot execute without native sandbox",async()=>{
 await assert.rejects(executeGit(null,"a","git_status"),(e:any)=>e.code==="SECURITY_BLOCKED");
});
test("Git status executes with injected verified backend and denies cross-network",async()=>{
 const calls:string[][]=[];
 const fake:VerifiedNativeSandbox={platform:"windows",verified:true,policy_fingerprint:"fake-only",execute:async(req)=>{calls.push([...req.argv]);return {exit_code:0,signal:null,stdout:" M README.md",stderr:"",cancelled:false,timed_out:false};}};
 const r=await executeGit(fake,"project-a","git_status");
 assert.equal(r.output," M README.md");assert.equal(r.committed,false);
 assert.equal(calls.length,1);
 await assert.rejects(executeGit(fake,"project-a","git_fetch"),/network requires/);
 assert.equal(calls.length,1);
});
