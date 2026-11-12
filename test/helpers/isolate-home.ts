import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Test processes must never read the developer's real
// ~/Library/Application Support/GSA-Localconnector. Importing this module
// (directly or through identity-root.ts) points HOME at an empty temp dir.
const home=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"gsa-test-home-"));
process.env.HOME=home;
process.on("exit",()=>{try{fs.rmSync(home,{recursive:true,force:true});}catch{}});
export const isolatedHome=home;
