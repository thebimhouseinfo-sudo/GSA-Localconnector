import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {enrollReadOnly,loadTrustedRegistry,revokeTrusted} from "../src/local/grants.js";
test("trusted store loads, grants read only, revokes",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-"));
 try{
  const dir=path.join(tmp,"host"),root=path.join(tmp,"workspace");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root,"hi.txt"),"hello");
  await enrollReadOnly("project-a",root,dir);
  const reg=await loadTrustedRegistry(dir);
  assert.equal(reg.list().length,1);
  assert.equal(await fs.readFile(await reg.resolveExistingRead("project-a","hi.txt"),"utf8"),"hello");
  assert.throws(()=>reg.requireGrant("project-a","execute"));
  await revokeTrusted("project-a",dir);
  assert.deepEqual((await loadTrustedRegistry(dir)).list(),[]);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test("invalid grant store fails closed",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-bad-grants-"));
 try{await fs.writeFile(path.join(tmp,"trusted-workspaces.json"),"not json");
 await assert.rejects(()=>loadTrustedRegistry(tmp));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
