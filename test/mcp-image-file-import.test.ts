import {test as platformTest} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {WorkspaceRegistry} from "../src/core/workspace.js";
import {createReadOnlyTools,toolDefinitions} from "../src/mcp/server.js";
import {downloadChatGptImage} from "../src/mcp/image-file-transfer.js";
import {ControlLeaseStore} from "../src/local/control-lease.js";

const test=(name:string,fn:()=>Promise<void>)=>platformTest(name,{skip:process.platform==="win32"?"POSIX controller fixture":false},fn);
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t1sAAAAASUVORK5CYII=","base64");
const sha=createHash("sha256").update(png).digest("hex");
const source={file_id:"file_test_asset_123456",download_url:"https://files.oaiusercontent.com/temporary?token=REDACT",mime_type:"image/png",file_name:"test.png"};
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
   downloadImageFile:async(file,target)=>downloadChatGptImage(file,target,(async()=>{downloads++;return new Response(Uint8Array.from(png).buffer as ArrayBuffer,{status:200});}) as typeof fetch)
  });
  const call=async(name:string,args:Record<string,unknown>={})=>body(await tools({name,arguments:args}));
  const schema=toolDefinitions().find(x=>x.name==="import_image_file") as any;
  assert.deepEqual(schema?._meta?.["openai/fileParams"],["file"]);
  assert.ok(schema.inputSchema.required.includes("control_token"));
  assert.deepEqual(schema.inputSchema.properties.file.required,["download_url","file_id"]);
  assert.deepEqual(Object.keys(schema.inputSchema.properties.file.properties).sort(),["download_url","file_id","file_name","mime_type"].sort());
  assert.equal(schema.inputSchema.properties.file.additionalProperties,false);
  assert.deepEqual(schema.annotations,{readOnlyHint:false,destructiveHint:false,openWorldHint:false,idempotentHint:false});
  assert.equal((await call("import_image_file",{workspace_id:"workspace",path:"test.png",file:source})).code,"SESSION_INVALID");
  const acquired=await call("acquire_control"),token=acquired.result.control_token;
  const unresolved=await call("import_image_file",{workspace_id:"workspace",path:"unresolved.png",file:source.file_id,control_token:token});
  assert.equal(unresolved.code,"FILEPARAM_UNRESOLVED");
  const nullFile=await call("import_image_file",{workspace_id:"workspace",path:"null.png",file:null,control_token:token});
  assert.equal(nullFile.code,"FILEPARAM_NULL");
  const incomplete=await call("import_image_file",{workspace_id:"workspace",path:"incomplete.png",file:{file_name:"image.png"},control_token:token});
  assert.equal(incomplete.code,"FILEPARAM_DOWNLOAD_URL_MISSING");
  const missing=await call("import_image_file",{workspace_id:"workspace",path:"missing.png",control_token:token});
  assert.equal(missing.code,"FILEPARAM_MISSING");
  assert.equal(downloads,0,"no fetch for unresolved, null, incomplete or missing file");
  const typeInvalid=await call("import_image_file",{workspace_id:"workspace",path:"bad-id.png",file:{...source,file_id:42},control_token:token});
  assert.equal(typeInvalid.code,"FILEPARAM_FILE_ID_TYPE_INVALID");
  assert.equal(downloads,0,"invalid ID types must not fetch");
  const unknownOrigin=await call("import_image_file",{workspace_id:"workspace",path:"unapproved.png",file:{...source,download_url:"https://cdn.newvendor.example/item?secret=topsecret"},control_token:token});
  assert.equal(unknownOrigin.code,"IMAGE_URL_HOST_REJECTED");
  assert.equal(unknownOrigin.host_suffix,"newvendor.example");
  assert.ok(!JSON.stringify(unknownOrigin).includes("topsecret"));
  assert.ok(!JSON.stringify(unknownOrigin).includes("cdn."));
  assert.equal(downloads,0,"unapproved host must never be fetched");
  for(const r of [unresolved,nullFile,incomplete,missing])assert.equal(r.ok,false);
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
