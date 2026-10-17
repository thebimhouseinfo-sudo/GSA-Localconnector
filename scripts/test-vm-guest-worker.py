#!/usr/bin/env python3
"""Hermetic worker protocol/lifecycle checks; no VM or network required."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

PATH = Path(__file__).resolve().parents[1] / 'native/macos-vm/guest_worker.py'
if PATH.exists():
    spec = importlib.util.spec_from_file_location('guest_worker', PATH)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
else:
    worker = None

NONCE = 'a' * 64

def request(**changes):
    value = dict(protocol='gsa-vm-worker-v1', type='request', nonce=NONCE,
                 workspace_id='fixture', seq=1, method='execute', executable='/bin/echo',
                 argv=['hello'], cwd_relative='.', time_limit_ms=1000,
                 max_output_bytes=4096, network_allowed=False)
    value.update(changes)
    return value

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(worker, 'guest worker module must exist')

    def test_rejects_replay_mismatch_and_unsafe_execution_fields(self):
        worker.validate_request(request(), NONCE, 'fixture', 0)
        cases = [dict(seq=1), dict(nonce='b'*64), dict(workspace_id='other'),
                 dict(network_allowed=True), dict(time_limit_ms=0), dict(time_limit_ms=True),
                 dict(max_output_bytes=1048577), dict(argv=[3]), dict(cwd_relative='../escape'),
                 dict(cwd_relative='/tmp'), dict(executable='a/b'), dict(seq=3)]
        for change in cases:
            with self.subTest(change=change), self.assertRaises(worker.ProtocolError):
                worker.validate_request(request(**change), NONCE, 'fixture', 1 if change == {'seq':1} else 0)

    def test_protocol_replay_does_not_execute_twice(self):
        calls = []
        def execute(req):
            calls.append(req['seq'])
            return {'stdout':'hello\n'}
        shutdown = dict(protocol='gsa-vm-worker-v1',type='request',nonce=NONCE,
                        workspace_id='fixture',seq=2,method='shutdown')
        incoming = '\n'.join(json.dumps(r) for r in [request(), request(), shutdown])+'\n'
        output = io.StringIO()
        worker.serve(io.StringIO(incoming), output, {'nonce':NONCE,'workspace_id':'fixture'}, execute)
        messages = [json.loads(s) for s in output.getvalue().splitlines()]
        self.assertEqual(calls, [1])
        self.assertEqual([m['type'] for m in messages], ['ready','result','error','result'])
        self.assertEqual(messages[2]['code'], 'invalid_sequence')
        self.assertEqual(messages[-1]['seq'], 2)

    def test_bad_json_and_oversize_line_are_bounded(self):
        output = io.StringIO()
        worker.serve(io.StringIO('{bad}\n' + 'x'*70000+'\n'), output,
                     {'nonce':NONCE,'workspace_id':'fixture'}, lambda r: self.fail('executed malformed input'))
        messages = [json.loads(s) for s in output.getvalue().splitlines()]
        self.assertEqual([m['code'] for m in messages[1:]], ['invalid_json','request_too_large'])

    def run_child(self, code, limit=4096, timeout=1000):
        return worker.capture_process([sys.executable, '-c', code], cwd='/tmp',
                                      env={'PATH':'/usr/bin:/bin'}, time_limit_ms=timeout,
                                      max_output_bytes=limit, prepare_child=os.setsid)

    def test_concurrent_output_has_combined_cap(self):
        result = self.run_child('import os\nwhile True: os.write(1,b"a"*2048); os.write(2,b"b"*2048)', limit=6000)
        self.assertTrue(result['output_limited'])
        self.assertLessEqual(len(result['stdout'].encode())+len(result['stderr'].encode()), 6000)
        self.assertFalse(result['timed_out'])

    def test_timeout_kills_children_and_captures_partial_output(self):
        started = time.monotonic()
        result = self.run_child('import os,time\nprint("started",flush=True)\nif os.fork()==0: time.sleep(60)\ntime.sleep(60)', timeout=120)
        self.assertTrue(result['timed_out'])
        self.assertIn('started', result['stdout'])
        self.assertLess(time.monotonic()-started, 3)

    def test_parent_exit_cleans_up_pipe_holding_descendant(self):
        started = time.monotonic()
        result = self.run_child('import os,time\nif os.fork()==0: time.sleep(60)\nelse: print("done",flush=True)')
        self.assertEqual(result['exit_code'], 0)
        self.assertIn('done', result['stdout'])
        self.assertLess(time.monotonic()-started, 3)

    def test_escaped_pipe_writer_cannot_extend_cleanup_deadline(self):
        started = time.monotonic()
        result = self.run_child('import os,time\nif os.fork()==0:\n os.setsid()\n end=time.monotonic()+1.2\n while time.monotonic()<end:\n  try: os.write(1,b"x"*100)\n  except BrokenPipeError: break\nelse: os._exit(0)', limit=16)
        self.assertTrue(result['output_limited'])
        self.assertLess(time.monotonic()-started, 0.8)

    def test_containment_failure_stops_subsequent_jobs(self):
        calls = []
        def execute(req):
            calls.append(req['seq'])
            raise worker.ContainmentError('unavailable')
        incoming = '\n'.join(json.dumps(r) for r in [request(),request(seq=2)])+'\n'
        output = io.StringIO()
        worker.serve(io.StringIO(incoming),output,{'nonce':NONCE,'workspace_id':'fixture'},execute)
        self.assertEqual(calls,[1])
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[-1]['code'],'containment_failed')

    def test_capture_invokes_containment_killer(self):
        killed = []
        result = worker.capture_process(['/bin/echo','contained'], cwd='/tmp',
                                        env={'PATH':'/usr/bin:/bin'}, time_limit_ms=1000,
                                        max_output_bytes=100, prepare_child=os.setsid,
                                        kill_descendants=lambda: killed.append(True))
        self.assertEqual(result['stdout'], 'contained\n')
        self.assertEqual(killed, [True])

    @unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0, 'requires root Linux guest')
    def test_cgroup_kills_doublefork_setsid_descendant(self):
        with worker.JobCgroup() as group:
            def prepare():
                group.join()
                worker._prepare_job('/tmp', 1000)
            code = ('import os,time\nread_fd,write_fd=os.pipe()\n'
                    'if os.fork()==0:\n'
                    ' os.setsid()\n'
                    ' if os.fork()!=0: os._exit(0)\n'
                    ' print(os.getpid(),flush=True)\n'
                    ' os.write(write_fd,b"1")\n'
                    ' time.sleep(60)\n'
                    'else: os.read(read_fd,1)')
            result = worker.capture_process(['/usr/bin/python3','-c',code],cwd='/tmp',
                                            env={'PATH':'/usr/bin:/bin'},time_limit_ms=1000,
                                            max_output_bytes=100,prepare_child=prepare,
                                            kill_descendants=group.kill)
            self.assertEqual(result['exit_code'], 0)
            self.assertEqual(group.populated(), False)
            self.assertTrue(result['stdout'].strip().isdigit())

    def test_invalid_utf8_does_not_expand_output_beyond_cap(self):
        result = self.run_child('import os;os.write(1,b"\\xff"*100)', limit=100)
        self.assertLessEqual(len(result['stdout'].encode())+len(result['stderr'].encode()), 100)

    @unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0, 'requires root Linux guest')
    def test_execution_drops_identity_and_protects_source(self):
        with tempfile.TemporaryDirectory(prefix='gsa-worker-test-') as directory:
            base = Path(directory)
            base.chmod(0o755)
            source, workspace = base/'source', base/'workspace'
            source.mkdir()
            workspace.mkdir()
            os.chown(workspace, 65534, 65534)
            (source/'input').write_text('immutable')
            (source/'input').chmod(0o444)
            source.chmod(0o555)
            try:
                code = ('import os,json; '
                        'print(json.dumps([os.getuid(),os.getgid(),os.getgroups(),'
                        'os.environ.get("HOST_SECRET"),os.environ["HOME"]==os.environ["TMPDIR"]])); '
                        'print([s.strip() for s in open("/proc/self/status") if s.startswith("NoNewPrivs:")][0])')
                result = worker.execute_request(request(executable='/usr/bin/python3',argv=['-c',code]),
                                                workspace=str(workspace), source=str(source))
                self.assertEqual(result['exit_code'], 0)
                self.assertEqual(json.loads(result['stdout'].splitlines()[0]), [65534,65534,[],None,True])
                self.assertIn('NoNewPrivs:\t1', result['stdout'])
                self.assertTrue(result['source_verified'])
            finally:
                source.chmod(0o755)

    def test_execute_refuses_non_linux_or_unprivileged_supervisor(self):
        if sys.platform == 'linux' and os.geteuid() == 0:
            self.skipTest('requires an unprivileged or non-Linux host')
        with self.assertRaises(RuntimeError):
            worker.execute_request(request())

if __name__ == '__main__':
    unittest.main()
