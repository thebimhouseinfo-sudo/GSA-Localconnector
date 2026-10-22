// Full packaged adapter + real pinned tunnel + real packaged stdio CLI.
// Only the control-plane URL is redirected to a disposable loopback fixture.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createMacInstaller} from './mac-desktop-install.mjs';
import {runInstall} from './desktop-install.mjs';
import {MacDesktopAdapter} from './mac-desktop-adapter.mjs';
import {createMacPrivateFile} from './mac-desktop-private-file.mjs';
import {saveDesktopConfig} from './desktop-config.mjs';
import {enrollRolesTrustedBatch} from '../dist/src/local/grants.js';

const execute=promisify(execFile),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa real packaged runtime ')));
const previousHome=process.env.HOME;process.env.HOME=root;
const desktop=path.join(root,'Library/Application Support/GSA-Localconnector/desktop');await fs.mkdir(desktop,{recursive:true,mode:0o700});
const privateFile=createMacPrivateFile(),envPath=path.join(desktop,'.env'),key='synthetic-real-packaged-key';
await saveDesktopConfig({envPath,privateFile,values:{tunnelId:'tunnel_0123456789abcdef0123456789abcdef',apiKey:key},expectedIdentity:null});
const rejectAuth=process.argv.includes('--reject-auth');
if(process.argv.includes('--stale-workspace')){
 const workspace=path.join(root,'workspace');await fs.mkdir(workspace,{mode:0o700});
 await enrollRolesTrustedBatch([{id:'fixture-workspace',root:workspace,role:'workspace'}],path.join(root,'Library/Application Support/GSA-Localconnector'));
 await fs.rename(workspace,path.join(root,'old-workspace'));await fs.mkdir(workspace,{mode:0o700});
}
let requests=0,runtime;
const server=http.createServer((request,response)=>{requests++;request.resume();response.statusCode=rejectAuth?401:200;response.setHeader('Content-Type','application/json');response.end('{}');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const options=await createMacInstaller({home:root,registerLogin:false});
 options.platformAdapter.startApp=async()=>{
  runtime=new MacDesktopAdapter({configPath:path.join(desktop,'config.json')});
  runtime.privateFile={readVerified:privateFile.readVerified,replaceVerified:(file,bytes,identity)=>privateFile.replaceVerified(file,
   file.endsWith('desktop-profile.yaml')?Buffer.from(bytes.toString().replace('control_plane:\n',`control_plane:\n  base_url: http://127.0.0.1:${server.address().port}\n`)):bytes,identity)};
  await runtime.start();return (await runtime.status()).state==='RUNNING';
 };
 const installed=await runInstall({action:'install',...options});assert.equal(installed.state,'INSTALLED',JSON.stringify(installed));
 await new Promise(resolve=>setTimeout(resolve,rejectAuth?35000:6000));
 const status=await runtime.status();assert.equal(status.state,'RUNNING',JSON.stringify(status));
 assert.equal(status.connection,rejectAuth?'CONNECTING':'CONNECTED',JSON.stringify(status));assert.ok(requests>0);
 console.log(rejectAuth?'PASS: packaged runtime survives35s of synthetic401 without clearing setup or claiming connection':'PASS: packaged actual tunnel and packaged CLI stay RUNNING beyond startup and verify local synthetic server poll');
}catch(error){
 try{console.error((await fs.readFile(path.join(desktop,'desktop.log'),'utf8')).replaceAll(key,'[SYNTHETIC]'));}catch{}
 throw error;
}finally{
 // Let the adapter observe close/drain its private write queue before removing
 // the synthetic HOME; killing a queue writer can otherwise spawn a later one.
 const processes=(await execute('/bin/ps',['-axo','pid=,ppid=,comm='])).stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
 const tunnel=processes.find(row=>Number(row[2])===process.pid&&row[3].startsWith(root+'/')&&row[3].endsWith('/bin/tunnel-client'));
 if(tunnel){try{process.kill(Number(tunnel[1]),'SIGTERM');}catch{}for(let i=0;i<50;i++){if((await runtime.status()).state!=='RUNNING')break;await new Promise(resolve=>setTimeout(resolve,50));}}
 const listing=(await execute('/bin/ps',['-axo','pid=,ppid='])).stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)$/)).filter(Boolean);
 const owned=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const row of listing)if(owned.has(Number(row[2]))&&!owned.has(Number(row[1]))){owned.add(Number(row[1]));changed=true;}}
 for(const pid of [...owned].reverse())if(pid!==process.pid)try{process.kill(pid,'SIGKILL');}catch{}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 process.env.HOME=previousHome;await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
