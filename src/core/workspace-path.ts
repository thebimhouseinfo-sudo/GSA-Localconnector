import path from "node:path";

/** Lexical gate only, not a replacement for handle-relative OS filesystem isolation.
 * API paths use a portable, slash-separated representation on both hosts.
 */
export class WorkspacePathError extends Error {
 readonly code="PATH_OUTSIDE_SCOPE" as const;
 constructor(message:string){super(message);this.name="WorkspacePathError";}
}
const WINDOWS_RESERVED=/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
export function validateWorkspaceRelative(value:string,allowRoot=false):string {
 const fail=(message:string):never=>{throw new WorkspacePathError(message);};
 if(typeof value!=="string"||value.length>4096||!value)fail("Invalid path");
 if(value==="."&&allowRoot)return ".";
 if(value==="."||value.startsWith("/")||value.startsWith("\\")||path.win32.isAbsolute(value)||path.posix.isAbsolute(value))fail("Path must be workspace-relative");
 if(value.includes("\\")||/[\u0000-\u001f\u007f]/.test(value))fail("Unsafe path encoding");
 const parts=value.split("/");
 if(parts.some(x=>!x||x==="."||x===".."||x.endsWith(".")||x.endsWith(" ")||x.includes(":")||WINDOWS_RESERVED.test(x)))fail("Unsafe relative path segment");
 return value;
}
