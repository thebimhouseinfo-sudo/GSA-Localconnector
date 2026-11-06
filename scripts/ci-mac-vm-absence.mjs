// C-VM: assert that no active product source, native fixture, or installer
// depends on the retired Linux VM. Historical docs are intentionally excluded.
import fs from "node:fs";
import path from "node:path";
const roots=["src","native","scripts","test",".github/workflows"];
const forbidden=/macos-vm|native-vm|MacVmCiExecutor|loadMacVmRuntime|guest_worker|install-native-vm|test-vm-/i;
const violations=[];
function scan(root){
 if(!fs.existsSync(root))return;
 for(const e of fs.readdirSync(root,{withFileTypes:true})){
  const file=path.join(root,e.name);
  if(e.isDirectory()){scan(file);continue;}
  if(!e.isFile()||file===path.join("scripts","ci-mac-vm-absence.mjs"))continue;
  const body=fs.readFileSync(file,"utf8");
  if(forbidden.test(body))violations.push(file);
 }
}
roots.forEach(scan);
const pkg=fs.readFileSync("package.json","utf8");
if(forbidden.test(pkg))violations.push("package.json");
if(violations.length){console.error("C-VM FAIL: active Linux VM refs",violations);process.exitCode=1;}
else console.log("C-VM PASS: zero active Linux VM source/install/test/CI references");
