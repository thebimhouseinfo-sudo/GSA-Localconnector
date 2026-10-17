import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {liveRoot,resolveRole} from './lib.mjs';
const root=liveRoot;
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):e.isFile()?[path.join(p,e.name)]:[]);
for(const file of walk(path.join(root,'harness')).filter(p=>p.endsWith('.mjs')&&!p.includes('/snapshots/'))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);}
for(const p of ['policy.json','roles.json','milestones.json','milestones.schema.json'])JSON.parse(fs.readFileSync(path.join(root,'harness',p)));
const roles=JSON.parse(fs.readFileSync(path.join(root,'harness/roles.json')));
for(const name of Object.keys(roles)){
 const resolved=resolveRole(root,name);const text=fs.readFileSync(path.join(root,'.codex/agents',name+'.toml'),'utf8');
 if(!text.includes('model = '+JSON.stringify(resolved.model))||!text.includes('model_reasoning_effort = '+JSON.stringify(resolved.effort)))throw Error('ROLE_RUNTIME_DRIFT: '+name);
}
const hooks=JSON.parse(fs.readFileSync(path.join(root,'.codex/hooks.json')));if(!hooks.hooks.Stop?.length)throw Error('STOP_HOOK_MISSING');
const agents=fs.readFileSync(path.join(root,'AGENTS.md'),'utf8');if(agents.trim().split('\n').length>=60)throw Error('AGENTS_TOO_LONG');
console.log('PASS: harness syntax, configuration, five role/model assignments and hook schema basics');
