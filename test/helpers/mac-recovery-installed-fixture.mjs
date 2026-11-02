// Disposable real-owner fixture; not a plugin or production activation test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyMacOwner} from '../../dist/src/local/mac-owner.js';
import {loadTrustedRegistry,requirePersistedGrant} from '../../dist/src/local/grants.js';
import {loadCheckedMacRecoveryInstallation} from '../../dist/src/hosts/macos-recovery-installation.js';
import {normalizedStrippedMacFileCode} from '../../dist/src/hosts/macos-file-code.js';

const scratch=process.env.GSA_FIXTURE_SCRATCH,identity=process.env.GSA_FIXTURE_IDENTITY,workspace=process.env.GSA_FIXTURE_WORKSPACE;
const temporary=await fs.realpath(os.tmpdir());
if(!scratch||await fs.realpath(scratch)!==scratch||!scratch.startsWith(temporary+path.sep)||!path.basename(scratch).startsWith('gsa-scoped-installer-')||identity!==path.join(scratch,'identity')||workspace!==path.join(scratch,'workspace'))throw Error('Invalid disposable fixture');
const rootStat=await fs.lstat(scratch);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==process.getuid()||(rootStat.mode&0o777)!==0o700)throw Error('Unsafe disposable fixture');
for(const directory of [identity,workspace]){const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw Error('Unsafe disposable fixture directory');}
const owner=await verifyMacOwner(identity),registry=await loadTrustedRegistry(identity),installation=path.join(identity,'scoped-files');
const grants=registry.list();if(grants.length!==1||grants[0].id!=='work'||grants[0].role!=='workspace'||grants[0].canonicalRoot!==workspace)throw Error('Fixture grant is not the disposable workspace');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');let dropReply=true;
async function run(executable,args,input,max,fd){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',LANG:'C',TMPDIR:'/private/tmp'},stdio:fd===undefined?['pipe','pipe','pipe']:['pipe','pipe','pipe',fd]});
  let out=Buffer.alloc(0),failure;const timer=setTimeout(()=>{failure=Error('fixture command timeout');child.kill('SIGKILL');},15000);
  child.stdout.on('data',chunk=>{if(out.length+chunk.length>max){failure=Error('fixture output limit');child.kill('SIGKILL');}else out=Buffer.concat([out,chunk]);});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',error=>{failure=error;});
  child.on('close',code=>{clearTimeout(timer);if(failure||code!==0)reject(failure??Error('fixture command failed'));else resolve(out);});child.stdin.end(input);
 });
}
const io={
 ownerLockFD:owner.lockFD,
 authorize:async id=>{await requirePersistedGrant(registry,id,identity,'write');},
 protectedRead:async(file,max)=>{const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.nlink!==1||before.size>max)throw Error('Unsafe fixture artifact');
  const fd=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=await fd.stat();if(opened.dev!==before.dev||opened.ino!==before.ino)throw Error('Fixture artifact changed');const bytes=await fd.readFile();const after=await fd.stat();if(bytes.length!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Fixture artifact changed');return bytes;}finally{await fd.close();}},
 protectedDirectory:async directory=>{const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw Error('Unsafe fixture directory');},
 normalizedCodeSha256:async binary=>{const dir=await fs.mkdtemp(path.join(scratch,'normalize-')),copy=path.join(dir,'binary');try{await fs.copyFile(binary,copy,fs.constants.COPYFILE_EXCL);await fs.chmod(copy,0o700);await run('/usr/bin/codesign',['--remove-signature',copy],'',65536);return sha(normalizedStrippedMacFileCode(await fs.readFile(copy)));}finally{await fs.unlink(copy).catch(()=>{});await fs.rmdir(dir);}},
 command:async(executable,args,input,max,fd)=>{const bytes=await run(executable,args,input,max,fd);if(dropReply&&executable.endsWith('/RecoveryBroker.app/Contents/MacOS/recovery-broker')&&JSON.parse(input).operation==='replace'){dropReply=false;throw Error('synthetic dropped reply after actual broker completion');}return bytes;}
};
const adapter=await loadCheckedMacRecoveryInstallation(registry,installation,io),ref={workspace_id:'work',path:'fixture.txt'},file=path.join(workspace,ref.path);
await fs.writeFile(file,'before',{flag:'wx',mode:0o600});const outcome=await adapter.replaceIfHash(ref,Buffer.from('after'),sha('before'));
assert.equal(outcome.status,'UNKNOWN');assert.equal(await fs.readFile(file,'utf8'),'after');const readback=await adapter.readTransaction(outcome.transaction_id);assert.equal(readback.status,'APPLIED');
const trash=await adapter.trashIfHash(ref,sha('after'));assert.equal(trash.status,'APPLIED');await assert.rejects(fs.lstat(file),{code:'ENOENT'});
console.log(JSON.stringify({dropped:outcome.status,readback:readback.status,trash:trash.status}));
