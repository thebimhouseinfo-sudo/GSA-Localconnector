import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CiSnapshotStore} from "../src/local/ci-snapshot-store.js";
import {CiWorkingCopyStore} from "../src/local/ci-working-copy.js";

test("CI writable working copy cannot change immutable source snapshot",async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-workcopy-"));
 try{
  const reference=path.join(temp,"reference"),working=path.join(temp,"working");
  const source=new CiSnapshotStore(reference);
  const id=randomUUID();
  const manifest=await source.persist(id,[{path:"src/code.ts",bytes:Buffer.from("const original=1;")}]);
  const work=new CiWorkingCopyStore(reference,working);
  const receipt=await work.create(id);
  assert.equal(receipt.source_sha256,manifest.source_sha256);
  assert.equal(receipt.verified,false);
  const edited=path.join(receipt.working_dir,"src","code.ts");
  await fs.writeFile(edited,"const changed=2;");
  const verified=await source.verify(id);
  assert.equal(verified.source_sha256,manifest.source_sha256);
  const original=await fs.readFile(path.join(reference,id,"files","src","code.ts"),"utf8");
  assert.equal(original,"const original=1;");
  await assert.rejects(work.create(id),(e:any)=>e.code==="WORKING_COPY_EXISTS");
  assert.throws(()=>new CiWorkingCopyStore(reference,path.join(reference,"sub")),(e:any)=>e.code==="INVALID_ROOT");
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
