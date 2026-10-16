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
},async()=>{
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
  assert.equal(positive.status,0,positive.stderr);
  assert.equal(positive.stdout,"ALLOWED");
  const forbidden=run("/bin/cat",[path.join(outside,"private.txt")]);
  assert.notEqual(forbidden.status,0,"forbidden sibling read succeeded");
  assert.ok(!forbidden.stdout.includes("DENIED"),"secret was read");
  const write=run("/usr/bin/touch",[path.join(outside,"created.txt")]);
  assert.notEqual(write.status,0,"forbidden sibling write succeeded");
  await assert.rejects(fs.stat(path.join(outside,"created.txt")));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
