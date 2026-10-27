/** POSIX UID/mode checks cannot verify Windows DACL ownership or access rules.
 * Windows remains status-only until a separately verified ACL backend exists.
 */
export function protectedStateCapability(platform:NodeJS.Platform=process.platform):{available:boolean;reason?:string}{
 if(platform==="win32")return {available:false,reason:"Windows ACL protected storage is not verified; persistent grants and controllers are blocked"};
 if(typeof process.getuid!=="function")return {available:false,reason:"Protected storage requires a verified ownership backend"};
 return {available:true};
}
export function requireProtectedState():void{
 const capability=protectedStateCapability();
 if(!capability.available)throw Object.assign(new Error(capability.reason),{code:"SECURITY_BLOCKED"});
}
