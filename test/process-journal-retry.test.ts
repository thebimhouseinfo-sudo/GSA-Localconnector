import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {ProcessJournalStore} from "../src/local/process-store.js";
import {createReadOnlyTools} from "../src/mcp/server.js";

const factory=createReadOnlyTools as unknown as (...args:any[])=>((call:any)=>Promise<any>);
const decode=(value:any)=>JSON.parse(value.content[0].text);
const skip=process.platform==="win32"?"POSIX ProcessJournalStore mode semantics":false;

async function fixture(failures:number){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-journal-retry-"));
 await fs.chmod(root,0o700);
 const work=path.join(root,"work");await fs.mkdir(work,{mode:0o700});
 const registry=new WorkspaceRegistry();
 await registry.enrollTrusted("A",work,["read","execute"]);
 const store=new ProcessJournalStore(path.join(root,"process-runs"));
 const real=store.list.bind(store);
 let calls=0,remaining=failures;
 store.list=async()=>{calls++;if(remaining===Infinity||remaining-->0)throw Error("journal read failed");return real();};
 const invoke=factory(registry,null,null,null,null,null,null,null,null,null,null,{processPersistence:{store,ownerSession:randomUUID()}});
 return {root,invoke,calls:()=>calls};
}

test("a transient journal load error is retried on the next process-tool call",{skip},async t=>{
 const f=await fixture(1);t.after(()=>fs.rm(f.root,{recursive:true,force:true}));
 const first=decode(await f.invoke({name:"list_processes",arguments:{workspace_id:"A"}}));
 assert.equal(first.ok,false);assert.equal(first.code,"PROCESS_JOURNAL_UNAVAILABLE");
 const second=decode(await f.invoke({name:"list_processes",arguments:{workspace_id:"A"}}));
 assert.equal(second.ok,true,JSON.stringify(second));
 assert.equal(f.calls(),2);
});

test("a persistent journal failure leaves diagnostics available and degraded",{skip},async t=>{
 const f=await fixture(Infinity);t.after(()=>fs.rm(f.root,{recursive:true,force:true}));
 for(let i=0;i<2;i++){
  const status=decode(await f.invoke({name:"connector_status",arguments:{}}));
  assert.equal(status.ok,true,JSON.stringify(status));
  assert.equal(status.result.processHistoryState,"DEGRADED");
 }
 const list=decode(await f.invoke({name:"list_processes",arguments:{workspace_id:"A"}}));
 assert.equal(list.ok,false);assert.equal(list.code,"PROCESS_JOURNAL_UNAVAILABLE");
});

test("concurrent process calls during one load cause a single journal list",{skip},async t=>{
 const f=await fixture(0);t.after(()=>fs.rm(f.root,{recursive:true,force:true}));
 const results=await Promise.all([1,2,3].map(()=>f.invoke({name:"list_processes",arguments:{workspace_id:"A"}})));
 assert.ok(results.every(r=>decode(r).ok===true));
 assert.equal(f.calls(),1);
});

test("an uncoded error escaping dispatch maps to INTERNAL_ERROR, not SESSION_INVALID",{skip},async t=>{
 const f=await fixture(0);t.after(()=>fs.rm(f.root,{recursive:true,force:true}));
 const registry=new WorkspaceRegistry();
 const controls={require:async()=>{throw Error("boom");}};
 const invoke=factory(registry,null,null,null,null,null,null,null,null,null,controls,{});
 const out=decode(await invoke({name:"create_file",arguments:{control_token:"x"}}));
 assert.equal(out.ok,false);assert.equal(out.code,"INTERNAL_ERROR");
 assert.equal(out.message,"boom");
});
