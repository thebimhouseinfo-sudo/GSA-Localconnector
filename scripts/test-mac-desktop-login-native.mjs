// Disposable launchd registration only; never uses the production label/job.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {parseLoginJob,retireInactiveLoginJob} from './mac-desktop-login.mjs';

if(process.platform!=='darwin')throw Error('MAC_REQUIRED');
const execute=promisify(execFile),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-inactive-job-')));
const label=`com.gsa-localconnector.fixture.${randomUUID()}`,target=`gui/${process.getuid()}/${label}`,plist=path.join(root,'fixture.plist');
const sentinel=spawn('/bin/sleep',['120'],{stdio:'ignore'});
const text=`<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${root}/missing-app</string></array><key>RunAtLoad</key><true/></dict></plist>`;
const query=async()=>parseLoginJob((await execute('/bin/launchctl',['list'])).stdout,label);
let registered=false;
try{
 await fs.writeFile(plist,text,{mode:0o600,flag:'wx'});
 await execute('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plist]);registered=true;
 // launchd may briefly report its spawn helper before the missing executable
 // fails; observe the actual inactive state rather than racing bootstrap.
 const deadline=Date.now()+5000;
 while(await query()==='ACTIVE'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(await query(),'INACTIVE');
 await retireInactiveLoginJob({query,verifyOwned:async()=>{
  const stat=await fs.lstat(plist);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&stat.nlink===1);
  assert.equal(await fs.readFile(plist,'utf8'),text);
 },ownerBusy:async()=>false,bootout:()=>execute('/bin/launchctl',['bootout',target])});
 assert.equal(await query(),'ABSENT');registered=false;
 process.kill(sentinel.pid,0);
 console.log('PASS: actual inactive failed launchd fixture retired; unrelated sentinel alive');
}finally{
 if(registered)await execute('/bin/launchctl',['bootout',target]);
 sentinel.kill('SIGTERM');
 await fs.rm(root,{recursive:true,force:true});
}
