#!/usr/bin/env python3
import base64,hashlib,importlib.util,json,pathlib,unittest
p=pathlib.Path(__file__).with_name('prepare-vm-worker-seed.py')
spec=importlib.util.spec_from_file_location('worker_seed',p);seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)
def fixture(path='main.py',data=b'print(42)\n'):
 return {'path':path,'base64':base64.b64encode(data).decode(),'sha256':hashlib.sha256(data).hexdigest(),'size':len(data),'executable':False}
class Tests(unittest.TestCase):
 def test_source_and_working_copies_are_distinct_and_config_is_private(self):
  files=seed.seed_files('a'*64,'fixture',{'files':[fixture()]})
  config=json.loads(files['user-data'].split('\n',1)[1]);written={f['path']:f for f in config['write_files']}
  self.assertEqual(written['/opt/gsa-source/main.py']['permissions'],'0444')
  self.assertEqual(written['/workspace/main.py']['permissions'],'0644')
  self.assertEqual(written['/etc/gsa-worker.json']['permissions'],'0600')
  self.assertFalse(config['ssh_pwauth']);self.assertFalse(config['package_update'])
  self.assertEqual(json.loads(files['meta-data'])['dsmode'],'local')
 def test_encoded_source_cannot_escape_or_overwrite_supervisor(self):
  for name in ['../etc/gsa-worker.json','/etc/shadow','a/../b','a\\b','NUL','a:ads']:
   with self.subTest(name=name),self.assertRaises(ValueError):seed.seed_files('a'*64,'fixture',{'files':[fixture(name)]})
 def test_content_hash_size_and_duplicate_inputs_must_match(self):
  for entry in [{**fixture(),'sha256':'0'*64},{**fixture(),'size':99},{**fixture(),'base64':'@@'}]:
   with self.assertRaises(ValueError):seed.seed_files('a'*64,'fixture',{'files':[entry]})
  with self.assertRaises(ValueError):seed.seed_files('a'*64,'fixture',{'files':[fixture(),fixture()]})
 def test_nonce_and_workspace_are_validated_before_embedding(self):
  for nonce,ws in [('A'*64,'fixture'),('a'*64,'../fixture')]:
   with self.assertRaises(ValueError):seed.seed_files(nonce,ws,{'files':[]})
if __name__=='__main__':unittest.main()
