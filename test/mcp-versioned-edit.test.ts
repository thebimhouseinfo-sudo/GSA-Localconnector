import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {dispatchFileMutation} from "../src/mcp/write-dispatch.js";
import {sha256} from "../src/core/edit-guards.js";
import type {NativeScopedFiles,ScopedFileRef} from "../src/core/native-io.js";
const encode=(s:string)=>Buffer.from(s,"utf8");
async function fixture(fn:(registry:WorkspaceRegistry,io:NativeScopedFiles,files:Map<string,Buffer>)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-versioned-edit-"));
 try{
  const source=path.join(root,"source"),destination=path.join(root,"destination");
  await fs.mkdir(source);await fs.mkdir(destination);
  const registry=new WorkspaceRegistry();
  const src=await registry.enrollTrusted("source",source,["read"]);
  const dst=await registry.enrollTrusted("dest",destination,["read","write"]);
  // Explicit workspace roles required by real production. Synthetic legacy roles
  // retain the same native create-only boundary for these functional tests.
  void src;void dst;
  const files=new Map<string,Buffer>();
  const key=(r:ScopedFileRef)=>r.workspace_id+"/"+r.path;
  const io:NativeScopedFiles={
   supportedOperations:["create_file","create_directory","copy_file"],
   read:async r=>{const data=files.get(key(r));if(!data)throw Error("NOT_FOUND");return {bytes:Buffer.from(data),sha256:sha256(data),kind:"file"};},
   createExclusive:async(r,data)=>{if(files.has(key(r)))throw Error("DESTINATION_EXISTS");files.set(key(r),Buffer.from(data));},
   replaceIfHash:async()=>{throw Error("MUST_NOT_REPLACE");},trashIfHash:async()=>{throw Error("MUST_NOT_TRASH");},
   moveExclusive:async()=>{throw Error("MUST_NOT_MOVE");},copyExclusive:async()=>{throw Error("MUST_NOT_COPY");},
   makeDirectory:async()=>{}
  };
  await fn(registry,io,files);
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
const argumentsFor=(expected_sha256:string)=>({
 source_workspace_id:"source",source_path:"draft.txt",destination_workspace_id:"dest",destination_path:"draft-v2.txt",
 old_text:"version one",new_text:"version two",expected_sha256
});
test("BASE-only edit-as-new-version leaves source immutable and returns new SHA",async()=>fixture(async(registry,io,files)=>{
 const original=encode("header\nversion one\n");files.set("source/draft.txt",original);
 const result=await dispatchFileMutation("edit_file_as_new_version",argumentsFor(sha256(original)),registry,io);
 assert.ok("source_sha256" in result && "after_sha256" in result && "file_mutated" in result);
 assert.equal(result.source_sha256,sha256(original));assert.equal(result.after_sha256,sha256(encode("header\nversion two\n")));
 assert.equal(result.committed,false);assert.equal(result.file_mutated,true);
 assert.deepEqual(files.get("source/draft.txt"),original);
 assert.equal(files.get("dest/draft-v2.txt")?.toString(),"header\nversion two\n");
}));
test("stale source hash refuses to create destination",async()=>fixture(async(registry,io,files)=>{
 files.set("source/draft.txt",encode("version one"));
 await assert.rejects(dispatchFileMutation("edit_file_as_new_version",argumentsFor("0".repeat(64)),registry,io),{code:"HASH_CONFLICT"});
 assert.equal(files.has("dest/draft-v2.txt"),false);
}));
test("nonunique exact edit refuses to create destination",async()=>fixture(async(registry,io,files)=>{
 const value=encode("version one; version one");files.set("source/draft.txt",value);
 await assert.rejects(dispatchFileMutation("edit_file_as_new_version",argumentsFor(sha256(value)),registry,io),{code:"MATCH_CONFLICT"});
 assert.equal(files.has("dest/draft-v2.txt"),false);
}));
test("existing destination is never overwritten, even on valid source edit",async()=>fixture(async(registry,io,files)=>{
 const value=encode("version one");files.set("source/draft.txt",value);files.set("dest/draft-v2.txt",encode("protected"));
 await assert.rejects(dispatchFileMutation("edit_file_as_new_version",argumentsFor(sha256(value)),registry,io),/DESTINATION_EXISTS/);
 assert.equal(files.get("dest/draft-v2.txt")?.toString(),"protected");
}));
test("incomplete native capability cannot enable edit-as-new-version",async()=>fixture(async(registry,io,files)=>{
 const value=encode("version one");files.set("source/draft.txt",value);
 const limited:NativeScopedFiles={...io,supportedOperations:["copy_file"]};
 await assert.rejects(dispatchFileMutation("edit_file_as_new_version",argumentsFor(sha256(value)),registry,limited),/SECURITY_BLOCKED/);
}));

test("unverifiable post-create readback reports RESULT_UNKNOWN without retry or deleting the new version",async()=>fixture(async(registry,io,files)=>{
 const value=encode("version one");files.set("source/draft.txt",value);
 const originalRead=io.read.bind(io);
 let creates=0;
 const modified:NativeScopedFiles={...io,
  read:async ref=>{if(ref.workspace_id==="dest")throw Error("READBACK_FAILED");return originalRead(ref,8*1024*1024);},
  createExclusive:async(ref,bytes)=>{creates++;files.set(ref.workspace_id+"/"+ref.path,Buffer.from(bytes));}
 };
 await assert.rejects(dispatchFileMutation("edit_file_as_new_version",argumentsFor(sha256(value)),registry,modified),{code:"RESULT_UNKNOWN"});
 assert.equal(creates,1);
 assert.equal(files.get("source/draft.txt")?.toString(),"version one");
 assert.equal(files.get("dest/draft-v2.txt")?.toString(),"version two");
}));
