#!/usr/bin/env python3
"""Hermetic seed rendering checks; no downloads, mounts or VM starts."""
import importlib.util,json,pathlib,subprocess,sys,unittest
p=pathlib.Path(__file__).with_name('prepare-vm-smoke-seed.py')
spec=importlib.util.spec_from_file_location('smoke_seed',p)
tool=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
class SeedTests(unittest.TestCase):
 def test_seed_requests_offline_workload_without_passwords_or_packages(self):
  files=tool.seed_files('a'*64)
  config=json.loads(files['user-data'].split('\n',1)[1])
  self.assertFalse(config['package_update']);self.assertFalse(config['package_upgrade'])
  self.assertFalse(config['ssh_pwauth']);self.assertTrue(config['disable_root'])
  self.assertEqual(config['users'],[])
  self.assertEqual(config['runcmd'],[['timeout','45','/bin/bash','/usr/local/sbin/gsa-offline-smoke']])
  self.assertEqual(json.loads(files['network-config']),{'version':2,'ethernets':{}})
  self.assertEqual(json.loads(files['meta-data']).get('dsmode'),'local')
  script=config['write_files'][0]['content']
  if sys.platform!='win32':
   checked=subprocess.run(['bash','-n'],input=script,capture_output=True,text=True)
   self.assertEqual(checked.returncode,0,checked.stderr)
 def test_bad_nonce_cannot_inject_guest_commands(self):
  for nonce in ['', 'a'*63,'A'*64,'a'*63+';','a'*64+'\n']:
   with self.assertRaises(ValueError):tool.seed_files(nonce)
 def test_each_run_has_distinct_metadata_and_evidence_challenge(self):
  a=tool.seed_files('a'*64);b=tool.seed_files('b'*64)
  self.assertNotEqual(a['meta-data'],b['meta-data'])
  self.assertNotEqual(a['user-data'],b['user-data'])
if __name__=='__main__':unittest.main()
