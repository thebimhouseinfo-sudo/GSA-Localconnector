// Hosted G3 packaging gate: build and attest a disposable unsigned-install stage; no real Mac setup.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createMacInstaller} from './mac-desktop-install.mjs';
const fail=(reason)=>{throw Error('BLOCKED/FAIL C-G3: '+reason);};
if(process.platform!=='darwin'||process.arch!=='arm64')fail('hosted Darwin ARM64 required');
const sha=process.env.SOURCE_SHA??process.env.GITHUB_SHA;
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(!/^[0-9a-f]{40}$/.test(sha??'')||git.status!==0||git.stdout.trim()!==sha)fail('exact candidate SHA mismatch');
const tests=spawnSync(process.execPath,['--test','--test-reporter=tap','scripts/test-mac-package.mjs'],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
process.stdout.write(tests.stdout??'');process.stderr.write(tests.stderr??'');
const counts={};
for(const key of ['tests','pass','fail','skipped','todo']){const m=(tests.stdout??'').match(new RegExp('^# '+key+' (\\d+)$','m'));counts[key]=m?Number(m[1]):NaN;}
if(tests.error||tests.status!==0||counts.tests<5||counts.pass!==counts.tests||counts.fail!==0||counts.skipped!==0||counts.todo!==0)fail('package safety test missing/failed/skipped '+JSON.stringify(counts));
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ci-mac-g3-')));
await fs.chmod(root,0o700);
let adapter,stage;
try{
 const client=path.join(process.cwd(),'bin/tunnel-client');
 const st=await fs.stat(client).catch(()=>null);
 if(!st?.isFile())fail('real pinned tunnel-client artifact unavailable; do not substitute fake binary');
 const options=await createMacInstaller({home:root,sourceRoot:process.cwd(),clientPath:client,registerLogin:false});
 adapter=options.platformAdapter;
 const host=await adapter.inspectHost();
 stage=await adapter.buildStage({sourceRoot:options.sourceRoot,installRoot:options.installRoot,envPath:options.envPath,current:{state:'EMPTY'},host});
 assert.equal(await adapter.verifyStage(stage),true);
 const release=JSON.parse(await fs.readFile(path.join(stage.stageRoot,'manifest.json'),'utf8'));
 assert.equal(release.format,'gsa-desktop-release-v1');
 assert.equal(release.platform,'darwin');assert.equal(release.arch,'arm64');
 assert.ok(Object.keys(release.files).some(x=>x.endsWith('GSA Local Connector.app/Contents/MacOS/GSA Local Connector')));
 assert.ok(!Object.keys(release.files).some(x=>/(^|\/)\.env$|mcp-token|server-owner\.lock/.test(x)));
 assert.match(stage.uiIdentity.cdhash,/^[a-f0-9]{40}$/);
 console.log(JSON.stringify({gate:'C-G3-package',state:'PASS',sha,manifestFileCount:Object.keys(release.files).length,uiCdhash:stage.uiIdentity.cdhash,stageOnly:true,installedOnUserMac:false}));
}finally{
 if(stage&&adapter)await adapter.discardStage(stage);
 if(adapter)await adapter.releaseInstall();
 await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
