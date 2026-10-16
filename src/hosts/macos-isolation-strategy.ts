/** Native macOS isolation strategy selection.
 * A verified proof is deliberately not constructible from a strategy plan.
 * No subprocesses launch from this module.
 */
export type MacIsolationStrategy="seatbelt-experimental"|"virtualization-native-worker"|"dedicated-account";
export interface MacIsolationAssessment {
 readonly strategy:MacIsolationStrategy;
 readonly state:"BLOCKED"|"CANDIDATE";
 readonly process_execution_allowed:false;
 readonly security_verified:false;
 readonly missing_evidence:readonly string[];
}
const REQUIRED_EVIDENCE=Object.freeze([
 "native-worker-code-signature-and-entitlements",
 "host-version-and-architecture",
 "workspace-mount-or-OS-enforced-root-confinement",
 "outside-root-read-and-write-denial",
 "nested-subprocess-and-symlink-escape-denial",
 "network-and-host-secret-isolation",
 "legitimate-in-workspace-build",
 "process-tree-timeout-and-cancellation",
 "artifact-integrity-and-restart-reconciliation"
]);
export function assessMacIsolation(strategy:MacIsolationStrategy):MacIsolationAssessment{
 if(strategy==="seatbelt-experimental")return {
  strategy,state:"BLOCKED",process_execution_allowed:false,security_verified:false,
  missing_evidence:["macos-26.6.2-restricted-file-read-SIGABRT",...REQUIRED_EVIDENCE]
 };
 if(strategy==="dedicated-account")return {
  strategy,state:"BLOCKED",process_execution_allowed:false,security_verified:false,
  missing_evidence:["POSIX-account-is-not-workspace-root-sandbox",...REQUIRED_EVIDENCE]
 };
 return {strategy,state:"CANDIDATE",process_execution_allowed:false,
  security_verified:false,missing_evidence:REQUIRED_EVIDENCE};
}
/** Guard for any future host adapter; planning alone is never permission. */
export function requireMacIsolationProof(assessment:MacIsolationAssessment):never {
 throw Object.assign(new Error("Native macOS isolation requires host verification"),{code:"SECURITY_BLOCKED",
  strategy:assessment.strategy});
}
