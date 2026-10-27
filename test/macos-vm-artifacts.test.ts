import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {validateMacVmArtifacts} from "../src/hosts/macos-vm-runtime.js";
import {validateWorkflow,validateArtifactPaths} from "../src/core/ci-dag.js";
import {parseCiManifest} from "../src/core/ci-manifest.js";
import type {SandboxedProcessRequest} from "../src/core/native-io.js";
const request=(paths:readonly string[]):SandboxedProcessRequest=>({workspace_id:"A",executable:"python3",argv:[],cwd_relative:".",time_limit_ms:1000,max_output_bytes:1048576,network_allowed:false,artifact_paths:paths});
const file=(name:string,bytes=Buffer.from([0,255,1]))=>({path:name,size:bytes.length,base64:bytes.toString("base64"),sha256:createHash("sha256").update(bytes).digest("hex")});
test("artifact list is an explicit portable exact-path workflow binding",()=>{
 const doc={name:"build",artifacts:["out/report.bin"],jobs:[{id:"build",steps:[{id:"run",command:"true"}]}]};
 validateWorkflow(doc);assert.deepEqual(parseCiManifest(JSON.stringify(doc)),doc);
 assert.deepEqual(parseCiManifest('name: build\nartifacts: ["out/report.bin"]\njobs:\n  - id: build\n    steps:\n      - id: run\n        command: true\n'),doc);
 for(const paths of [["../escape"],["/absolute"],["a","A"],["a/*"],["a?"],["a\\b"],["NUL"],["é"],Array(21).fill("x")])assert.throws(()=>validateArtifactPaths(paths));
});
test("parent verifies artifact byte/hash/count/quota and preserves binary NUL",()=>{
 const entry=file("out/report.bin"),req=request([entry.path]);
 assert.deepEqual(validateMacVmArtifacts(req,{artifacts:[entry],artifact_error:null}),{artifacts:[entry],artifact_error:null});
 for(const entries of [[],[entry,entry],[{...entry,path:"other"}],[{...entry,size:4}],[{...entry,sha256:"0".repeat(64)}],[{...entry,base64:entry.base64+"!"}],[{...entry,size:1048577}]] )assert.throws(()=>validateMacVmArtifacts(req,{artifacts:entries,artifact_error:null}),/SECURITY_BLOCKED/);
 assert.throws(()=>validateMacVmArtifacts(req,{artifacts:[entry],artifact_error:"artifact_missing_unsafe_or_over_quota"}));
 assert.throws(()=>validateMacVmArtifacts(request([]),{artifacts:[entry],artifact_error:null}));
 const a=file("a",Buffer.alloc(524289)),b=file("b",Buffer.alloc(524288));
 assert.throws(()=>validateMacVmArtifacts(request(["a","b"]),{artifacts:[a,b],artifact_error:null}),/quota/);
 assert.deepEqual(validateMacVmArtifacts(req,{artifacts:[],artifact_error:"artifact_missing_unsafe_or_over_quota"}),{artifacts:[],artifact_error:"artifact_missing_unsafe_or_over_quota"});
});
