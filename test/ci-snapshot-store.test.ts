import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
test("protected CI reference snapshot is immutable and tamper-evident",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-ci-snapshot-"));
 try{
  const store=new CiSnapshotStore(path.join(tmp,"snapshots"));
  const id=randomUUID(),entries=[{path:"src/index.ts",bytes:Buffer.from("const x=1;")},{path:"README.md",bytes:Buffer.from("readme")}];
  const manifest=await store.persist(id,entries);
  assert.equal((await store.verify(id)).source_sha256,manifest.source_sha256);
  await assert.rejects(store.persist(id,entries),(e:any)=>e.code==="SNAPSHOT_EXISTS");
  await fs.chmod(path.join(tmp,"snapshots",id,"files","README.md"),0o600);
  await fs.writeFile(path.join(tmp,"snapshots",id,"files","README.md"),"tampered");
  await assert.rejects(store.verify(id),(e:any)=>e.code==="SNAPSHOT_INTEGRITY");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
