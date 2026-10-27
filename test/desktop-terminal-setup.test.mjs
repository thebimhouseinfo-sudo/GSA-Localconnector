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

test('explicit setup repairs verified malformed bytes without exposing their identity or contents',()=>fixture(async root=>{
 const envPath=path.join(root,'.env');await privateFile.replaceVerified(envPath,Buffer.from('invalid-synthetic-config'),null);
 const publicResult=await loadDesktopConfig({envPath,privateFile});
 assert.deepEqual(publicResult,{state:'SETUP_REQUIRED',reason:'CONFIG_INVALID'});
 await assert.rejects(setupTerminal({envPath,privateFile,prompt:()=>assert.fail('implicit repair must not prompt')}),{code:'CONFIG_INVALID'});
 const result=await setupTerminal({envPath,privateFile,replace:true,prompt:async({secret})=>secret?values.apiKey:values.tunnelId});
 assert.deepEqual(result,{state:'SAVED'});assert.deepEqual((await loadDesktopConfig({envPath,privateFile})).values,values);
}));

test('cancelled or stale malformed-config repair preserves original or newer bytes',()=>fixture(async root=>{
 const envPath=path.join(root,'.env'),original=Buffer.from([0xff,0xfe]);
 await privateFile.replaceVerified(envPath,original,null);
 const before=await privateFile.readVerified(envPath);
 await assert.rejects(setupTerminal({envPath,privateFile,replace:true,prompt:async()=>{throw Error('cancel');}}));
 assert.deepEqual((await privateFile.readVerified(envPath)).bytes,original);
 const newer=Buffer.from('newer-synthetic-invalid-content');let changed=false;
 await assert.rejects(setupTerminal({envPath,privateFile,replace:true,prompt:async({secret})=>{
  if(!changed){changed=true;await privateFile.replaceVerified(envPath,newer,before.identity);}
  return secret?values.apiKey:values.tunnelId;
 }}),{code:'FILE_STALE'});
 assert.deepEqual((await privateFile.readVerified(envPath)).bytes,newer);
}));

test('explicit replacement still refuses unsafe malformed files and aliases before prompting',()=>fixture(async root=>{
 const envPath=path.join(root,'.env');await fs.writeFile(envPath,'invalid',{mode:0o600});await fs.chmod(envPath,0o644);
 await assert.rejects(setupTerminal({envPath,privateFile,replace:true,prompt:()=>assert.fail('unsafe file must not prompt')}),{code:'FILE_UNSAFE'});
 await fs.chmod(envPath,0o600);const alias=path.join(root,'alias');await fs.symlink(envPath,alias);
 await assert.rejects(setupTerminal({envPath:alias,privateFile,replace:true,prompt:()=>assert.fail('alias must not prompt')}),{code:'FILE_UNSAFE'});
}));
