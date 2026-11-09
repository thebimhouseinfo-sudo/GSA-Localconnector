import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {isDesktopPaused} from "../src/local/desktop-pause.js";

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
