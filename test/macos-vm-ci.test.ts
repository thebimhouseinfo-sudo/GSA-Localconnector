import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {MacVmCiExecutor} from "../src/hosts/macos-vm-ci.js";
import {createSnapshotManifest} from "../src/core/ci-snapshot.js";
import {createQueuedRun,transitionRun} from "../src/core/ci-journal.js";
import {CiLogStore} from "../src/local/ci-log-store.js";
import {CiArtifactStore} from "../src/local/ci-artifacts.js";
import type {MacVmRuntime} from "../src/hosts/macos-vm-runtime.js";
import type {SandboxedProcessReceipt,SandboxedProcessRequest} from "../src/core/native-io.js";
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const workflow={name:"build",jobs:[{id:"test",needs:["build"],steps:[{id:"check",command:"python3",args:["-c","assert open('result').read() == 'ok'"]}]},{id:"build",steps:[{id:"write",command:"python3",args:["-c","open('result','w').write('ok')"]}]}]};
async function fixture(receipt:SandboxedProcessReceipt={exit_code:0,signal:null,stdout:"hello\n",stderr:"",cancelled:false,timed_out:false}){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"mac-ci-"));const entries=[{path:"ci.json",bytes:Buffer.from(JSON.stringify(workflow))},{path:"big.dat",bytes:Buffer.alloc(70000,65)}];
 const manifest=createSnapshotManifest(entries);const base=createQueuedRun("A",workflow.name,manifest.source_sha256);
 const run={...transitionRun(transitionRun(base,"PREPARING",1),"RUNNING",2),workflow_binding:{path:"ci.json",sha256:sha(entries[0].bytes),document:workflow}};
 let requests:SandboxedProcessRequest[]=[];let input:readonly {path:string;bytes:Uint8Array}[]=[];
 const runtime={sandbox:{policy_fingerprint:"test-native",cancel:async()=>false},executeSnapshot:async(req:SandboxedProcessRequest,files:typeof input)=>{requests.push(req);input=files;return receipt;}} as unknown as MacVmRuntime;
 const snapshots={verify:async()=>manifest,readVerifiedFile:async()=>entries[0].bytes,readVerifiedEntries:async()=>entries};
 const logs=new CiLogStore(path.join(tmp,"logs")),artifacts=new CiArtifactStore(path.join(tmp,"artifacts"));
 const executor=new MacVmCiExecutor(runtime,snapshots,logs,artifacts);
 return {tmp,run,entries,requests,get input(){return input;},runtime,snapshots,logs,artifacts,executor,cleanup:()=>fs.rm(tmp,{recursive:true,force:true})};
}
test("native CI submits one pinned snapshot and runs dependency steps in one guest copy",async()=>{
 const f=await fixture();try{
  const outcome=await f.executor.execute(f.run,workflow);assert.equal(outcome.exit_code,0);assert.equal(outcome.source_verified,true);assert.equal(outcome.cancelled_verified,false);assert.equal(f.requests.length,1);
  assert.equal(f.input[1].bytes.length,70000);assert.equal(f.requests[0].process_id,f.run.run_id);
  assert.equal(f.requests[0].network_allowed,false);
  const result=spawnSync("python3",[...f.requests[0].argv],{cwd:f.tmp,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);assert.equal(await fs.readFile(path.join(f.tmp,"result"),"utf8"),"ok");
  assert.equal((await f.logs.page(f.run.run_id)).entries[0].text,"hello\n");
  const artifact=await f.artifacts.read(f.run.run_id,"execution.json");assert.equal(JSON.parse(Buffer.from(artifact.bytes).toString()).source_sha256,f.run.source_sha256);assert.equal(outcome.artifact_hashes[artifact.metadata.name],artifact.metadata.sha256);
 }finally{await f.cleanup();}
});
test("native CI rejects workflow and source mismatches before VM execution",async()=>{
 const f=await fixture();try{
  await assert.rejects(f.executor.execute(f.run,{...workflow,name:"changed"}),/WORKFLOW/);
  f.entries[1].bytes[0]=66;
  await assert.rejects(f.executor.execute(f.run,workflow),/SOURCE/);assert.equal(f.requests.length,0);
 }finally{await f.cleanup();}
});
test("native CI never reports PASS for timeout, signal or cancellation",async()=>{
 for(const delta of [{timed_out:true},{signal:"SIGKILL"},{cancelled:true}]){
  const f=await fixture({exit_code:0,signal:null,stdout:"",stderr:"",cancelled:false,timed_out:false,...delta});try{
   assert.equal((await f.executor.execute(f.run,workflow)).exit_code,null);
  }finally{await f.cleanup();}
 }
});
test("native CI does not claim cancellation without native confirmation",async()=>{
 const f=await fixture();try{await assert.rejects(f.executor.cancel(f.run.run_id,"A"),/SECURITY_BLOCKED/);}finally{await f.cleanup();}
});
test("native CI runner ignores source modules that shadow its trusted Python imports",async()=>{
 const f=await fixture();try{
  await f.executor.execute(f.run,workflow);
  await fs.writeFile(path.join(f.tmp,"base64.py"),"raise RuntimeError('source shadowed runner')\n");
  const result=spawnSync("python3",[...f.requests[0].argv],{cwd:f.tmp,encoding:"utf8"});assert.equal(result.status,0,result.stderr);
 }finally{await f.cleanup();}
});
test("native CI rejects duplicate in-flight execution and requires confirmed cancellation",async()=>{
 const f=await fixture();let finish!:(receipt:SandboxedProcessReceipt)=>void;
 f.runtime.executeSnapshot=async()=>new Promise(resolve=>{finish=resolve;});
 let cancelledId="";
 f.runtime.sandbox.cancel=async(id,workspace)=>{assert.equal(workspace,"A");cancelledId=id;finish({exit_code:null,signal:null,stdout:"",stderr:"",cancelled:true,timed_out:false});return true;};
 try{
  const first=f.executor.execute(f.run,workflow);
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.executor.execute(f.run,workflow),/WORKFLOW_PROVENANCE/);
  assert.deepEqual(await f.executor.cancel(f.run.run_id,"A"),{stopped:true});
  assert.equal(cancelledId,f.run.run_id);assert.equal((await first).exit_code,null);
 }finally{await f.cleanup();}
});
test("native CI logs retain multibyte output across bounded chunks",async()=>{
 const text="🙂".repeat(20000);const f=await fixture({exit_code:1,signal:null,stdout:text,stderr:"failed",cancelled:false,timed_out:false});try{
  assert.equal((await f.executor.execute(f.run,workflow)).exit_code,1);
  const chunks=(await f.logs.page(f.run.run_id)).entries;
  assert.equal(chunks.filter(c=>c.stream==="stdout").map(c=>c.text).join(""),text);
  assert(chunks.every(c=>Buffer.byteLength(c.text)<=65536));
 }finally{await f.cleanup();}
});
test("native CI output-limit receipt cannot become zero-exit evidence",async()=>{
 const f=await fixture();f.runtime.executeSnapshot=async()=>({exit_code:0,signal:null,stdout:"truncated",stderr:"",cancelled:false,timed_out:false,output_limited:true});
 try{assert.equal((await f.executor.execute(f.run,workflow)).exit_code,null);}finally{await f.cleanup();}
});
