import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setupTerminal,resolveTerminalTarget} from '../scripts/desktop-terminal-setup.mjs';
import {createMacPrivateFile} from '../scripts/mac-desktop-private-file.mjs';
import {saveDesktopConfig,loadDesktopConfig} from '../scripts/desktop-config.mjs';

const values={tunnelId:'tunnel_0123456789abcdef0123456789abcdef',apiKey:'synthetic-terminal-key'};
const privateFile=createMacPrivateFile();
async function fixture(fn){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gsa-terminal-')));try{await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}}

test('terminal setup saves both values privately and does not return credentials',()=>fixture(async root=>{
 const envPath=path.join(root,'.env'),prompts=[];
 const result=await setupTerminal({envPath,privateFile,prompt:async options=>{prompts.push(options);return options.secret?values.apiKey:values.tunnelId;}});
 assert.deepEqual(result,{state:'SAVED'});
 assert.deepEqual(prompts.map(p=>p.secret),[false,true]);
 assert.deepEqual((await loadDesktopConfig({envPath,privateFile})).values,values);
 assert.equal((await fs.stat(envPath)).mode&0o777,0o600);
}));
test('valid saved configuration skips prompts on ordinary install',()=>fixture(async root=>{
 const envPath=path.join(root,'.env');await saveDesktopConfig({envPath,privateFile,values,expectedIdentity:null});
 const before=await privateFile.readVerified(envPath);
 assert.deepEqual(await setupTerminal({envPath,privateFile,prompt:()=>assert.fail('must not prompt')}),{state:'READY'});
 assert.equal((await privateFile.readVerified(envPath)).identity,before.identity);
}));
test('explicit setup can keep saved values; cancellation preserves the original',()=>fixture(async root=>{
 const envPath=path.join(root,'.env');await saveDesktopConfig({envPath,privateFile,values,expectedIdentity:null});
 await setupTerminal({envPath,privateFile,replace:true,prompt:async()=>''});
 assert.deepEqual((await loadDesktopConfig({envPath,privateFile})).values,values);
 const before=await privateFile.readVerified(envPath);
 await assert.rejects(setupTerminal({envPath,privateFile,replace:true,prompt:async({secret})=>{if(secret)throw Error('cancel');return values.tunnelId;}}));
 assert.equal((await privateFile.readVerified(envPath)).identity,before.identity);
}));
test('invalid values and unsafe files cannot overwrite configuration',()=>fixture(async root=>{
 const envPath=path.join(root,'.env');await saveDesktopConfig({envPath,privateFile,values,expectedIdentity:null});
 const before=await privateFile.readVerified(envPath);
 await assert.rejects(setupTerminal({envPath,privateFile,replace:true,prompt:async()=> 'invalid'}),{code:'CONFIG_INVALID'});
 assert.equal((await privateFile.readVerified(envPath)).identity,before.identity);
 await fs.chmod(envPath,0o644);
 await assert.rejects(setupTerminal({envPath,privateFile,prompt:()=>assert.fail('unsafe must not prompt')}),{code:'FILE_UNSAFE'});
}));
test('target uses existing private metadata and refuses a conflicting override',()=>fixture(async home=>{
 const desktop=path.join(home,'Library/Application Support/GSA-Localconnector/desktop');await fs.mkdir(desktop,{recursive:true,mode:0o700});
 const envPath=path.join(home,'custom.env');
 await privateFile.replaceVerified(path.join(desktop,'config.json'),Buffer.from(JSON.stringify({envPath})),null);
 assert.equal(await resolveTerminalTarget({home,privateFile}),envPath);
 await assert.rejects(resolveTerminalTarget({home,privateFile,requestedEnvPath:path.join(home,'other.env')}),{code:'CONFIG_PATH_CONFLICT'});
}));
