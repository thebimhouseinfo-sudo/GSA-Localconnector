import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {NativeFileCandidate} from "../src/hosts/native-file-candidate.js";
test("native candidate read and exclusive create refuse traversal and symlinks",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-native-"));
 try{
  const root=path.join(tmp,"root");await fs.mkdir(root);
  await fs.writeFile(path.join(tmp,"secret"),"OUTSIDE");
  await fs.writeFile(path.join(root,"existing"),"INSIDE");
  const reg=new WorkspaceRegistry();
  await reg.enrollTrusted("w",root,["read","write"]);
  const candidate=new NativeFileCandidate(reg);
  assert.equal(Buffer.from((await candidate.readCandidate("w","existing")).bytes).toString(),"INSIDE");
  await candidate.createExclusiveCandidate("w","new.txt",Buffer.from("NEW"));
  await assert.rejects(candidate.createExclusiveCandidate("w","new.txt",Buffer.from("overwrite")));
  await assert.rejects(candidate.readCandidate("w","../secret"));
  await assert.rejects(candidate.readCandidate("w","existing:ads"));
  const link=path.join(root,"secret-link");
  try{await fs.symlink(path.join(tmp,"secret"),link);await assert.rejects(candidate.readCandidate("w","secret-link"));}
  catch(e){if((e as NodeJS.ErrnoException).code!=="EPERM")throw e;}
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
