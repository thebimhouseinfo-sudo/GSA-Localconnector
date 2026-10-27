import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const fail=()=>Object.assign(new Error('RELEASE_INVALID'),{code:'RELEASE_INVALID'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function safeName(name){
 if(typeof name!=='string'||!name||name.length>1024||name.includes('\\')||/[\u0000-\u001f\u007f]/.test(name)||path.posix.normalize(name)!==name||path.posix.isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..'||/^\.env(?:$|[.-])/.test(x)||/^(mcp-token|server-owner\.lock|grants\.json|identity\.json)$/.test(x)||/\.(pem|key|p12)$/.test(x)))throw fail();
 return name;
}
async function regular(root,name){
 safeName(name);let current=root;
 const rootInfo=await fs.lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw fail();
 for(const [index,part] of name.split('/').entries()){
  current=path.join(current,part);const s=await fs.lstat(current);
  if(s.isSymbolicLink()||(index===name.split('/').length-1?(!s.isFile()||s.nlink!==1):!s.isDirectory()))throw fail();
 }
 return current;
}
export async function createReleaseManifest({sourceRoot,platform,arch,version,allowedFiles}){
 if(!path.isAbsolute(sourceRoot)||!Array.isArray(allowedFiles)||!allowedFiles.length||allowedFiles.length>8192||!['darwin','win32'].includes(platform)||typeof arch!=='string'||typeof version!=='string')throw fail();
 const files={};for(const name of [...allowedFiles].sort()){
  if(name==='manifest.json'||Object.hasOwn(files,name))throw fail();
  files[name]=digest(await fs.readFile(await regular(sourceRoot,name)));
 }
 return {format:'gsa-desktop-release-v1',platform,arch,version,files};
}
async function inventory(root,prefix=''){
 const files=[];
 for(const name of await fs.readdir(path.join(root,prefix))){
  const rel=prefix?`${prefix}/${name}`:name;const s=await fs.lstat(path.join(root,rel));
  if(s.isSymbolicLink())throw fail();
  if(s.isDirectory())files.push(...await inventory(root,rel));else if(s.isFile()&&s.nlink===1)files.push(rel);else throw fail();
 }
 return files;
}
export async function verifyReleaseManifest({releaseRoot,manifest}){
 if(!path.isAbsolute(releaseRoot)||manifest?.format!=='gsa-desktop-release-v1'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||!Object.keys(manifest.files).length)throw fail();
 const names=Object.keys(manifest.files).sort();
 const actual=(await inventory(releaseRoot)).filter(x=>x!=='manifest.json').sort();
 if(JSON.stringify(names)!==JSON.stringify(actual))throw fail();
 for(const name of names){
  if(!/^[a-f0-9]{64}$/.test(manifest.files[name])||digest(await fs.readFile(await regular(releaseRoot,name)))!==manifest.files[name])throw fail();
 }
 return true;
}
