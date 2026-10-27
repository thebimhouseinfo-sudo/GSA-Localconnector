import assert from "node:assert/strict";
import {test} from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFile,type ChildProcessWithoutNullStreams} from "node:child_process";
import {promisify} from "node:util";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {WorkspaceReadSession} from "../src/core/workspace-read.js";
import {createReadOnlyTools} from "../src/mcp/server.js";

async function fixture(run:(root:string,session:WorkspaceReadSession,registry:WorkspaceRegistry)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"workspace-read-"));
 const registry=new WorkspaceRegistry();await registry.enrollTrusted("fixture",root,["read"]);
 const session=new WorkspaceReadSession(registry,"fixture");
 let passed=false;
 try{await run(root,session,registry);passed=true;}finally{
  // Keep failed fixtures, and never remove a root before owned-reader closure is confirmed.
  await session.dispose();
  if(passed)await fs.rm(root,{recursive:true,force:true});
 }
}
const posix={skip:process.platform==="win32"};
// Inspect the existing owned child only; no production injection or process lookup.
const ownedChild=(s:WorkspaceReadSession)=>(s as unknown as {child:ChildProcessWithoutNullStreams}).child;
test("bounded descriptor reader reads ordinary bytes and rejects oversized files",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"hello");
 assert.equal((await s.read("a",5)).toString(),"hello");
 await assert.rejects(s.read("a",4),/READ_LIMIT_EXCEEDED/);
}));
test("reader cleanup is awaitable and idempotent after a successful final close",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"hello");
 assert.equal((await s.read("a",5)).toString(),"hello");
 await s.finish();
 const cleanup=s.dispose();
 assert.ok(cleanup instanceof Promise);
 assert.equal(s.dispose(),cleanup);
 await cleanup;
 await assert.rejects(s.read("a",5),/SOURCE_UNVERIFIED/);
}));
test("reader abort cleanup confirms owned child close before resolving",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"hello");await s.read("a",5);
 let closed=false;ownedChild(s).once("close",()=>{closed=true;});
 await s.dispose();
 assert.equal(closed,true);
 await assert.rejects(s.finish(),/SOURCE_UNVERIFIED/);
}));
test("reader stdin failure rejects publication and still confirms child cleanup",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"hello");await s.read("a",5);
 let closed=false;const child=ownedChild(s);child.once("close",()=>{closed=true;});
 child.stdin.emit("error",new Error("synthetic owned pipe failure"));
 await assert.rejects(s.finish(),/SOURCE_UNVERIFIED/);
 await s.dispose();assert.equal(closed,true);
}));
test("reader child error rejects publication without an unhandled exit rejection",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"hello");await s.read("a",5);
 let closed=false;const child=ownedChild(s);child.once("close",()=>{closed=true;});
 child.emit("error",Object.assign(new Error("synthetic owned spawn error"),{code:"ENOENT"}));
 await assert.rejects(s.finish(),/SECURITY_BLOCKED/);
 await s.dispose();assert.equal(closed,true);
}));
test("reader request deadline stops and awaits its owned child",posix,async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 await fixture(async(root,s)=>{
  await fs.writeFile(path.join(root,"a"),"hello");await s.read("a",5);
  let closed=false;ownedChild(s).once("close",()=>{closed=true;});
  t.mock.timers.tick(30000);
  await assert.rejects(s.finish(),/READ_LIMIT_EXCEEDED/);
  await s.dispose();assert.equal(closed,true);
 });
});
test("unconfirmed cleanup returns a typed failure and preserves the fixture",posix,async t=>{
 let root="",child:ChildProcessWithoutNullStreams|undefined,closed=false;
 let originalKill:ChildProcessWithoutNullStreams["kill"]|undefined;
 let passed=false;
 try{
  await assert.rejects(fixture(async(ownedRoot,s)=>{
   root=ownedRoot;await fs.writeFile(path.join(root,"a"),"hello");await s.read("a",5);
   child=ownedChild(s);child.once("close",()=>{closed=true;});originalKill=child.kill;
   t.mock.method(child,"kill",()=>false);
   t.mock.timers.enable({apis:["setTimeout"]});
   const cleanup=s.dispose();
   const rejected=assert.rejects(cleanup,{code:"READ_CLEANUP_UNCONFIRMED"});
   await Promise.resolve();t.mock.timers.tick(1000);await rejected;
   assert.equal(s.dispose(),cleanup);
  }),{code:"READ_CLEANUP_UNCONFIRMED"});
  assert.equal(closed,false);assert.equal(await fs.readFile(path.join(root,"a"),"utf8"),"hello");
  passed=true;
 }finally{
  t.mock.timers.reset();t.mock.restoreAll();
  if(child&&!closed){
   const confirmed=new Promise<void>(resolve=>child!.once("close",()=>resolve()));
   originalKill!.call(child,"SIGKILL");
   let deadline:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([confirmed,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("TEST_CHILD_CLOSE_UNCONFIRMED")),1000);})]);}
   finally{if(deadline)clearTimeout(deadline);}
  }
  if(passed&&closed)await fs.rm(root,{recursive:true,force:true});
 }
});
test("reader rejects symlink ancestors",posix,async()=>fixture(async(root,s)=>{
 await fs.mkdir(path.join(root,"real"));await fs.writeFile(path.join(root,"real","a"),"secret");
 await fs.symlink("real",path.join(root,"alias"));await assert.rejects(s.read("alias/a",64));
}));
test("reader rejects multiply linked regular files in an independent session",posix,async()=>fixture(async(root,s)=>{
 await fs.mkdir(path.join(root,"real"));await fs.writeFile(path.join(root,"real","a"),"secret");
 await fs.link(path.join(root,"real","a"),path.join(root,"linked"));await assert.rejects(s.read("linked",64));
}));
test("replacement after buffered read prevents final publication",posix,async()=>fixture(async(root,s)=>{
 await fs.mkdir(path.join(root,"parent"));await fs.writeFile(path.join(root,"parent","a"),"old");
 await s.read("parent/a",64);await fs.rename(path.join(root,"parent"),path.join(root,"moved"));
 await fs.symlink("moved",path.join(root,"parent"));await assert.rejects(s.finish(),/SOURCE_UNVERIFIED/);
}));
test("file growth after buffered read prevents final publication",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"a");await s.read("a",1);
 await fs.appendFile(path.join(root,"a"),"more");await assert.rejects(s.finish(),/SOURCE_UNVERIFIED/);
}));
test("FIFO is rejected without waiting for a writer",posix,async()=>fixture(async(root,s)=>{
 await promisify(execFile)("/usr/bin/mkfifo",[path.join(root,"pipe")]);
 await assert.rejects(s.read("pipe",64),/SOURCE_UNVERIFIED/);
}));
test("bounded directory scan distinguishes exact limit from omitted entries",posix,async()=>fixture(async(root,s)=>{
 await fs.mkdir(path.join(root,"dir"));await fs.writeFile(path.join(root,"dir","a"),"");
 assert.equal((await s.list("dir",1)).truncated,false);
 assert.equal((await s.list("dir",1)).entries.length,1);
 await s.finish();
}));
test("directory overflow is explicitly reported and revocation withholds publication",posix,async()=>fixture(async(root,s,r)=>{
 await fs.writeFile(path.join(root,"a"),"");await fs.writeFile(path.join(root,"b"),"");
 const listing=await s.list(".",1);assert.equal(listing.entries.length,1);assert.equal(listing.truncated,true);
 r.revoke("fixture");await assert.rejects(s.finish());
}));
test("root replacement is rejected using the original grant pin",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"old");await s.read("a",64);
 const old=root+"-old";
 await fs.rename(root,old);
 let checked=false;
 try{await fs.mkdir(root);await assert.rejects(s.finish(),/SOURCE_UNVERIFIED/);checked=true;}
 finally{
  await s.dispose();
  if(checked){await fs.rm(root,{recursive:true,force:true});await fs.rename(old,root);}
 }
}));
test("metadata hashes only bounded regular files",posix,async()=>fixture(async(root,s)=>{
 await fs.writeFile(path.join(root,"a"),"a");
 assert.equal((await s.info("a")).base64,Buffer.from("a").toString("base64"));
 const large=await fs.open(path.join(root,"large"),"w");await large.truncate(8*1024*1024+1);await large.close();
 assert.equal((await s.info("large")).base64,undefined);
 await s.finish();
}));
test("protocol listing refuses overflow and glob advertises scan truncation",posix,async()=>fixture(async(root,_s,r)=>{
 await Promise.all(Array.from({length:501},(_,i)=>fs.writeFile(path.join(root,`f${i}`),"")));
 const invoke=createReadOnlyTools(r);
 const list=JSON.parse((await invoke({name:"list_directory",arguments:{workspace_id:"fixture",path:"."}})).content[0].text);
 assert.equal(list.ok,false);assert.equal(list.code,"READ_LIMIT_EXCEEDED");
 const glob=JSON.parse((await invoke({name:"glob",arguments:{workspace_id:"fixture",path:".",pattern:"*"}})).content[0].text);
 assert.equal(glob.ok,true);assert.equal(glob.result.entries.length,500);assert.equal(glob.result.truncated,true);
}));
test("search remembers dropped directory queue work",posix,async()=>fixture(async(root,_s,r)=>{
 await Promise.all(Array.from({length:101},(_,i)=>fs.mkdir(path.join(root,`d${i}`))));
 const response=JSON.parse((await createReadOnlyTools(r)({name:"search",arguments:{workspace_id:"fixture",path:".",query:"needle"}})).content[0].text);
 assert.equal(response.ok,true);assert.equal(response.result.truncated,true);
}));
test("search at the exact result limit is complete until another match is omitted",posix,async()=>fixture(async(root,_s,r)=>{
 await fs.writeFile(path.join(root,"a"),Array(100).fill("needle").join("\n"));
 const invoke=createReadOnlyTools(r);
 const call=()=>invoke({name:"search",arguments:{workspace_id:"fixture",path:".",query:"needle"}});
 const exact=JSON.parse((await call()).content[0].text);
 assert.equal(exact.ok,true);assert.equal(exact.result.matches.length,100);assert.equal(exact.result.truncated,false);
 await fs.appendFile(path.join(root,"a"),"\nneedle");
 const extra=JSON.parse((await call()).content[0].text);
 assert.equal(extra.ok,true);assert.equal(extra.result.matches.length,100);assert.equal(extra.result.truncated,true);
}));
test("search with exactly 100 matches remains complete across later nonmatching files",posix,async()=>fixture(async(root,s,r)=>{
 await fs.writeFile(path.join(root,"a"),"");await fs.writeFile(path.join(root,"b"),"");
 const listing=await s.list(".");await s.finish();
 assert.equal(listing.entries.length,2);
 await fs.writeFile(path.join(root,listing.entries[0].name),Array(100).fill("needle").join("\n"));
 await fs.writeFile(path.join(root,listing.entries[1].name),"no matching content");
 const call=()=>createReadOnlyTools(r)({name:"search",arguments:{workspace_id:"fixture",path:".",query:"needle"}});
 const exact=JSON.parse((await call()).content[0].text);
 assert.equal(exact.ok,true);assert.equal(exact.result.matches.length,100);
 assert.equal(exact.result.files_examined,2);assert.equal(exact.result.truncated,false);
 await fs.appendFile(path.join(root,listing.entries[1].name),"\nneedle");
 const extra=JSON.parse((await call()).content[0].text);
 assert.equal(extra.ok,true);assert.equal(extra.result.matches.length,100);assert.equal(extra.result.truncated,true);
}));
