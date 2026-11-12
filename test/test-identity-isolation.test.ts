import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {identityDirectory} from "../src/local/identity.js";
import {testIdentityRoot} from "./helpers/identity-root.js";

const testDir=path.resolve("test");

test("test helpers keep identity and HOME away from the real machine state",()=>{
 const tmp=fs.realpathSync(os.tmpdir());
 assert.ok(os.homedir().startsWith(tmp+path.sep),os.homedir());
 if(process.platform==="darwin")assert.ok(identityDirectory().startsWith(tmp+path.sep),identityDirectory());
 assert.ok(testIdentityRoot().startsWith(tmp+path.sep));
});

test("every createReadOnlyTools call in tests passes options.identityRoot",()=>{
 const offenders:string[]=[];
 for(const name of fs.readdirSync(testDir).filter(n=>n.endsWith(".test.ts")&&n!=="test-identity-isolation.test.ts")){
  const source=fs.readFileSync(path.join(testDir,name),"utf8");
  let index=0;
  while((index=source.indexOf("createReadOnlyTools(",index))>=0){
   let depth=0,end=index+"createReadOnlyTools".length;
   for(;end<source.length;end++){
    if(source[end]==="(")depth++;
    else if(source[end]===")"&&--depth===0)break;
   }
   const line=source.slice(0,index).split("\n").length;
   if(!source.slice(index,end).includes("identityRoot"))offenders.push(`${name}:${line}`);
   index=end;
  }
  if(source.includes("createReadOnlyTools(")&&!source.includes("helpers/identity-root.js"))offenders.push(`${name}: missing identity-root helper import`);
 }
 assert.deepEqual(offenders,[]);
});
