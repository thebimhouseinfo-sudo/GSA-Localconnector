#!/usr/bin/env python3
"""Kernel fencing for one connector owner. FD 3 must stay with trusted workers.

The persistent file is never unlinked. flock follows the inherited open file
description, so a crashed server cannot release fencing while its VM is alive.
"""
import argparse,fcntl,json,os,pathlib,stat,sys,uuid

def fail(message,code=78):
 print(json.dumps({'state':'OWNER_BLOCKED','reason':message}),file=sys.stderr,flush=True)
 raise SystemExit(code)

def protected(info,directory=False):
 if info.st_uid!=os.getuid() or info.st_mode&0o077 or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode) or info.st_nlink!=1):fail('unsafe owner storage')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--identity',required=True);parser.add_argument('--node');parser.add_argument('--entry');parser.add_argument('--verify',action='store_true');args=parser.parse_args()
 if sys.platform!='darwin':fail('macOS owner launcher only')
 directory=pathlib.Path(args.identity)
 if not directory.is_absolute() or str(directory.resolve())!=str(directory):fail('noncanonical identity directory')
 if not args.verify:directory.mkdir(mode=0o700,parents=True,exist_ok=True)
 protected(directory.lstat(),True);lock=directory/'server-owner.lock'
 if args.verify:
  if os.environ.get('GSA_OWNER_LOCK_FD')!='3':fail('owner descriptor absent')
  info=os.fstat(3);protected(info);observed=lock.lstat();protected(observed)
  if (info.st_dev,info.st_ino)!=(observed.st_dev,observed.st_ino):fail('owner descriptor identity mismatch')
  try:fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:fail('another server owns installation',75)
  raw=os.pread(3,4097,0)
  if len(raw)>4096:fail('oversized owner record')
  value=json.loads(raw)
  if value.get('session')!=os.environ.get('GSA_OWNER_SESSION') or value.get('format')!='gsa-owner-v1':fail('owner session mismatch')
  print(json.dumps(value),flush=True);return
 if not args.node or not args.entry or not all(pathlib.Path(x).is_absolute() for x in [args.node,args.entry]):fail('absolute node and entry required')
 fd=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600);protected(os.fstat(fd))
 try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:fail('another server or trusted worker owns installation',75)
 session=str(uuid.uuid4());record=json.dumps({'format':'gsa-owner-v1','session':session,'pid':os.getpid()}).encode()
 os.ftruncate(fd,0);os.pwrite(fd,record,0);os.fsync(fd)
 if fd!=3:os.dup2(fd,3,inheritable=True);os.close(fd)
 os.set_inheritable(3,True)
 env={**os.environ,'GSA_OWNER_LOCK_FD':'3','GSA_OWNER_SESSION':session,'GSA_OWNER_IDENTITY':str(directory)}
 os.execve(args.node,[args.node,args.entry],env)

if __name__=='__main__':
 try:main()
 except (OSError,ValueError,KeyError) as error:fail(type(error).__name__+': '+str(error))
