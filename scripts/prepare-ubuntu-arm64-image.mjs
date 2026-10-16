#!/usr/bin/env node
// Explicit, opt-in acquisition of an official Ubuntu ARM64 cloud disk for VM research.
// No install, mount, VM boot, entitlement change or connector activation.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {Readable} from "node:stream";

const BASE="https://cloud-images.ubuntu.com/releases/noble/release/";
const FILE="ubuntu-24.04-server-cloudimg-arm64.img";
const MAX_BYTES=2*1024*1024*1024;
const targetDir=process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.homedir(),"Library","Application Support","GSA-Localconnector","images");
const fail=(message)=>{throw new Error("IMAGE_PREPARATION_BLOCKED: "+message)};
if(process.platform!=="darwin"||process.arch!=="arm64")fail("macOS arm64 only");
if(process.argv.includes("--help")){console.log("Usage: node scripts/prepare-ubuntu-arm64-image.mjs [destination-directory]");process.exit(0);}
if(process.argv.length>3)fail("Unexpected arguments");
const head=await fetch(BASE+"SHA256SUMS",{signal:AbortSignal.timeout(20000),redirect:"error"});
if(!head.ok)fail("Official checksum download HTTP "+head.status);
const sums=await head.text();
if(sums.length>200000)fail("Oversized checksum manifest");
const item=sums.split(/\r?\n/).find(x=>x.trim().endsWith("  "+FILE)||x.trim().endsWith(" *"+FILE));
if(!item)fail("ARM64 image missing from official checksum manifest");
const sha=item.trim().slice(0,64).toLowerCase();
if(!/^[0-9a-f]{64}$/.test(sha))fail("Invalid checksum entry");
// The official HTTPS site and SHA256 checksum protect transport corruption,
// NOT independently authenticated provenance: detached signature trust remains pending.
await fs.mkdir(targetDir,{recursive:true,mode:0o700});
const realDir=await fs.realpath(targetDir);
if(realDir!==targetDir)fail("Target directory must be canonical (no symlink parents)");
const dest=path.join(realDir,FILE);
const part=dest+".partial";
const manifestPath=path.join(realDir,"ubuntu-arm64-image-manifest.json");
try{await fs.lstat(manifestPath);fail("Manifest exists: refusing overwrite");}catch(e){if(e.code!=="ENOENT")throw e;}
try{await fs.lstat(dest);fail("Destination exists: refusing overwrite");}catch(e){if(e.code!=="ENOENT")throw e;}
try{await fs.lstat(part);fail("Partial download already exists: refusing overwrite");}catch(e){if(e.code!=="ENOENT")throw e;}
const response=await fetch(BASE+FILE,{signal:AbortSignal.timeout(900000),redirect:"error"});
if(!response.ok||!response.body)fail("Official disk image unavailable: HTTP "+response.status);
const declared=Number(response.headers.get("content-length"));
if(!Number.isFinite(declared)||declared<4096||declared>MAX_BYTES)fail("Invalid image size header");
const handle=await fs.open(part,"wx",0o600);
let bytes=0;
const hash=createHash("sha256");
try{
 const stream=Readable.fromWeb(response.body);
 for await(const chunk of stream){
  bytes+=chunk.length;
  if(bytes>MAX_BYTES||bytes>declared)fail("Download exceeds declared size");
  hash.update(chunk);
  await handle.writeFile(chunk);
 }
 if(bytes!==declared)fail("Incomplete image body");
 await handle.sync();
} catch(e){await handle.close();await fs.rm(part,{force:true});throw e;}
await handle.close();
if(hash.digest("hex")!==sha){await fs.rm(part,{force:true});fail("SHA256 mismatch");}
await fs.rename(part,dest);
const manifest={format:"gsa-linux-arm64-cloudimg-qcow2-candidate-v1",image_path:dest,sha256:sha,bytes,arch:"arm64",provenance:BASE+FILE,boot_ready:false,security_verified:false,execution_authorized:false};
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({status:"DOWNLOADED_AND_SHA256_VERIFIED",file:dest,bytes,sha256:sha,boot_ready:false,security_verified:false,execution_authorized:false}));
