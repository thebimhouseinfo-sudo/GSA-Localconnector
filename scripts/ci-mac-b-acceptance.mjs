// C-B: actual Darwin command adapter acceptance; no mocks or VM. All assertions mandatory.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
if(process.platform!=='darwin')throw Error('C-B requires actual macOS runner');
const names=['mac-host-commands','process-journal','process-manager','durable-process','mcp-process-history','mcp-process-revocation'];
const paths=names.map(n=>'dist/test/'+n+'.test.js');
for(const path of paths)if(!fs.existsSync(path))throw Error('BLOCKED C-B required compiled test is missing: '+path);
const p=spawnSync(process.execPath,['--test','--test-reporter=tap',...paths],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:10*60*1000});
process.stdout.write(p.stdout??'');process.stderr.write(p.stderr??'');
const counts={};for(const key of ['tests','pass','fail','skipped','todo']){
 const match=(p.stdout??'').match(new RegExp('^# '+key+' (\\d+)$','m'));
 counts[key]=match?Number(match[1]):NaN;
}
const {tests,pass,fail,skipped,todo}=counts;
console.log('C-B native subprocess, Git, neighbor, timeout, journal assertions:',JSON.stringify(counts));
if(p.error||p.status!==0||!Number.isSafeInteger(tests)||tests<10||pass!==tests||fail!==0||skipped!==0||todo!==0)throw Error('FAIL/BLOCKED C-B: mandatory Darwin tests failed, skipped or incomplete: '+(p.error?.message??p.status));
console.log('PASS C-B targeted native Darwin tests at the CI checkout SHA');
