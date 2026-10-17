import {test as platformTest} from "node:test";
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX ownership/mode storage test; Windows ACL backend unverified":false},fn);
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {enrollReadOnly,loadTrustedRegistry,revokeTrusted,requirePersistedGrant,enrollExecute} from "../src/local/grants.js";
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
test("restart rejects a replaced root until explicit enrollment and preserves revision epochs",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-restart-"));
 try{
  const dir=path.join(tmp,"identity"),root=path.join(tmp,"project");await fs.mkdir(root);
  await enrollReadOnly("A",root,dir);
  const first=(await loadTrustedRegistry(dir)).requireGrant("A","read");assert.equal(first.revision,1);
  await enrollReadOnly("A",root,dir);
  const second=(await loadTrustedRegistry(dir)).requireGrant("A","read");assert.equal(second.revision,2);
  await fs.rename(root,root+"-original");await fs.mkdir(root);
  await assert.rejects(loadTrustedRegistry(dir),/identity changed|SOURCE_UNVERIFIED/);
  await enrollReadOnly("A",root,dir);
  const third=(await loadTrustedRegistry(dir)).requireGrant("A","read");
  assert.equal(third.revision,3);assert.notEqual(third.rootIdentity.inode,first.rootIdentity.inode);
  await revokeTrusted("A",dir);assert.deepEqual((await loadTrustedRegistry(dir)).list(),[]);
  await enrollReadOnly("A",root,dir);
  assert.equal((await loadTrustedRegistry(dir)).requireGrant("A","read").revision,5);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test("legacy grants cannot silently authorize a freshly observed root",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-legacy-"));
 try{
  const dir=path.join(tmp,"identity"),root=path.join(tmp,"project");await fs.mkdir(dir,{mode:0o700});await fs.mkdir(root);
  await fs.writeFile(path.join(dir,"trusted-workspaces.json"),JSON.stringify([{id:"A",root,permissions:["read","write","execute"]}]),{mode:0o600});
  assert.deepEqual((await loadTrustedRegistry(dir)).list(),[]);
  await enrollReadOnly("A",root,dir);
  const grant=(await loadTrustedRegistry(dir)).requireGrant("A","read");assert.deepEqual(grant.permissions,["read"]);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test("protected grant reads reject symlinks and group-readable state",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-protected-"));
 try{
  const dir=path.join(tmp,"identity"),root=path.join(tmp,"project");await fs.mkdir(root);await enrollReadOnly("A",root,dir);
  const file=path.join(dir,"trusted-workspaces.json");await fs.chmod(file,0o644);
  await assert.rejects(loadTrustedRegistry(dir),/UNSAFE_GRANT_STORE/);
  await fs.chmod(file,0o600);await fs.rename(file,file+"-original");await fs.symlink(file+"-original",file);
  await assert.rejects(loadTrustedRegistry(dir),/UNSAFE_GRANT_STORE/);
  await assert.rejects(enrollReadOnly("A",root,dir),/UNSAFE_GRANT_STORE/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("native grant rechecks observe persisted revocation and reject an old controller epoch",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-live-"));
 try{
  const dir=path.join(tmp,"identity"),root=path.join(tmp,"project");await fs.mkdir(root);await enrollReadOnly("A",root,dir);
  const file=path.join(dir,"trusted-workspaces.json");
  // Execution permission is a trusted local administrative edit, never an MCP grant.
  const entries=JSON.parse(await fs.readFile(file,"utf8"));entries[0].permissions=["read","execute"];
  await fs.writeFile(file,JSON.stringify(entries));
  const live=await loadTrustedRegistry(dir);
  assert.equal((await requirePersistedGrant(live,"A",dir)).revision,1);
  await revokeTrusted("A",dir);
  await assert.rejects(requirePersistedGrant(live,"A",dir),/WORKSPACE_GRANT_REVOKED/);
  await enrollReadOnly("A",root,dir);
  const refreshed=JSON.parse(await fs.readFile(file,"utf8"));refreshed[0].permissions=["read","execute"];
  await fs.writeFile(file,JSON.stringify(refreshed));
  await assert.rejects(requirePersistedGrant(live,"A",dir),/WORKSPACE_GRANT_CHANGED/);
  assert.equal((await requirePersistedGrant(await loadTrustedRegistry(dir),"A",dir)).revision,3);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test("trusted local execute enrollment pins only its explicit root and advances durable revisions",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-grants-execute-"));
 try{
  const dir=path.join(tmp,"identity"),root=path.join(tmp,"project"),sibling=path.join(tmp,"sibling");await fs.mkdir(root);await fs.mkdir(sibling);
  await enrollReadOnly("A",root,dir);await enrollExecute("A",root,dir);
  const live=await loadTrustedRegistry(dir),grant=live.requireGrant("A","execute");
  assert.deepEqual(grant.permissions,["read","execute"]);assert.equal(grant.revision,2);
  assert.equal((await requirePersistedGrant(live,"A",dir)).revision,2);
  assert.equal(live.list().length,1);assert.notEqual(grant.canonicalRoot,await fs.realpath(sibling));
  await enrollReadOnly("A",root,dir);
  assert.throws(()=>(live.requireGrant("A","write")));
  await assert.rejects(requirePersistedGrant(live,"A",dir),/WORKSPACE_GRANT_REVOKED/);
  assert.equal((await loadTrustedRegistry(dir)).requireGrant("A","read").revision,3);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
