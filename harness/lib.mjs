// Project harness only. This module never implements or mutates product behavior.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const liveRoot=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=s=>{throw new Error(s);};
const optional=(fn,fallback)=>{try{return fn();}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const secret=p=>/^(?:\.gsa\/local-state(?:\/|$)|\.continue(?:\/|$)|\.git(?:\/|$)|\.codex\/(?:sessions|cache)(?:\/|$))/.test(p)||p.split('/').some(x=>/^\.env(?:\.|$)/.test(x)||/\.(?:key|pem|p12|pfx)$/.test(x)||['.ssh','secrets'].includes(x));
const protectedPath=p=>p==='harness/state.json'||p.startsWith('harness/snapshots/')||p.startsWith('harness/local-state/');
export function safe(root,rel,{write=false,privateOK=false}={}) {
 if(typeof rel!=='string'||!rel||rel.includes('\0')||rel.includes('\\')||path.isAbsolute(rel)||rel.split('/').some(x=>x==='..'||x==='.'||!x))fail('PATH_DENIED');
 if(secret(rel))fail('SECRET_PATH_DENIED');
 if(!privateOK&&protectedPath(rel))fail('PROTECTED_PATH_DENIED');
 const base=fs.realpathSync(root);let cur=base;
 for(const part of rel.split('/')){cur=path.join(cur,part);const st=optional(()=>fs.lstatSync(cur),null);if(st?.isSymbolicLink())fail('SYMLINK_PATH_DENIED');if(st&&!st.isDirectory()&&cur!==path.join(base,rel))fail('PATH_NOT_DIRECTORY');}
 const st=optional(()=>fs.lstatSync(cur),null);if(st&&st.isFile()&&(st.nlink!==1||st.size>8*1024*1024))fail('PATH_UNSAFE_OR_TOO_LARGE');
 return cur;
}
const read=(root,p)=>fs.readFileSync(safe(root,p,{privateOK:true}));
const json=(root,p,fallback)=>optional(()=>JSON.parse(read(root,p).toString()),fallback);
function atomic(root,rel,data){const dest=safe(root,rel,{privateOK:true});fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});safe(root,rel,{privateOK:true});const tmp=dest+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{mode:0o600,flag:'wx'});try{fs.renameSync(tmp,dest);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
const save=(root,p,v)=>atomic(root,p,JSON.stringify(v,null,2)+'\n');
function locked(root,fn){const p=safe(root,'harness/local-state/operation.lock',{privateOK:true});fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});try{fs.mkdirSync(p,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('HARNESS_BUSY: inspect stale lock; no automatic deletion');throw e;}try{return fn();}finally{fs.rmdirSync(p);}}
function files(root,rel){const p=safe(root,rel);const st=optional(()=>fs.lstatSync(p),null);if(!st)return [rel];if(st.isFile())return [rel];if(!st.isDirectory())fail('PATH_SPECIAL_DENIED');const out=[];for(const name of fs.readdirSync(p).sort()){const sub=rel+'/'+name;if(secret(sub))fail('SECRET_IN_SCOPE');out.push(...files(root,sub));if(out.length>2000)fail('SCOPE_TOO_LARGE');}return out;}
function hashPaths(root,paths){const list=[...new Set(paths.flatMap(p=>files(root,p)))].sort();return sha(JSON.stringify(list.map(p=>[p,optional(()=>sha(fs.readFileSync(safe(root,p))),'MISSING')])));}
function git(root,args){const x=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});return {code:x.status??1,out:x.stdout?.trim()??'',err:x.error?.message??x.stderr?.trim()??''};}
function changed(root){const unstaged=git(root,['ls-files','-m','-d','-o','--exclude-standard','-z']);const staged=git(root,['diff','--cached','--name-only','-z']);return [...new Set([...(unstaged.code?[]:unstaged.out.split('\0')),...(staged.code?[]:staged.out.split('\0'))].filter(Boolean))];}
export function gitAdmin(root,command,{commit='HEAD',target}={}) {
 if(git(root,['rev-parse','--show-toplevel']).code)return {state:'NOT_APPLICABLE',ok:true};
 const policy=json(root,'harness/policy.json',{});target??=policy.target??'main';
 const current=git(root,['branch','--show-current']).out;
 const dirty=git(root,['status','--porcelain']).out;
 const base={branch:current,target,push:'MANUAL_ONLY',remote:'UNVERIFIED_NOT_FETCHED',workingTree:dirty,ok:true};
 if(command==='push')return {...base,state:'PUSH_BLOCKED',ok:false,reason:'Use direct human authorization; harness never pushes.'};
 if(command==='status')return {...base,state:'LOCAL_ONLY',upstream:git(root,['rev-parse','--abbrev-ref','@{upstream}']).out,worktrees:git(root,['worktree','list','--porcelain']).out};
 if(command==='preflight'){const warnings=[];if(current!==target)warnings.push('WRONG_BRANCH');if(dirty)warnings.push('DIRTY_WORKTREE');return {...base,state:warnings.length?'NEEDS_SCOPE_REVIEW':'READY',warnings,ok:!warnings.length};}
 if(command==='audit'||command==='cleanup'){
 const branches=git(root,['for-each-ref','--format=%(refname:short)|%(objectname)|%(upstream:short)','refs/heads','refs/remotes']).out.split('\n').filter(Boolean).map(line=>{const [name,id,upstream]=line.split('|');return {name,commit:id,upstream,integration:git(root,['merge-base','--is-ancestor',id,target]).code===0?'INTEGRATED':'UNVERIFIED_OR_NOT_INTEGRATED'};});
 return {...base,state:command==='cleanup'?'DRY_RUN_NO_DELETION':'AUDITED',branches,worktrees:git(root,['worktree','list','--porcelain']).out};}
 if(command==='verify-integration'){
 if(commit==='HEAD'&&dirty)return {...base,state:'UNVERIFIED_DIRTY_WORKTREE',ok:false};
 if(!/^[A-Za-z0-9_./-]+$/.test(commit)||commit.startsWith('-')||target.startsWith('-'))fail('INVALID_REF');
 if(git(root,['rev-parse','--verify',target+'^{commit}']).code||git(root,['rev-parse','--verify',commit+'^{commit}']).code)return {...base,state:'UNVERIFIED',ok:false};
 const code=git(root,['merge-base','--is-ancestor',commit,target]).code;
 const equivalent=code!==0&&git(root,['cherry',target,commit]).out.split('\n').some(x=>x.startsWith('- '));
 return {...base,state:code===0?'INTEGRATED':equivalent?'POSSIBLY_EQUIVALENT':'NOT_INTEGRATED',ok:code===0,commit:git(root,['rev-parse',commit]).out,remote:'UNVERIFIED_NOT_FETCHED'};
 }
 if(command==='recover')return {...base,state:'PLAN_ONLY',reflog:git(root,['reflog','-10','--format=%h %gs']).out,next:'Inspect snapshots/reflog; approve a concrete restore separately. No mutation performed.'};
 fail('UNKNOWN_GIT_ADMIN_COMMAND');
}
export function snapshot(root,paths){
 if(!Array.isArray(paths)||!paths.length||paths.length>200)fail('INVALID_SNAPSHOT_SCOPE');
 let totalBytes=0;const entries=[];for(const p of [...new Set(paths)]){safe(root,p);const st=optional(()=>fs.lstatSync(safe(root,p)),null);if(st&&!st.isFile())fail('PATH_NOT_REGULAR');totalBytes+=st?.size??0;if(totalBytes>4*1024*1024)fail('SNAPSHOT_BYTE_LIMIT: split scope; maximum total source bytes 4MiB');const bytes=st?fs.readFileSync(safe(root,p)):null;entries.push({path:p,sha256:bytes?sha(bytes):null,mode:st?st.mode&0o777:null,base64:bytes?bytes.toString('base64'):null});}
 const id=crypto.randomUUID();save(root,`harness/snapshots/${id}/snapshot.json`,{version:1,root:fs.realpathSync(root),entries});return id;
}
export function restore(root,id,rel,expectedCurrent){
 if(!/^[0-9a-f-]{36}$/.test(id))fail('INVALID_SNAPSHOT_ID');safe(root,rel);
 const snap=json(root,`harness/snapshots/${id}/snapshot.json`,null);if(!snap||snap.root!==fs.realpathSync(root))fail('SNAPSHOT_ROOT_MISMATCH');const entry=snap.entries.find(e=>e.path===rel);if(!entry)fail('PATH_NOT_IN_SNAPSHOT');
 const current=optional(()=>sha(fs.readFileSync(safe(root,rel))),null);if(current!==expectedCurrent)fail('RESTORE_CONFLICT');
 if(entry.base64===null)fail('RESTORE_WOULD_DELETE: remove new file only after explicit review');
 const bytes=Buffer.from(entry.base64,'base64');if(sha(bytes)!==entry.sha256)fail('SNAPSHOT_CORRUPT');atomic(root,rel,bytes);fs.chmodSync(safe(root,rel),entry.mode);return {restored:rel,sha256:entry.sha256};
}
function execute(root,args,timeoutMs=180000){
 return new Promise(resolve=>{
  const start=Date.now();let output='',timedOut=false,settled=false,killTimer,finishTimer;
  const grouped=process.platform!=='win32';
  const cp=spawn(args[0],args.slice(1),{cwd:root,detached:grouped,stdio:['ignore','pipe','pipe'],env:{...process.env,GSA_HARNESS_VERIFY:'1'}});
  const add=b=>{if(output.length<256*1024)output+=b.toString().slice(0,256*1024-output.length);};
  const signal=sig=>{if(!cp.pid)return;try{if(grouped)process.kill(-cp.pid,sig);else cp.kill(sig);}catch(e){if(e.code!=='ESRCH')add(Buffer.from('TERMINATION_UNCONFIRMED: '+e.code));}};
  const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(finishTimer);if(timedOut)signal('SIGKILL');resolve({command:args,code:timedOut?124:code??1,timedOut,output,ms:Date.now()-start});};
  const timer=setTimeout(()=>{
   timedOut=true;signal('SIGTERM');
   killTimer=setTimeout(()=>{signal('SIGKILL');cp.stdout.destroy();cp.stderr.destroy();finishTimer=setTimeout(()=>finish(124),500);},500);
  },timeoutMs);
  cp.stdout.on('data',add);cp.stderr.on('data',add);cp.on('error',e=>add(Buffer.from(e.message)));cp.on('close',finish);
 });
}
export async function verify(root,{quick=false,scope}={}){
 const policy=json(root,'harness/policy.json',{});const steps=[];const warnings=[];const paths=changed(root);
 for(const p of paths){if(/(^|\/)(test|tests)\/|\.test\./.test(p))warnings.push('TEST_CHANGED: '+p);if(scope&&!scope.some(s=>p===s||p.startsWith(s+'/')))warnings.push('OUT_OF_SCOPE: '+p);}
 warnings.push('LINT_NOT_CONFIGURED');
 const suspects=[];for(const p of paths){if(secret(p)){suspects.push(p);continue;}const st=optional(()=>fs.lstatSync(safe(root,p)),null);if(!st?.isFile()||st.size>1024*1024)continue;const s=fs.readFileSync(safe(root,p),'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}/.test(s))suspects.push(p);}
 if(suspects.length)return {ok:false,steps,warnings,changed:paths,secretSuspectFiles:suspects};
 const commands=quick?policy.quickCommands:policy.commands;
 if(!Array.isArray(commands)||!commands.length)return {ok:false,steps,warnings:[...warnings,'VERIFY_COMMANDS_NOT_CONFIGURED'],changed:paths};
 for(const args of commands){if(!Array.isArray(args)||!args.length||args.some(x=>typeof x!=='string'))fail('INVALID_VERIFY_COMMAND');const result=await execute(root,args,Number.isFinite(policy.commandTimeoutMs)?Math.max(100,Math.min(180000,policy.commandTimeoutMs)):180000);steps.push(result);if(result.code!==0)return {ok:false,steps,warnings,changed:paths};}
 return {ok:!warnings.some(w=>w.startsWith('OUT_OF_SCOPE')),steps,warnings,changed:paths};
}
export class Gate {
 constructor(root,{simulation=false}={}){this.root=fs.realpathSync(root);this.simulation=simulation;if(simulation&&this.root===liveRoot)fail('SIMULATION_LIVE_ROOT_DENIED');}
 config(){const c=json(this.root,'harness/milestones.json',{version:1,milestone:null});if(c.version!==1)fail('INVALID_MILESTONE_VERSION');return c;}
 state(){return json(this.root,'harness/state.json',{version:1,cursor:0,gates:{},rounds:{}});}
 status(){
 const c=this.config(),s=this.state();if(!c.milestone)return {state:'NOT_CONFIGURED',mode:'GUIDED_ONLY',next:null,gates:[]};
 const m=c.milestone;if(!this.simulation||m.approval!=='SIMULATED')return {state:'AWAITING_USER',mode:'GUIDED_ONLY',next:{role:'user',reason:'G0: trusted approval adapter not installed'},gates:[]};
 const task=m.tasks?.[s.cursor];if(!task)return {state:'AWAITING_USER',next:{role:'user',reason:'G11 milestone acceptance'},gates:[]};
 if(!task.id||!task.criteria?.length||!task.scope?.length||!task.event||(!Array.isArray(task.gates)||!task.gates.length))fail('INVALID_TASK');
 const policy=json(this.root,'harness/policy.json',{}),changes=changed(this.root);let profile=task.profile??'light';
 const stat=git(this.root,['diff','--numstat','HEAD']).out.split('\n').reduce((n,line)=>n+line.split('\t').slice(0,2).reduce((a,b)=>a+(Number(b)||0),0),0);
 if(changes.length>=12||stat>=400||changes.some(p=>(policy.sensitive??[]).some(s=>p.startsWith(s))||/(^|\/)package(?:-lock)?\.json$/.test(p)))profile='heavy';else if((changes.length>=5||stat>=150)&&profile==='light')profile='standard';
 const specs=task.gates.map(g=>({...g}));const extra=profile==='heavy'?[['G6','tester'],['G5','reviewer'],['G9','critic'],['G12','git-admin']]:profile==='standard'?[['G5','reviewer']]:[];
 for(const [id,role] of extra)if(!specs.some(g=>g.id===id))specs.push({id,role,paths:task.scope,depends:[]});
 const gates=[];const visit=(spec,trail=[])=>{
 if(trail.includes(spec.id))fail('GATE_DEPENDENCY_CYCLE');const existing=gates.find(g=>g.id===spec.id);if(existing)return existing;
 const deps=(spec.depends??[]).map(id=>{const d=specs.find(g=>g.id===id);if(!d)fail('MISSING_DEPENDENCY');return visit(d,[...trail,spec.id]);});
 const targetHash=sha(JSON.stringify({milestone:m.id,task:task.id,criteria:task.criteria,event:task.event,scope:task.scope,spec,source:hashPaths(this.root,spec.paths??task.scope),deps:deps.map(g=>[g.id,g.targetHash,g.state])}));
 const receipt=s.gates[task.id+':'+spec.id];let state='MISSING';if(receipt){state=receipt.targetHash===targetHash&&optional(()=>sha(read(this.root,receipt.evidence)),null)===receipt.evidenceHash?receipt.verdict:'EXPIRED';}
 const g={...spec,state,targetHash};gates.push(g);return g;
 };for(const spec of specs)visit(spec);
 const limited=Object.entries(s.rounds).some(([key,n])=>key.startsWith(task.id+':')&&n>=(policy.maxReviewRounds??2));
 const missing=gates.find(g=>g.state!=='PASS');let next=missing?{role:missing.state==='FAIL'?'coder':missing.role,gate:missing.id,event:task.event,task:task.id}:null;
 if(limited)next={role:'user',reason:'Review/repair round limit exceeded'};
 return {state:limited?'BLOCKED_ROUND_LIMIT':missing?'GATES_PENDING':'PASS',mode:'GUIDED_ONLY',milestone:m.id,task:task.id,profile,gates,next};
 }
 check(){const s=this.status();return {...s,ok:s.state==='PASS'};}
 sign(id,verdict,evidence){if(['G0','G11'].includes(id))fail('AWAITING_USER: cannot authenticate human approval through an agent-writable file');if(!['PASS','FAIL'].includes(verdict))fail('INVALID_VERDICT');return locked(this.root,()=>{const status=this.status();if(status.state==='NOT_CONFIGURED')fail('NOT_CONFIGURED');if(status.state==='BLOCKED_ROUND_LIMIT')fail('ROUND_LIMIT');if(status.state==='AWAITING_USER')fail('AWAITING_USER');const spec=status.gates.find(g=>g.id===id);if(!spec)fail('UNKNOWN_GATE');if((spec.depends??[]).some(d=>status.gates.find(g=>g.id===d)?.state!=='PASS'))fail('DEPENDENCY_PENDING');const bytes=read(this.root,evidence);if(!bytes.toString().trim())fail('EMPTY_EVIDENCE');if(id==='G12'&&!gitAdmin(this.root,'verify-integration').ok)fail('G12_INTEGRATION_NOT_PROVEN');const s=this.state();s.gates[status.task+':'+id]={verdict,evidence,evidenceHash:sha(bytes),targetHash:spec.targetHash,at:new Date().toISOString(),identity:'SELF_REPORTED_UNAUTHENTICATED'};if(verdict==='FAIL'){const key=status.task+':'+spec.role;s.rounds[key]=(s.rounds[key]??0)+1;}save(this.root,'harness/state.json',s);return this.status();});}
 advance(){return locked(this.root,()=>{if(!this.check().ok)fail('GATES_PENDING');const status=this.status(),s=this.state();const p=safe(this.root,'TASKS.md');const text=fs.readFileSync(p,'utf8');if(!/^[A-Za-z0-9_-]+$/.test(status.task))fail('INVALID_TASK_ID');const marker=new RegExp('^- \\[ \\] '+status.task+'(?=\\s|$)','m');if(!marker.test(text))fail('TASK_MARKER_NOT_FOUND');atomic(this.root,'TASKS.md',text.replace(marker,'- [x] '+status.task));s.cursor++;save(this.root,'harness/state.json',s);return this.status();});}
}
export function resolveRole(root,role,available){const config=json(root,'harness/roles.json',{});const r=config[role];if(!r)fail('UNKNOWN_ROLE');if(available&&!available.includes(r.model))fail('MODEL_UNAVAILABLE: '+r.model);return {...r,role,profile:read(root,'docs/PROJECT_PROFILE.md').toString(),runtimeVerification:'UNVERIFIED',permissionEnforcement:'CONTRACT_ONLY'};}
export async function hook(root,event,{simulation=false}={}){
 const type=event.hook_event_name;const g=new Gate(root,{simulation});
 const denied=reason=>({denied:true,output:{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:reason}}});
 if(type==='SessionStart'||type==='UserPromptSubmit')return {output:{systemMessage:JSON.stringify(g.status())}};
 if(type==='PreToolUse'){
 const command=event.tool_input?.command??event.tool_input?.cmd??'';const name=event.tool_name??'';
 if(!/apply_patch|Edit|Write/.test(name)&&/(?:harness\/(?:state\.json|snapshots|local-state|policy\.json|roles\.json|milestones\.json)|\.codex\/|TASKS\.md)/.test(command)&&/(?:>|\b(?:write|open|unlink|rename|rm|mv|cp|tee|chmod)\b)/.test(command)&&!/^node harness\/(?:gate|snapshot|verify|self-check|git-admin|runtime-check)\.mjs(?:\s|$)/.test(command))return denied('Direct shell mutation of protected harness state/configuration is blocked.');
 if(/\bgit\s+(?:[^\n;]*\s)?push\b|\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f)|\b(?:mkfs|diskutil\s+erase|sudo)\b|curl[^\n]*\|\s*(?:sh|bash)/.test(command))return denied('Blocked destructive/remote operation. Use a separately reviewed explicit workflow.');
 if(/apply_patch|Edit|Write/.test(name)){
 let paths=[...command.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm)].map(m=>m[1].trim());if(!paths.length&&event.tool_input?.file_path)paths=[event.tool_input.file_path];
 if(!paths.length)return denied('Cannot identify edit scope; use apply_patch with explicit paths.');
 try{paths=paths.map(p=>path.isAbsolute(p)?path.relative(fs.realpathSync(root),p):p);for(const p of paths){safe(root,p);if(p.startsWith('.codex/')||p==='harness/policy.json'||p==='harness/roles.json'||p==='harness/milestones.json'||p==='TASKS.md')return denied('Sensitive harness configuration/status: prepare a proposal and apply only through user-reviewed maintenance.');}snapshot(root,paths);}catch(e){return denied(e.message);}
 return {denied:false,output:{hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:'Edit snapshot saved. Role/path restrictions are guardrails, not a sandbox.'}}};
 }
 return {denied:false,output:{hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:'GUIDED_ONLY for shell/other tools: snapshot explicit files before mutation; never edit gate state or secrets.'}}};
 }
 if(type==='PostToolUse'){
 let message='Check gate status after source changes; hash expiry is automatic.';
 if(/apply_patch|Edit|Write/.test(event.tool_name??'')){const result=await verify(root,{quick:true});message=(result.ok?'QUICK_CHECK_PASS':'QUICK_CHECK_FAIL')+': '+JSON.stringify({steps:result.steps.map(s=>({command:s.command,code:s.code,output:s.code?s.output.slice(-3000):undefined})),warnings:result.warnings});}
 return {output:{hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:message}}};
 }
 if(type==='Stop'){
 const status=g.status();if(status.state==='NOT_CONFIGURED'||status.state==='AWAITING_USER'||status.state==='BLOCKED_ROUND_LIMIT')return {output:{continue:true,systemMessage:JSON.stringify(status)}};
 if(status.state==='PASS')return {output:{continue:true}};
 const policy=json(root,'harness/policy.json',{});const key=sha(String(event.session_id??'unknown')+':'+status.task);const p='harness/local-state/stop-'+key+'.json';const state=json(root,p,{attempts:0});state.attempts++;save(root,p,state);
 if(state.attempts>(policy.maxStopAttempts??3))return {output:{continue:true,systemMessage:'BLOCKED: Stop continuation limit reached. Report pending gates to the user.'}};
 return {output:{decision:'block',reason:'Run the next required gate step: '+JSON.stringify(status.next)}};
 }
 return {output:{}};
}
