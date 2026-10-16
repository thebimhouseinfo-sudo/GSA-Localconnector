#!/usr/bin/env node
// Explicit local conversion only. Original QCOW2 remains untouched.
// Fail closed: no install, VM boot, connector execution or privilege escalation.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {inspectGuestDiskHeader} from "../dist/src/hosts/macos-vm-disk-format.js";

const dir=path.join(os.homedir(),"Library","Application Support","GSA-Localconnector","images");
const manifestPath=path.join(dir,"ubuntu-arm64-image-manifest.json");
const source=path.join(dir,"ubuntu-24.04-server-cloudimg-arm64.img");
const destination=path.join(dir,"ubuntu-24.04-arm64-converted.raw");
const tmp=destination+".partial";
const fail=(code)=>{throw Object.assign(new Error(code),{code:"CONVERSION_BLOCKED"});};
if(process.platform!=="darwin"||process.arch!=="arm64")fail("MACOS_ARM64_REQUIRED");
if(process.argv.length!==2)fail("NO_ARGUMENTS_ALLOWED");
const m=JSON.parse(await fs.readFile(manifestPath,"utf8"));
if(m.image_path!==source||m.format!=="gsa-linux-arm64-cloudimg-qcow2-candidate-v1"||
 m.sha256!=="1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55"||
 m.bytes!==620224512||m.arch!=="arm64"||m.boot_ready!==false)fail("SOURCE_MANIFEST_MISMATCH");
const stat=await fs.lstat(source);
if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==m.bytes)fail("SOURCE_IDENTITY_MISMATCH");
const format=await inspectGuestDiskHeader(source);
if(format.disk_format!=="qcow2"||format.qcow_version!==3||
 format.virtual_size_bytes!==3758096384||format.backing_file_declared||format.external_data_declared)
 fail("UNEXPECTED_QCOW2_LAYOUT");
for(const file of [destination,tmp,destination+".manifest.json"]){
 try{await fs.lstat(file);fail("DESTINATION_EXISTS");}catch(e){if(e.code!=="ENOENT")throw e;}
}
const exe="/opt/homebrew/bin/qemu-img";
const candidate=await fs.stat(exe).catch(()=>null);
if(!candidate?.isFile())fail("QEMU_IMG_NOT_INSTALLED");
const check=spawnSync(exe,["info","--output=json",source],{encoding:"utf8",timeout:15000,maxBuffer:65536});
if(check.status!==0)fail("QEMU_IMG_INFO_FAILED");
const info=JSON.parse(check.stdout);
if(info.format!=="qcow2"||Number(info["virtual-size"])!==3758096384||
 info["backing-filename"]||info["full-backing-filename"]||info["data-file"]||
 info["encrypted"]===true)fail("QEMU_IMAGE_UNSAFE");
let finished=false;
try{
 const run=spawnSync(exe,["convert","-f","qcow2","-O","raw","-S","0",source,tmp],
 {encoding:"utf8",timeout:600000,maxBuffer:65536});
 if(run.status!==0)fail("QEMU_CONVERSION_FAILED");
 const actual=await fs.lstat(tmp);
 if(!actual.isFile()||actual.isSymbolicLink()||actual.size!==3758096384)fail("RAW_SIZE_MISMATCH");
 const hash=createHash("sha256"),handle=await fs.open(tmp,"r");
 try{
  const buf=Buffer.allocUnsafe(1024*1024);
  for(let pos=0;pos<actual.size;){
   const {bytesRead}=await handle.read(buf,0,Math.min(buf.length,actual.size-pos),pos);
   if(!bytesRead)fail("RAW_UNEXPECTED_EOF");
   hash.update(buf.subarray(0,bytesRead));pos+=bytesRead;
  }
 }finally{await handle.close();}
 const sha256=hash.digest("hex");
 await fs.rename(tmp,destination);
 const output={format:"gsa-linux-arm64-raw-v1",image_path:destination,bytes:actual.size,sha256,
 arch:"arm64",provenance:"converted from pinned official Ubuntu ARM64 QCOW2",boot_ready:false,
 security_verified:false,execution_authorized:false};
 await fs.writeFile(destination+".manifest.json",JSON.stringify(output,null,2)+"\n",{flag:"wx",mode:0o600});
 finished=true;
 console.log(JSON.stringify({status:"RAW_CONVERSION_VERIFIED",bytes:actual.size,sha256,
  boot_ready:false,security_verified:false,execution_authorized:false}));
}finally{
 if(!finished)await fs.rm(tmp,{force:true});
}
