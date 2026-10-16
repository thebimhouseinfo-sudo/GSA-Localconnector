import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import {sha256} from "../src/core/edit-guards.js";
import type {NativeScopedFiles,ScopedFileRef} from "../src/core/native-io.js";
test("MCP write requires both grant and injected verified file backend",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-write-"));
 try {
  const reg=new WorkspaceRegistry();await reg.enrollTrusted("a",tmp,["read"]);
  const blocked=createReadOnlyTools(reg);
  const denial=await blocked({name:"create_file",arguments:{workspace_id:"a",path:"f.txt",content:"x"}});
  assert.equal(JSON.parse(denial.content[0].text).code,"SECURITY_BLOCKED");
  const data=new Map<string,Uint8Array>();
  const k=(r:ScopedFileRef)=>r.workspace_id+"/"+r.path;
  const io:NativeScopedFiles={
   read:async r=>{const b=data.get(k(r));if(!b)throw Error("missing");return {bytes:b,sha256:sha256(b),kind:"file"};},
   createExclusive:async(r,b)=>{data.set(k(r),b);},replaceIfHash:async()=>{},makeDirectory:async()=>{},
   copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}
  };
  const call=createReadOnlyTools(reg,io);
  const noWrite=await call({name:"create_file",arguments:{workspace_id:"a",path:"f.txt",content:"x"}});
  assert.equal(noWrite.isError,true);
  await reg.enrollTrusted("a",tmp,["read","write"]);
  const ok=await call({name:"create_file",arguments:{workspace_id:"a",path:"f.txt",content:"x"}});
  assert.equal(ok.isError,undefined);assert.equal(JSON.parse(ok.content[0].text).result.committed,false);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
