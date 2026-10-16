#!/usr/bin/env node
// Read-only environment feasibility probe except disposable test files under OS tmp.
// Does not certify production security. Never prints file content or secrets.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {planMacSeatbelt} from "../dist/src/hosts/macos-seatbelt-candidate.js";

const result={
 platform:"macos",profile_version:"seatbelt-candidate-v1",
 baseline_allowed:false,workspace_read_allowed:false,
 sibling_read_denied:false,sibling_write_denied:false,
 symlink_escape_denied:false,nested_child_denied:false,workspace_write_allowed:false,
 outcome:"SECURITY_BLOCKED",security_verified:false
};
if(process.platform!=="darwin"){
 console.log(JSON.stringify({...result,outcome:"WRONG_PLATFORM"}));process.exit(0);
}
const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-policy-"));
try{
 const own=path.join(root,"allowed"),other=path.join(root,"outside");
 await fs.mkdir(own);await fs.mkdir(other);await fs.mkdir(path.join(own,"tmp"));
 await fs.writeFile(path.join(own,"allowed.txt"),"allowed");
 await fs.writeFile(path.join(other,"outside.txt"),"not-for-output");
 const call=(program,args,baseline=false)=>{
  const cmd=baseline?{command:"/usr/bin/sandbox-exec",argv:["-p",["(version 1)","(allow default)"].join(String.fromCharCode(10)),program,...args]}:planMacSeatbelt(own,program,args);
  return spawnSync(cmd.command,[...cmd.argv],{
   cwd:own,encoding:"utf8",timeout:10000,maxBuffer:16384,
   env:{PATH:"/usr/bin:/bin",HOME:own,TMPDIR:path.join(own,"tmp")}
  });
 };
 const base=call("/usr/bin/true",[],true);
 result.baseline_allowed=base.status===0;
 if(result.baseline_allowed){
  const ok=call("/bin/cat",[path.join(own,"allowed.txt")]);
  result.workspace_read_allowed=ok.status===0&&ok.stdout==="allowed";
  if(result.workspace_read_allowed){
   const denied=call("/bin/cat",[path.join(other,"outside.txt")]);
   result.sibling_read_denied=denied.status!==0&&!denied.stdout?.includes("not-for-output");
   const blocked=call("/usr/bin/touch",[path.join(other,"new.txt")]);
   let fileExists=true;
   try{await fs.stat(path.join(other,"new.txt"));}catch{fileExists=false;}
   result.sibling_write_denied=blocked.status!==0&&!fileExists;
   await fs.symlink(path.join(other,"outside.txt"),path.join(own,"outside-link"));
   const linked=call("/bin/cat",[path.join(own,"outside-link")]);
   result.symlink_escape_denied=linked.status!==0&&!linked.stdout?.includes("not-for-output");
   const child=call("/bin/sh",["-c",'/bin/cat "$1"',"gsa-child",path.join(other,"outside.txt")]);
   result.nested_child_denied=child.status!==0&&!child.stdout?.includes("not-for-output");
   const write=call("/usr/bin/touch",[path.join(own,"inside-created.txt")]);
   result.workspace_write_allowed=write.status===0;

  }
 }
 if(result.workspace_read_allowed&&result.workspace_write_allowed&&result.sibling_read_denied&&result.sibling_write_denied&&result.symlink_escape_denied&&result.nested_child_denied)
  result.outcome="EXTENDED_POLICY_NEGATIVE_CONTROLS_PASS";
}finally{
 await fs.rm(root,{recursive:true,force:true});
}
console.log(JSON.stringify(result));
