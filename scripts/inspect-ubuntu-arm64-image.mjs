#!/usr/bin/env node
// Offline, read-only inspection of already acquired Ubuntu ARM64 disk.
// Never starts a VM or converts images. 
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {inspectGuestDiskHeader} from "../dist/src/hosts/macos-vm-disk-format.js";
const directory=path.join(os.homedir(),"Library","Application Support","GSA-Localconnector","images");
const manifestFile=path.join(directory,"ubuntu-arm64-image-manifest.json");
const fail=(why)=>{throw new Error("IMAGE_INSPECTION_BLOCKED: "+why)};
const manifest=JSON.parse(await fs.readFile(manifestFile,"utf8"));
if(manifest.format!=="gsa-linux-arm64-cloudimg-qcow2-candidate-v1"||
 manifest.arch!=="arm64"||typeof manifest.image_path!=="string"||
 path.dirname(manifest.image_path)!==directory||
 !/^[0-9a-f]{64}$/.test(manifest.sha256)||
 !Number.isSafeInteger(manifest.bytes)||manifest.bytes<4096||
 manifest.boot_ready!==false||manifest.security_verified!==false)fail("Invalid source manifest");
const st=await fs.lstat(manifest.image_path);
if(!st.isFile()||st.isSymbolicLink()||st.size!==manifest.bytes)fail("Disk identity mismatch");
const handle=await fs.open(manifest.image_path,"r");
const h=createHash("sha256"),buf=Buffer.allocUnsafe(1024*1024);
try{
 let position=0;
 while(position<manifest.bytes){
  const {bytesRead}=await handle.read(buf,0,Math.min(buf.length,manifest.bytes-position),position);
  if(!bytesRead)fail("Unexpected EOF");
  h.update(buf.subarray(0,bytesRead));position+=bytesRead;
 }
 const after=await handle.stat();
 if(after.ino!==st.ino||after.dev!==st.dev||after.size!==st.size||after.mtimeMs!==st.mtimeMs)fail("Disk changed during read");
}finally{await handle.close();}
if(h.digest("hex")!==manifest.sha256)fail("SHA256 mismatch");
const format=await inspectGuestDiskHeader(manifest.image_path);
console.log(JSON.stringify({status:"IMAGE_INSPECTED",sha256_verified:true,
 bytes:manifest.bytes,...format,format_conversion_required:format.disk_format==="qcow2"}));
