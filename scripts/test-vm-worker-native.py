#!/usr/bin/env python3
"""Opt-in Mac VM channel/containment integration. No external network or live MCP."""
import argparse,base64,hashlib,importlib.util,json,os,pathlib,selectors,secrets,subprocess,sys,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');parser.add_argument('--helpers-root',type=pathlib.Path);parser.add_argument('--backpressure',action='store_true');args=parser.parse_args()
 if sys.platform!='darwin' or not args.run:raise SystemExit('Explicit native test: python3 scripts/test-vm-worker-native.py --run')
 with tempfile.TemporaryDirectory(prefix='gsa-worker-native-') as raw:
  tmp=pathlib.Path(raw).resolve();binary=tmp/'worker';capture=tmp/'capture'
  if args.helpers_root:
   binary=args.helpers_root/'bin/worker-host';capture=args.helpers_root/'bin/source-capture'
  else:
   subprocess.run(['swiftc','-framework','Virtualization',str(ROOT/'native/macos-vm/WorkerHost.swift'),'-o',str(binary)],check=True)
   subprocess.run(['codesign','--force','--sign','-','--entitlements',str(ROOT/'native/macos-vm/Virtualization.entitlements'),str(binary)],check=True)
   subprocess.run(['swiftc',str(ROOT/'native/macos-vm/SourceCapture.swift'),'-o',str(capture)],check=True)
  project=tmp/'project';project.mkdir();(project/'hello.py').write_text('print(42)\n')
  canary=tmp/'outside-secret';canary.write_text('host-only-'+secrets.token_hex(16));canary_hash=hashlib.sha256(canary.read_bytes()).hexdigest()
  snapshot=json.loads(subprocess.check_output([str(capture)],input=json.dumps({'protocolVersion':'gsa-source-capture-v1','canonicalRoot':str(project)}).encode()))
  spec=importlib.util.spec_from_file_location('seed',(args.helpers_root or ROOT)/'scripts/prepare-vm-worker-seed.py');seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
  nonce=secrets.token_hex(32);ws='native-fixture';fields=seed.prepare(tmp/'seed',nonce,ws,snapshot,run_tests=True)
  image=pathlib.Path.home()/'Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-efi-fallback-candidate.raw'
  cfg={'protocolVersion':'gsa-vm-host-v1','workspaceID':ws,'nonce':nonce,'imagePath':str(image),'expectedBytes':3758096384,'expectedSHA256':'9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666','timeoutSeconds':300,**fields}
  native_scratch_before=set(pathlib.Path(tempfile.gettempdir()).glob('gsa-worker-*'))
  proc=subprocess.Popen([str(binary)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
   env={**os.environ,'MCP_HTTP_TOKEN':'gsa-test-host-secret','OPENAI_API_KEY':'gsa-test-host-key','CONTROL_PLANE_API_KEY':'gsa-test-control-key'})
  selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ)
  os.set_blocking(proc.stdout.fileno(),False)
  queue=[];buffer=b'';transcript=[];seq=0
  def send(obj):proc.stdin.write(json.dumps(obj).encode()+b'\n');proc.stdin.flush()
  def wait(kind,timeout=120,sequence=None):
   nonlocal buffer
   end=time.monotonic()+timeout
   while time.monotonic()<end:
    while queue:
     msg=queue.pop(0);transcript.append(msg)
     if msg.get('type')=='guest-log':print('GUEST: '+msg['text'],flush=True)
     elif msg.get('type') in ('error','stopped') and kind!=msg.get('type'):raise AssertionError(msg)
     if msg.get('type')==kind and (sequence is None or msg.get('seq')==sequence):return msg
    if proc.poll() is not None:raise AssertionError('worker exited: '+str(proc.returncode)+' '+proc.stderr.read().decode())
    for key,_ in selector.select(.1):
     data=os.read(key.fd,65536)
     if not data:continue
     buffer+=data
     while b'\n' in buffer:
      raw,buffer=buffer.split(b'\n',1);queue.append(json.loads(raw))
   raise AssertionError('timeout waiting for '+kind)
  def execute(code=None,**changes):
   nonlocal seq
   seq+=1
   req={'protocol':'gsa-vm-worker-v1','type':'request','nonce':nonce,'workspace_id':ws,'seq':seq,'method':'execute','executable':'/usr/bin/python3','argv':['-c',code] if code is not None else ['hello.py'],'cwd_relative':'.','time_limit_ms':5000,'max_output_bytes':65536,'network_allowed':False,**changes}
   send(req);msg=wait('result',sequence=seq);result=msg['result']
   print('RESULT '+str(seq)+' '+json.dumps({**result,'artifacts':[{k:v for k,v in a.items() if k!='base64'} for a in result.get('artifacts',[])],'stdout':result.get('stdout','')[:200],'stderr':result.get('stderr','')[:200],'stdout_bytes':len(result.get('stdout','').encode())}),flush=True)
   return result
  try:
   send(cfg);wait('ready')
   if args.backpressure:
    created=set(pathlib.Path(tempfile.gettempdir()).glob('gsa-worker-*'))-native_scratch_before
    assert len(created)==1,created
    send({'protocol':'gsa-vm-worker-v1','type':'request','nonce':nonce,'workspace_id':ws,'seq':1,'method':'execute','executable':'/usr/bin/python3','argv':['-c','import os;os.write(1,b"\\0"*1048576)'],'cwd_relative':'.','time_limit_ms':5000,'max_output_bytes':1048576,'network_allowed':False})
    # Deliberately do not drain stdout: bounded emit must still stop the VM.
    assert proc.wait(timeout=30)==2
    diagnostics=proc.stderr.read().decode()
    assert 'GSA_WORKER_SCRATCH_RETAINED' not in diagnostics,diagnostics
    assert not any(item.exists() for item in created)
    print(json.dumps({'state':'NATIVE_BACKPRESSURE_PASSED','clean_stop':True}),flush=True)
    return
   r=execute();assert r['exit_code']==0 and r['stdout'].strip()=='42' and r['source_verified'],r
   code=f'''import os,pathlib,subprocess,socket,json
assert os.getuid()==65534 and os.getgid()==65534 and os.getgroups()==[]
assert 'NoNewPrivs:\\t1' in pathlib.Path('/proc/self/status').read_text()
for target in [{str(canary)!r},'/etc/gsa-worker.json']:
 try: open(target).read(); raise AssertionError('outside read allowed')
 except (PermissionError,FileNotFoundError): pass
 try: open(target,'w').write('bad'); raise AssertionError('outside write allowed')
 except (PermissionError,FileNotFoundError): pass
link=pathlib.Path('/workspace/escape');link.symlink_to({str(canary)!r})
try: link.read_text();raise AssertionError('symlink read allowed')
except (PermissionError,FileNotFoundError):pass
assert subprocess.run(['/bin/sh','-c','cat "$1"','sh',{str(canary)!r}],capture_output=True).returncode!=0
try: pathlib.Path('/opt/gsa-source/hello.py').write_text('bad');raise AssertionError('source write allowed')
except PermissionError: pass
assert sorted(p.name for p in pathlib.Path('/sys/class/net').iterdir())==['lo']
s=socket.socket();s.settimeout(.2)
try:s.connect(('192.0.2.1',9));raise AssertionError('network allowed')
except OSError:pass
assert not any(k in os.environ for k in ['MCP_HTTP_TOKEN','OPENAI_API_KEY','CONTROL_PLANE_API_KEY'])
print('DENIALS_AND_IDENTITY_PASS')'''
   r=execute(code);assert r['exit_code']==0 and 'DENIALS_AND_IDENTITY_PASS' in r['stdout'] and r['source_verified'],r
   r=execute('import time; print("partial",flush=True); time.sleep(60)',time_limit_ms=150)
   assert r['timed_out'] and 'partial' in r['stdout'],r
   r=execute('import os\nwhile True: os.write(1,b"x"*8192)',max_output_bytes=1024)
   assert r['output_limited'] and len(r['stdout'].encode())+len(r['stderr'].encode())<=1024,r
   r=execute('import os;open("binary.bin","wb").write(bytes(range(256))*4096);os.write(1,b"\\0"*1048576)',max_output_bytes=1048576,artifact_paths=['binary.bin'])
   assert r['exit_code']==0 and len(r['stdout'].encode())==1048576 and not r['output_limited'],{'exit_code':r['exit_code'],'bytes':len(r['stdout'])}
   assert r['artifact_error'] is None and base64.b64decode(r['artifacts'][0]['base64'])==bytes(range(256))*4096
   assert r['artifacts'][0]['sha256']==hashlib.sha256(bytes(range(256))*4096).hexdigest()
   r=execute('pass',artifact_paths=['missing.bin']);assert r['exit_code']==0 and r['source_verified'] and r['artifact_error'] and not r['artifacts'],r
   r=execute('import os;os.symlink("binary.bin","alias.bin")',artifact_paths=['alias.bin']);assert r['exit_code']==0 and r['artifact_error'],r
   seq+=1;send({'protocol' :'gsa-vm-worker-v1','type':'request','nonce':nonce,'workspace_id':ws,'seq':seq,'method':'shutdown'})
   wait('result',sequence=seq);stopped=wait('stopped',timeout=20);assert stopped['clean'],stopped
   assert proc.wait(timeout=20)==0
   assert hashlib.sha256(canary.read_bytes()).hexdigest()==canary_hash
   print(json.dumps({'state':'NATIVE_WORKER_TESTS_PASSED','positive_build':True,'outside_denials':True,'identity_dropped':True,'source_protected':True,'timeout':True,'output_cap':True,'clean_stop':True,'securityVerified':False}),flush=True)
  finally:
   if proc.poll() is None:
    proc.terminate()
    try:proc.communicate(timeout=15)
    except subprocess.TimeoutExpired:proc.kill();proc.communicate(timeout=10)
   selector.close()
   print('FINAL_NATIVE_RETURN='+str(proc.returncode),flush=True)
if __name__=='__main__':main()
