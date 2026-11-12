import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {isDesktopPaused} from "../src/local/desktop-pause.js";
import * as pauseModule from "../src/local/desktop-pause.js";

test("pause reader identifies insecure permissions and retries transient hard links",{skip:process.platform!=="darwin"},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-pause-retry-"));
 const dir=path.join(root,"desktop"),file=path.join(dir,"pause-state.json"),link=path.join(root,"extra");
 try{
  const read=(pauseModule as any).readDesktopPauseFile;
  await fs.mkdir(dir);
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:true}),{mode:0o600});
  await fs.chmod(file,0o644);
  await assert.rejects(isDesktopPaused(root),{code:"DESKTOP_PAUSE_STATE_UNTRUSTED",reason:"NOT_PRIVATE"});
  await fs.chmod(file,0o600);await fs.link(file,link);
  await assert.rejects(read(file,{attempts:1}),{reason:"LINK_COUNT"});
  const removal=setTimeout(()=>void fs.unlink(link),5);
  try{assert.deepEqual(await read(file,{attempts:3,delayMs:20}),{exists:true,paused:true});}finally{clearTimeout(removal);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("pause reader does not retry durable failures and reports missing uid",{skip:process.platform!=="darwin"},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-pause-durable-"));
 const file=path.join(root,"pause-state.json");
 const original=process.getuid;
 try{
  const read=(pauseModule as any).readDesktopPauseFile;
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:true}),{mode:0o600});
  await fs.chmod(file,0o644);
  const started=Date.now();
  await assert.rejects(read(file,{attempts:3,delayMs:200}),{reason:"NOT_PRIVATE"});
  assert.ok(Date.now()-started<150,"NOT_PRIVATE must not be retried");
  await fs.chmod(file,0o600);
  process.getuid=undefined as any;
  await assert.rejects(read(file),{reason:"UID_UNAVAILABLE"});
 }finally{process.getuid=original;await fs.rm(root,{recursive:true,force:true});}
});

test("Mac desktop pause gate is fail-closed for malformed or insecure state",{
 skip:process.platform!=="darwin"
},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-desktop-pause-"));
 const dir=path.join(root,"desktop"),file=path.join(dir,"pause-state.json");
 await fs.mkdir(dir,{mode:0o700});await fs.chmod(root,0o700);
 try{
  assert.equal(await isDesktopPaused(root),false);
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:true}),{mode:0o600});
  assert.equal(await isDesktopPaused(root),true);
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:false}));
  assert.equal(await isDesktopPaused(root),false);
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:"false"}));
  await assert.rejects(isDesktopPaused(root),/UNTRUSTED/);
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:true}));
  await fs.chmod(file,0o644);
  await assert.rejects(isDesktopPaused(root),/UNTRUSTED/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
