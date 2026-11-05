import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {MacNativeCommands} from "../src/hosts/macos-host-commands.js";
import {executeGit} from "../src/core/git-engine.js";

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
 assert.equal(pwd.stdout,path.join(root,"child"));
}));
onMac("Track B denies traversal absolute cwd symlink reference and revoked grant",()=>fixture(async(host,root,registry)=>{
 for(const cwd_relative of ["../outside","/tmp",".//x","x/../y",""])await assert.rejects(host.execute(request({cwd_relative})));
 await fs.symlink(os.tmpdir(),path.join(root,"escape"));
 await assert.rejects(host.execute(request({cwd_relative:"escape"})));
 await registry.enrollRolesTrusted([{id:"reference",root:await fs.mkdtemp(path.join(os.tmpdir(),"gsa-b-reference-")),role:"reference"}]).then(async()=>{});
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
