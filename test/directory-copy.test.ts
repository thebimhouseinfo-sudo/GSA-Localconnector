import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {directoryManifestDigest, validateDirectoryCapture, type DirectoryEntry} from '../src/core/directory-copy.js';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const dir=(path:string):DirectoryEntry=>({path,kind:'directory'});
const file=(path:string,bytes:Uint8Array):DirectoryEntry=>({path,kind:'file',size:bytes.byteLength,sha256:hash(bytes)});
const stat=(path:string,kind:'directory'|'file',size=0)=>({path,device:'1',inode:String(path.length+2),kind,size,mtime_ns:'1700000000000000000',ctime_ns:'1700000000000000001'});
function capture(entries:DirectoryEntry[],files:Array<{path:string;bytes:Uint8Array}> = []):any{
 const ordered=[...entries];
 return {manifest:{format:'gsa-directory-manifest-v1',entries:ordered,total_bytes:entries.reduce((n,e)=>n+(e.kind==='file'?e.size:0),0),sha256:directoryManifestDigest(ordered)},files:files.map(f=>({path:f.path,base64:Buffer.from(f.bytes).toString('base64')})),observations:entries.map(e=>stat(e.path,e.kind,e.kind==='file'?e.size:0))};
}
function validEmpty(){return capture([dir('')]);}
function rejects(value:unknown,pattern?:RegExp){if(pattern)assert.throws(()=>validateDirectoryCapture(value),{message:pattern});else assert.throws(()=>validateDirectoryCapture(value));}
function children(count:number):DirectoryEntry[]{return [dir(''),...Array.from({length:count},(_,i)=>dir(`d${String(i).padStart(4,'0')}`))];}
function deep(depth:number):DirectoryEntry[]{const entries:DirectoryEntry[]=[dir('')];let path='';for(let i=1;i<=depth;i++){path=path?`${path}/d`:'d';entries.push(dir(path));}return entries;}

test('canonical digest has stable empty-root and nested UTF-8 vectors',()=>{
 assert.equal(directoryManifestDigest([dir('')]),'cc5144d246b1b9433cde0158cb3b3164bbc4407cd9b198ef4251c59685205dd4');
 const entries:DirectoryEntry[]=[dir(''),dir('z'),dir('é'),{path:'é/雪.txt',kind:'file',size:2,sha256:'b'.repeat(64)}];
 assert.equal(directoryManifestDigest(entries),'9707aa901857aff8efee4a60a715e7fe3f03f7ecc88d2dfc50cdcb72b48d8557');
 assert.equal(directoryManifestDigest([dir(''),dir('é'),dir('z')]),directoryManifestDigest([dir(''),dir('z'),dir('é')]));
});

test('accepts root and nested empty directories with exact stat observation types',()=>{
 const source=capture([dir(''),dir('empty'),dir('nested'),dir('nested/also-empty')]);
 const result=validateDirectoryCapture(source);
 assert.deepEqual(result.manifest.entries,source.manifest.entries);
 assert.deepEqual(result.files,[]);
 for(const observation of result.observations){
  assert.deepEqual(Object.keys(observation).sort(),['ctime_ns','device','inode','kind','mtime_ns','path','size']);
  assert.match(observation.device,/^(0|[1-9][0-9]*)$/);assert.match(observation.inode,/^(0|[1-9][0-9]*)$/);
  assert.match(observation.mtime_ns,/^(0|[1-9][0-9]*)$/);assert.match(observation.ctime_ns,/^(0|[1-9][0-9]*)$/);
  assert.ok(Number.isSafeInteger(observation.size)&&observation.size>=0);
 }
});

test('accepts all structural fixed limits and the maximum bounded byte payload',()=>{
 const bytes=new Uint8Array(8_388_608);const entries:DirectoryEntry[]=[dir(''),file('payload',bytes)];
 const source=capture(entries,[{path:'payload',bytes}]);
 assert.equal(validateDirectoryCapture(source).manifest.total_bytes,8_388_608);
 assert.equal(validateDirectoryCapture({ ...capture(children(1023)), observations:capture(children(1023)).observations }).manifest.entries.length,1024);
 assert.equal(validateDirectoryCapture(capture(deep(16))).manifest.entries.length,17);
});

test('rejects one over every fixed tree and payload limit',()=>{
 const bytes=new Uint8Array(8_388_609);let oversized=capture([dir(''),file('payload',bytes)],[{path:'payload',bytes}]);rejects(oversized,/limit|size|byte/i);
 rejects(capture(children(1024)),/limit|entry/i);
 rejects(capture(deep(17)),/limit|depth/i);
 const small=new Uint8Array([1]);
 const a=new Uint8Array(4_194_304),b=new Uint8Array(4_194_305);
 const two=capture([dir(''),file('a',a),file('b',b)],[{path:'a',bytes:a},{path:'b',bytes:b}]);rejects(two,/limit|total|byte/i);
});

test('enforces the 524288-byte canonical manifest boundary and rejects plus one',()=>{
 // Long legal paths let this hit the exact byte boundary without allocating file payloads.
 const paths=Array.from({length:140},(_,i)=>`f${String(i).padStart(3,'0')}${'x'.repeat(3496)}`);
 const encodingLength=()=>Buffer.byteLength(JSON.stringify(['gsa-directory-manifest-v1',[['','directory'],...paths.map(path=>[path,'directory'])]]));
 let remaining=524_288-encodingLength();
 for(let i=0;i<paths.length&&remaining>0;i++){const room=4096-paths[i]!.length,add=Math.min(room,remaining);paths[i]+='x'.repeat(add);remaining-=add;}
 assert.equal(remaining,0);const entries:DirectoryEntry[]=[dir(''),...paths.map(path=>dir(path))];
 const source=capture(entries);assert.equal(encodingLength(),524_288);assert.equal(validateDirectoryCapture(source).manifest.entries.length,141);
 paths[0]+='x';rejects(capture([dir(''),...paths.map(path=>dir(path))]),/manifest|limit|size/i);
});

test('rejects malformed paths, invalid UTF-8-round-tripping names and overlong paths',()=>{
 const bad=['../escape','/absolute','a//b','a/./b','a/../b','a\\b','a\0b','.gsa-trash/x','\ud800','x'.repeat(4097)];
 for(const path of bad){const source=capture([dir(''),dir(path)]);rejects(source,/path|name|utf|manifest|entry/i);}
});

test('requires exactly one directory root, canonical root-first UTF-8 order and valid ancestry',()=>{
 rejects(capture([file('',new Uint8Array())]),/root|directory|kind/i);
 rejects(capture([dir(''),dir('')]),/duplicate|unique/i);
 rejects(capture([dir('x'),dir('')]),/root|order/i);
 rejects(capture([dir(''),dir('z'),dir('a')]),/order|sort|canonical/i);
 rejects(capture([dir(''),dir('parent/child')]),/parent|ancestor/i);
 rejects(capture([dir(''),file('parent',new Uint8Array()),dir('parent/child')],[{path:'parent',bytes:new Uint8Array()}]),/parent|ancestor|file/i);
});

test('rejects missing, duplicate, extra and reordered file payloads',()=>{
 const a=new Uint8Array([1]),b=new Uint8Array([2]);const entries=[dir(''),file('a',a),file('b',b)];
 const good=capture(entries,[{path:'a',bytes:a},{path:'b',bytes:b}]);assert.equal(validateDirectoryCapture(good).files.length,2);
 rejects({...good,files:[{path:'a',bytes:a}]},/payload|file|match/i);
 rejects({...good,files:[...good.files,{path:'a',base64:Buffer.from(a).toString('base64')}]},/duplicate|payload|file/i);
 rejects({...good,files:[...good.files,{path:'extra',base64:Buffer.from(a).toString('base64')}]},/extra|payload|file/i);
 rejects({...good,files:[...good.files].reverse()},/order|canonical|payload/i);
 rejects({...good,files:[{path:'a',bytes:a},{path:'b',bytes:b}]},/field|shape|base64|payload/i);
 rejects({...good,files:[{path:'a',base64:[1]},{path:'b',base64:[2]}]},/field|shape|base64|payload/i);
 rejects({...good,files:[{path:'a',base64:'AQ'},{path:'b',base64:'Ag=='}]},/base64|encoding|payload/i);
});

test('recomputes file hash, file size, aggregate bytes and manifest digest',()=>{
 const bytes=new Uint8Array([4,5]);const source=capture([dir(''),file('x',bytes)],[{path:'x',bytes}]);
 const badHash=structuredClone(source);badHash.manifest.entries[1]={...badHash.manifest.entries[1]!,sha256:'0'.repeat(64)};rejects(badHash,/hash|digest|manifest/i);
 const badSize=structuredClone(source);badSize.manifest.entries[1]={...badSize.manifest.entries[1]!,size:1};rejects(badSize,/size|hash|manifest/i);
 const badTotal={...source,manifest:{...source.manifest,total_bytes:3}};rejects(badTotal,/total|byte|manifest/i);
 const badDigest={...source,manifest:{...source.manifest,sha256:'f'.repeat(64)}};rejects(badDigest,/digest|hash|manifest/i);
 const altered={...source,files:[{path:'x',base64:Buffer.from([99,5]).toString('base64')}]};rejects(altered,/hash|digest|content/i);
});

test('rejects unknown fields at capture, manifest, entry, payload and observation levels',()=>{
 const source=validEmpty();
 rejects({...source,extra:true},/field|shape|capture/i);
 rejects({...source,manifest:{...source.manifest,extra:true}},/field|shape|manifest/i);
 rejects({...source,manifest:{...source.manifest,entries:[{...source.manifest.entries[0],extra:true}]}},/field|shape|entry/i);
 rejects({...source,files:[{path:'unexpected',bytes:new Uint8Array(),extra:true}]},/field|shape|payload|file/i);
 rejects({...source,observations:[{...source.observations[0],extra:true}]},/field|shape|observation/i);
});
