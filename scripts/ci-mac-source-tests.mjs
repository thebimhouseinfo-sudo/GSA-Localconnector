// Exhaustive compiled test discovery: all remaining active native tests are mandatory.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir='dist/test';
if(!fs.existsSync(dir))throw Error('BLOCKED: build did not create dist/test');
const all=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js')).sort();
const required=all.map(f=>path.join(dir,f));
if(!required.length)throw Error('BLOCKED: no non-VM tests compiled');
console.log(JSON.stringify({gate:'C0',discovered:all.length,excludedVM:[],required:required.length}));
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...required],{encoding:'utf8',maxBuffer:24*1024*1024});
// Keep CI logs compact and put failing test names/diagnostics first; the old
// full 600+ suite TAP output was too noisy to identify actionable regressions.
const stdout=result.stdout||'',stderr=result.stderr||'';
if(result.status!==0||result.error){
  const lines=stdout.split('\n');
  const failing=[];
  for(let i=0;i<lines.length;i++){
    if(/^\s*not ok\s+\d+/.test(lines[i])){
      failing.push(lines.slice(Math.max(0,i-1),Math.min(lines.length,i+32)).join('\n'));
      if(failing.length>=8)break;
    }
  }
  process.stderr.write('C0 FAILED TEST DIAGNOSTICS:\n'+(failing.length?failing.join('\n---\n'):'No TAP failing-test markers found; process may have exited early')+'\n');
  process.stderr.write(stderr.slice(-8192));
}else console.log('C0 compiled TAP suite completed; summary follows');

const count=k=>Number((result.stdout||'').match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??NaN);
const tests=count('tests'),pass=count('pass'),fail=count('fail'),skip=count('skipped'),todo=count('todo');
if(result.error||result.status!==0||![tests,pass,fail,skip,todo].every(Number.isFinite)||!tests||fail||todo||pass+skip!==tests){
  console.error('FAIL C0: test process failed, missing TAP summary, or invalid test accounting',JSON.stringify({status:result.status,tests,pass,fail,skip,todo,error:result.error?.message}));
  process.exit(1);
}
console.log(JSON.stringify({gate:'C0',state:'PASS_WITH_REPORTED_SKIPS',tests,pass,fail,skip,todo}));
if(skip)console.log('C0 historical/conditional source test SKIPs are disclosed, NEVER promoted to native C-A/C-B/G3 acceptance. Required native fixtures must independently run with zero SKIP.');


// Desktop lifecycle tests are native-safe .mjs, not part of dist/test compiled discovery.
const desktop=spawnSync(process.execPath,['--test','--test-reporter=tap','test/desktop-supervisor.test.mjs'],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
process.stdout.write(desktop.stdout||'');process.stderr.write(desktop.stderr||'');
const desktopCount=k=>Number((desktop.stdout||'').match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??NaN);
const dt=desktopCount('tests'),dp=desktopCount('pass'),df=desktopCount('fail'),ds=desktopCount('skipped'),dd=desktopCount('todo');
if(desktop.error||desktop.status!==0||!Number.isSafeInteger(dt)||dt<1||dp!==dt||df!==0||ds!==0||dd!==0)throw Error('FAIL/BLOCKED C0 required Desktop lifecycle regression: '+JSON.stringify({status:desktop.status,tests:dt,pass:dp,fail:df,skipped:ds,todo:dd,error:desktop.error?.message}));
console.log(JSON.stringify({gate:'C0-D1',state:'PASS',tests:dt}));

// Menu registration cleanup uses a JS desktop adapter and is not in dist/test.
// Require the real adapter source tests, including the inactive-grant prune
// dispatch and status/denial contracts; skips never count as acceptance.
const adapter=spawnSync(process.execPath,['--test','--test-reporter=tap','test/mac-desktop-adapter.test.mjs'],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
process.stdout.write(adapter.stdout||'');process.stderr.write(adapter.stderr||'');
const adapterCount=k=>Number((adapter.stdout||'').match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??NaN);
const at=adapterCount('tests'),ap=adapterCount('pass'),af=adapterCount('fail'),as=adapterCount('skipped'),ad=adapterCount('todo');
if(adapter.error||adapter.status!==0||!Number.isSafeInteger(at)||at<2||ap!==at||af!==0||as!==0||ad!==0)throw Error('FAIL/BLOCKED C0 required Mac Desktop adapter regressions: '+JSON.stringify({status:adapter.status,tests:at,pass:ap,fail:af,skipped:as,todo:ad,error:adapter.error?.message}));
console.log(JSON.stringify({gate:'C0-DESKTOP-ADAPTER',state:'PASS',tests:at}));
