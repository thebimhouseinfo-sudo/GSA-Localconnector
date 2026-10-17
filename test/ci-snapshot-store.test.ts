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
test("verified workflow reads reject absent paths, traversal, and changed captured bytes",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-ci-read-"));
 try{
  const store=new CiSnapshotStore(path.join(tmp,"snapshots")),id=randomUUID();
  await store.persist(id,[{path:"ci.json",bytes:Buffer.from("captured")}]);
  assert.equal((await store.readVerifiedFile(id,"ci.json")).toString(),"captured");
  await assert.rejects(store.readVerifiedFile(id,"../ci.json"));
  await assert.rejects(store.readVerifiedFile(id,"missing.json"),/not in captured source/);
  const file=path.join(tmp,"snapshots",id,"files","ci.json");
  await fs.chmod(file,0o600);await fs.writeFile(file,"modified");
  await assert.rejects(store.readVerifiedFile(id,"ci.json"),(e:any)=>e.code==="SNAPSHOT_INTEGRITY");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test("verified snapshot export includes files over workflow limit and detects changed bytes",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-ci-export-"));try{
  const store=new CiSnapshotStore(tmp),id=randomUUID(),bytes=Buffer.alloc(100000,65);
  await store.persist(id,[{path:"large.bin",bytes}]);
  await assert.rejects(store.readVerifiedFile(id,"large.bin"),/Workflow exceeds/);
  const entries=await store.readVerifiedEntries(id);assert.equal(entries[0].path,"large.bin");assert.deepEqual(entries[0].bytes,bytes);
  const file=path.join(tmp,id,"files","large.bin");await fs.chmod(file,0o600);await fs.writeFile(file,Buffer.alloc(100000,66));
  await assert.rejects(store.readVerifiedEntries(id),(e:any)=>e.code==="SNAPSHOT_INTEGRITY");
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
