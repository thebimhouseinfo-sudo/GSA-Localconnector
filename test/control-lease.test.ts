import {test as platformTest} from "node:test";
const test=(name:string,fn:()=>void|Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX ownership/mode storage test; Windows ACL backend unverified":false},fn);
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {ControlLeaseStore} from "../src/local/control-lease.js";
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-control-"));
 return {root,dir:path.join(root,"identity"),cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
const code=(expected:string)=>(error:any)=>error.code===expected;
test("cross-instance controller acquisition is exclusive and durable without plaintext credentials",async()=>{
 const f=await fixture();
 try{
  const stores=[new ControlLeaseStore(f.dir),new ControlLeaseStore(f.dir)];
  const outcomes=await Promise.allSettled(stores.map(store=>store.acquire()));
  const successes=outcomes.filter((outcome):outcome is PromiseFulfilledResult<Awaited<ReturnType<ControlLeaseStore['acquire']>>>=>outcome.status==="fulfilled");
  assert.equal(successes.length,1);
  const denied=outcomes.find(outcome=>outcome.status==="rejected") as PromiseRejectedResult;
  assert.ok(["SESSION_BUSY","CONTROL_LEASE_LOCKED"].includes(denied.reason.code));
  const lease=successes[0].value;
  assert.equal((await new ControlLeaseStore(f.dir).require(lease.control_token)).session_id,lease.session_id);
  await assert.rejects(new ControlLeaseStore(f.dir).acquire(),code("SESSION_BUSY"));
  const stored=await fs.readFile(path.join(f.dir,"control-lease.json"),"utf8");
  assert.equal(stored.includes(lease.control_token),false);
  const record=JSON.parse(stored);assert.match(record.token_sha256,/^[a-f0-9]{64}$/);
  assert.match(record.installation_id,/^[a-f0-9-]{36}$/);
  assert.equal((await fs.stat(f.dir)).mode&0o777,0o700);
  for(const name of ["control-lease.json","installation-id"])
   assert.equal((await fs.stat(path.join(f.dir,name))).mode&0o777,0o600);
 }finally{await f.cleanup();}
});
test("renew, expiry, release and reacquire preserve credential checks and monotonic revisions",async()=>{
 const f=await fixture();let now=1000;
 try{
  const store=new ControlLeaseStore(f.dir,100,()=>now),other=new ControlLeaseStore(f.dir,100,()=>now);
  const first=await store.acquire();assert.equal(first.expires_at,1100);assert.equal(first.revision,1);
  await assert.rejects(other.require("0".repeat(64)),code("SESSION_INVALID"));
  await assert.rejects(other.renew("wrong"),code("SESSION_INVALID"));
  await assert.rejects(other.release("wrong"),code("SESSION_INVALID"));
  now=1050;const renewed=await other.renew(first.control_token);
  assert.equal(renewed.expires_at,1150);assert.equal(renewed.revision,2);
  now=1150;await assert.rejects(store.require(first.control_token),code("SESSION_EXPIRED"));
  await assert.rejects(store.renew(first.control_token),code("SESSION_EXPIRED"));
  const second=await other.acquire();assert.equal(second.revision,3);assert.notEqual(second.session_id,first.session_id);
  await assert.rejects(store.require(first.control_token),code("SESSION_INVALID"));
  await store.release(second.control_token);
  await assert.rejects(store.require(second.control_token),code("SESSION_INVALID"));
  const third=await new ControlLeaseStore(f.dir,100,()=>now).acquire();assert.equal(third.revision,5);
 }finally{await f.cleanup();}
});
test("identity tampering, unsafe permissions and stale locks fail closed",async()=>{
 const f=await fixture();
 try{
  const store=new ControlLeaseStore(f.dir),first=await store.acquire();
  const identity=path.join(f.dir,"installation-id"),original=await fs.readFile(identity,"utf8");
  await fs.writeFile(identity,"11111111-1111-4111-8111-111111111111\n");
  await assert.rejects(store.require(first.control_token),code("SESSION_INVALID"));
  await fs.writeFile(identity,original);
  const record=path.join(f.dir,"control-lease.json");await fs.chmod(record,0o644);
  await assert.rejects(store.require(first.control_token),code("CONTROL_LEASE_UNSAFE"));
  await fs.chmod(record,0o600);
  await fs.writeFile(path.join(f.dir,"control-lease.lock"),"stale",{mode:0o600});
  await assert.rejects(store.renew(first.control_token),code("CONTROL_LEASE_LOCKED"));
  assert.equal((await fs.readFile(record,"utf8")).includes(first.control_token),false);
 }finally{await f.cleanup();}
});
test("symlink control paths never modify outside files",async()=>{
 for(const name of ["control-lease.json","installation-id","control-lease.lock"]){
  const f=await fixture();
  try{
   await fs.mkdir(f.dir,{mode:0o700});
   const outside=path.join(f.root,"outside");await fs.writeFile(outside,"unchanged",{mode:0o600});
   await fs.symlink(outside,path.join(f.dir,name));
   await assert.rejects(new ControlLeaseStore(f.dir).acquire(),code("CONTROL_LEASE_UNSAFE"));
   assert.equal(await fs.readFile(outside,"utf8"),"unchanged");
   assert.equal((await fs.readdir(f.dir)).some(file=>file.startsWith('.control-')),false);
  }finally{await f.cleanup();}
 }
 const f=await fixture();
 try{
  const outside=path.join(f.root,"outside-dir");await fs.mkdir(outside,{mode:0o700});
  await fs.symlink(outside,f.dir);
  await assert.rejects(new ControlLeaseStore(f.dir).acquire(),code("CONTROL_LEASE_UNSAFE"));
  assert.deepEqual(await fs.readdir(outside),[]);
 }finally{await f.cleanup();}
});
test("malformed records, nonregular paths and weakened directory or identity modes are refused",async()=>{
 const f=await fixture();
 try{
  const store=new ControlLeaseStore(f.dir),first=await store.acquire();
  const record=path.join(f.dir,"control-lease.json"),original=await fs.readFile(record,"utf8");
  await fs.writeFile(record,"{broken");
  await assert.rejects(store.require(first.control_token),code("CONTROL_LEASE_UNSAFE"));
  await fs.writeFile(record,original);await fs.chmod(f.dir,0o755);
  await assert.rejects(store.acquire(),code("CONTROL_LEASE_UNSAFE"));
  await fs.chmod(f.dir,0o700);
  const identity=path.join(f.dir,"installation-id");await fs.chmod(identity,0o640);
  await assert.rejects(store.require(first.control_token),code("CONTROL_LEASE_UNSAFE"));
  await fs.chmod(identity,0o600);
  await fs.rm(record);await fs.mkdir(record,{mode:0o700});
  await assert.rejects(store.acquire(),code("CONTROL_LEASE_UNSAFE"));
  assert.equal((await fs.readdir(f.dir)).includes("control-lease.lock"),false);
 }finally{await f.cleanup();}
});
test("one controller can authorize simultaneous operations through its shared store",async()=>{
 const f=await fixture();
 try{
  const store=new ControlLeaseStore(f.dir),lease=await store.acquire();
  const checks=await Promise.allSettled([store.require(lease.control_token),store.require(lease.control_token),store.renew(lease.control_token)]);
  assert.deepEqual(checks.map(check=>check.status),["fulfilled","fulfilled","fulfilled"]);
 }finally{await f.cleanup();}
});
