import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";

// Exact bytes accepted by independent review of the finite Mac27 native run.
// These pins grant no installation or execution authority. A new qualification
// requires source review; caller-selected reports/check-name lists cannot pass.
const REPORT_SHA256="ee918da1ad707489454f49e2180fe048659859a53c213555e23aa62e9c46471b";
const SOURCE_SHA256="6b5debec3543ca6d0c25b2844e77113630f884ca1513d168bfd161d52fe0fab8";
const RELEASE_SHA256="95817c08d1a409ed33fc27aef46b8975ee9e1bb5b03cad4c924609e71b5a8a31";
const CODE_SHA256="046820244f22afb203ffca4261cb4365df45b26018a943ee2cea865e5a596205";
const PROFILE="gsa-recovery-adhoc-two-root-v1";
const limitations=Object.freeze([
 "relocation:pre-capture-read-denial;capture-publication-restoration-unexercised",
 "constructed-states:structural-readback-only",
 "sync-error:diagnostic-injection-only",
 "power-loss:unverified",
 "compiler-private-descendants:unverified",
 "installed-plugin:unverified"
]);
export interface MacRecoveryQualification {
 readonly qualification_sha256:string;
 readonly source_sha256:string;
 readonly release_sha256:string;
 readonly code_sha256:string;
 readonly host_release:string;
 readonly arch:string;
 readonly signing_profile:string;
 readonly limitations:readonly string[];
}
function invalid():never{throw Object.assign(Error("Recovery qualification does not match accepted native evidence"),{code:"RECOVERY_EVIDENCE_INVALID"});}
/** Pure bounded evidence identity check. Does not perform I/O, validate current
 * installed roots/signatures, replay a transaction or enable any capability.
 * Raw native receipts were independently audited before this exact report pin
 * was accepted; this function does not claim to repeat that audit. */
export function requireMacRecoveryQualification(reportBytes:Uint8Array,build:unknown):Readonly<MacRecoveryQualification>{
 if(!(reportBytes instanceof Uint8Array)||reportBytes.byteLength>512*1024)invalid();
 const bytes=Buffer.from(reportBytes);
 if(createHash("sha256").update(bytes).digest("hex")!==REPORT_SHA256)invalid();
 let report;try{report=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{invalid();}
 const production=report?.builds?.production;
 if(report?.format!=="gsa-mac27-recovery-driver-v1"||report.state!=="RECOVERY_SEQUENCE_OBSERVED"||report.phase!=="finished"||report.activation!==false||report.setupComplete!==true||report.controlReleased!==true||!Array.isArray(report.unresolved)||report.unresolved.length!==0)invalid();
 if(!isDeepStrictEqual(report.counts,{broker:17,sign:4,compile:2,observer:6,owner:0,tool:105,total:134,relocation:1,signals:5})||report.receipts?.length!==134||report.receipts.some((r:{closed?:boolean;truncated?:boolean})=>r.closed!==true||r.truncated!==false)||report.nativeSequence?.length!==17||report.nativeResults?.length!==16||report.canaryChecks?.length!==11)invalid();
 const relocation=report.observations?.heldParent?.classification;
 if(relocation?.state!=="OBSERVED_DENIAL"||relocation.phase!=="pre-capture-read"||!isDeepStrictEqual(relocation.exercisedSyscalls,[])||report.observations?.diagnostic?.actualKernelFsyncFailure!==false||report.observations?.postCapture?.readback?.status!=="UNKNOWN")invalid();
 if(!production||production.provenance!=="PRODUCTION"||production.hostRelease!=="27.0.0"||production.arch!=="arm64"||production.signing_profile!==PROFILE||production.source_sha256!==SOURCE_SHA256||production.production_source_sha256!==SOURCE_SHA256||production.release_sha256!==RELEASE_SHA256||production.code_sha256!==CODE_SHA256||!isDeepStrictEqual(build,production))invalid();
 return Object.freeze({qualification_sha256:REPORT_SHA256,source_sha256:SOURCE_SHA256,release_sha256:RELEASE_SHA256,code_sha256:CODE_SHA256,host_release:"27.0.0",arch:"arm64",signing_profile:PROFILE,limitations});
}
