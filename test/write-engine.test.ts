import {test} from "node:test";
import assert from "node:assert/strict";
import {createFile,updateFile,editFile,copyFile,moveFile,trashFile} from "../src/core/write-engine.js";
import {sha256} from "../src/core/edit-guards.js";
import type {NativeScopedFiles,ScopedFileRef} from "../src/core/native-io.js";
const key=(r:ScopedFileRef)=>r.workspace_id+"/"+r.path;
class FakeFiles implements NativeScopedFiles {
 data=new Map<string,Uint8Array>();
 async read(r:ScopedFileRef,max:number){const b=this.data.get(key(r));if(!b||b.length>max)throw Error("MISSING");return {bytes:b,sha256:sha256(b),kind:"file" as const};}
 async createExclusive(r:ScopedFileRef,b:Uint8Array){if(this.data.has(key(r)))throw Error("CONFLICT");this.data.set(key(r),b);}
 async replaceIfHash(r:ScopedFileRef,b:Uint8Array,h:string){const current=this.data.get(key(r));if(!current||sha256(current)!==h)throw Error("HASH_CONFLICT");this.data.set(key(r),b);}
 async makeDirectory(_r:ScopedFileRef){}
 async copyExclusive(a:ScopedFileRef,b:ScopedFileRef,h:string){const d=await this.read(a,100000);if(d.sha256!==h)throw Error("HASH_CONFLICT");await this.createExclusive(b,d.bytes);}
 async moveExclusive(a:ScopedFileRef,b:ScopedFileRef,h:string){await this.copyExclusive(a,b,h);this.data.delete(key(a));}
 async trashIfHash(r:ScopedFileRef,h:string){const d=await this.read(r,100000);if(d.sha256!==h)throw Error("HASH_CONFLICT");this.data.delete(key(r));}
}
test("file mutations are hash guarded and backend scoped",async()=>{
 const f=new FakeFiles(),a={workspace_id:"w",path:"src/a.txt"},b={workspace_id:"w2",path:"dest.txt"};
 const created=await createFile(f,a,"hello world");assert.equal(created.committed,false);
 await assert.rejects(createFile(f,a,"different"));
 await assert.rejects(updateFile(f,a,"bad","0".repeat(64)));
 const edited=await editFile(f,a,"world","GSA",created.after_sha256!);
 assert.equal(edited.file_mutated,true);
 const copied=await copyFile(f,a,b,edited.after_sha256!);
 assert.equal(copied.after_sha256,edited.after_sha256);
 await moveFile(f,b,{workspace_id:"w2",path:"moved.txt"},edited.after_sha256!);
 await trashFile(f,a,edited.after_sha256!);
 assert.equal(f.data.has(key(a)),false);
 await assert.rejects(createFile(f,{workspace_id:"w",path:"../escape"},"no"));
});
