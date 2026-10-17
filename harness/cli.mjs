import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {liveRoot, Gate, snapshot, restore, gitAdmin, verify, hook, resolveRole} from './lib.mjs';
export async function main(kind,args=process.argv.slice(2)) {
 const root=liveRoot;
 try {
 let result;
 if(kind==='gate'){
  const g=new Gate(root),[action='status',id,verdict,evidence]=args;
  if(action==='status')result=g.status();
  else if(action==='check'){result=g.check();if(!result.ok)process.exitCode=1;}
  else if(action==='sign')result=g.sign(id,verdict,evidence);
  else if(action==='advance')result=g.advance();
  else throw Error('Usage: node harness/gate.mjs status|check|sign GATE PASS|FAIL evidence.md|advance');
 } else if(kind==='git-admin'){
  result=gitAdmin(root,args[0]??'status',{commit:args[1]??'HEAD'});if(result.ok===false)process.exitCode=1;
 } else if(kind==='snapshot'){
  if(args[0]==='restore')result=restore(root,args[1],args[2],args[3]==='MISSING'?null:args[3]);
  else if(args[0]==='create')result={snapshot:snapshot(root,args.slice(1))};
  else throw Error('Usage: node harness/snapshot.mjs create file... | restore ID file CURRENT_SHA256');
 } else if(kind==='verify'){
  result=await verify(root,{quick:args.includes('--quick')});
  const folder=root+'/harness/reports';fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.writeFileSync(folder+'/verify.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
  if(!result.ok)process.exitCode=1;
 } else if(kind==='hook'){
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw Error('HOOK_INPUT_LIMIT');}
  const event=JSON.parse(input);result=(await hook(root,event)).output;
 } else if(kind==='role')result=resolveRole(root,args[0]);
 else throw Error('Unknown harness command');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 } catch(e) {
  if(kind==='hook'){
   // Documented exit 2 denies supported PreToolUse calls; Stop errors are visible.
   process.stderr.write('HARNESS_HOOK_ERROR: '+e.message+'\n');process.exitCode=2;
  }else{process.stderr.write('HARNESS_ERROR: '+e.message+'\n');process.exitCode=1;}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(process.argv[2],process.argv.slice(3));
