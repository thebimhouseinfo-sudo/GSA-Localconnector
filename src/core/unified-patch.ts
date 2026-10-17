/** Strict single-file unified hunk applier. Hash and native write scope enforced by caller. */
export class PatchConflict extends Error {constructor(public readonly code:"INVALID_PATCH"|"HASH_CONFLICT",message:string){super(message);}}
export function applyUnifiedTextPatch(original:string,patch:string):string {
 if(!patch||patch.length>1024*1024||patch.includes("\0"))throw new PatchConflict("INVALID_PATCH","Empty or oversized patch");
 const lines=patch.replace(/\r\n/g,"\n").split("\n");
 const source=original.split("\n");
 const out:string[]=[];
 let cursor=0,index=0,hunks=0;
 if(lines[index]?.startsWith("--- ")){index++;if(!lines[index]?.startsWith("+++ "))throw new PatchConflict("INVALID_PATCH","Expected new file marker");index++;}
 while(index<lines.length){
  const head=lines[index];
  if(head===""){if(index===lines.length-1)break;throw new PatchConflict("INVALID_PATCH","Unexpected blank patch line");}
  const m=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(head);
  if(!m)throw new PatchConflict("INVALID_PATCH","Expected unified hunk");
  hunks++;
  const oldCount=m[2]===undefined?1:Number(m[2]);
  const oldStart=Number(m[1])-(oldCount===0?0:1);
  const newCount=m[4]===undefined?1:Number(m[4]);
  if(oldStart<cursor||oldStart>source.length||oldCount<0||newCount<0)throw new PatchConflict("INVALID_PATCH","Hunk out of order or bounds");
  out.push(...source.slice(cursor,oldStart));cursor=oldStart;
  let consumed=0,added=0;
  for(index++;index<lines.length&&!lines[index].startsWith("@@ ");index++){
   const text=lines[index];
   if(text===""){if(index===lines.length-1)break;throw new PatchConflict("INVALID_PATCH","Malformed empty line");}
   const symbol=text[0],value=text.slice(1);
   if(symbol===" "||symbol==="-"){
    if(source[cursor]!==value)throw new PatchConflict("HASH_CONFLICT","Unified patch context mismatch");
    cursor++;consumed++;
   }
   if(symbol===" "||symbol==="+"){out.push(value);added++;}
   if(![" ","+","-"].includes(symbol))throw new PatchConflict("INVALID_PATCH","Invalid hunk operation");
  }
  if(consumed!==oldCount||added!==newCount)throw new PatchConflict("INVALID_PATCH","Hunk counts mismatch");
 }
 if(!hunks)throw new PatchConflict("INVALID_PATCH","Missing hunk");
 out.push(...source.slice(cursor));
 return out.join("\n");
}
