import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "./isolate-home.js";

// Empty per-process identity directory for createReadOnlyTools(options.identityRoot).
const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"gsa-test-identity-"));
process.on("exit",()=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{}});
export const testIdentityRoot=():string=>root;
