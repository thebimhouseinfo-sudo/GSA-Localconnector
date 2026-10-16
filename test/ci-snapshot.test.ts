import {test} from "node:test";
import assert from "node:assert/strict";
import {createSnapshotManifest} from "../src/core/ci-snapshot.js";
const b=(text:string)=>Buffer.from(text);
test("immutable input manifest is deterministic and bounded",()=>{
 const a=[{path:"src/z.ts",bytes:b("zzz")},{path:"src/a.ts",bytes:b("aaa")}];
 const first=createSnapshotManifest(a);
 assert.equal(first.source_sha256,createSnapshotManifest([...a].reverse()).source_sha256);
 assert.equal(first.total_bytes,6);
 assert.deepEqual(first.files.map(x=>x.path),["src/a.ts","src/z.ts"]);
 assert.throws(()=>createSnapshotManifest([{path:"../private",bytes:b("oops")}]));
 assert.throws(()=>createSnapshotManifest([a[0],a[0]]),(e:any)=>e.code==="SNAPSHOT_DUPLICATE");
 assert.throws(()=>createSnapshotManifest(a,10,5),(e:any)=>e.code==="SNAPSHOT_QUOTA");
});
