import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {planMacSeatbelt} from "../src/hosts/macos-seatbelt-candidate.js";

/** Runs ONLY on CI macOS; host owner E2E remains separately required.
 * No pass-through of local system secrets into this deliberately bounded fixture.
 */
test("Seatbelt native candidate permits own workspace and denies sibling read/write",{
 skip:process.platform!=="darwin"||!existsSync("/usr/bin/sandbox-exec")
},async(t)=>{
 const baseline=spawnSync("/usr/bin/sandbox-exec",["-p",["(version 1)","(allow default)"].join(String.fromCharCode(10)),"/usr/bin/true"],{encoding:"utf8",timeout:10000,maxBuffer:65536});
 if(baseline.status!==0){
  t.diagnostic("Native sandbox-exec baseline unavailable: "+JSON.stringify({status:baseline.status,signal:baseline.signal,stderr:baseline.stderr}));
  t.skip("macOS host runner lacks operational sandbox-exec; NOT a native security PASS");
  return;
 }
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-seatbelt-"));
 try{
  const work=path.join(root,"allowed"),outside=path.join(root,"outside");
  await fs.mkdir(work);await fs.mkdir(outside);
  await fs.writeFile(path.join(work,"in.txt"),"ALLOWED");
  await fs.writeFile(path.join(outside,"private.txt"),"DENIED");
  const run=(binary:string,args:string[])=>{
   const p=planMacSeatbelt(work,binary,args);
   return spawnSync(p.command,[...p.argv],{cwd:work,encoding:"utf8",timeout:10000,maxBuffer:65536,env:{PATH:"/usr/bin:/bin"}});
  };
  const positive=run("/bin/cat",[path.join(work,"in.txt")]);
  if(positive.status!==0){
   t.diagnostic("Workspace policy native feasibility BLOCKED: "+JSON.stringify({status:positive.status,signal:positive.signal,stderr:positive.stderr}));
   t.skip("Seatbelt candidate does not launch allowed command on macOS runner; NOT a security PASS");
   return;
  }
  assert.equal(positive.stdout,"ALLOWED");
  const forbidden=run("/bin/cat",[path.join(outside,"private.txt")]);
  assert.notEqual(forbidden.status,0,"forbidden sibling read succeeded");
  assert.ok(!forbidden.stdout.includes("DENIED"),"secret was read");
  const write=run("/usr/bin/touch",[path.join(outside,"created.txt")]);
  assert.notEqual(write.status,0,"forbidden sibling write succeeded");
  await assert.rejects(fs.stat(path.join(outside,"created.txt")));
  // A symlink inside the Workspace must not expose an outside file.
  const link=path.join(work,"outside-link");
  await fs.symlink(path.join(outside,"private.txt"),link);
  const escaped=run("/bin/cat",[link]);
  assert.notEqual(escaped.status,0,"Workspace symlink escaped host sandbox");
  assert.ok(!escaped.stdout.includes("DENIED"),"symlink leaked outside content");
  // Nested commands inherit the sandbox, not only the first executable.
  const nested=run("/bin/sh",["-c","/bin/cat \"$1\"","gsa-nested",path.join(outside,"private.txt")]);
  assert.notEqual(nested.status,0,"nested child escaped host sandbox");
  assert.ok(!nested.stdout.includes("DENIED"),"nested child leaked outside content");
  const writable=run("/usr/bin/touch",[path.join(work,"inside-created.txt")]);
  assert.equal(writable.status,0,"allowed workspace write was denied");
  assert.ok((await fs.stat(path.join(work,"inside-created.txt"))).isFile());

 }finally{await fs.rm(root,{recursive:true,force:true});}
});
