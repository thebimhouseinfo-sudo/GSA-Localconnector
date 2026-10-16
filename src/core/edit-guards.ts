import {createHash} from "node:crypto";
export class EditConflict extends Error {
 constructor(public readonly code:"HASH_CONFLICT"|"MATCH_CONFLICT"|"INVALID_PATCH", message:string){super(message);this.name="EditConflict";}
}
export function sha256(bytes:Uint8Array):string {return createHash("sha256").update(bytes).digest("hex");}
export function requireExpectedHash(current:Uint8Array,expected:string):string {
 if(!/^[a-f0-9]{64}$/.test(expected))throw new EditConflict("HASH_CONFLICT","Invalid expected SHA256");
 const actual=sha256(current);
 if(actual!==expected)throw new EditConflict("HASH_CONFLICT","File changed since read");
 return actual;
}
export function exactTextEdit(current:string,oldText:string,newText:string):string {
 if(!oldText)throw new EditConflict("MATCH_CONFLICT","Empty match forbidden");
 const first=current.indexOf(oldText);
 if(first<0)throw new EditConflict("MATCH_CONFLICT","Expected text not found");
 if(current.indexOf(oldText,first+oldText.length)>=0)throw new EditConflict("MATCH_CONFLICT","Expected text is not unique");
 return current.slice(0,first)+newText+current.slice(first+oldText.length);
}
/** Pure validation only. This is NOT authorization to write a file. */
export function planExactEdit(currentBytes:Uint8Array, expectedHash:string, oldText:string,newText:string){
 const before= requireExpectedHash(currentBytes,expectedHash);
 let original:string;
 try {original=new TextDecoder("utf-8",{fatal:true}).decode(currentBytes);}
 catch {throw new EditConflict("MATCH_CONFLICT","Cannot text-edit a non-UTF8 file");}
 const next=Buffer.from(exactTextEdit(original,oldText,newText),"utf8");
 return {before_sha256:before,after_sha256:sha256(next),content:next,committed:false};
}
