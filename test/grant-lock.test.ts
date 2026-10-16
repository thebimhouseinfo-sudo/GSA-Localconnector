import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {enrollReadOnly,revokeTrusted,loadTrustedRegistry} from "../src/local/grants.js";

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
  await fs.writeFile(path.join(store,".trusted-workspaces.lock"),"held");
  await assert.rejects(enrollReadOnly("a",rootA,store),/GRANT_STORE_BUSY/);
  await fs.rm(path.join(store,".trusted-workspaces.lock"));
  assert.deepEqual((await loadTrustedRegistry(store)).list().map(x=>x.id),["b"]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
