import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile,stat} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {identityDirectory,initializeToken,loadToken} from "../src/local/identity.js";
test("platform identity directories differ",()=>{
 assert.match(identityDirectory("win32","C:\\Users\\x"),/GSA-Localconnector$/);
 assert.match(identityDirectory("darwin","/Users/example"),/Library/);
 assert.throws(()=>identityDirectory("linux"),/UNSUPPORTED_PLATFORM/);
});
test("token is unique, persisted and never regenerated",async()=>{
 const a=await mkdtemp(path.join(os.tmpdir(),"gsa-identity-a-"));
 const b=await mkdtemp(path.join(os.tmpdir(),"gsa-identity-b-"));
 try{
  assert.equal((await initializeToken(a)).created,true);
  assert.equal((await initializeToken(a)).created,false);
  const ta=await loadToken(a),tb=await loadToken(b).catch(()=>null);
  assert.equal(tb,null);
  await initializeToken(b);
  assert.notEqual(ta,await loadToken(b));
  assert.ok(ta.length>=32);
  assert.equal((await readFile(path.join(a,"mcp-token"),"utf8")).trim(),ta);
  if(process.platform!=="win32")assert.equal((await stat(path.join(a,"mcp-token"))).mode&0o077,0);
 }finally{await rm(a,{recursive:true,force:true});await rm(b,{recursive:true,force:true});}
});
