#!/usr/bin/env python3
"""Offline immutable snapshot + root supervisor bootstrap. No mounts, network or credentials."""
import base64,hashlib,json,pathlib,re,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
MAX_SOURCE=4*1024*1024
RESERVED=re.compile(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',re.I)
def valid_path(value):
 if not isinstance(value,str) or not value or len(value)>4096 or '\\' in value or any(ord(x)<32 or ord(x)==127 for x in value):raise ValueError('UNSAFE_SOURCE_PATH')
 if any(x in ('','.','..') or x.endswith(('.',' ')) or ':' in x or RESERVED.match(x) for x in value.split('/')):raise ValueError('UNSAFE_SOURCE_PATH')
 return value

def seed_files(nonce,workspace_id,snapshot,run_tests=False):
 if not isinstance(nonce,str) or re.fullmatch('[a-f0-9]{64}',nonce) is None or not isinstance(workspace_id,str) or re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,63}',workspace_id) is None:raise ValueError('INVALID_WORKER_IDENTITY')
 entries=snapshot.get('files')
 if not isinstance(entries,list) or len(entries)>1000:raise ValueError('SOURCE_FILE_LIMIT')
 seen=set();total=0;written=[]
 for entry in entries:
  name=valid_path(entry['path'])
  if name.casefold() in seen:raise ValueError('DUPLICATE_SOURCE_PATH')
  seen.add(name.casefold())
  data=base64.b64decode(entry['base64'],validate=True);total+=len(data)
  if total>MAX_SOURCE or len(data)!=entry['size'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('SOURCE_INTEGRITY')
  executable=entry.get('executable',False)
  if type(executable) is not bool:raise ValueError('SOURCE_MODE')
  for prefix,mode in [('/opt/gsa-source/','0555' if executable else '0444'),('/workspace/','0755' if executable else '0644')]:
   written.append({'path':prefix+name,'permissions':mode,'encoding':'b64','content':entry['base64']})
 worker=(ROOT/'native/macos-vm/guest_worker.py').read_text()
 written.extend([{'path':'/etc/gsa-worker.json','permissions':'0600','content':json.dumps({'nonce':nonce,'workspace_id':workspace_id})},
  {'path':'/usr/local/sbin/gsa-vm-worker.py','permissions':'0700','content':worker}])
 boot='''#!/bin/bash
set -euo pipefail
exec >/dev/hvc0 2>&1
systemctl mask --runtime serial-getty@hvc0.service || true
mkdir -p /opt/gsa-source /workspace
chmod -R a-w /opt/gsa-source
chown -R 65534:65534 /workspace
chmod 0755 /workspace
'''
 if run_tests:
  written.extend([{'path':'/usr/local/lib/gsa/tests/scripts/test-vm-guest-worker.py','permissions':'0700','content':(ROOT/'scripts/test-vm-guest-worker.py').read_text()},
   {'path':'/usr/local/lib/gsa/tests/native/macos-vm/guest_worker.py','permissions':'0700','content':worker}])
  boot+="echo GSA_BOOTSTRAP_TESTS_START\npython3 /usr/local/lib/gsa/tests/scripts/test-vm-guest-worker.py\necho GSA_BOOTSTRAP_TESTS_PASS\n"
 boot+='exec python3 -u /usr/local/sbin/gsa-vm-worker.py\n'
 written.append({'path':'/usr/local/sbin/gsa-worker-start','permissions':'0700','content':boot})
 config={'users':[],'disable_root':True,'ssh_pwauth':False,'ssh_deletekeys':False,'ssh_genkeytypes':[],'package_update':False,'package_upgrade':False,'growpart':{'mode':'off'},'resize_rootfs':False,
  'bootcmd':[['systemctl','mask','--runtime','systemd-networkd-wait-online.service'],['systemctl','mask','--runtime','serial-getty@hvc0.service']],
  'write_files':written,'runcmd':[['/bin/bash','/usr/local/sbin/gsa-worker-start']]}
 return {'user-data':'#cloud-config\n'+json.dumps(config)+'\n','meta-data':json.dumps({'instance-id':'gsa-worker-'+nonce,'local-hostname':'gsa-worker','dsmode':'local'})+'\n','network-config':json.dumps({'version':2,'ethernets':{}})+'\n'}

def prepare(destination,nonce,workspace_id,snapshot,run_tests=False):
 files=seed_files(nonce,workspace_id,snapshot,run_tests)
 destination=pathlib.Path(destination);destination.mkdir(mode=0o700,parents=False,exist_ok=False)
 for name,text in files.items():
  with (destination/name).open('x',encoding='utf-8') as f:f.write(text)
 iso=destination.parent/'worker-seed.iso'
 if iso.exists() or iso.is_symlink():raise ValueError('SEED_EXISTS')
 subprocess.run(['/usr/bin/hdiutil','makehybrid','-iso','-joliet','-default-volume-name','cidata','-o',str(iso),str(destination)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
 data=iso.read_bytes()
 if len(data)>16*1024*1024:raise ValueError('SEED_TOO_LARGE')
 return {'seedImagePath':str(iso.resolve()),'seedSHA256':hashlib.sha256(data).hexdigest(),'seedBytes':len(data)}

if __name__=='__main__':
 if sys.platform!='darwin' or len(sys.argv)!=5:raise SystemExit('Usage on Mac: prepare-vm-worker-seed.py NEW_DIRECTORY NONCE WORKSPACE_ID SNAPSHOT_JSON')
 print(json.dumps(prepare(sys.argv[1],sys.argv[2],sys.argv[3],json.loads(pathlib.Path(sys.argv[4]).read_text()))))
