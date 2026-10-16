/** Pure local CI dependency validator. No process or shell execution. */
export interface CiJob { id:string; needs?:string[]; steps?:Array<{id:string;command:string;args?:string[]}> }
export interface CiWorkflow { name:string; jobs:CiJob[] }
export class CiValidationError extends Error {constructor(public readonly code:"CI_INVALID",message:string){super(message);}}
export function validateWorkflow(value:unknown):{name:string;job_order:string[]} {
 const bad=(m:string):never=>{throw new CiValidationError("CI_INVALID",m);};
 if(!value||typeof value!=="object"||Array.isArray(value))bad("workflow must be an object");
 const doc=value as Record<string,unknown>;
 if(Object.keys(doc).some(k=>!["name","jobs"].includes(k))||typeof doc.name!=="string"||!doc.name.trim()||!Array.isArray(doc.jobs)||doc.jobs.length<1||doc.jobs.length>64)bad("invalid workflow shape");
 const jobs=doc.jobs as unknown[];const nodes=new Map<string,string[]>();
 for(const raw of jobs){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))bad("invalid job");
  const j=raw as Record<string,unknown>;
  if(Object.keys(j).some(k=>!["id","needs","steps"].includes(k))||typeof j.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(j.id)||nodes.has(j.id))bad("invalid or duplicate job ID");
  if(j.needs!==undefined&&(!Array.isArray(j.needs)||j.needs.some(x=>typeof x!=="string")))bad("invalid dependencies");
  if(!Array.isArray(j.steps)||j.steps.length<1||(j.steps as unknown[]).length>100)bad("missing/oversized steps");
  for(const rawStep of j.steps as unknown[]){
   if(!rawStep||typeof rawStep!=="object"||Array.isArray(rawStep))bad("invalid step");
   const s=rawStep as Record<string,unknown>;
   if(Object.keys(s).some(k=>!["id","command","args"].includes(k))||typeof s.id!=="string"||typeof s.command!=="string"||!s.command||(s.args!==undefined&&(!Array.isArray(s.args)||s.args.some(x=>typeof x!=="string"))))bad("invalid step schema");
  }
  nodes.set(j.id as string,(j.needs as string[]|undefined)??[]);
 }
 const visited=new Set<string>();const active=new Set<string>();const ordered:string[]=[];
 const walk=(id:string):void=>{
  if(active.has(id))bad("dependency cycle");
  if(visited.has(id))return;
  if(!nodes.has(id))bad("unknown dependency "+id);
  active.add(id);for(const dep of nodes.get(id)!)walk(dep);
  active.delete(id);visited.add(id);ordered.push(id);
 };
 for(const id of nodes.keys())walk(id);
 return {name:doc.name as string,job_order:ordered};
}
