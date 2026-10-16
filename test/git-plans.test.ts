import {test} from "node:test";
import assert from "node:assert/strict";
import {gitPlan} from "../src/core/git-plans.js";
test("Git tools produce deterministic argv without spawning",()=>{
 const status=gitPlan("git_status");assert.equal(status.executable,"git");assert.equal(status.mutates,false);
 assert.deepEqual(gitPlan("git_add",{paths:["src/a.ts","README.md"]}).argv,["add","--","src/a.ts","README.md"]);
 assert.equal(gitPlan("git_fetch").network,true);
 assert.deepEqual(gitPlan("git_show",{revision:"HEAD"}).argv,["show","--no-ext-diff","--format=fuller","HEAD"]);
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
