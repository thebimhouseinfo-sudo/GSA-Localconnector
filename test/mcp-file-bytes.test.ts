import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {createReadOnlyTools,toolDefinitions} from '../src/mcp/server.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {sha256} from '../src/core/edit-guards.js';
import type {NativeScopedFiles,ScopedFileRef} from '../src/core/native-io.js';

test('byte tools roundtrip binary and keep reference and capability boundaries',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-byte-api-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work'),ref=path.join(root,'ref');await fs.mkdir(work);await fs.mkdir(ref);
 const bytes=Buffer.from([0xef,0xbb,0xbf,0,255,13,10]);await fs.writeFile(path.join(ref,'data.bin'),bytes);
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'W',root:work,role:'workspace'},{id:'R',root:ref,role:'reference'}]);
 const data=new Map<string,Uint8Array>();const key=(r:ScopedFileRef)=>r.workspace_id+'/'+r.path;
 const backend:NativeScopedFiles={supportedOperations:['create_file','update_file'],read:async r=>{const b=data.get(key(r));if(!b)throw Error('MISSING');return {bytes:b,sha256:sha256(b),kind:'file'};},
  createExclusive:async(r,b)=>{if(data.has(key(r)))throw Error('CONFLICT');data.set(key(r),b);},replaceIfHash:async(r,b,h)=>{const old=data.get(key(r));if(!old||sha256(old)!==h)throw Error('HASH_CONFLICT');data.set(key(r),b);},
  makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}};
 const invoke=createReadOnlyTools(registry,backend);const call=async(name:string,args:Record<string,unknown>)=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
 const read=await call('fetch_file_bytes',{workspace_id:'R',path:'data.bin'});assert.equal(read.ok,true);assert.equal(read.result.base64,bytes.toString('base64'));assert.equal(read.result.sha256,sha256(bytes));assert.equal(read.result.bytes,bytes.length);
 const encoded=bytes.toString('base64');assert.equal((await call('create_file_bytes',{workspace_id:'R',path:'no',base64:encoded})).ok,false);
 const created=await call('create_file_bytes',{workspace_id:'W',path:'binary',base64:encoded});assert.equal(created.ok,true);assert.deepEqual(Buffer.from(data.get('W/binary')!),bytes);
 const changed=Buffer.from([0,128,10,13]);assert.equal((await call('update_file_bytes',{workspace_id:'W',path:'binary',base64:changed.toString('base64'),expected_sha256:'0'.repeat(64)})).ok,false);assert.deepEqual(Buffer.from(data.get('W/binary')!),bytes);
 assert.equal((await call('update_file_bytes',{workspace_id:'W',path:'binary',base64:changed.toString('base64'),expected_sha256:sha256(bytes)})).ok,true);assert.deepEqual(Buffer.from(data.get('W/binary')!),changed);
 assert.equal((await call('create_file_bytes',{workspace_id:'W',path:'bad',base64:'a==='})).ok,false);
 assert.equal((await call('create_file_bytes',{workspace_id:'W',path:'large',base64:Buffer.alloc(8*1024*1024+1).toString('base64')})).ok,false);
 const baseOnly={...backend,supportedOperations:['create_file'] as const};const partial=createReadOnlyTools(registry,baseOnly);
 const unavailable=JSON.parse((await partial({name:'update_file_bytes',arguments:{workspace_id:'W',path:'binary',base64:encoded,expected_sha256:sha256(changed)}})).content[0].text);assert.equal(unavailable.code,'SECURITY_BLOCKED');
 const guarded=createReadOnlyTools(registry,backend,null,null,null,null,null,null,null,null,new ControlLeaseStore(path.join(root,'identity')));
 const denied=JSON.parse((await guarded({name:'create_file_bytes',arguments:{workspace_id:'W',path:'x',base64:encoded}})).content[0].text);assert.equal(denied.code,'SESSION_INVALID');
 const tool=toolDefinitions().find(x=>x.name==='create_file_bytes');assert.ok(tool);assert.ok(tool.inputSchema.required.includes('control_token'));
});
