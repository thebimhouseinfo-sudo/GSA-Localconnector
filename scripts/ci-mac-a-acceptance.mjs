// C-A: signed disposable broker and scoped file acceptance, NOT installation.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
if(process.platform!=='darwin')throw Error('BLOCKED C-A: actual macOS required');
const sources=['mac-scoped-files','mac-file-authorization-contract','mac-file-code','mac-file-evidence','mac-file-recovery','mac-file-transaction-log','native-file-candidate'];
const paths=sources.map(n=>'dist/test/'+n+'.test.js');
for(const p of paths)if(!fs.existsSync(p))throw Error('BLOCKED C-A: missing required suite '+p);
const node=spawnSync(process.execPath,['--test','--test-reporter=tap',...paths],{encoding:'utf8',timeout:10*60*1000,maxBuffer:20*1024*1024});
process.stdout.write(node.stdout??'');process.stderr.write(node.stderr??'');
const counts={};for(const k of ['tests','pass','fail','skipped','todo']){const m=(node.stdout??'').match(new RegExp('^# '+k+' (\\d+)$','m'));counts[k]=m?Number(m[1]):NaN;}
if(node.error||node.status!==0||counts.tests<15||counts.pass!==counts.tests||counts.fail!==0||counts.skipped!==0||counts.todo!==0)throw Error('FAIL C-A compiled file tests: '+JSON.stringify(counts));
const signed=spawnSync('python3',['native/macos-files/test-broker.py'],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
process.stdout.write(signed.stdout??'');process.stderr.write(signed.stderr??'');
let evidence;try{evidence=JSON.parse((signed.stdout??'').trim().split('\n').at(-1));}catch{}
const required=['native-read','traversal-denied','symlink-denied','hardlink-denied','create-exclusive','create-duplicate-denied','copy-exclusive','hash-conflict','ancestor-relocation','root-identity'];
if(signed.error||signed.status!==0||evidence?.ok!==true||evidence?.cleanup?.temporary_root_removed!==true||required.some(n=>!evidence.checks?.includes(n))||!evidence?.artifacts?.signature?.code_directory_hash)throw Error('BLOCKED C-A actual signed broker proof incomplete');
console.log('C-A base signed broker checks PASS; verifying independent recovery-broker candidate on actual Darwin');
const recovery=spawnSync('python3',['scripts/ci-mac-a-recovery-candidate.py'],{encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
process.stdout.write(recovery.stdout??'');process.stderr.write(recovery.stderr??'');
if(recovery.error||recovery.status!==0)throw Error('FAIL/BLOCKED C-A real signed recovery candidate proof: '+String(recovery.error?.message??recovery.status));
console.log('C-A real signed sandbox broker checks PASS; checking interruption/owned-helper production gate');
const interruption='scripts/ci-mac-a-interruption-proof.mjs';
if(!fs.existsSync(interruption))throw Error('BLOCKED C-A: production integrated interruption, physical owned-helper stop and UNKNOWN/no-replay gate missing: '+interruption);
const p=spawnSync(process.execPath,[interruption],{stdio:'inherit',timeout:180000});
if(p.error||p.status!==0)throw Error('FAIL C-A interruption/owned-helper gate');
console.log('PASS C-A signed broker + core journal + direct owned-helper interruption scope; checked installed-loader and escaped-descendant qualification remain separate PRELOCAL findings');
