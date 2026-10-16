import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {inspectGuestDiskHeader} from "../src/hosts/macos-vm-disk-format.js";
test("QCOW2 is detected but never approved for direct Apple VZ disk attachment",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-disk-"));
 try{
  const file=path.join(root,"guest.img"), header=Buffer.alloc(104);
  header.writeUInt32BE(0x514649fb,0);
  header.writeUInt32BE(3,4);
  header.writeBigUInt64BE(8n*1024n*1024n*1024n,24);
  await fs.writeFile(file,header);
  const got=await inspectGuestDiskHeader(file);
  assert.equal(got.disk_format,"qcow2");
  assert.equal(got.qcow_version,3);
  assert.equal(got.virtual_size_bytes,8589934592);
  assert.equal(got.safe_for_direct_vz_disk_attachment,false);
  assert.equal(got.boot_ready,false);
  assert.equal(got.execution_authorized,false);
  header.writeBigUInt64BE(128n,8);
  await fs.writeFile(file,header);
  assert.equal((await inspectGuestDiskHeader(file)).backing_file_declared,true);
  header.writeBigUInt64BE(4n,72);
  await fs.writeFile(file,header);
  assert.equal((await inspectGuestDiskHeader(file)).external_data_declared,true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
