/** Common negative-control suite for candidate native confinement backends.
 * PASS from a mock probe is never an OS-native certification; native host integration
 * must separately bind evidence to platform, executable and policy fingerprint.
 */
export type ProbeCase={
 id:string;category:"outside-read"|"outside-write"|"nested-process"|"secret-exposure"|"allowed-build";
 expected:"DENIED"|"ALLOWED";
};
export const securityProbeCases:readonly ProbeCase[]=Object.freeze([
 {id:"outside-read",category:"outside-read",expected:"DENIED"},
 {id:"outside-write",category:"outside-write",expected:"DENIED"},
 {id:"nested-process",category:"nested-process",expected:"DENIED"},
 {id:"secret-exposure",category:"secret-exposure",expected:"DENIED"},
 {id:"allowed-build",category:"allowed-build",expected:"ALLOWED"}
]);
export interface ProbeObservation{
 readonly id:string;readonly outcome:"DENIED"|"ALLOWED"|"ERROR"|"UNKNOWN";
 readonly detail:string;
}
export type ProbeVerdict={readonly passed:boolean;readonly failures:readonly string[];readonly unverified:boolean};
export function evaluateSecurityProbes(observations:readonly ProbeObservation[]):ProbeVerdict{
 const failures:string[]=[];
 for(const test of securityProbeCases){
  const found=observations.filter(x=>x.id===test.id);
  if(found.length!==1){failures.push(test.id+": missing or duplicate observation");continue;}
  if(found[0].outcome!==test.expected)failures.push(test.id+": expected "+test.expected+", got "+found[0].outcome);
 }
 for(const result of observations)if(!securityProbeCases.some(t=>t.id===result.id))failures.push("UNKNOWN_PROBE:"+result.id);
 return {passed:failures.length===0,failures,unverified:true};
}
