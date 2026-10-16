import {validateWorkflow,type CiWorkflow,type CiJob} from "./ci-dag.js";
export class ManifestError extends Error{constructor(message:string){super(message);this.name="ManifestError";}}
/** Deliberately narrow YAML subset for local CI; rejects aliases, tags, multiline,
 * unknown nesting and implicit YAML coercions instead of guessing.
 */
export function parseCiManifest(text:string):CiWorkflow {
 if(Buffer.byteLength(text,"utf8")>65536||!text.trim())throw new ManifestError("CI_MANIFEST_TOO_LARGE_OR_EMPTY");
 if(text.trimStart().startsWith("{")){
  const parsed=JSON.parse(text) as CiWorkflow;validateWorkflow(parsed);return parsed;
 }
 const lines=text.replace(/\r\n/g,"\n").split("\n");
 const doc:{name?:string;jobs:CiJob[]}={jobs:[]};
 let job:CiJob|null=null,step:{id:string;command:string;args?:string[]}|null=null;
 let area:"root"|"jobs"|"steps"="root";
 const scalar=(raw:string):string=>{
  const v=raw.trim();
  if(!v||/[!&*]|<<|\t/.test(v))throw new ManifestError("UNSUPPORTED_YAML_FEATURE");
  if(v.startsWith('"')){const x=JSON.parse(v);if(typeof x!=="string")throw new ManifestError("EXPECTED_STRING");return x;}
  if(v.startsWith("'")&&v.endsWith("'"))return v.slice(1,-1).replace(/''/g,"'");
  if(v.includes("#")||v.includes(": "))throw new ManifestError("UNSUPPORTED_YAML_FEATURE");
  return v;
 };
 const array=(raw:string):string[]=>{
  const v=raw.trim();if(!v.startsWith("[")||!v.endsWith("]"))throw new ManifestError("EXPECTED_ARRAY");
  if(v==="[]")return [];
  try{const x=JSON.parse(v);if(Array.isArray(x)&&x.every(y=>typeof y==="string"))return x;}catch{}
  const x=v.slice(1,-1).split(",").map(s=>scalar(s));
  if(x.some(y=>!y))throw new ManifestError("INVALID_ARRAY");
  return x;
 };
 const keyValue=(raw:string):[string,string]=>{
  const m=/^([a-z_]+):(?:\s+(.+))?$/.exec(raw);
  if(!m)throw new ManifestError("INVALID_YAML_MAPPING");
  return [m[1],m[2]??""];
 };
 for(let n=0;n<lines.length;n++){
  const raw=lines[n];if(!raw.trim()||raw.trimStart().startsWith("#"))continue;
  if(raw.includes("\t"))throw new ManifestError("YAML_TABS_FORBIDDEN");
  const indent=raw.length-raw.trimStart().length;const content=raw.trim();
  if(indent===0){
   const [k,v]=keyValue(content);
   if(k==="name"){if(doc.name!==undefined)throw new ManifestError("DUPLICATE_NAME");doc.name=scalar(v);}
   else if(k==="jobs"&&!v){area="jobs";}
   else throw new ManifestError("UNKNOWN_ROOT_KEY");
  }else if(indent===2&&area!=="root"&&content.startsWith("- ")){
   const [k,v]=keyValue(content.slice(2));if(k!=="id")throw new ManifestError("JOB_REQUIRES_ID");
   job={id:scalar(v),steps:[]};doc.jobs.push(job);step=null;area="jobs";
  }else if(indent===4&&job&&area!=="steps"){
   const [k,v]=keyValue(content);
   if(k==="needs")job.needs=array(v);
   else if(k==="steps"&&!v)area="steps";
   else throw new ManifestError("UNKNOWN_JOB_KEY");
  }else if(indent===6&&job&&area==="steps"&&content.startsWith("- ")){
   const [k,v]=keyValue(content.slice(2));if(k!=="id")throw new ManifestError("STEP_REQUIRES_ID");
   step={id:scalar(v),command:""};job.steps!.push(step);
  }else if(indent===8&&step&&area==="steps"){
   const [k,v]=keyValue(content);
   if(k==="command")step.command=scalar(v);
   else if(k==="args")step.args=array(v);
   else throw new ManifestError("UNKNOWN_STEP_KEY");
  }else throw new ManifestError("INVALID_YAML_INDENT_OR_ORDER");
 }
 const result={name:doc.name??"",jobs:doc.jobs};
 validateWorkflow(result);
 return result;
}
