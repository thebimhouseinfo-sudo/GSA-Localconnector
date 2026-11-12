import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import {createReadOnlyTools,toolDefinitions} from '../src/mcp/server.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {sha256} from '../src/core/edit-guards.js';
import type {NativeScopedFiles,ScopedFileRef} from '../src/core/native-io.js';
import {testIdentityRoot} from './helpers/identity-root.js';

test('byte tools roundtrip binary and keep reference and capability boundaries',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-byte-api-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work'),ref=path.join(root,'ref');await fs.mkdir(work);await fs.mkdir(ref);
 const bytes=Buffer.from([0xef,0xbb,0xbf,0,255,13,10]);await fs.writeFile(path.join(ref,'data.bin'),bytes);
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'W',root:work,role:'workspace'},{id:'R',root:ref,role:'reference'}]);
 const data=new Map<string,Uint8Array>();const key=(r:ScopedFileRef)=>r.workspace_id+'/'+r.path;
 const backend:NativeScopedFiles={supportedOperations:['create_file','update_file'],read:async r=>{const b=data.get(key(r));if(!b)throw Error('MISSING');return {bytes:b,sha256:sha256(b),kind:'file'};},
  createExclusive:async(r,b)=>{if(data.has(key(r)))throw Error('CONFLICT');data.set(key(r),b);},replaceIfHash:async(r,b,h)=>{const old=data.get(key(r));if(!old||sha256(old)!==h)throw Error('HASH_CONFLICT');data.set(key(r),b);},
  makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}};
 const invoke=createReadOnlyTools(registry,backend,null,null,null,null,null,null,null,null,null,{identityRoot:testIdentityRoot()});const call=async(name:string,args:Record<string,unknown>)=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
 const read=await call('fetch_file_bytes',{workspace_id:'R',path:'data.bin'});assert.equal(read.ok,true);assert.equal(read.result.base64,bytes.toString('base64'));assert.equal(read.result.sha256,sha256(bytes));assert.equal(read.result.bytes,bytes.length);
 const encoded=bytes.toString('base64');assert.equal((await call('create_file_bytes',{workspace_id:'R',path:'no',base64:encoded})).ok,false);
 const created=await call('create_file_bytes',{workspace_id:'W',path:'binary',base64:encoded});assert.equal(created.ok,true);assert.deepEqual(Buffer.from(data.get('W/binary')!),bytes);
 const changed=Buffer.from([0,128,10,13]);assert.equal((await call('update_file_bytes',{workspace_id:'W',path:'binary',base64:changed.toString('base64'),expected_sha256:'0'.repeat(64)})).ok,false);assert.deepEqual(Buffer.from(data.get('W/binary')!),bytes);
 assert.equal((await call('update_file_bytes',{workspace_id:'W',path:'binary',base64:changed.toString('base64'),expected_sha256:sha256(bytes)})).ok,true);assert.deepEqual(Buffer.from(data.get('W/binary')!),changed);
 assert.equal((await call('create_file_bytes',{workspace_id:'W',path:'bad',base64:'a==='})).ok,false);
 assert.equal((await call('create_file_bytes',{workspace_id:'W',path:'large',base64:Buffer.alloc(8*1024*1024+1).toString('base64')})).ok,false);
 const baseOnly={...backend,supportedOperations:['create_file'] as const};const partial=createReadOnlyTools(registry,baseOnly,null,null,null,null,null,null,null,null,null,{identityRoot:testIdentityRoot()});
 const unavailable=JSON.parse((await partial({name:'update_file_bytes',arguments:{workspace_id:'W',path:'binary',base64:encoded,expected_sha256:sha256(changed)}})).content[0].text);assert.equal(unavailable.code,'SECURITY_BLOCKED');
 const guarded=createReadOnlyTools(registry,backend,null,null,null,null,null,null,null,null,new ControlLeaseStore(path.join(root,'identity')),{identityRoot:testIdentityRoot()});
 const denied=JSON.parse((await guarded({name:'create_file_bytes',arguments:{workspace_id:'W',path:'x',base64:encoded}})).content[0].text);assert.equal(denied.code,'SESSION_INVALID');
 const tool=toolDefinitions().find(x=>x.name==='create_file_bytes');assert.ok(tool);assert.ok(tool.inputSchema.required.includes('control_token'));
});

/** Self-generated PNG fixture for protocol coverage only. The user's original SHA256
 * dcde214ebb22e618074e7f6064d484c0acee78fbf46072033c3bcd1399ad17c6
 * cannot be verified without the original 723-byte payload and an installed host. */
test('PNG 24x14 723-byte Base64 create/info/fetch is byte-identical through MCP APIs',{skip:process.platform==='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gsa-png-byte-roundtrip-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work'),ref=path.join(root,'reference');
 await fs.mkdir(work);await fs.mkdir(path.join(work,'docs'));await fs.mkdir(ref);
 const crc32=(bytes:Uint8Array)=>{
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1);}
  return (crc^0xffffffff)>>>0;
 };
 const chunk=(name:string,data:Buffer)=>{
  const label=Buffer.from(name,'ascii'),size=Buffer.alloc(4),crc=Buffer.alloc(4);
  size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));
  return Buffer.concat([size,label,data,crc]);
 };
 const signature=Buffer.from('89504e470d0a1a0a','hex'),ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(24,0);ihdr.writeUInt32BE(14,4);ihdr[8]=8;ihdr[9]=6;
 const pixels=Buffer.alloc(14*(24*4+1),0);
 const compressed=deflateSync(pixels),header=chunk('IHDR',ihdr),image=chunk('IDAT',compressed),end=chunk('IEND',Buffer.alloc(0));
 const textBytes=723-(signature.length+header.length+image.length+end.length+12);
 assert.ok(textBytes>5);
 const note=Buffer.concat([Buffer.from('Note\0','ascii'),Buffer.alloc(textBytes-5,0x41)]);
 const png=Buffer.concat([signature,header,image,chunk('tEXt',note),end]);
 assert.equal(png.length,723);
 assert.equal(png.readUInt32BE(16),24);assert.equal(png.readUInt32BE(20),14);
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'W',root:work,role:'workspace'},{id:'R',root:ref,role:'reference'}]);
 const backend:NativeScopedFiles={supportedOperations:['create_file'],read:async r=>{
  const bytes=await fs.readFile(path.join(work,r.path));return {bytes,sha256:sha256(bytes),kind:'file'};
 },createExclusive:async(r,b)=>{await fs.writeFile(path.join(work,r.path),b,{flag:'wx'});},
 replaceIfHash:async()=>{},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}};
 const invoke=createReadOnlyTools(registry,backend,null,null,null,null,null,null,null,null,null,{identityRoot:testIdentityRoot()});
 const call=async(name:string,args:Record<string,unknown>)=>JSON.parse((await invoke({name,arguments:args})).content[0].text);
 const file='docs/kideschool_chinhta_base64_test.png',base64=png.toString('base64');
 assert.equal((await call('create_file_bytes',{workspace_id:'R',path:'test.png',base64})).ok,false);
 assert.equal((await call('create_file_bytes',{workspace_id:'W',path:file,base64})).ok,true);
 const info=await call('get_file_info',{workspace_id:'W',path:file});
 assert.equal(info.ok,true);assert.equal(info.result.size,723);assert.equal(info.result.sha256,sha256(png));
 const fetched=await call('fetch_file_bytes',{workspace_id:'W',path:file});
 assert.equal(fetched.ok,true);assert.equal(fetched.result.bytes,723);assert.equal(fetched.result.sha256,sha256(png));
 assert.deepEqual(Buffer.from(fetched.result.base64,'base64'),png);
 assert.equal((await call('create_file_bytes',{workspace_id:'W',path:file,base64})).ok,false,'exclusive create must reject overwrite');
 await fs.symlink(ref,path.join(work,'escape'));
 assert.equal((await call('fetch_file_bytes',{workspace_id:'W',path:'escape/secret.png'})).ok,false,'outside-scope symlink must not be readable');
});
