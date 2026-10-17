// Read-only Codex runtime catalog and project-hook discovery. No model inference or credentials printed.
import fs from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {liveRoot} from './lib.mjs';
export async function runtimeCheck(){
 const cp=spawn('codex',['--strict-config','app-server','--stdio'],{cwd:liveRoot,stdio:['pipe','pipe','pipe']});
 let buffer='',seq=0;const pending=new Map();let stderr='';
 cp.stderr.on('data',b=>{if(stderr.length<65536)stderr+=b.toString();});
 cp.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>4*1024*1024){cp.kill();return;}let nl;while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);let m;try{m=JSON.parse(line);}catch{continue;}const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});
 const rejectAll=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();};
 cp.on('error',rejectAll);cp.on('exit',()=>rejectAll(Error('CODEX_APP_SERVER_EXITED')));
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CODEX_RUNTIME_TIMEOUT'));},25000);pending.set(id,{resolve,reject,timer});cp.stdin.write(JSON.stringify({id,method,params})+'\n');});
 try{
 await call('initialize',{clientInfo:{name:'gsa_harness_check',version:'1.0.0'},capabilities:{experimentalApi:true}});cp.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const models=[];let cursor;do{const page=await call('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});models.push(...(page.data??[]));cursor=page.nextCursor;}while(cursor&&models.length<500);
 const hooks=await call('hooks/list',{cwds:[liveRoot]});
 const skills=await call('skills/list',{cwds:[liveRoot],forceReload:true});
 const roles=JSON.parse(fs.readFileSync(liveRoot+'/harness/roles.json'));
 const assignments=Object.fromEntries(Object.entries(roles).map(([name,role])=>{const model=models.find(m=>m.model===role.model||m.id===role.model);const efforts=(model?.supportedReasoningEfforts??[]).map(x=>typeof x==='string'?x:x.reasoningEffort);return [name,{model:role.model,effort:role.effort,catalog:model&&efforts.includes(role.effort)?'SUPPORTED':'UNVERIFIED_OR_UNAVAILABLE',inference:'NOT_PROBED'}];}));
 return {cli:spawnSync('codex',['--version'],{encoding:'utf8',timeout:5000}).stdout?.trim()||'UNVERIFIED',catalog:models.map(m=>({id:m.id,model:m.model,efforts:m.supportedReasoningEfforts})),assignments,hookDiscovery:hooks,skillDiscovery:{data:(skills.data??[]).map(d=>({cwd:d.cwd,skills:(d.skills??[]).filter(s=>s.path?.startsWith(liveRoot+'/.agents/')).map(s=>({name:s.name,path:s.path,enabled:s.enabled})),errors:d.errors??[]}))},desktop:'RELOAD_AND_VERIFY_REQUIRED',rolePermissions:'CONTRACT_ONLY',reviewLoop:'GUIDED_ONLY'};
 }finally{cp.stdin.end();cp.kill('SIGTERM');}
}
if(process.argv[1]?.endsWith('/runtime-check.mjs')||process.argv[1]==='harness/runtime-check.mjs'){
 try{const x=await runtimeCheck();console.log(JSON.stringify(x,null,2));}catch(e){console.error('RUNTIME_CHECK_BLOCKED: '+e.message);process.exitCode=1;}
}
