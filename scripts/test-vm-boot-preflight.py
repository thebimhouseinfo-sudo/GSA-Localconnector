#!/usr/bin/env python3
"""Native fixture-only disk checks; compile the probe, never start a VM."""
import hashlib,json,os,pathlib,subprocess,sys,tempfile,unittest

BINARY=pathlib.Path(sys.argv.pop(1)) if len(sys.argv)>1 else None

@unittest.skipUnless(sys.platform=='darwin' and BINARY is not None,'requires compiled macOS probe')
class DiskTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='gsa-disk-preflight-')
  self.addCleanup(self.temp.cleanup)
  self.root=pathlib.Path(self.temp.name).resolve()
  self.source=self.root/'source.raw';self.source.write_bytes(b'fixture'+bytes(8192-7))
  self.sha=hashlib.sha256(self.source.read_bytes()).hexdigest()
 def run_probe(self,**options):
  request={'protocolVersion':'gsa-vm-boot-probe-v1','imagePath':str(self.source),'expectedSHA256':self.sha,'expectedBytes':8192,'timeoutSeconds':10,'preflightOnly':True,**options}
  p=subprocess.run([str(BINARY)],input=json.dumps(request),capture_output=True,text=True,timeout=20)
  self.assertNotIn("CONFIG_VALIDATE",p.stderr,"fixture preflight must terminate before VM configuration")
  return p,json.loads(p.stdout)
 def test_readonly_preflight_does_not_launch_vm(self):
  p,result=self.run_probe()
  self.assertEqual(p.returncode,0,p.stderr)
  self.assertEqual(result['state'],'DISK_PREFLIGHT_PASSED')
  self.assertFalse(result['vmStarted'])
  self.assertEqual(result['diskMode'],'read-only')
 def test_clone_is_independent_and_leaves_source_unchanged(self):
  p,result=self.run_probe(diskMode='disposable-clone')
  self.assertEqual(p.returncode,0,p.stderr)
  self.assertEqual(result['state'],'DISK_PREFLIGHT_PASSED')
  self.assertEqual(result['diskMode'],'disposable-clone')
  self.assertIn('clone_write_verified=true',result['diagnostic'])
  self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(),self.sha)
 def test_unknown_disk_mode_is_rejected(self):
  p,result=self.run_probe(diskMode='write-original')
  self.assertNotEqual(p.returncode,0)
  self.assertEqual(result['state'],'BLOCKED')
 def test_smoke_seed_requires_disposable_disk(self):
  p,result=self.run_probe(seedImagePath=str(self.source),seedSHA256=self.sha,seedBytes=8192,smokeNonce='a'*64)
  self.assertNotEqual(p.returncode,0)
  self.assertEqual(result['state'],'BLOCKED')
 def test_source_symlink_is_rejected(self):
  link=self.root/'link.raw';link.symlink_to(self.source)
  p,result=self.run_probe(imagePath=str(link))
  self.assertNotEqual(p.returncode,0)
  self.assertEqual(result['state'],'BLOCKED')
 def test_seed_hash_mismatch_is_rejected(self):
  p,result=self.run_probe(diskMode='disposable-clone',seedImagePath=str(self.source),seedSHA256='f'*64,seedBytes=8192,smokeNonce='a'*64)
  self.assertNotEqual(p.returncode,0)
  self.assertEqual(result['state'],'BLOCKED')

if __name__=='__main__':unittest.main()
