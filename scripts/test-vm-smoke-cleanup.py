#!/usr/bin/env python3
"""Opt-in native failure-path regression. Boots one disposable VM for 10 seconds.
Usage on Mac: python3 scripts/test-vm-smoke-cleanup.py SIGNED_PROBE_BINARY
Never used in CI. No network, host shares, passwords or package downloads.
"""
import importlib.util,json,pathlib,subprocess,sys,tempfile

def main():
 if sys.platform!='darwin' or len(sys.argv)!=2:raise SystemExit(__doc__)
 binary=pathlib.Path(sys.argv[1]).resolve()
 source=pathlib.Path.home()/'Library/Application Support/GSA-Localconnector/images/ubuntu-24.04-arm64-efi-fallback-candidate.raw'
 spec=importlib.util.spec_from_file_location('seed',pathlib.Path(__file__).with_name('prepare-vm-smoke-seed.py'))
 seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
 with tempfile.TemporaryDirectory(prefix='gsa-smoke-failure-') as d:
  fields=seed.prepare(pathlib.Path(d)/'seed','a'*64)
  request={'protocolVersion':'gsa-vm-boot-probe-v1','imagePath':str(source),'expectedSHA256':'9aca11f8edb5474df457c073dbfe140b27aa31f22e46ab1405bed089c5d57666','expectedBytes':3758096384,'timeoutSeconds':10,'diskMode':'disposable-clone',**fields}
  # Wrong challenge deliberately prevents a guest marker from passing the probe.
  request['smokeNonce']='b'*64
  p=subprocess.run([str(binary)],input=json.dumps(request),text=True,capture_output=True,timeout=50)
  if p.returncode!=2:raise AssertionError('expected bounded smoke failure: '+p.stdout+p.stderr)
  result=json.loads(p.stdout.strip().splitlines()[-1])
  if not result.get('vmStarted') or result['state']!='VM_STARTED_UNVERIFIED':raise AssertionError(result)
  paths=[line.split('GSA_VM_PHASE=SCRATCH_PATH=',1)[1] for line in p.stderr.splitlines() if line.startswith('GSA_VM_PHASE=SCRATCH_PATH=')]
  if len(paths)!=1:raise AssertionError('missing scratch identity: '+p.stderr)
  if pathlib.Path(paths[0]).exists():raise AssertionError('FAILED_SMOKE_SCRATCH_LEAK: '+paths[0])
  print(json.dumps({'state':'FAILURE_CLEANUP_PASSED','vmStarted':True,'exitCode':p.returncode,'scratchRemoved':True,'securityVerified':False}))
if __name__=='__main__':main()
