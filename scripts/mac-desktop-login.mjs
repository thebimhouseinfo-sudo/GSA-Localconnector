const fail=code=>Object.assign(new Error(code),{code});

export function parseLoginJob(text,label){
 const rows=text.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(row=>row[2]===label);
 if(!rows.length)return 'ABSENT';
 if(rows.length!==1||rows[0].length!==3||! /^-?\d+$/.test(rows[0][1]))return 'UNKNOWN';
 return rows[0][0]==='-'?'INACTIVE':/^[1-9]\d*$/.test(rows[0][0])?'ACTIVE':'UNKNOWN';
}

// Retire registration only; active/unknown processes and foreign plists refuse.
// Checks serialize cooperating installers, not hostile same-user launchctl use.
export async function retireInactiveLoginJob({query,verifyOwned,ownerBusy,bootout}){
 const state=await query();
 if(state==='ABSENT')return;
 if(state!=='INACTIVE')throw fail('OWNER_ACTIVE');
 await verifyOwned();
 if(await ownerBusy()||await query()!=='INACTIVE')throw fail('OWNER_ACTIVE');
 await bootout();
 if(await query()!=='ABSENT')throw fail('LOGIN_JOB_UNLOAD_FAILED');
}
