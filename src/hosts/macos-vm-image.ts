import {createHash,timingSafeEqual} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Host-controlled guest image verification. No download, boot, mount, or mutation. */
export type GuestImageManifest = Readonly<{
 format:"gsa-linux-arm64-raw-v1";
 image_path:string;
 sha256:string;
 bytes:number;
 arch:"arm64";
 provenance:string;
}>;
export class GuestImageError extends Error {
 readonly code="SECURITY_BLOCKED";
 constructor(message:string){super(message);}
}
export function checkGuestImageManifest(value:GuestImageManifest):GuestImageManifest{
 if(!value||value.format!=="gsa-linux-arm64-raw-v1"||value.arch!=="arm64"||
 typeof value.image_path!=="string"||!path.isAbsolute(value.image_path)||
 value.image_path.includes("\0")||value.image_path.split(path.sep).includes("..")||
 !/^[a-f0-9]{64}$/.test(value.sha256)||
 !Number.isSafeInteger(value.bytes)||value.bytes<4096||value.bytes>32*1024*1024*1024||
 typeof value.provenance!=="string"||value.provenance.length<8||value.provenance.length>1024)
 throw new GuestImageError("Invalid pinned guest image manifest");
 return value;
}
export async function verifyGuestImage(manifest:GuestImageManifest):Promise<{
 readonly digest_verified:true;readonly executable:false;readonly security_verified:false;
}>{
 checkGuestImageManifest(manifest);
 const st=await fs.lstat(manifest.image_path);
 if(!st.isFile()||st.isSymbolicLink()||st.size!==manifest.bytes)
  throw new GuestImageError("Guest image type or size mismatch");
 const h=createHash("sha256");
 const handle=await fs.open(manifest.image_path,"r");
 try{
  const before=await handle.stat();
  if(!before.isFile()||before.size!==manifest.bytes||before.ino!==st.ino||before.dev!==st.dev)
   throw new GuestImageError("Guest image changed before verification");
  const chunk=Buffer.allocUnsafe(1024*1024);
  let cursor=0;
  while(cursor<manifest.bytes){
   const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,manifest.bytes-cursor),cursor);
   if(bytesRead===0)throw new GuestImageError("Unexpected guest image EOF");
   h.update(chunk.subarray(0,bytesRead));cursor+=bytesRead;
  }
  const after=await handle.stat();
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)
   throw new GuestImageError("Guest image modified during verification");
 }finally{await handle.close();}
 if(!timingSafeEqual(Buffer.from(h.digest("hex"),"hex"),Buffer.from(manifest.sha256,"hex")))
  throw new GuestImageError("Guest image digest mismatch");
 return {digest_verified:true,executable:false,security_verified:false};
}
