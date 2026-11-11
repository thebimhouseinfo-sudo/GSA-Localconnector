import {test as platformTest} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {ControlLeaseStore} from "../src/local/control-lease.js";

const test=(name:string,fn:()=>Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX controller fixture":false},fn);
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t1sAAAAASUVORK5CYII=","base64");
const sha=createHash("sha256").update(png).digest("hex");
const source={file_id:"file_test_asset_123456",download_url:"https://files.oaiusercontent.com/temporary?token=REDACT"};
const body=(r:{content:{text:string}[]})=>JSON.parse(r.content[0]!.text);

test("image file tool requires current controller, imports only to active workspace and roundtrips bytes",async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-image-import-")),work=path.join(home,"work"),ref=path.join(home,"reference"),identity=path.join(home,"identity");
 await fs.mkdir(work);await fs.mkdir(ref);
 try{
  const registry=new WorkspaceRegistry();
  await registry.enrollRolesTrusted([{id:"workspace",root:work,role:"workspace"},{id:"reference",root:ref,role:"reference"}]);
  const saved=new Map<string,Buffer>();
  let downloads=0;
  const backend={
   supportedOperations:["create_file"] as const,
   read:async(_r:unknown)=>{throw Error("UNUSED");},
   createExclusive:async(r:{path:string},b:Uint8Array)=>{saved.set(r.path,Buffer.from(b));await fs.writeFile(path.join(work,r.path),b,{flag:"wx"});},
   replaceIfHash:async()=>{},makeDirectory:async()=>{},copyExclusive:async()=>{},moveExclusive:async()=>{},trashIfHash:async()=>{}
  };
  const tools=createReadOnlyTools(registry,backend,null,null,null,null,null,null,null,null,new ControlLeaseStore(identity),{
   grantDirectory:identity,
   downloadImageFile:async()=>{downloads++;return {bytes:png,size:png.length,sha256:sha,mime_type:"image/png"};}
  });
  const call=async(name:string,args:Record<string,unknown>={})=>body(await tools({name,arguments:args}));
  const schema=toolDefinitions().find(x=>x.name==="import_image_file") as any;
  assert.deepEqual(schema?._meta?.["openai/fileParams"],["file"]);
  assert.ok(schema.inputSchema.required.includes("control_token"));
  assert.deepEqual(schema.inputSchema.properties.file.required,["download_url","file_id"]);
  assert.equal((await call("import_image_file",{workspace_id:"workspace",path:"test.png",file:source})).code,"SESSION_INVALID");
  const acquired=await call("acquire_control"),token=acquired.result.control_token;
  const noWrite=await call("import_image_file",{workspace_id:"reference",path:"bad.png",file:source,control_token:token});
  assert.equal(noWrite.code,"PERMISSION_DENIED");
  assert.equal(downloads,0);
  const invalid=await call("import_image_file",{workspace_id:"workspace",path:"../escape.png",file:source,control_token:token});
  assert.equal(invalid.ok,false);
  assert.equal(downloads,0,"reject a path before fetching remote bytes");
  const created=await call("import_image_file",{workspace_id:"workspace",path:"test.png",file:source,control_token:token});
  assert.equal(created.ok,true);
  assert.equal(created.result.source_sha256,sha);
  assert.equal(created.result.mime_type,"image/png");
  assert.equal(created.result.bytes,png.length);
  assert.deepEqual(saved.get("test.png"),png);
  const info=await call("get_file_info",{workspace_id:"workspace",path:"test.png"});
  const read=await call("fetch_file_bytes",{workspace_id:"workspace",path:"test.png"});
  assert.equal(info.ok,true);assert.equal(info.result.sha256,sha);
  assert.equal(read.ok,true);assert.equal(read.result.base64,png.toString("base64"));
  const collision=await call("import_image_file",{workspace_id:"workspace",path:"test.png",file:source,control_token:token});
  assert.equal(collision.ok,false,"exclusive create must never overwrite");
  assert.deepEqual(await fs.readFile(path.join(work,"test.png")),png);
  assert.equal(downloads,2);
  assert.equal((await call("release_control",{control_token:token})).ok,true);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});

test("image file tool does not download when native file backend is unavailable",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-image-import-blocked-")),dir=path.join(root,"work");
 await fs.mkdir(dir);
 try{
  const registry=new WorkspaceRegistry();await registry.enrollRolesTrusted([{id:"work",root:dir,role:"workspace"}]);
  let downloaded=false;
  const invoke=createReadOnlyTools(registry,null,null,null,null,null,null,null,null,null,new ControlLeaseStore(path.join(root,"identity")),{
   fileBackendState:()=>({files:null,fileBlockedReason:"Scoped file grant set changed"}),
   downloadImageFile:async()=>{downloaded=true;throw Error("NOT_ALLOWED");}
  });
  const call=async(name:string,args:Record<string,unknown>={})=>body(await invoke({name,arguments:args}));
  const token=(await call("acquire_control")).result.control_token;
  const denied=await call("import_image_file",{workspace_id:"work",path:"blocked.png",file:source,control_token:token});
  assert.equal(denied.code,"FILE_GRANT_RECOVERY_REQUIRED");
  assert.equal(downloaded,false);
  await call("release_control",{control_token:token});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
