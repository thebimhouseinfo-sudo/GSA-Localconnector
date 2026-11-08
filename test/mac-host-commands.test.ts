import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {MacNativeCommands} from "../src/hosts/macos-host-commands.js";
import {executeGit} from "../src/core/git-engine.js";
import {enrollRolesTrustedBatch} from "../src/local/grants.js";

const mac=test.skip; // Platform-specific tests are mandatory on hosted Darwin CI.
const onMac=process.platform==="darwin"?test:mac;
async function fixture(run:(host:MacNativeCommands,root:string,registry:WorkspaceRegistry)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-b-native-"));
 try{
  const registry=new WorkspaceRegistry();
  await registry.enrollRolesTrusted([{id:"work",root,role:"workspace"}]);
  await run(new MacNativeCommands(registry),root,registry);
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
function request(overrides:Record<string,unknown>={}){
 return {workspace_id:"work",executable:process.execPath,argv:["-e","process.stdout.write('ok');process.stderr.write('err')"],cwd_relative:".",
  time_limit_ms:4000,max_output_bytes:1024,network_allowed:false,...overrides};
}
onMac("Track B native process stdout stderr exit and subdirectory cwd",()=>fixture(async(host,root)=>{
 await fs.mkdir(path.join(root,"child"));
 const receipt=await host.execute(request({cwd_relative:"child"}));
 assert.equal(receipt.exit_code,0);assert.equal(receipt.stdout,"ok");assert.equal(receipt.stderr,"err");
 assert.equal(receipt.timed_out,false);assert.equal(receipt.output_limited,false);
 const pwd=await host.execute(request({cwd_relative:"child",argv:["-e","process.stdout.write(process.cwd())"]}));
 assert.equal(await fs.realpath(pwd.stdout),await fs.realpath(path.join(root,"child")));
}));
onMac("Track B denies traversal absolute cwd symlink reference and revoked grant",()=>fixture(async(host,root,registry)=>{
 for(const cwd_relative of ["../outside","/tmp",".//x","x/../y",""])await assert.rejects(host.execute(request({cwd_relative})));
 await fs.symlink(os.tmpdir(),path.join(root,"escape"));
 await assert.rejects(host.execute(request({cwd_relative:"escape"})));
 const reference=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-b-reference-"));
 try{
  await registry.enrollRolesTrusted([{id:"reference",root:reference,role:"reference"}]);
  await assert.rejects(host.execute(request({workspace_id:"reference"})));
 }finally{await fs.rm(reference,{recursive:true,force:true});}
 registry.revoke("work");
 await assert.rejects(host.execute(request()));
}));
onMac("Track B caps stdout and records nonzero failures",()=>fixture(async host=>{
 const failed=await host.execute(request({argv:["-e","process.stderr.write('failure');process.exit(17)"]}));
 assert.equal(failed.exit_code,17);assert.equal(failed.stderr,"failure");
 const capped=await host.execute(request({argv:["-e","process.stdout.write('x'.repeat(100))"],max_output_bytes:8}));
 assert.equal(capped.output_limited,true);assert.equal(capped.stdout.length,8);
}));
onMac("Track B stops only owned process group, preserving unrelated neighbor",()=>fixture(async host=>{
 const neighbor=spawn(process.execPath,["-e","setTimeout(()=>{},15000)"],{stdio:"ignore"});
 try{
  const started=await host.start(request({argv:["-e","setInterval(()=>{},1000)"],time_limit_ms:10000}));
  assert.equal((await host.status(started.native_id)).state,"RUNNING");
  const stopped=await host.stop(started.native_id);
  assert.equal(stopped.stopped,true);
  assert.equal(stopped.state,"CANCELLED");
  assert.equal(neighbor.exitCode,null);
 }finally{neighbor.kill("SIGTERM");}
}));
onMac("Track B local Git reports dirty files without resetting them",()=>fixture(async(host,root)=>{
 const exec=async(argv:string[])=>host.execute(request({executable:"git",argv}));
 assert.equal((await exec(["init","-q"])).exit_code,0);
 await fs.writeFile(path.join(root,"dirty.txt"),"preserve-me");
 const result=await executeGit(host,"work","git_status");
 assert.equal(result.exit_code,0);
 assert.match(result.output,/dirty.txt/);
 assert.equal(await fs.readFile(path.join(root,"dirty.txt"),"utf8"),"preserve-me");
}));

onMac("Track B timeout is bounded and never reported as a normal success",()=>fixture(async host=>{
 const result=await host.execute(request({argv:["-e","setInterval(()=>{},1000)"],time_limit_ms:250}));
 assert.equal(result.timed_out,true);
 assert.notEqual(result.exit_code,0);
}));
onMac("Track B controller retains bounded output cursors and rejects unowned process IDs",()=>fixture(async host=>{
 const started=await host.start(request({argv:["-e","process.stdout.write('abcdef');process.stderr.write('XYZ')"]}));
 const status=await host.wait(started.native_id);
 assert.equal(status.state,"SUCCEEDED");
 const first=await host.output(started.native_id,0,4);
 assert.equal(first.stdout,"abcd");
 assert.notEqual(first.next_cursor,null);
 const second=await host.output(started.native_id,first.next_cursor!,8);
 assert.equal(second.stdout,"ef");
 assert.equal(second.stderr,"XYZ");
 assert.equal(second.next_cursor,null);
 await assert.rejects(host.stop("unowned-id"),(error:any)=>error.code==="PROCESS_NOT_FOUND");
}));

onMac("Track B runs existing non-Git shell script from valid subdirectory",()=>fixture(async(host,root)=>{
 const scripts=path.join(root,"scripts");await fs.mkdir(scripts);
 await fs.writeFile(path.join(scripts,"build.sh"),"#!/bin/sh\nprintf 'built\\n'\nprintf 'warn\\n' >&2\n", {mode:0o700});
 const result=await host.execute(request({executable:"/bin/sh",argv:["./build.sh"],cwd_relative:"scripts"}));
 assert.equal(result.exit_code,0);assert.equal(result.stdout,"built\n");assert.equal(result.stderr,"warn\n");
}));
onMac("Track B does not inherit connector runtime tokens",()=>fixture(async host=>{
 const name="GSA_TRACK_B_SECRET_SENTINEL";
 const previous=process.env[name];
 process.env[name]="SECRET_SHOULD_NOT_ENTER_CHILD";
 try{
  const result=await host.execute(request({argv:["-e",`process.stdout.write(process.env.${name}||'CLEAN')`]}));
  assert.equal(result.stdout,"CLEAN");
 }finally{
  if(previous===undefined)delete process.env[name];else process.env[name]=previous;
 }
}));
onMac("Track B synchronous cancellation confirms physical stop",()=>fixture(async host=>{
 const process_id="b-test-owned";
 const execution=host.execute(request({process_id,argv:["-e","setInterval(()=>{},1000)"],time_limit_ms:12000}));
 // Wait for the owned child to be observable; cancellation never probes a guessed PID.
 let running=false;
 for(let attempt=0;attempt<50;attempt++){
  try{running=(await host.status(process_id)).state==="RUNNING";if(running)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(running,true);
 assert.equal(await host.cancel(process_id,"work"),true);
 const receipt=await execution;
 assert.equal(receipt.cancelled,true);
 assert.equal((await host.status(process_id)).stopped,true);
}));

onMac("Track B installer inspect returns promptly and does not break command supervisor",()=>fixture(async(host,root)=>{
 // The real inspector is read-only. Run against disposable grant state, never
 // the machine's active connector identity or installation.
 const canonicalRoot=await fs.realpath(root);
 const identity=path.join(canonicalRoot,"identity");
 const selected=path.join(canonicalRoot,"selected");
 await fs.mkdir(selected,{mode:0o700});
 await enrollRolesTrustedBatch([{id:"selected",root:selected,role:"workspace"}],identity);
 await fs.chmod(identity,0o700); // Installer requires exact private0700, not merely group-inaccessible.
 const script=path.resolve("scripts/install-mac-scoped-files.mjs");
 const inspect=await host.execute(request({
  executable:process.execPath,
  argv:[script,"inspect","--identity-root",identity],
  time_limit_ms:8000,
  max_output_bytes:8192
 }));
 assert.equal(inspect.timed_out,false,"inspect must not exhaust command timeout");
 assert.equal(inspect.exit_code,0,`inspector stderr: ${inspect.stderr}`);
 assert.equal(JSON.parse(inspect.stdout).state,"SCOPED_FILES_PLAN");
 const after=await host.execute(request({argv:["-e","process.stdout.write('SUPERVISOR_ALIVE')"]}));
 assert.equal(after.exit_code,0);
 assert.equal(after.stdout,"SUPERVISOR_ALIVE");
 assert.deepEqual(await fs.readdir(identity).then(entries=>entries.filter(name=>name.startsWith(".scoped-files.stage-"))),[]);
}));
