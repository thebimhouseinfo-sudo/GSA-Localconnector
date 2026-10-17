import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CiJournalStore} from "../src/local/ci-store.js";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {CiSourceCaptureService,type VerifiedWorkspaceSourceCapture} from "../src/core/ci-source-capture.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import type {VerifiedCiExecutor} from "../src/core/ci-run-service.js";
test("source capture is native-gated and binds source to exactly one Workspace",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-capture-"));
 try{
  const journal=new CiJournalStore(path.join(tmp,"runs")),snapshots=new CiSnapshotStore(path.join(tmp,"snaps"));
  await assert.rejects(new CiSourceCaptureService(null,snapshots,journal).prepare("A"),(e:any)=>e.code==="SECURITY_BLOCKED");
  const native:VerifiedWorkspaceSourceCapture={verified:true,platform:"macos",policy_fingerprint:"stub",
   capture:async()=>[{path:"src/index.ts",bytes:Buffer.from("ok")}]};
  const service=new CiSourceCaptureService(native,snapshots,journal);
  const prep=await service.prepare("A");
  assert.match(prep.source_sha256,/^[a-f0-9]{64}$/);
  assert.equal((await service.requireOwned("A",prep.source_run_id)).total_bytes,2);
  await assert.rejects(service.requireOwned("B",prep.source_run_id),/SOURCE_OWNERSHIP_DENIED/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("MCP CI source + run never executes unless both native verifiers are injected",async t=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"ci-mcp-integrated-"));
 try{
  const journal=new CiJournalStore(path.join(tmp,"run")),snapshots=new CiSnapshotStore(path.join(tmp,"snapshot"));
  const storageErrors:string[]=[];
  const save=journal.save.bind(journal),verify=snapshots.verify.bind(snapshots),read=snapshots.readVerifiedFile.bind(snapshots);
  // Keep real storage operations; surface errors otherwise hidden by UNKNOWN recovery.
  t.mock.method(journal,"save",async(...args:Parameters<CiJournalStore["save"]>)=>{
   try{return await save(...args);}catch(error){storageErrors.push(`journal.save: ${String(error)}`);throw error;}
  });
  t.mock.method(snapshots,"verify",async(...args:Parameters<CiSnapshotStore["verify"]>)=>{
   try{return await verify(...args);}catch(error){storageErrors.push(`snapshots.verify: ${String(error)}`);throw error;}
  });
  t.mock.method(snapshots,"readVerifiedFile",async(...args:Parameters<CiSnapshotStore["readVerifiedFile"]>)=>{
   try{return await read(...args);}catch(error){storageErrors.push(`snapshots.readVerifiedFile: ${String(error)}`);throw error;}
  });
  const native:VerifiedWorkspaceSourceCapture={verified:true,platform:"windows",policy_fingerprint:"test",capture:async()=>[{path:"index.ts",bytes:Buffer.from("ok")},{path:"ci.json",bytes:await fs.readFile(path.join(tmp,"ci.json"))}]};
  const executor:VerifiedCiExecutor={verified:true,policy_fingerprint:"stub-only",execute:async()=>({exit_code:0,source_verified:true})};
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("A",tmp,["read","execute"]);await reg.enrollTrusted("B",tmp,["read","execute"]);
  await fs.writeFile(path.join(tmp,"ci.json"),JSON.stringify({name:"check",jobs:[{id:"test",steps:[{id:"one",command:"node"}]}]}));
  const call=createReadOnlyTools(reg,null,null,journal,null,null,null,snapshots,native,executor);
  const prepared=JSON.parse((await call({name:"ci_prepare_source",arguments:{workspace_id:"A"}})).content[0].text);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  const id=prepared.result.source_run_id;
  await fs.writeFile(path.join(tmp,"ci.json"),"host changed after capture");
  assert.equal((await call({name:"ci_run",arguments:{workspace_id:"B",workflow:"ci.json",source_run_id:id}})).isError,true);
  const started=JSON.parse((await call({name:"ci_run",arguments:{workspace_id:"A",workflow:"ci.json",source_run_id:id}})).content[0].text);
  assert.equal(started.ok,true,JSON.stringify(started));
  // The async execution contract returns a queue record; native proof is a separate gate.
  assert.equal(started.result.state,"QUEUED");
  let finalState="QUEUED";
  for(let attempt=0;attempt<300;attempt++){
   const status=JSON.parse((await call({name:"ci_status",arguments:{workspace_id:"A",run_id:started.result.run_id}})).content[0].text);
   assert.equal(status.ok,true,JSON.stringify(status));
   finalState=status.result.state;
   if(["PASSED","FAILED","UNKNOWN","CANCELLED"].includes(finalState))break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(finalState,"PASSED",JSON.stringify({finalState,storageErrors}));
  const denied=await createReadOnlyTools(reg)({name:"ci_prepare_source",arguments:{workspace_id:"A"}});
  assert.equal(denied.isError,true);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
