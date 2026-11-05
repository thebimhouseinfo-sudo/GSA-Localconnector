// Deliberate fail-closed integration boundary; do not synthesize a native PASS.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [gate,entry]=process.argv.slice(2);
const allowed={'C-A':'scripts/ci-mac-a-acceptance.mjs','C-B':'scripts/ci-mac-b-acceptance.mjs','C-G3':'scripts/ci-mac-g3-acceptance.mjs'};
if(!Object.hasOwn(allowed,gate)||entry!==allowed[gate]){console.error('FAIL: unsupported gate contract');process.exit(2);}
if(process.platform!=='darwin'){console.error('BLOCKED '+gate+': actual Darwin runner required');process.exit(2);}
if(!fs.existsSync(entry)){console.error('BLOCKED '+gate+': required executable fixture missing: '+entry+'; upstream native implementation and independently asserted suite not accepted');process.exit(2);}
const r=spawnSync(process.execPath,[entry],{stdio:'inherit',timeout:10*60*1000});
if(r.error||r.signal||r.status!==0){console.error('FAIL '+gate+': required acceptance fixture failed or timed out',r.error?.message||r.signal||r.status);process.exit(1);}
console.log('PASS '+gate+': acceptance fixture exited successfully; consult assertion-level evidence before release');
