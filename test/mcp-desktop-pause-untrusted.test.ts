import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools} from "../src/mcp/server.js";
import './helpers/identity-root.js';

const decode=(result:any)=>JSON.parse(result.content[0].text);

test("unverifiable pause state blocks effects but keeps diagnostics available",{skip:process.platform!=="darwin"},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"gsa-mcp-untrusted-")));
 const dir=path.join(root,"desktop"),file=path.join(dir,"pause-state.json");
 try{
  await fs.mkdir(dir,{mode:0o700});
  await fs.writeFile(file,JSON.stringify({format:"gsa-desktop-pause-v1",paused:false}),{mode:0o600});
  await fs.chmod(file,0o644);
  const invoke=createReadOnlyTools(new WorkspaceRegistry(),null,null,null,null,null,null,null,null,null,null,{identityRoot:root});
  for(const name of ["connector_status","list_capabilities"]){
   const body=decode(await invoke({name}));
   assert.equal(body.ok,true,name);
   assert.equal(body.result.desktopPaused,null);
   assert.equal(body.result.desktopPauseReason,"NOT_PRIVATE");
  }
  const fetched=decode(await invoke({name:"fetch_file",arguments:{workspace_id:"missing",path:"a.txt"}}));
  assert.doesNotMatch(fetched.message??"",/DESKTOP_PAUSE_STATE_UNTRUSTED|CONNECTOR_PAUSED/);
  const blocked=decode(await invoke({name:"create_file",arguments:{workspace_id:"missing",path:"a.txt",content:"x"}}));
  assert.equal(blocked.code,"SECURITY_BLOCKED");
  assert.match(blocked.message??"",/DESKTOP_PAUSE_STATE_UNTRUSTED/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
