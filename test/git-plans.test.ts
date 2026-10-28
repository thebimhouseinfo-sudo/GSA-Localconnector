import {test} from "node:test";
import assert from "node:assert/strict";
import {gitPlan} from "../src/core/git-plans.js";
test("Git tools produce deterministic argv without spawning",()=>{
 const status=gitPlan("git_status");assert.equal(status.executable,"git");assert.equal(status.mutates,false);
 assert.deepEqual(gitPlan("git_add",{paths:["src/a.ts","README.md"]}).argv,["-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false","add","--","src/a.ts","README.md"]);
 assert.equal(gitPlan("git_fetch").network,true);
 assert.deepEqual(gitPlan("git_show",{revision:"HEAD"}).argv,["-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false","show","--no-ext-diff","--no-textconv","--format=fuller","HEAD"]);
});
test("Git command argument injection and ref escaping fail",()=>{
 for(const fn of [
 ()=>gitPlan("git_add",{paths:["../../secret"]}),
 ()=>gitPlan("git_add",{paths:["--all"]}),
 ()=>gitPlan("create_branch",{branch:"--force"}),
 ()=>gitPlan("compare_commits",{base:"main",head:"foo..bar"}),
 ()=>gitPlan("git_status",{remote:"bad"}),
 ()=>gitPlan("git_commit",{message:""})
 ])assert.throws(fn);
});
test('git_add refuses Git pathspec magic outside a granted subdirectory',()=>{
 for(const value of [':/',':(top)x',':!x'])assert.throws(()=>gitPlan('git_add',{paths:[value]}));
});
test('every Git plan disables inherited hooks and fsmonitor; diffs disable textconv',()=>{
 const cases:Array<[string,Record<string,unknown>]>=[['git_status',{}],['git_diff',{}],['git_log',{}],['git_show',{revision:'HEAD'}],['compare_commits',{base:'main',head:'HEAD'}],['git_add',{paths:['a']}],['git_commit',{message:'test'}],['create_branch',{branch:'safe'}],['git_checkout',{branch:'safe'}],['git_fetch',{}],['git_pull',{}],['git_push',{}]];
 for(const [name,args] of cases){
  const argv=gitPlan(name,args).argv;
  for(const setting of ['core.hooksPath=/dev/null','core.fsmonitor=false']){
   const index=argv.indexOf(setting);assert.ok(index>0&&argv[index-1]==='-c',name+' '+setting);
  }
  if(['git_diff','git_show','compare_commits'].includes(name))assert.ok(argv.includes('--no-textconv'),name);
 }
});
