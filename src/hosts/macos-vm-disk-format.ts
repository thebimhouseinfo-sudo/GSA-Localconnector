import fs from "node:fs/promises";

/** Read-only header inspection. Does not attach disks, convert, or boot a VM. */
export interface DiskFormatInspection {
 readonly disk_format:"qcow2"|"raw-unknown";
 readonly qcow_version:number|null;
 readonly virtual_size_bytes:number|null;
 readonly backing_file_declared:boolean|null;
 readonly external_data_declared:boolean|null;
 readonly safe_for_direct_vz_disk_attachment:false;
 readonly boot_ready:false;
 readonly security_verified:false;
 readonly execution_authorized:false;
}
export async function inspectGuestDiskHeader(file:string):Promise<DiskFormatInspection>{
 const fd=await fs.open(file,"r");
 try{
  const st=await fd.stat();
  if(!st.isFile()||st.size<72)throw new Error("DISK_HEADER_INVALID");
  const header=Buffer.alloc(104);
  const {bytesRead}=await fd.read(header,0,header.length,0);
  if(bytesRead<72)throw new Error("DISK_HEADER_SHORT");
  const qcow=header.readUInt32BE(0)===0x514649fb;
  if(!qcow)return {disk_format:"raw-unknown",qcow_version:null,virtual_size_bytes:null,
   backing_file_declared:null,external_data_declared:null,safe_for_direct_vz_disk_attachment:false,
   boot_ready:false,security_verified:false,execution_authorized:false};
  const version=header.readUInt32BE(4);
  if(version!==2&&version!==3)throw new Error("QCOW_VERSION_UNSUPPORTED");
  const backingOffset=header.readBigUInt64BE(8);
  const backingSize=header.readUInt32BE(16);
  const virtualSize=header.readBigUInt64BE(24);
  if(virtualSize<=0n||virtualSize>128n*1024n*1024n*1024n)throw new Error("QCOW_VIRTUAL_SIZE_INVALID");
  // QCOW2 v3 incompatible features: external data file bit 2.
  const incompatible=version===3&&bytesRead>=80?header.readBigUInt64BE(72):0n;
  return {disk_format:"qcow2",qcow_version:version,virtual_size_bytes:Number(virtualSize),
   backing_file_declared:backingOffset!==0n||backingSize!==0,
   external_data_declared:(incompatible&4n)!==0n,
   safe_for_direct_vz_disk_attachment:false,boot_ready:false,
   security_verified:false,execution_authorized:false};
 }finally{await fd.close();}
}
