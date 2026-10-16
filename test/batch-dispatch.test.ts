import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {batchFileOperations} from "../src/mcp/batch-dispatch.js";
import type {NativeScopedFiles,ScopedFileRef} from "../src/core/native-io.js";
test("batch returns truthful partial outcome and stops after first failure",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"batch-test-"));
 try{
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("ws",tmp,["read","write"]);
  const store=new Map<string,Uint8Array>();
  const key=(r:ScopedFileRef)=>r.workspace_id+"/"+r.path;
  const io:NativeScopedFiles={
   read:async()=>{throw Error("unused");},
   createExclusive:async(r,b)=>{if(store.has(key(r)))throw Error("EXISTS");store.set(key(r),b);},
   replaceIfHash:async()=>{},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}
  };
  const result=await batchFileOperations(reg,io,"ws",[
   {name:"create_file",arguments:{path:"a.txt",content:"first"}},
   {name:"create_file",arguments:{path:"a.txt",content:"second"}},
   {name:"create_file",arguments:{path:"b.txt",content:"never"}}
  ]);
  assert.equal(result.completed,1);assert.equal(result.partial,true);assert.equal(result.atomic,false);
  assert.equal(store.has("ws/b.txt"),false);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
