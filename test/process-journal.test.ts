import {test} from "node:test";
import assert from "node:assert/strict";
import {DurableProcessManager} from "../src/core/durable-process.js";
import type {NativeProcessStatus,VerifiedNativeProcessController} from "../src/core/native-io.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {ProcessJournalStore} from "../src/local/process-store.js";
import type {ProcessJournalRecord} from "../src/core/process-journal.js";

test("completed process status and output survive a new manager without querying an old native identity",async()=>{
 const records=new Map<string,any>();
 const store={list:async()=>[...records.values()].map(r=>structuredClone(r)),load:async(id:string)=>structuredClone(records.get(id)),
  create:async(r:any)=>{assert(!records.has(r.process_id));records.set(r.process_id,structuredClone(r));},
  save:async(r:any,expected:number)=>{assert.equal(records.get(r.process_id).revision,expected);records.set(r.process_id,structuredClone(r));}};
 const completed:NativeProcessStatus={state:"SUCCEEDED",exit_code:0,started_at:"start",ended_at:"end"};
 const native:VerifiedNativeProcessController={verified:true,platform:"macos",policy_fingerprint:"fixture",start:async()=>({native_id:"n1"}),status:async()=>completed,
  output:async()=>({stdout:"complete π",stderr:"",next_cursor:null}),stop:async()=>({stopped:true,state:"SUCCEEDED"})};
 const request={workspace_id:"A",executable:"python3",argv:[],cwd_relative:".",time_limit_ms:1000,max_output_bytes:1024,network_allowed:false};
 const first=new (DurableProcessManager as any)(native,1,{store,ownerSession:"11111111-1111-4111-8111-111111111111"});
 const started=await first.start(request);await first.status("A",started.process_id);
 const forbidden=async()=>{throw Error("old native identity must not be queried");};
 const restarted=new (DurableProcessManager as any)({...native,status:forbidden,output:forbidden,stop:forbidden},1,{store,ownerSession:"22222222-2222-4222-8222-222222222222"});
 assert.equal((await restarted.status("A",started.process_id)).state,"SUCCEEDED");
 assert.equal((await restarted.output("A",started.process_id)).stdout,"complete π");
 await assert.rejects(restarted.status("B",started.process_id),(error:any)=>error.code==="PROCESS_NOT_FOUND");
});
test("protected process records preserve binary-safe output and sealed terminal evidence",{skip:process.platform==="win32"},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-process-store-')));
 const store=new ProcessJournalStore(path.join(root,'records'));
 const record:ProcessJournalRecord={format:'gsa-process-v1',process_id:randomUUID(),workspace_id:'A',native_id:randomUUID(),owner_session:randomUUID(),revision:1,
  status:{state:'SUCCEEDED',exit_code:0,started_at:'start',ended_at:'end'},stopped:true,stdout:'\0π\n',stderr:'warning',output_complete:true};
 try{
  await store.create(record);assert.deepEqual(await new ProcessJournalStore(path.join(root,'records')).load(record.process_id),record);
  await assert.rejects(store.save({...record,revision:2,stdout:'forged'},1),(error:any)=>error.code==='PROCESS_TERMINAL_IMMUTABLE');
  const file=path.join(root,'records',record.process_id+'.json');await fs.rename(file,file+'.original');await fs.symlink(file+'.original',file);
  await assert.rejects(store.load(record.process_id));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("stopped process output can finish once before the record becomes immutable",{skip:process.platform==="win32"},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-process-output-')));
 const store=new ProcessJournalStore(path.join(root,'records'));
 const record:ProcessJournalRecord={format:'gsa-process-v1',process_id:randomUUID(),workspace_id:'A',native_id:randomUUID(),owner_session:randomUUID(),revision:1,
  status:{state:'SUCCEEDED',exit_code:0,started_at:'start',ended_at:'end'},stopped:true,stdout:'partial',stderr:'',output_complete:false};
 try{
  await store.create(record);
  const complete={...record,revision:2,stdout:'complete',output_complete:true};
  await store.save(complete,1);
  for(const change of [{stdout:'forged'},{output_complete:false},{stopped:false},{status:{...record.status,state:'RUNNING' as const,exit_code:null,ended_at:null}}]){
   await assert.rejects(store.save({...complete,...change,revision:3},2),(error:any)=>error.code==='PROCESS_TERMINAL_IMMUTABLE');
  }
  assert.deepEqual(await new ProcessJournalStore(path.join(root,'records')).load(record.process_id),complete);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
