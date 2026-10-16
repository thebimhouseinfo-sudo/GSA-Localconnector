import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {verifyGuestImage,checkGuestImageManifest} from "../src/hosts/macos-vm-image.js";
test("VM guest image digest proof cannot authorize execution",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-image-"));
 try{
  const file=path.join(root,"guest.raw");
  const bytes=Buffer.alloc(4096,13);
  await fs.writeFile(file,bytes);
  const manifest={format:"gsa-linux-arm64-raw-v1" as const,image_path:file,
   sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,
   arch:"arm64" as const,provenance:"test-only-local-fixture"};
  assert.deepEqual(await verifyGuestImage(manifest),{digest_verified:true,executable:false,security_verified:false});
  await assert.rejects(verifyGuestImage({...manifest,sha256:"0".repeat(64)}),(e:any)=>e.code==="SECURITY_BLOCKED");
  assert.throws(()=>checkGuestImageManifest({...manifest,image_path:"../guest.raw"}),(e:any)=>e.code==="SECURITY_BLOCKED");
  const link=path.join(root,"guest-link.raw");
  await fs.symlink(file,link);
  await assert.rejects(verifyGuestImage({...manifest,image_path:link}),(e:any)=>e.code==="SECURITY_BLOCKED");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
