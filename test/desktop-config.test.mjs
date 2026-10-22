import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {parseDesktopEnv,loadDesktopConfig,saveDesktopConfig,resolveDesktopSetup} from "../scripts/desktop-config.mjs";
import {createMacPrivateFile} from "../scripts/mac-desktop-private-file.mjs";

const validValues=()=>({tunnelId:"tunnel_0123456789abcdef0123456789abcdef",apiKey:"synthetic-api-key-for-tests"});
const privateFile=createMacPrivateFile();
const fixture=async fn=>{const created=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-desktop-config-"));const root=await fs.realpath(created);await fs.chmod(root,0o700);try{return await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}};
const serialize=({tunnelId,apiKey})=>`GSA_LC_TUNNEL_ID=${tunnelId}\nCONTROL_PLANE_API_KEY=${apiKey}\n`;

test("parseDesktopEnv accepts exactly the two documented fields",()=>{
 const values=parseDesktopEnv(serialize(validValues()));
 assert.deepEqual(values,validValues());
});

test("resolveDesktopSetup saves once and relaunch, login, update, and repair reuse the same env without prompting",async()=>fixture(async root=>{
 const envPath=path.join(root,"desktop",".env");let prompts=0;
 const first=await resolveDesktopSetup({envPath,privateFile,setupRequested:true,promptOnce:async()=>{prompts++;return validValues();}});
 assert.equal(first.state,"READY");assert.equal(prompts,1);
 for(const lifecycle of ["relaunch","login","update","repair"]){
  const next=await resolveDesktopSetup({envPath,privateFile,promptOnce:async()=>{prompts++;throw Error(`unexpected credential prompt during ${lifecycle}`);}});
  assert.equal(next.state,"READY",lifecycle);assert.deepEqual(next.values,validValues(),lifecycle);
 }
 assert.equal(prompts,1);
}));

test("configured absolute env path is reused without copying to the default path",async()=>fixture(async root=>{
 const configuredDirectory=path.join(root,"existing-config");await fs.mkdir(configuredDirectory,{mode:0o700});
 const envPath=path.join(configuredDirectory,".env");await saveDesktopConfig({envPath,values:validValues(),expectedIdentity:null,privateFile});
 let prompts=0;const loaded=await resolveDesktopSetup({envPath,privateFile,promptOnce:async()=>{prompts++;throw Error("existing setup must be reused");}});
 assert.equal(loaded.state,"READY");assert.equal(prompts,0);
 await assert.rejects(fs.access(path.join(root,"desktop",".env")));
}));

test("shell metacharacters remain literal key data and never execute",async()=>fixture(async root=>{
 const marker=path.join(root,"must-not-exist");
 const literal=`synthetic-$(touch ${marker})-\`whoami\``;
 const parsed=parseDesktopEnv(serialize({...validValues(),apiKey:literal}));
 assert.equal(parsed.apiKey,literal);
 await assert.rejects(fs.access(marker));
}));

test("duplicate, unknown, malformed tunnel, and control-character values are rejected",()=>{
 const tunnelId=validValues().tunnelId;
 for(const source of [
  `GSA_LC_TUNNEL_ID=${tunnelId}\nGSA_LC_TUNNEL_ID=${tunnelId}\nCONTROL_PLANE_API_KEY=synthetic-key\n`,
  `GSA_LC_TUNNEL_ID=${tunnelId}\nCONTROL_PLANE_API_KEY=synthetic-key\nPATH=/tmp\n`,
  "GSA_LC_TUNNEL_ID=tunnel_invalid\nCONTROL_PLANE_API_KEY=synthetic-key\n",
  `GSA_LC_TUNNEL_ID=${tunnelId}\nCONTROL_PLANE_API_KEY=synthetic\u0001key\n`
 ])assert.throws(()=>parseDesktopEnv(source));
});

test("missing and unsafe configuration returns one actionable setup state without secret text",async()=>fixture(async root=>{
 const envPath=path.join(root,"missing",".env");let prompts=0;
 const result=await loadDesktopConfig({envPath,privateFile});
 assert.equal(result.state,"SETUP_REQUIRED");
 assert.equal(typeof result.reason,"string");assert.ok(result.reason.length>0);
 assert.equal(JSON.stringify(result).includes(validValues().apiKey),false);
 const resolved=await resolveDesktopSetup({envPath,privateFile,setupRequested:true,promptOnce:async()=>{prompts++;return validValues();}});
 assert.equal(resolved.state,"READY");assert.equal(prompts,1);
}));

test("failed save with stale file identity preserves the previously saved configuration",async()=>fixture(async root=>{
 const envPath=path.join(root,".env");const original=await saveDesktopConfig({envPath,values:validValues(),expectedIdentity:null,privateFile});
 const wrongValues={...validValues(),apiKey:"replacement-synthetic-key"};
 await assert.rejects(saveDesktopConfig({envPath,values:wrongValues,expectedIdentity:"stale-identity",privateFile}));
 const loaded=await loadDesktopConfig({envPath,privateFile});
 assert.equal(loaded.state,"READY");assert.deepEqual(loaded.values,validValues());assert.equal(loaded.identity,original.identity);
}));
