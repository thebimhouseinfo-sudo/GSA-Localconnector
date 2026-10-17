import {test as platformTest} from "node:test";
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX ownership/mode storage test; Windows ACL backend unverified":false},fn);
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {enrollReadOnly,enrollReadOnlyBatch,revokeTrusted,loadTrustedRegistry} from "../src/local/grants.js";

test("grant enroll/revoke are serialized and persisted",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grantlock-"));
 try{
  const rootA=path.join(dir,"a"),rootB=path.join(dir,"b"),store=path.join(dir,"identity");
  await fs.mkdir(rootA);await fs.mkdir(rootB);
  await enrollReadOnly("a",rootA,store);
  await enrollReadOnly("b",rootB,store);
  assert.deepEqual((await loadTrustedRegistry(store)).list().map(x=>x.id).sort(),["a","b"]);
  await assert.rejects(enrollReadOnly("c",rootA,store),/WORKSPACE_DUPLICATE_ROOT/);
  await revokeTrusted("a",store);
  assert.deepEqual((await loadTrustedRegistry(store)).list().map(x=>x.id),["b"]);
  await fs.writeFile(path.join(store,".trusted-workspaces.lock"),"held",{mode:0o600});
  await assert.rejects(enrollReadOnly("a",rootA,store),/GRANT_STORE_BUSY/);
  await fs.rm(path.join(store,".trusted-workspaces.lock"));
  assert.deepEqual((await loadTrustedRegistry(store)).list().map(x=>x.id),["b"]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("multi-root enrollment is atomic on invalid root",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-batch-grants-"));
 try{
  const root=path.join(dir,"valid"),store=path.join(dir,"store");
  await fs.mkdir(root);
  await assert.rejects(enrollReadOnlyBatch([{id:"valid",root},{id:"missing",root:path.join(dir,"missing")}],store));
  assert.deepEqual((await loadTrustedRegistry(store)).list(),[]);
  const result=await enrollReadOnlyBatch([{id:"valid",root}],store);
  assert.equal(result.length,1);
  assert.equal((await loadTrustedRegistry(store)).list().length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
