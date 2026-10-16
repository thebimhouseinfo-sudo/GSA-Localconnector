import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export interface HostProbe{
 readonly platform:string;readonly arch:string;readonly release:string;readonly node_version:string;
 readonly native_strategy:string;readonly candidate_available:boolean|null;
 readonly security_verified:false;readonly requires_host_negative_test:true;
}
/** Deliberately read-only: no spawned command, no registry mutation, no credentials.
 * The return value is feature discovery, NEVER sandbox certification.
 */
export async function probeNativeCapabilities():Promise<HostProbe>{
 const platform=process.platform,arch=process.arch;
 let strategy="UNSUPPORTED_PLATFORM",available:boolean|null=null;
 if(platform==="darwin"){
  strategy="macos-seatbelt-candidate";
  try{available=(await fs.stat("/usr/bin/sandbox-exec")).isFile();}
  catch{available=false;}
 }else if(platform==="win32"){
  strategy="windows-appcontainer-native-worker-required";
  available=null; // Node cannot prove AppContainer process isolation availability.
 }
 return {platform,arch,release:os.release(),node_version:process.version,
  native_strategy:strategy,candidate_available:available,security_verified:false,requires_host_negative_test:true};
}
const isMain=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname);
if(isMain)probeNativeCapabilities().then(x=>{process.stdout.write(JSON.stringify(x,null,2)+"\n");})
 .catch(e=>{process.stderr.write("NATIVE_PROBE_FAILED: "+(e instanceof Error?e.message:String(e))+"\n");process.exitCode=1;});
