import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createChildLifecycle} from '../scripts/mac-recovery-probe-control.mjs';
const execute=promisify(execFile);
const entry=new URL('../scripts/test-mac-host-bootstrap-v2.mjs',import.meta.url);
const oldSlot=new URL('../docs/reports/.mac-host-bootstrap-v1.attempt.json',import.meta.url);
const newSlot=new URL('../docs/reports/.mac-host-bootstrap-v2.attempt.json',import.meta.url);
const bytes=url=>fs.readFile(url).then(b=>b.toString('base64'),e=>{if(e.code==='ENOENT')return null;throw e;});

test('v2 preparation preserves both slots and rejects v1 acknowledgement',async()=>{
 const before=await Promise.all([bytes(oldSlot),bytes(newSlot)]);
 const {stdout}=await execute(process.execPath,[entry.pathname]);
 const plan=JSON.parse(stdout);
 assert.equal(plan.nativeExecution,false);assert.equal(plan.activation,false);
 assert.equal(plan.maximumSandboxInvocations,12);assert.equal(plan.reservation,newSlot.pathname);
 assert.match(plan.command,/--ack-reviewed-dev-null-variant$/);
 await assert.rejects(execute(process.execPath,[entry.pathname,'--run','--ack-reviewed-bootstrap-variant']),e=>e.stderr.includes('EXPLICIT_ACKNOWLEDGEMENT_REQUIRED'));
 assert.deepEqual(await Promise.all([bytes(oldSlot),bytes(newSlot)]),before);
});

test('v2 changes only the literal null-device write rule; commands and rejection semantics stay fixed',async()=>{
 const v1=await import('../scripts/test-mac-host-bootstrap.mjs'),v2=await import('../scripts/test-mac-host-bootstrap-v2.mjs');
 assert.equal(v2.HOST_PROFILE.replace('(allow file-write-data (literal "/dev/null"))\n',''),v1.HOST_PROFILE);
 const cases=v2.buildCases('/private/tmp/gsa-host-bootstrap-unit',12345);
 assert.deepEqual(cases,v1.buildCases('/private/tmp/gsa-host-bootstrap-unit',12345));
 const calls=[];
 await assert.rejects(v2.executeCases(cases,async c=>{calls.push(c.id);return {code:128,signal:null,stdout:'',stderr:'fatal',failure:null};},async()=>{}),/UNVERIFIED_POSITIVE/);
 assert.deepEqual(calls,['workspace-read']);
 assert.throws(()=>v2.assessResult(cases[5],{code:1,signal:null,stdout:'',stderr:'unrelated error',failure:null}),/UNVERIFIED_DENIAL/);
});

test('v2 real runner forwards the reviewed profile with only standard descriptors and clean env',async()=>{
 const v2=await import('../scripts/test-mac-host-bootstrap-v2.mjs');
 const root=await fs.realpath(await fs.mkdtemp('/private/tmp/gsa-host-bootstrap-unit-'));
 try{
  const lifecycle=createChildLifecycle(),report={root,started:[]};
  const spawnImpl=(exe,args,options)=>{
   assert.equal(exe,'/usr/bin/sandbox-exec');assert.equal(args[1],v2.HOST_PROFILE);
   assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.equal(options.shell,false);
   assert.deepEqual(Object.keys(options.env).sort(),['PATH','HOME','TMPDIR','LANG','LC_ALL','DEVELOPER_DIR','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_TERMINAL_PROMPT'].sort());
   const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   queueMicrotask(()=>{child.stdout.write('ALLOWED_MARKER');child.emit('close',0,null);});return child;
  };
  const result=await v2.createNativeRunner(root,report,lifecycle,Date.now()+10000,{spawnImpl})(v2.buildCases('/private/tmp/gsa-host-bootstrap-unit',12345)[0]);
  assert.equal(result.stdout,'ALLOWED_MARKER');assert.equal(lifecycle.cleanupUnverified,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
