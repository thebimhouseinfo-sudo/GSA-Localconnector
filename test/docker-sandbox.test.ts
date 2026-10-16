import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {dockerArguments,DockerSandboxCandidate} from "../src/hosts/docker-sandbox.js";
const policy={image:"example/build@sha256:"+"a".repeat(64),maxMemory:"2g",cpus:"2",pids:128,policy_fingerprint:"test-only"};
const request={workspace_id:"w",executable:"node",argv:["--version"],cwd_relative:".",time_limit_ms:1000,max_output_bytes:2048,network_allowed:false};
test("Docker command enforces no-network no privilege and exact root mount",()=>{
 const root=path.resolve("project"),args=dockerArguments(root,"gsa-12345678-1234-1234-1234-123456789abc",request,policy);
 for(const key of ["--network=none","--read-only","--cap-drop=ALL","--security-opt=no-new-privileges:true"])assert.ok(args.includes(key));
 assert.ok(args.includes("type=bind,source="+root+",target=/workspace"));
 assert.equal(args.includes("--privileged"),false);
 assert.throws(()=>dockerArguments(root,"gsa-12345678-1234-1234-1234-123456789abc",{...request,network_allowed:true},policy),/NETWORK_NOT_APPROVED/);
 assert.throws(()=>dockerArguments(root,"gsa-12345678-1234-1234-1234-123456789abc",request,{...policy,image:"node:latest"}),/UNPINNED_IMAGE/);
});
test("Docker candidate remains unverified and injectable command arguments are literal",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"docker-test-"));
 try {
  const seen:string[][]=[];
  const runner=async (_cmd:string,args:string[],_opts:any)=>{seen.push(args);return {stdout:"v22",stderr:"",exitCode:0};};
  const candidate=new DockerSandboxCandidate(async()=>root,policy,runner);
  const result=await candidate.executeCandidate({...request,argv:["hi; echo bad"]});
  assert.equal(result.exit_code,0);
  assert.equal(seen.length,1);
  assert.ok(seen[0].includes("hi; echo bad"));
  assert.equal("verified" in candidate,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
