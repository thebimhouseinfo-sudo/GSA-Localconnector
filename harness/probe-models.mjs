// Explicit optional smoke test: small inference calls against configured models, no project source.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {liveRoot} from './lib.mjs';
if(!process.argv.includes('--run')){console.log('Usage: node harness/probe-models.mjs --run (uses account quota; no fallback)');process.exit(0);}
const roles=JSON.parse(fs.readFileSync(liveRoot+'/harness/roles.json'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gsa-model-smoke-'));
const results={};
try{
 for(const [role,config] of Object.entries(roles)){
  const key=config.model+':'+config.effort;
  if(results[key])continue;
  const args=['exec','--strict-config','--ignore-user-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check','-C',dir,'--model',config.model,'-c','model_reasoning_effort='+JSON.stringify(config.effort),'--json','Do not use tools or read files. This is a model availability smoke test only. Reply exactly HARNESS_MODEL_OK.'];
  const result=await new Promise(resolve=>{
   const cp=spawn('codex',args,{cwd:dir,stdio:['ignore','pipe','pipe']});let out='',err='';
   cp.stdout.on('data',b=>{if(out.length<262144)out+=b.toString();});cp.stderr.on('data',b=>{if(err.length<65536)err+=b.toString();});
   const timer=setTimeout(()=>cp.kill('SIGTERM'),45000);cp.on('error',e=>{err=e.message;});cp.on('close',code=>{clearTimeout(timer);const quota=/usage limit|quota|rate.limit|insufficient_quota/i.test(out+err);const done=out.split('\n').flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}}).some(e=>e.type==='item.completed'&&e.item?.type==='agent_message'&&e.item.text?.trim()==='HARNESS_MODEL_OK');resolve({model:config.model,effort:config.effort,state:code===0&&done?'INFERENCE_PASS':quota?'BLOCKED_QUOTA':'UNVERIFIED_OR_UNAVAILABLE',exitCode:code});});
  });
  results[key]=result;console.log(JSON.stringify(result));
  if(result.state==='BLOCKED_QUOTA')break;
 }
 const report=Object.fromEntries(Object.entries(roles).map(([role,c])=>[role,results[c.model+':'+c.effort]??{model:c.model,effort:c.effort,state:'NOT_PROBED_AFTER_BLOCKER'}]));
 const target=path.join(liveRoot,'harness/reports');fs.mkdirSync(target,{recursive:true,mode:0o700});fs.writeFileSync(path.join(target,'model-probes.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}finally{fs.rmSync(dir,{recursive:true,force:true});}
