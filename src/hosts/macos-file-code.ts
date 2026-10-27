/** codesign --remove-signature preserves the prior __LINKEDIT virtual mapping
 * size, which grows with root-specific entitlements. Normalize only that 8-byte
 * size after strict thin ARM64 validation. Every other byte, including all load
 * commands and the complete remaining __LINKEDIT data, stays in the digest. */
export function normalizedStrippedMacFileCode(bytes:Uint8Array):Buffer{
 const b=Buffer.from(bytes),bad=():never=>{throw Object.assign(Error('Unsupported or malformed stripped Mach-O'),{code:'SECURITY_BLOCKED'});};
 if(b.length<32||b.length>16*1024*1024||b.readUInt32LE(0)!==0xfeedfacf||b.readUInt32LE(4)!==0x100000c||b.readUInt32LE(8)!==0||b.readUInt32LE(12)!==2)bad();
 const count=b.readUInt32LE(16),size=b.readUInt32LE(20),end=32+size;
 if(count<1||count>1024||size>1024*1024||end>b.length)bad();
 let offset=32,linkedit=-1,uuid=0;const segments=new Set<string>();
 for(let i=0;i<count;i++){
  if(offset+8>end)bad();const cmd=b.readUInt32LE(offset),length=b.readUInt32LE(offset+4);
  if(length<8||length%8||offset+length>end||cmd===0x1d)bad();
  if(cmd===0x1b){if(length!==24||++uuid!==1||b.subarray(offset+8,offset+24).every(v=>v===0))bad();}
  if(cmd===0x19){
   if(length<72)bad();const sections=b.readUInt32LE(offset+64);if(sections>1024||length!==72+sections*80)bad();
   const nameBytes=b.subarray(offset+8,offset+24),zero=nameBytes.indexOf(0);if(zero<1||nameBytes.subarray(zero).some(v=>v!==0))bad();
   const name=nameBytes.subarray(0,zero).toString('ascii');if(segments.has(name))bad();segments.add(name);
   const fileoff=b.readBigUInt64LE(offset+40),filesize=b.readBigUInt64LE(offset+48);if(fileoff+filesize>BigInt(b.length))bad();
   if(name==='__LINKEDIT'){if(linkedit!==-1||sections!==0||fileoff<BigInt(end)||filesize===0n||fileoff+filesize!==BigInt(b.length))bad();linkedit=offset+32;}
  }
  offset+=length;
 }
 if(offset!==end||linkedit===-1||uuid!==1)bad();b.writeBigUInt64LE(0n,linkedit);return b;
}
