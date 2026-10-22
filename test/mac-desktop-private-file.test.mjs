import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createMacPrivateFile} from "../scripts/mac-desktop-private-file.mjs";

const privateFile=createMacPrivateFile();
const withPrivateDirectory=async fn=>{const created=await fs.mkdtemp(path.join(os.tmpdir(),"gsa-private-env-"));const root=await fs.realpath(created);await fs.chmod(root,0o700);try{return await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}};
const contents=Buffer.from("GSA_LC_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef\nCONTROL_PLANE_API_KEY=synthetic-private-file-key\n");

test("exclusive create writes a private single-link file and verified read returns its identity",async()=>withPrivateDirectory(async root=>{
 const envPath=path.join(root,".env");const created=await privateFile.replaceVerified(envPath,contents,null);
 const observed=await fs.lstat(envPath);const read=await privateFile.readVerified(envPath);
 assert.equal(observed.mode&0o777,0o600);assert.equal(observed.nlink,1);
 assert.deepEqual(read.bytes,contents);assert.equal(read.identity,created.identity);
}));

test("a symlink file is refused on read and replace",async()=>withPrivateDirectory(async root=>{
 const target=path.join(root,"target.env"),link=path.join(root,".env");await fs.writeFile(target,contents,{mode:0o600});await fs.symlink(target,link);
 await assert.rejects(privateFile.readVerified(link));
 await assert.rejects(privateFile.replaceVerified(link,Buffer.from("replacement"),null));
}));

test("a symlinked directory ancestor is refused",async()=>withPrivateDirectory(async root=>{
 const privateDirectory=path.join(root,"private");await fs.mkdir(privateDirectory,{mode:0o700});const envPath=path.join(privateDirectory,".env");await fs.writeFile(envPath,contents,{mode:0o600});
 const alias=path.join(root,"alias");await fs.symlink(privateDirectory,alias);
 await assert.rejects(privateFile.readVerified(path.join(alias,".env")));
}));

test("hard-linked credential files are refused",async()=>withPrivateDirectory(async root=>{
 const envPath=path.join(root,".env"),other=path.join(root,"another-name");await fs.writeFile(envPath,contents,{mode:0o600});await fs.link(envPath,other);
 await assert.rejects(privateFile.readVerified(envPath));
}));

test("group or world readable credential files are refused",async()=>withPrivateDirectory(async root=>{
 const envPath=path.join(root,".env");await fs.writeFile(envPath,contents,{mode:0o644});await fs.chmod(envPath,0o644);
 await assert.rejects(privateFile.readVerified(envPath));
}));

test("expected identity prevents a stale writer from replacing newer configuration",async()=>withPrivateDirectory(async root=>{
 const envPath=path.join(root,".env");const first=await privateFile.replaceVerified(envPath,contents,null);
 const replacement=Buffer.from("GSA_LC_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef\nCONTROL_PLANE_API_KEY=second-synthetic-key\n");
 const second=await privateFile.replaceVerified(envPath,replacement,first.identity);
 await assert.rejects(privateFile.replaceVerified(envPath,contents,first.identity));
 const observed=await privateFile.readVerified(envPath);
 assert.equal(observed.identity,second.identity);assert.deepEqual(observed.bytes,replacement);
}));
