// Test-only module copy exposes the unexported constructor; no production bypass.
// These synthetic C fixtures assert adapter contracts, never Swift/native proof.
import fs from 'node:fs/promises';
import os from 'node:os';
import {loadMacScopedFiles} from '../../src/hosts/macos-scoped-files.js';
const sourceURL=new URL('../../src/hosts/macos-scoped-files.js',import.meta.url);
let candidate:Promise<any>|undefined;
export const fixtureBuild=()=>({uuid:'00000000-0000-0000-0000-000000000000',source_sha256:'0'.repeat(64),compiler_sha256:'0'.repeat(64),driver:'xcrun-macosx-swiftc-v1',sdk:{path:'/synthetic/sdk',version:'test',settings_sha256:'0'.repeat(64)},compiler_version:'synthetic adapter fixture',release_sha256:'0'.repeat(64),code_sha256:'0'.repeat(64),arguments:['-O','-Xlinker','-reproducible'],signing_profile:'gsa-scoped-files-adhoc-single-root-v1',hostRelease:os.release(),arch:process.arch});
export const loadMacScopedFilesCandidate:typeof loadMacScopedFiles=async(registry,installation,options)=>{
 candidate??=(async()=>{const source=(await fs.readFile(sourceURL,'utf8')).replace('async function constructMacScopedFiles(', 'export async function constructMacScopedFiles(').replace('if (sha(normalizedStrippedMacFileCode(await fs.readFile(copy))) !== proof.build.code_sha256)', 'if (false)') .replace(/from (["'])(\.[^"']+)\1/g,(_m,quote,relative)=>`from ${quote}${new URL(relative,sourceURL).href}${quote}`);return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));})();
 return (await candidate).constructMacScopedFiles(registry,installation,options,true);
};
