// Exhaustive compiled test discovery: only historical product-VM suites are excluded.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir='dist/test';
if(!fs.existsSync(dir))throw Error('BLOCKED: build did not create dist/test');
const all=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js')).sort();
const excluded=all.filter(f=>/^macos-vm-(artifacts|ci|runtime)\.test\.js$/.test(f));
const vmUnexpected=all.filter(f=>f.startsWith('macos-vm-')&&!excluded.includes(f));
if(vmUnexpected.length)throw Error('BLOCKED: unreviewed VM test exclusions: '+vmUnexpected.join(', '));
const required=all.filter(f=>!excluded.includes(f)).map(f=>path.join(dir,f));
if(!required.length)throw Error('BLOCKED: no non-VM tests compiled');
console.log(JSON.stringify({gate:'C0',discovered:all.length,excludedVM:excluded,required:required.length}));
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...required],{encoding:'utf8',maxBuffer:24*1024*1024});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
const count=k=>Number((result.stdout||'').match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??NaN);
const tests=count('tests'),pass=count('pass'),fail=count('fail'),skip=count('skipped'),todo=count('todo');
if(result.error||result.status!==0||![tests,pass,fail,skip,todo].every(Number.isFinite)||!tests||fail||todo||pass+skip!==tests){
  console.error('FAIL C0: test process failed, missing TAP summary, or invalid test accounting',JSON.stringify({status:result.status,tests,pass,fail,skip,todo,error:result.error?.message}));
  process.exit(1);
}
console.log(JSON.stringify({gate:'C0',state:'PASS_WITH_REPORTED_SKIPS',tests,pass,fail,skip,todo}));
if(skip)console.log('C0 historical/conditional source test SKIPs are disclosed, NEVER promoted to native C-A/C-B/G3 acceptance. Required native fixtures must independently run with zero SKIP.');
