#!/usr/bin/env python3
"""Build a local NoCloud ISO for an offline guest-only smoke test. No mounts/downloads."""
import hashlib,json,pathlib,re,subprocess,sys

def seed_files(nonce):
 if not isinstance(nonce,str) or re.fullmatch('[a-f0-9]{64}',nonce) is None:
  raise ValueError('INVALID_SMOKE_NONCE')
 script='''#!/bin/bash
set -euo pipefail
exec >/dev/hvc0 2>&1
trap 'printf "GSA_VM_SMOKE_V1 NONCE FAIL\\n"' EXIT
python3 - <<'GUESTPY'
import json,os,pathlib,py_compile,shutil,subprocess,sys,tempfile
root=pathlib.Path(tempfile.mkdtemp(prefix='gsa-offline-smoke-',dir='/var/tmp'))
try:
 source=root/'hello.py'
 source.write_text('print(6 * 7)\\n')
 compiled=py_compile.compile(str(source),doraise=True)
 result=subprocess.check_output([sys.executable,compiled],text=True,timeout=10).strip()
 assert result=='42', 'compiled Python result mismatch'
 nested=subprocess.check_output(['/bin/sh','-c',"/bin/sh -c 'printf nested-ok'"],text=True,timeout=10)
 assert nested=='nested-ok', 'nested subprocess failed'
 interfaces=sorted(p.name for p in pathlib.Path('/sys/class/net').iterdir())
 assert interfaces==['lo'], 'unexpected network interface'
 print('GSA_GUEST_CHECKS '+json.dumps({'root_write':True,'python_compile_run':True,'nested_process':True,'interfaces':interfaces,'nonce':'NONCE'},sort_keys=True),flush=True)
finally:
 shutil.rmtree(root)
GUESTPY
trap - EXIT
printf 'GSA_VM_SMOKE_V1 NONCE PASS\\n'
'''.replace('NONCE',nonce)
 config={'users':[],'disable_root':True,'ssh_pwauth':False,'ssh_deletekeys':False,'ssh_genkeytypes':[],
  'package_update':False,'package_upgrade':False,'growpart':{'mode':'off'},'resize_rootfs':False,
  'bootcmd':[['systemctl','mask','--runtime','systemd-networkd-wait-online.service']],
  'write_files':[{'path':'/usr/local/sbin/gsa-offline-smoke','permissions':'0700','content':script}],
  'runcmd':[['timeout','45','/bin/bash','/usr/local/sbin/gsa-offline-smoke']]}
 return {'user-data':'#cloud-config\n'+json.dumps(config)+'\n',
  'meta-data':json.dumps({'instance-id':'gsa-smoke-'+nonce,'local-hostname':'gsa-offline-smoke','dsmode':'local'})+'\n',
  'network-config':json.dumps({'version':2,'ethernets':{}})+'\n'}

def prepare(destination,nonce):
 files=seed_files(nonce)
 destination=pathlib.Path(destination)
 destination.mkdir(mode=0o700,parents=False,exist_ok=False)
 for name,contents in files.items():
  with (destination/name).open('x',encoding='utf-8') as f:f.write(contents)
 iso=destination.parent/'seed.iso'
 if iso.exists() or iso.is_symlink():raise ValueError('SEED_ALREADY_EXISTS')
 subprocess.run(['/usr/bin/hdiutil','makehybrid','-iso','-joliet','-default-volume-name','cidata','-o',str(iso),str(destination)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
 data=iso.read_bytes()
 if not 4096<=len(data)<=16*1024*1024:raise ValueError('SEED_SIZE')
 return {'seedImagePath':str(iso.resolve()),'seedSHA256':hashlib.sha256(data).hexdigest(),'seedBytes':len(data),'smokeNonce':nonce}

if __name__=='__main__':
 if len(sys.argv)!=3 or sys.platform!='darwin':raise SystemExit('Usage on macOS: prepare-vm-smoke-seed.py NEW_DIRECTORY NONCE')
 print(json.dumps(prepare(sys.argv[1],sys.argv[2])))
