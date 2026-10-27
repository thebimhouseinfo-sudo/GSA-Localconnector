import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,type TestContext} from 'node:test';
import {WorkspaceRegistry} from '../src/core/workspace.js';
import type {NativeScopedFiles,ScopedFileRef} from '../src/core/native-io.js';
import {directoryManifestDigest,validateDirectoryCopyOutcome,type DirectoryCopyOutcome,type DirectoryManifest} from '../src/core/directory-copy.js';
import {ControlLeaseStore} from '../src/local/control-lease.js';
import {createReadOnlyTools,toolDefinitions} from '../src/mcp/server.js';
import {controlledToolNames} from '../src/mcp/catalog.js';
import {withMacDirectoryCopies} from '../src/mcp/runtime-bootstrap.js';

const id='6c3cdce6-0d6d-4be5-93e9-c711ae66a009';
const digest=directoryManifestDigest([{path:'',kind:'directory'}]);
const manifest:DirectoryManifest={format:'gsa-directory-manifest-v1',entries:[{path:'',kind:'directory'}],total_bytes:0,sha256:digest};
const ref=(workspace_id:string,path:string):ScopedFileRef=>({workspace_id,path});
function outcome(status:DirectoryCopyOutcome['status']):DirectoryCopyOutcome{return {
 copy_id:id,status,source:ref('reference','.'),destination:ref('work','copy'),manifest_sha256:digest,
 acknowledged:[],pending_path:status==='APPLIED'?null:'',reason:`${status} observed`,committed:false,
 ...(status==='UNKNOWN'?{readback:{status:'UNAVAILABLE' as const,manifest_sha256:null,reason:'readback unavailable'}}:{})
};}
const decode=(result:{content:{text:string}[]})=>JSON.parse(result.content[0]!.text);
const posixTest=(name:string,fn:(t:TestContext)=>void|Promise<void>)=>test(name,{skip:process.platform==='win32'?'POSIX protected controller store is unavailable on this host':false},fn);

async function fixture(t:TestContext,withExtension=true){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-mcp-directory-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'work'),reference=path.join(root,'reference');await fs.mkdir(work,{mode:0o700});await fs.mkdir(reference,{mode:0o700});
 const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:'work',root:work,role:'workspace'},{id:'reference',root:reference,role:'reference'}]);
 const controls=new ControlLeaseStore(path.join(root,'controls'));const token=(await controls.acquire()).control_token;
 const calls:string[]=[];
 const directoryCopies=withExtension?{
  async inspect(source:ScopedFileRef){calls.push(`inspect:${source.workspace_id}:${source.path}`);return manifest;},
  async copy(copyId:string,source:ScopedFileRef,destination:ScopedFileRef,expected:string){calls.push(`copy:${copyId}:${source.workspace_id}:${source.path}:${destination.workspace_id}:${destination.path}:${expected}`);return outcome('APPLIED');},
  async readCopy(copyId:string){calls.push(`read:${copyId}`);return outcome('UNKNOWN');}
 }:undefined;
 const forbidden=async()=>{throw Error('legacy base IO must not serve directory tools');};
 const files={supportedOperations:withExtension?['create_file','copy_directory']:['create_file'],...(directoryCopies?{directoryCopies}:{}),read:forbidden,createExclusive:forbidden,replaceIfHash:forbidden,makeDirectory:forbidden,copyExclusive:forbidden,moveExclusive:forbidden,trashIfHash:forbidden} as unknown as NativeScopedFiles;
 const invoke=createReadOnlyTools(registry,files,null,null,null,null,null,null,null,null,controls);
 const call=(name:string,args:Record<string,unknown>)=>invoke({name,arguments:controlledToolNames.has(name)?{...args,control_token:token}:args});
 return {root,registry,controls,token,calls,files,invoke,call};
}

test('directory tools have strict exact schemas and require controller tokens',()=>{
 const schemas=new Map(toolDefinitions().map(tool=>[tool.name,tool.inputSchema]));
 const expected:Record<string,string[]>={inspect_directory:['path','workspace_id'],copy_directory:['copy_id','destination_path','destination_workspace_id','expected_manifest_sha256','source_path','source_workspace_id'],get_directory_copy:['copy_id']};
 for(const [name,keys] of Object.entries(expected)){
  const schema=schemas.get(name) as any;assert.ok(schema,`${name} is discoverable`);assert.ok(controlledToolNames.has(name),`${name} is controlled`);
  assert.equal(schema.additionalProperties,false);assert.deepEqual(Object.keys(schema.properties).sort(),[...keys,'control_token'].sort());
  assert.deepEqual([...schema.required].sort(),[...keys,'control_token'].sort());
  for(const key of keys)assert.equal(schema.properties[key].minLength,1,`${name}.${key} is nonempty`);
  if(name==='copy_directory'){
   assert.equal(schema.properties.copy_id.pattern,'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
   assert.equal(schema.properties.expected_manifest_sha256.pattern,'^[a-f0-9]{64}$');
   assert.equal(schema.properties.source_path.maxLength,4096);assert.equal(schema.properties.destination_path.maxLength,4096);
  }
 }
});

posixTest('all three directory calls reject a missing controller before backend access',async t=>{
 const f=await fixture(t);for(const [name,args] of [['inspect_directory',{workspace_id:'reference',path:'dir'}],['copy_directory',{copy_id:id,source_workspace_id:'reference',source_path:'.',destination_workspace_id:'work',destination_path:'copy',expected_manifest_sha256:digest}],['get_directory_copy',{copy_id:id}]] as const){
  const result=await f.invoke({name,arguments:args});assert.equal(decode(result).ok,false);assert.ok(['SESSION_INVALID','SESSION_EXPIRED'].includes(decode(result).code));
 }
 assert.deepEqual(f.calls,[]);
});

posixTest('missing directory extension blocks new tools while retaining base backend availability',async t=>{
 const f=await fixture(t,false);const capabilities=decode(await f.call('list_capabilities',{})).result;
 assert.equal(capabilities.fileBackendAvailable,true);assert.equal(capabilities.directoryCopyAvailable,false);
 assert.deepEqual(capabilities.fileOperations,['create_file']);assert(capabilities.files.includes('create_file'));
 for(const name of ['inspect_directory','get_directory_copy','copy_directory'])assert(capabilities.blocked.includes(name));
 for(const name of ['inspect_directory','get_directory_copy','copy_directory']){
  const args=name==='inspect_directory'?{workspace_id:'reference',path:'.'}:name==='get_directory_copy'?{copy_id:id}:{copy_id:id,source_workspace_id:'reference',source_path:'.',destination_workspace_id:'work',destination_path:'copy',expected_manifest_sha256:digest};
  assert.equal(decode(await f.call(name,args)).code,'SECURITY_BLOCKED');
 }
 assert.deepEqual(f.calls,[]);
});

posixTest('inspect exposes manifest only and copy preserves APPLIED response shape',async t=>{
 const f=await fixture(t);const inspected=decode(await f.call('inspect_directory',{workspace_id:'reference',path:'.'}));
 assert.deepEqual(inspected,{ok:true,result:manifest});assert.equal(JSON.stringify(inspected).includes('base64'),false);assert(!('files' in inspected.result));assert(!('observations' in inspected.result));assert(!('bytes' in inspected.result));
 const copied=decode(await f.call('copy_directory',{copy_id:id,source_workspace_id:'reference',source_path:'.',destination_workspace_id:'work',destination_path:'copy',expected_manifest_sha256:digest}));
 assert.equal(copied.ok,true);assert.deepEqual(copied.result,outcome('APPLIED'));assert.deepEqual(f.calls.slice(0,2),['inspect:reference:.',`copy:${id}:reference:.:work:copy:${digest}`]);
});

posixTest('reference roots can supply a copy but cannot receive one; destination dot is rejected',async t=>{
 const f=await fixture(t);
 const referenceDestination=decode(await f.call('copy_directory',{copy_id:id,source_workspace_id:'reference',source_path:'.',destination_workspace_id:'reference',destination_path:'copy',expected_manifest_sha256:digest}));
 assert.equal(referenceDestination.ok,false);assert.equal(referenceDestination.result,undefined);
 const rootDestination=decode(await f.call('copy_directory',{copy_id:id,source_workspace_id:'reference',source_path:'.',destination_workspace_id:'work',destination_path:'.',expected_manifest_sha256:digest}));
 assert.equal(rootDestination.ok,false);assert.equal(rootDestination.result,undefined);assert.deepEqual(f.calls,[]);
});

posixTest('inspect_directory rejects extra nested payload fields instead of exposing them',async t=>{
 const f=await fixture(t);(f.files.directoryCopies!.inspect as any)=async()=>({...manifest,privatePayload:{bytes:'SECRET_BYTES',base64:'U0VDUkVU'}});
 const result=await f.call('inspect_directory',{workspace_id:'reference',path:'.'});const body=decode(result);
 assert.equal(result.isError,true);assert.equal(body.code,'INVALID_DIRECTORY_MANIFEST');assert.equal(body.result,undefined);assert.equal(JSON.stringify(body).includes('SECRET_BYTES'),false);
});

for(const status of ['CONFLICT','UNKNOWN'] as const)posixTest(`${status} copy progress remains structured through MCP error packaging`,async t=>{
 const f=await fixture(t);const value=outcome(status);(f.files.directoryCopies!.copy as any)=async()=>value;
 const result=await f.call('copy_directory',{copy_id:id,source_workspace_id:'reference',source_path:'.',destination_workspace_id:'work',destination_path:'copy',expected_manifest_sha256:digest});
 assert.equal(result.isError,true);assert.deepEqual(decode(result),{ok:false,code:status==='UNKNOWN'?'RESULT_UNKNOWN':'DIRECTORY_COPY_CONFLICT',result:value});
});

test('outcome validator rejects unknown fields and detaches nested mutable input',()=>{
 const input=outcome('UNKNOWN');const validated=validateDirectoryCopyOutcome(input);assert.notEqual(validated,input);assert.notEqual(validated.source,input.source);assert(Object.isFrozen(validated));assert(Object.isFrozen(validated.source));
 (input.source as any).path='changed';(input.acknowledged as Array<{path:string;kind:'directory'|'file'}>).push({path:'mutable',kind:'file'});assert.equal(validated.source.path,'.');assert.deepEqual(validated.acknowledged,[]);
 for(const bad of [{...outcome('APPLIED'),extra:'not public'},{...outcome('UNKNOWN'),committed:true},{...outcome('UNKNOWN'),status:'PENDING'},{...outcome('APPLIED'),manifest_sha256:'BAD'}])assert.throws(()=>validateDirectoryCopyOutcome(bad));
});

test('runtime facade binds class receivers and preserves only the base subset plus directory extension',async()=>{
 class Recovery {#marker='recovery';replaceIfHash(){return this.#marker;}trashIfHash(){return this.#marker;}readTransaction(){return this.#marker;}}
 class Base {
  #marker='base';readonly supportedOperations=['create_file','create_directory','copy_file'] as const;readonly recoverableMutations=new Recovery();
  read(){return this.#marker;}createExclusive(){return this.#marker;}replaceIfHash(){return this.#marker;}makeDirectory(){return this.#marker;}copyExclusive(){return this.#marker;}moveExclusive(){return this.#marker;}trashIfHash(){return this.#marker;}
 }
 class Directory {#marker='directory';inspect(){return this.#marker;}copy(){return this.#marker;}readCopy(){return this.#marker;}}
 const base=new Base(),directory=new Directory();const facade=withMacDirectoryCopies(base as unknown as NativeScopedFiles,directory as any);
 assert.deepEqual(facade.supportedOperations,['create_file','create_directory','copy_file','copy_directory']);
 assert.equal((await facade.read(ref('work','x'),10) as any),'base');assert.equal(await facade.createExclusive(ref('work','x'),new Uint8Array()),'base');assert.equal(await facade.replaceIfHash(ref('work','x'),new Uint8Array(),digest),'base');assert.equal(await facade.makeDirectory(ref('work','x')),'base');assert.equal(await facade.copyExclusive(ref('work','x'),ref('work','y'),digest),'base');assert.equal(await facade.moveExclusive(ref('work','x'),ref('work','y'),digest),'base');assert.equal(await facade.trashIfHash(ref('work','x'),digest),'base');
 const recovery=facade.recoverableMutations!;assert.equal(await recovery.replaceIfHash(ref('work','x'),new Uint8Array(),digest),'recovery');assert.equal(await recovery.trashIfHash(ref('work','x'),digest),'recovery');assert(recovery.readTransaction);assert.equal(await recovery.readTransaction!(id),'recovery');
 assert.equal(await facade.directoryCopies!.inspect(ref('reference','.')),'directory');assert.equal(await facade.directoryCopies!.copy(id,ref('reference','.'),ref('work','copy'),digest),'directory');assert.equal(await facade.directoryCopies!.readCopy(id),'directory');
});
