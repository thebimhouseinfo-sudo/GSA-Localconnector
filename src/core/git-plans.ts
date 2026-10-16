/** Git operation planning is pure: caller must execute ONLY inside a verified OS sandbox.
 * No shell expansion, inherited Git hooks or unrestricted git process may be run here.
 */
export type GitPlan={readonly executable:"git";readonly argv:readonly string[];readonly network:boolean;readonly mutates:boolean};
export class GitPlanError extends Error{constructor(message:string){super(message);this.name="GitPlanError";}}
const bad=(why:string):never=>{throw new GitPlanError(why);};
function ref(s:string):string{
 if(!s||s.startsWith("-")||s.length>200||/\s|[\\~^:?*\[\]@{}]/.test(s)||s.includes("..")||s.endsWith(".lock")||s.includes("//"))bad("Unsafe Git ref");
 return s;
}
function rel(s:string):string{
 if(!s||s.startsWith("/")||s.startsWith("-")||s.includes("\\")||s.split("/").some(x=>!x||x==="."||x==="..")||s.includes("\0"))bad("Unsafe Workspace-relative path");
 return s;
}
function plan(argv:string[],mutates=false,network=false):GitPlan{return {executable:"git",argv:Object.freeze(argv),mutates,network};}
export function gitPlan(name:string,args:Record<string,unknown>={}):GitPlan{
 const only=(keys:string[])=>{if(Object.keys(args).some(k=>!keys.includes(k)))bad("Unknown Git arguments");};
 switch(name){
  case "git_status":only([]);return plan(["-c","core.fsmonitor=false","status","--porcelain=v1","-z"]);
  case "git_diff":only([]);return plan(["-c","core.fsmonitor=false","-c","diff.external=","diff","--no-ext-diff","--"]);
  case "git_log":only([]);return plan(["log","-n","30","--format=%H%x09%s"]);
  case "git_show":only(["revision"]);return plan(["show","--no-ext-diff","--format=fuller",ref(String(args.revision))]);
  case "compare_commits":only(["base","head"]);return plan(["diff","--no-ext-diff",ref(String(args.base)),ref(String(args.head)),"--"]);
  case "git_add":only(["paths"]);if(!Array.isArray(args.paths)||!args.paths.length||args.paths.length>100||args.paths.some(x=>typeof x!=="string"))bad("Invalid Git paths");return plan(["add","--",...(args.paths as string[]).map(rel)],true);
  case "git_commit":only(["message"]);if(typeof args.message!=="string"||!args.message.trim()||args.message.length>500)bad("Invalid commit message");return plan(["commit","-m",args.message],true);
  case "create_branch":only(["branch"]);return plan(["branch",ref(String(args.branch))],true);
  case "git_checkout":only(["branch"]);return plan(["switch",ref(String(args.branch))],true);
  case "git_fetch":only([]);return plan(["fetch","--no-tags","origin"],true,true);
  case "git_pull":only([]);return plan(["pull","--ff-only"],true,true);
  case "git_push":only([]);return plan(["push"],true,true);
  default:bad("Unknown Git tool");
 }
}
