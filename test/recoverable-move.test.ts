import {test} from "node:test";
import assert from "node:assert/strict";
import {moveFile} from "../src/core/write-engine.js";
import {sha256} from "../src/core/edit-guards.js";
import type {FileTransactionOutcome,FileTransactionStatus} from "../src/core/file-transactions.js";
import type {NativeScopedFiles,ScopedFileRef} from "../src/core/native-io.js";
const src={workspace_id:"source",path:"old.txt"},dst={workspace_id:"dest",path:"new.txt"};
const bytes=Buffer.from("preserve this source");
const hash=sha256(bytes);
const name=(r:ScopedFileRef)=>r.workspace_id+"/"+r.path;
const uuid="12345678-1234-4123-8123-123456789012";
const pin={device:"1",inode:"2"};
function outcome(status:FileTransactionStatus):FileTransactionOutcome{
 const success=status==="APPLIED";
 return {
  transaction_id:uuid,status,intent:{operation:"trash",source:{...src,revision:1,rootIdentity:pin},destination:null,expected_sha256:hash,after_sha256:null},
  observations:{captured:success?true:null,published:null,source_absent:success?true:null,destination_present:null,source_sha256:null,destination_sha256:null,capturedIdentity:success?pin:null,publishedIdentity:null},
  retained_handles:success?[uuid]:[],
  reason:success?"VERIFIED_READBACK":status==="CONFLICT"?"HASH_CONFLICT":"IO_UNCERTAIN"
 };
}
function fixture(status:FileTransactionStatus="APPLIED"){
 const data=new Map([[name(src),Buffer.from(bytes)]]),calls={copy:0,trash:0};
 const io:NativeScopedFiles={
  supportedOperations:["create_file","copy_file","move_file"],
  async read(ref,max){const b=data.get(name(ref));if(!b||b.length>max)throw Error("NOT_FOUND");return {bytes:b,sha256:sha256(b),kind:"file"};},
  async createExclusive(ref,content){if(data.has(name(ref)))throw Error("CONFLICT");data.set(name(ref),Buffer.from(content));},
  async copyExclusive(source,dest,expected){calls.copy++;const b=data.get(name(source));if(!b||sha256(b)!==expected||data.has(name(dest)))throw Error("COPY_CONFLICT");data.set(name(dest),Buffer.from(b));},
  async replaceIfHash(){throw Error("legacy replace forbidden");},
  async makeDirectory(){throw Error("unneeded");},
  async moveExclusive(){throw Error("unsafe legacy move forbidden");},
  async trashIfHash(){throw Error("unsafe legacy trash forbidden");},
  recoverableMutations:{
   async replaceIfHash(){throw Error("unneeded");},
   async trashIfHash(ref,expected){calls.trash++;assert.deepEqual(ref,src);assert.equal(expected,hash);if(status==="APPLIED")data.delete(name(src));return outcome(status);}
  }
 };
 return {io,data,calls};
}
test("recoverable move returns APPLIED only after verified copy and journalled trash",async()=>{
 const f=fixture();
 const result=await moveFile(f.io,src,dst,hash);
 assert.equal("status" in result&&result.status,"APPLIED");
 assert.equal("source_transaction" in result&&result.source_transaction?.transaction_id,uuid);
 assert.equal(f.data.has(name(src)),false);
 assert.deepEqual(f.data.get(name(dst)),bytes);
 assert.deepEqual(f.calls,{copy:1,trash:1});
});
test("source conflict after destination copy preserves both entries and returns CONFLICT",async()=>{
 const f=fixture("CONFLICT");const result=await moveFile(f.io,src,dst,hash);
 assert.equal("status" in result&&result.status,"CONFLICT");assert.deepEqual(f.data.get(name(src)),bytes);
 assert.deepEqual(f.data.get(name(dst)),bytes);
 assert.equal(f.calls.trash,1);
});
test("UNKNOWN trash result never becomes successful or triggers replay/rollback",async()=>{
 const f=fixture("UNKNOWN");const result=await moveFile(f.io,src,dst,hash);
 assert.equal("status" in result&&result.status,"UNKNOWN");
 assert.equal("reason" in result&&result.reason,"SOURCE_UNKNOWN");
 assert.deepEqual(f.data.get(name(dst)),bytes);assert.equal(f.calls.trash,1);
});
test("destination conflict does not attempt source removal or alter existing destination",async()=>{
 const f=fixture();f.data.set(name(dst),Buffer.from("neighbor"));
 await assert.rejects(moveFile(f.io,src,dst,hash),/COPY_CONFLICT/);
 assert.deepEqual(f.data.get(name(dst)),Buffer.from("neighbor"));
 assert.deepEqual(f.data.get(name(src)),bytes);assert.equal(f.calls.trash,0);
});
test("post-copy readback uncertainty retains the source and reports partial destination",async()=>{
 const f=fixture();const read=f.io.read.bind(f.io);
 f.io.read=async(ref,max)=>{if(name(ref)===name(dst))throw Error("READ_UNAVAILABLE");return read(ref,max);};
 const result=await moveFile(f.io,src,dst,hash);
 assert.equal("status" in result&&result.status,"UNKNOWN");
 assert.equal("reason" in result&&result.reason,"DESTINATION_UNKNOWN");
 assert.equal(f.calls.trash,0);
 assert.deepEqual(f.data.get(name(src)),bytes);assert.deepEqual(f.data.get(name(dst)),bytes);
});
test("exception after verified copy returns UNKNOWN and never deletes the destination",async()=>{
 const f=fixture();f.io.recoverableMutations!.trashIfHash=async()=>{f.calls.trash++;throw Error("TRANSPORT_LOST");};
 const result=await moveFile(f.io,src,dst,hash);
 assert.equal("status" in result&&result.status,"UNKNOWN");
 assert.equal("reason" in result&&result.reason,"SOURCE_ERROR");
 assert.deepEqual(f.data.get(name(dst)),bytes);assert.equal(f.calls.trash,1);
});
test("move rejects source=destination and stale content without any mutation",async()=>{
 const f=fixture();
 await assert.rejects(moveFile(f.io,src,src,hash),/differ/);
 await assert.rejects(moveFile(f.io,src,dst,"0".repeat(64)));
 assert.deepEqual(f.calls,{copy:0,trash:0});
});
