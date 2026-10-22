import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {sha256} from "../src/core/edit-guards.js";
import type {NativeScopedFiles,ScopedFileRef} from "../src/core/native-io.js";
import type {FileTransactionOutcome} from "../src/core/file-transactions.js";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {applyPatch as applyPatchWrite,editFile as editFileWrite,trashFile as trashFileWrite,updateFile as updateFileWrite} from "../src/core/write-engine.js";
import {createReadOnlyTools} from "../src/mcp/server.js";

const before=Buffer.from("old\n"),after=Buffer.from("new\n"),expected=sha256(before);
const transactionId="11111111-1111-1111-1111-111111111111",handle="22222222-2222-2222-2222-222222222222";
function observed(operation:"replace"|"trash",status:FileTransactionOutcome["status"]="APPLIED"):FileTransactionOutcome{
 return {transaction_id:transactionId,status,intent:{operation,source:{workspace_id:"work",path:"a.txt",revision:1,rootIdentity:{device:"1",inode:"2"}},destination:null,expected_sha256:expected,after_sha256:operation==="replace"?sha256(after):null},observations:{captured:true,published:operation==="replace"?true:false,source_absent:operation==="trash",destination_present:operation==="replace",source_sha256:null,destination_sha256:operation==="replace"?sha256(after):null,capturedIdentity:{device:"1",inode:"3"},publishedIdentity:operation==="replace"?{device:"1",inode:"4"}:null},retained_handles:[handle],reason:status==="APPLIED"?"VERIFIED_READBACK":status==="CONFLICT"?"ENTRY_CONFLICT":"IO_UNCERTAIN"};
}
async function fixture(t:any,outcome:FileTransactionOutcome|null){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-recovery-route-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root,role:"workspace"}]);
 let legacy=0,transactions=0;
 const mutate=async()=>{legacy++;};
 const backend:NativeScopedFiles & {recoverableMutations?:unknown}={read:async()=>({bytes:before,sha256:expected,kind:"file"}),createExclusive:mutate,replaceIfHash:mutate,makeDirectory:mutate,copyExclusive:mutate,moveExclusive:mutate,trashIfHash:mutate};
 if(outcome)backend.recoverableMutations={
  replaceIfHash:async(ref:ScopedFileRef,bytes:Uint8Array,hash:string)=>{transactions++;assert.deepEqual(ref,{workspace_id:"work",path:"a.txt"});assert.equal(hash,expected);assert.deepEqual(Buffer.from(bytes),after);return outcome;},
  trashIfHash:async(ref:ScopedFileRef,hash:string)=>{transactions++;assert.deepEqual(ref,{workspace_id:"work",path:"a.txt"});assert.equal(hash,expected);return outcome;}
 };
 const invoke=createReadOnlyTools(registry,backend);
 return {invoke:(name:string,args:Record<string,unknown>)=>invoke({name,arguments:args}),call:async(name:string,args:Record<string,unknown>={})=>{const response=await invoke({name,arguments:{workspace_id:"work",path:"a.txt",expected_sha256:expected,...args}});return {...JSON.parse(response.content[0]!.text),isError:response.isError===true};},counts:()=>({legacy,transactions})};
}

// These catch legacy fallthrough or loss of transaction observations at MCP serialization.
for(const [name,operation,args] of [
 ["update_file","replace",{content:"new\n"}],
 ["edit_file","replace",{old_text:"old",new_text:"new"}],
 ["apply_patch","replace",{patch:"--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"}],
 ["delete_file","trash",{}]
] as const)test(`${name} returns verified transaction through MCP without legacy mutation`,async t=>{
 const outcome=observed(operation),f=await fixture(t,outcome),result=await f.call(name,args);
 assert.equal(result.ok,true);assert.deepEqual(result.result,outcome);assert.equal(result.result.file_mutated,undefined);assert.deepEqual(f.counts(),{legacy:0,transactions:1});
});
for(const status of ["CONFLICT","UNKNOWN"] as const)test(`${status} is a tool error while retaining full observations and recovery handle`,async t=>{
 const outcome=observed("replace",status),f=await fixture(t,outcome),result=await f.call("update_file",{content:"new\n"});
 assert.equal(result.isError,true);assert.equal(result.ok,false);assert.equal(result.code,status==="CONFLICT"?"FILE_TRANSACTION_CONFLICT":"RESULT_UNKNOWN");
 assert.deepEqual(result.result,outcome);assert.equal(result.result.file_mutated,undefined);assert.deepEqual(f.counts(),{legacy:0,transactions:1});
});
test("edit and patch preconditions reject before a transaction starts",async t=>{
 const f=await fixture(t,observed("replace"));
 for(const [name,args,code] of [["edit_file",{old_text:"absent",new_text:"new"},"MATCH_CONFLICT"],["apply_patch",{patch:"broken"},"INVALID_PATCH"],["update_file",{content:"new\n",expected_sha256:"0".repeat(64)},"HASH_CONFLICT"]] as const){
  const result=await f.call(name,args);assert.equal(result.ok,false);assert.equal(result.code,code);
 }
 assert.deepEqual(f.counts(),{legacy:0,transactions:0});
});
test("absent optional adapter retains legacy receipt",async t=>{
 const f=await fixture(t,null),result=await f.call("update_file",{content:"new\n"});
 assert.deepEqual(result.result,{workspace_id:"work",path:"a.txt",before_sha256:expected,after_sha256:sha256(after),file_mutated:true,committed:false});assert.deepEqual(f.counts(),{legacy:1,transactions:0});
});
test("invalid APPLIED observation cannot become a successful mutation",async t=>{
 const value=observed("replace"),f=await fixture(t,{...value,reason:"IO_UNCERTAIN"});
 const result=await f.call("update_file",{content:"new\n"});assert.equal(result.ok,false);assert.equal(result.code,"INVALID_FILE_TRANSACTION");assert.deepEqual(f.counts(),{legacy:0,transactions:1});
});
test("transaction intent must bind to requested operation, ref and hashes",async t=>{
 const value=observed("replace");
 for(const intent of [{...value.intent,source:{...value.intent.source,path:"other.txt"}},{...value.intent,expected_sha256:"0".repeat(64)},{...value.intent,after_sha256:"0".repeat(64)},observed("trash").intent]){
  const f=await fixture(t,{...value,intent});const result=await f.call("update_file",{content:"new\n"});assert.equal(result.ok,false);assert.equal(result.code,"INVALID_FILE_TRANSACTION");assert.deepEqual(f.counts(),{legacy:0,transactions:1});
 }
});

test("mutation routing snapshots caller ref before async read for update/edit/patch/trash",async()=>{
 const operations=[
  ["update",(io:NativeScopedFiles,ref:ScopedFileRef)=>updateFileWrite(io,ref,"new\n",expected)],
  ["edit",(io:NativeScopedFiles,ref:ScopedFileRef)=>editFileWrite(io,ref,"old","new",expected)],
  ["patch",(io:NativeScopedFiles,ref:ScopedFileRef)=>applyPatchWrite(io,ref,"--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",expected)],
  ["trash",(io:NativeScopedFiles,ref:ScopedFileRef)=>trashFileWrite(io,ref,expected)]
 ] as const;
 for(const [name,run] of operations){
  const ref:ScopedFileRef={workspace_id:"work",path:"a.txt"};let routedPath:string|undefined;
  const io:NativeScopedFiles={
   read:async()=>{(ref as {workspace_id:string;path:string}).path="other.txt";return {bytes:before,sha256:expected,kind:"file"};},
   createExclusive:async()=>{},replaceIfHash:async()=>{throw Error("legacy mutation must not run");},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{throw Error("legacy mutation must not run");},
   recoverableMutations:{
    replaceIfHash:async(r,bytes,hash)=>{routedPath=r.path;return observed("replace");},
    trashIfHash:async r=>{routedPath=r.path;return observed("trash");}
   }
  };
  await run(io,ref);assert.equal(routedPath,"a.txt",`${name} must route using the original workspace-relative path`);
 }
});

for(const status of ["CONFLICT","UNKNOWN"] as const)test(`batch reports ${status} as partial failure and stops before the next mutation`,async t=>{
 const outcome=observed("replace",status),f=await fixture(t,outcome);
 const response=await f.invoke("batch_file_operations",{workspace_id:"work",operations:[
  {name:"update_file",arguments:{path:"a.txt",content:"new\n",expected_sha256:expected}},
  {name:"create_file",arguments:{path:"later.txt",content:"later"}}
 ]});
 const envelope=JSON.parse(response.content[0]!.text);
 assert.equal(envelope.ok,true);assert.equal(response.isError,undefined);
 assert.equal(envelope.result.completed,0);assert.equal(envelope.result.partial,true);
 assert.deepEqual(envelope.result.outcomes,[{index:0,name:"update_file",ok:false,code:status==="CONFLICT"?"FILE_TRANSACTION_CONFLICT":"RESULT_UNKNOWN",result:outcome}]);
 assert.deepEqual(f.counts(),{legacy:0,transactions:1});
});

test("replacement after-hash is captured before the async adapter can mutate its byte buffer",async()=>{
 const ref:ScopedFileRef={workspace_id:"work",path:"a.txt"};
 const io:NativeScopedFiles={read:async()=>({bytes:before,sha256:expected,kind:"file"}),createExclusive:async()=>{},replaceIfHash:async()=>{throw Error("legacy mutation must not run");},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{throw Error("legacy mutation must not run");},recoverableMutations:{
  replaceIfHash:async(_ref,bytes)=>{bytes[0]=0;return observed("replace");},trashIfHash:async()=>observed("trash")
 }};
 const result=await updateFileWrite(io,ref,"new\n",expected);
 assert.equal((result as FileTransactionOutcome).status,"APPLIED");assert.equal((result as FileTransactionOutcome).intent.after_sha256,sha256(after));
});
