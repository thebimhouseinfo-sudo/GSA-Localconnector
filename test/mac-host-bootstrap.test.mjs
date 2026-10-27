import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createChildLifecycle} from '../scripts/mac-recovery-probe-control.mjs';
const execute=promisify(execFile);
const entry=fileURLToPath(new URL('../scripts/test-mac-host-bootstrap.mjs',import.meta.url));
const slot=fileURLToPath(new URL('../docs/reports/.mac-host-bootstrap-v1.attempt.json',import.meta.url));
const existing=()=>fs.readFile(slot).then(bytes=>bytes.toString('base64'),e=>{if(e.code==='ENOENT')return null;throw e;});

test('default, import and invalid run cannot consume the once-only host slot',async()=>{
 const before=await existing(),module=await import('../scripts/test-mac-host-bootstrap.mjs');
 assert.equal((await module.getPlan()).nativeExecution,false);
 const {stdout}=await execute(process.execPath,[entry]);
 assert.equal(JSON.parse(stdout).nativeExecution,false);
 await assert.rejects(execute(process.execPath,[entry,'--run']),e=>e.stderr.includes('EXPLICIT_ACKNOWLEDGEMENT_REQUIRED'));
 assert.equal(await existing(),before);
});
test('one host profile keeps exact root and sysctl filters with fixed twelve cases',async()=>{
 const {HOST_PROFILE,buildCases}=await import('../scripts/test-mac-host-bootstrap.mjs');
 assert.match(HOST_PROFILE,/\(literal "\/"\)/);assert.doesNotMatch(HOST_PROFILE,/\(subpath "\/"\)/);
 assert.match(HOST_PROFILE,/\(sysctl-name "kern.bootargs"\)/);
 assert.match(HOST_PROFILE,/\(sysctl-name "security.mac.lockdown_mode_state"\)/);
 assert.doesNotMatch(HOST_PROFILE,/\(subpath "\/(?:Library|usr|System)"\)/);
 assert.match(HOST_PROFILE,/\(deny network\*\)/);
 const cases=buildCases('/private/tmp/gsa-host-bootstrap-unit',12345);
 assert.equal(cases.length,12);assert.equal(new Set(cases.map(c=>c.id)).size,12);
 assert.equal(cases[0].id,'workspace-read');assert.equal(cases[11].id,'loopback-denied');
 assert.throws(()=>buildCases('/Users/nam',12345));assert.throws(()=>buildCases('/private/tmp/gsa-host-bootstrap-unit',0));
});
test('a failed positive stops the fixed suite with no implicit retry or later launch',async()=>{
 const {executeCases,buildCases}=await import('../scripts/test-mac-host-bootstrap.mjs');
 const calls=[];
 await assert.rejects(executeCases(buildCases('/private/tmp/gsa-host-bootstrap-unit',12345),async c=>{
  calls.push(c.id);return {code:null,signal:'SIGABRT',stdout:'',stderr:'',failure:null};
 },async()=>{}),/UNVERIFIED/);
 assert.deepEqual(calls,['workspace-read']);
});
test('negative cases require a clean attributable denial, never generic errors or crashes',async()=>{
 const {assessResult,buildCases}=await import('../scripts/test-mac-host-bootstrap.mjs');
 const c=buildCases('/private/tmp/gsa-host-bootstrap-unit',12345)[5];
 assert.throws(()=>assessResult(c,{code:1,signal:null,stdout:'',stderr:'No such file',failure:null}),/UNVERIFIED/);
 assert.throws(()=>assessResult(c,{code:null,signal:'SIGABRT',stdout:'',stderr:'Operation not permitted',failure:null}),/UNVERIFIED/);
 assert.throws(()=>assessResult(c,{code:1,signal:null,stdout:'OUTSIDE_MARKER',stderr:c.denialTarget+': Operation not permitted',failure:null}),/ESCAPE/);
 assert.doesNotThrow(()=>assessResult(c,{code:1,signal:null,stdout:'',stderr:c.denialTarget+': Operation not permitted',failure:null}));
});

test('real runner transport bounds output and timeout and never forwards extra descriptors or ambient secrets',async()=>{
 const {createNativeRunner}=await import('../scripts/test-mac-host-bootstrap.mjs');
 for(const scenario of ['output','timeout']){
  const root=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-host-bootstrap-unit-'));
  try{
   const lifecycle=createChildLifecycle(),report={root,started:[]},kills=[];
   let options;
   const spawnImpl=(executable,args,opts)=>{
    assert.equal(executable,'/usr/bin/sandbox-exec');assert.equal(args[0],'-p');options=opts;
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.pid=123;
    child.kill=signal=>{kills.push(signal);queueMicrotask(()=>child.emit('close',null,signal));return true;};
    if(scenario==='output')queueMicrotask(()=>child.stdout.write(Buffer.alloc(16385,65)));
    return child;
   };
   const runner=createNativeRunner(root,report,lifecycle,Date.now()+10000,{spawnImpl,timeoutMs:10});
   const result=await runner({id:'test-'+scenario,executable:'/bin/cat',args:[]});
   assert.equal(result.failure,scenario==='output'?'OUTPUT_LIMIT':'CHILD_TIMEOUT');
   assert.deepEqual(kills,['SIGKILL']);assert.equal(lifecycle.cleanupUnverified,true);
   assert.deepEqual(options.stdio,['pipe','pipe','pipe']);
   assert.deepEqual(Object.keys(options.env).sort(),['PATH','HOME','TMPDIR','LANG','LC_ALL','DEVELOPER_DIR','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_TERMINAL_PROMPT'].sort());
   assert.throws(()=>lifecycle.beforeLaunch(),/OWNED_CHILD_CLEANUP_UNVERIFIED/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

test('an error without close cannot disable the runner cleanup deadline; synchronous spawn failure also latches abort',async()=>{
 const {createNativeRunner}=await import('../scripts/test-mac-host-bootstrap.mjs');
 const root=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-host-bootstrap-unit-'));
 try{
  const lifecycle=createChildLifecycle(),report={root,started:[]};
  const spawnImpl=()=>{
   const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.kill=()=>false;
   queueMicrotask(()=>child.emit('error',Error('synthetic error without close')));
   return child;
  };
  const runner=createNativeRunner(root,report,lifecycle,Date.now()+10000,{spawnImpl,timeoutMs:10});
  let outer;
  try{await assert.rejects(Promise.race([runner({id:'error-without-close',executable:'/bin/cat',args:[]}),new Promise((_,reject)=>{outer=setTimeout(()=>reject(Error('TEST_DEADLINE_EXCEEDED')),1500);})]),e=>e.message==='CHILD_CLEANUP_UNVERIFIED');}
  finally{clearTimeout(outer);}
  assert.equal(lifecycle.cleanupUnverified,true);
  await assert.rejects(runner({id:'must-not-launch'}),/OWNED_CHILD_CLEANUP_UNVERIFIED/);
  assert.deepEqual(report.started,['error-without-close']);
  const second=createChildLifecycle();
  const throwing=createNativeRunner(root,{root,started:[]},second,Date.now()+10000,{spawnImpl:()=>{throw Error('SYNTHETIC_SPAWN_THROW');}});
  await assert.rejects(throwing({id:'spawn-throw',executable:'/bin/cat',args:[]}),/SYNTHETIC_SPAWN_THROW/);
  assert.equal(second.cleanupUnverified,true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
