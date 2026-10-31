import {test} from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const run=promisify(execFile);
test("glob returns without blocking on many interleaved wildcard stars",{skip:process.platform==="win32",timeout:6000},async()=>{
 const script=`
 import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
 import {WorkspaceRegistry} from './dist/src/core/workspace.js';
 import {createReadOnlyTools} from './dist/src/mcp/server.js';
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-glob-'));
 try {
  await fs.writeFile(path.join(root,'a'.repeat(60)),'');
  await fs.writeFile(path.join(root,'a+b.txt'),'');
  const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',root,['read']);
  const invoke=createReadOnlyTools(registry);
  const call=async pattern=>JSON.parse((await invoke({name:'glob',arguments:{workspace_id:'A',path:'.',pattern}})).content[0].text);
  console.log(JSON.stringify([await call('*a'.repeat(25)+'*b'),await call('a+?.txt'),await call('*')]));
 } finally {await fs.rm(root,{recursive:true,force:true});}
 `;
 const {stdout}=await run(process.execPath,["--input-type=module","-e",script],{timeout:3000,killSignal:"SIGKILL"});
 const [hostile,literal,all]=JSON.parse(stdout);
 assert.equal(hostile.ok,true);assert.deepEqual(hostile.result.entries,[]);
 assert.deepEqual(literal.result.entries,[{name:"a+b.txt",kind:"file"}]);
 assert.equal(all.result.entries.length,2);
});
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {createReadOnlyTools} from '../src/mcp/server.js';
test('fetch_file pages source files above 64 KiB and defaults to 500 lines',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-fetch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const lines=Array.from({length:2000},(_,i)=>`${i}: ${'x'.repeat(80)}`);await fs.writeFile(path.join(root,'large.txt'),lines.join('\n'));
 const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',root,['read']);const invoke=createReadOnlyTools(registry);
 const call=async(args:object)=>JSON.parse((await invoke({name:'fetch_file',arguments:{workspace_id:'A',path:'large.txt',...args}})).content[0].text);
 const page=await call({start_line:100,max_lines:50});assert.equal(page.ok,true);
 assert.equal(page.result.text,lines.slice(99,149).join('\n'));assert.equal(page.result.total_lines,2000);assert.equal(page.result.truncated,true);
 const first=await call({});assert.equal(first.result.end_line,500);assert.equal(first.result.text.split('\n').length,500);assert.equal(first.result.truncated,true);
});
test('search reports hidden paths it skipped instead of claiming a complete negative',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-hidden-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'.github'));await fs.writeFile(path.join(root,'.github','workflow.yml'),'needle');
 await fs.writeFile(path.join(root,'.env.example'),'needle');await fs.writeFile(path.join(root,'visible.txt'),'ordinary');
 const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',root,['read']);
 const response=JSON.parse((await createReadOnlyTools(registry)({name:'search',arguments:{workspace_id:'A',path:'.',query:'needle'}})).content[0].text);
 assert.equal(response.ok,true);assert.deepEqual(response.result.matches,[]);assert.equal(response.result.skipped_hidden,2);assert.equal(response.result.truncated,true);assert.equal(response.result.files_examined,1);
});
test('search reports truncation when it exhausts the file scan budget',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-search-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await Promise.all(Array.from({length:201},(_,i)=>fs.writeFile(path.join(root,`file-${i}`),'ordinary')));
 const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',root,['read']);
 const response=JSON.parse((await createReadOnlyTools(registry)({name:'search',arguments:{workspace_id:'A',path:'.',query:'needle'}})).content[0].text);
 assert.equal(response.ok,true);assert.equal(response.result.files_examined,200);assert.equal(response.result.truncated,true);
});
test('glob preserves literal Unicode filenames including surrogate pairs',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-unicode-glob-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const name='mèo-😀.txt';await fs.writeFile(path.join(root,name),'ordinary');
 const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',root,['read']);
 const response=JSON.parse((await createReadOnlyTools(registry)({name:'glob',arguments:{workspace_id:'A',path:'.',pattern:name}})).content[0].text);
 assert.equal(response.ok,true);assert.deepEqual(response.result.entries,[{name,kind:'file'}]);
});
test('glob accepts double dots in a literal filename while refusing path patterns',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-review-dots-glob-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'file..txt'),'fixture');
 const registry=new WorkspaceRegistry();await registry.enrollTrusted('A',root,['read']);const invoke=createReadOnlyTools(registry);
 const call=async(pattern:string)=>JSON.parse((await invoke({name:'glob',arguments:{workspace_id:'A',path:'.',pattern}})).content[0].text);
 const literal=await call('file..txt');assert.equal(literal.ok,true);assert.deepEqual(literal.result.entries,[{name:'file..txt',kind:'file'}]);
 for(const pattern of ['../file','dir/file','dir\\file','**'])assert.equal((await call(pattern)).code,'INVALID_GLOB');
});
