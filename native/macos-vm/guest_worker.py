#!/usr/bin/env python3
"""Root guest supervisor. Its serial transport is never inherited by jobs.

The VM boundary supplies isolation; this supervisor additionally separates the
untrusted job from its nonce, immutable input, and serial control channel.
"""
import base64
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import termios
import time
import tty

PROTOCOL = 'gsa-vm-worker-v1'
MAX_REQUEST_BYTES = 65536

class ProtocolError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


MAX_ARTIFACT_BYTES = 1048576
MAX_ARTIFACT_FILES = 20


def validate_artifact_paths(paths):
    if not isinstance(paths, list) or len(paths) > MAX_ARTIFACT_FILES:
        raise ProtocolError('invalid_artifact_paths')
    seen = set()
    for name in paths:
        if not isinstance(name, str) or not name or len(name) > 4096 or re.search(r'[\x00-\x1f\x7f\\:*?<>|"\[\]]', name):
            raise ProtocolError('invalid_artifact_paths')
        parts = name.split('/')
        if any(not part or part in ('.', '..') or part.endswith(('.', ' ')) or
               re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', part, re.I) for part in parts):
            raise ProtocolError('invalid_artifact_paths')
        # Restrict to ASCII so case folding is identical in every protocol peer.
        if not name.isascii() or name.lower() in seen:
            raise ProtocolError('invalid_artifact_paths')
        seen.add(name.lower())
    return paths


def collect_artifacts(workspace, paths):
    """Called only after cgroup cleanup: no job can rename or write these files.
    Every path component is opened relative to a held no-follow directory FD.
    """
    validate_artifact_paths(paths)
    results, total = [], 0
    root = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        for name in paths:
            directory = os.dup(root)
            try:
                parts = name.split('/')
                for part in parts[:-1]:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
                    os.close(directory)
                    directory = child
                fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
                try:
                    info = os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_ARTIFACT_BYTES - total:
                        raise ProtocolError('artifact_unsafe_or_over_quota')
                    data = bytearray()
                    while True:
                        chunk = os.read(fd, min(65536, MAX_ARTIFACT_BYTES - total - len(data) + 1))
                        if not chunk:
                            break
                        data.extend(chunk)
                        if total + len(data) > MAX_ARTIFACT_BYTES:
                            raise ProtocolError('artifact_unsafe_or_over_quota')
                    after = os.fstat(fd)
                    if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink) or len(data) != info.st_size:
                        raise ProtocolError('artifact_changed')
                    total += len(data)
                    results.append(dict(path=name, size=len(data), sha256=hashlib.sha256(data).hexdigest(), base64=base64.b64encode(data).decode('ascii')))
                finally:
                    os.close(fd)
            finally:
                os.close(directory)
    finally:
        os.close(root)
    return results


def validate_request(req, nonce, workspace_id, last_seq):
    if not isinstance(req, dict):
        raise ProtocolError('invalid_request')
    if req.get('protocol') != PROTOCOL or req.get('type') != 'request':
        raise ProtocolError('invalid_protocol')
    if req.get('nonce') != nonce or req.get('workspace_id') != workspace_id:
        raise ProtocolError('identity_mismatch')
    if type(req.get('seq')) is not int or req['seq'] != last_seq + 1:
        raise ProtocolError('invalid_sequence')
    if req.get('method') == 'shutdown':
        return req
    if req.get('method') != 'execute':
        raise ProtocolError('invalid_method')
    executable = req.get('executable')
    if not isinstance(executable, str) or not executable or '\0' in executable:
        raise ProtocolError('invalid_executable')
    if not os.path.isabs(executable) and ('/' in executable or executable in ('.', '..')):
        raise ProtocolError('invalid_executable')
    argv = req.get('argv')
    if not isinstance(argv, list) or any(not isinstance(a, str) or '\0' in a for a in argv):
        raise ProtocolError('invalid_argv')
    cwd = req.get('cwd_relative')
    if not isinstance(cwd, str) or not cwd or '\0' in cwd or os.path.isabs(cwd) or '..' in Path(cwd).parts:
        raise ProtocolError('invalid_cwd')
    for name, maximum in [('time_limit_ms', 120000), ('max_output_bytes', 1048576)]:
        if type(req.get(name)) is not int or not 1 <= req[name] <= maximum:
            raise ProtocolError('invalid_' + name)
    if req.get('network_allowed') is not False:
        raise ProtocolError('network_not_allowed')
    validate_artifact_paths(req.get('artifact_paths', []))
    return req


def _kill_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def capture_process(command, *, cwd, env, time_limit_ms, max_output_bytes, prepare_child, kill_descendants=None):
    """Bounded concurrent capture; caller supplies mandatory child setup."""
    started = time.monotonic()
    proc = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            close_fds=True, preexec_fn=prepare_child)
    output = {'stdout': bytearray(), 'stderr': bytearray()}
    total = 0
    timed_out = output_limited = False
    deadline = started + time_limit_ms / 1000
    selector = selectors.DefaultSelector()
    for name, stream in [('stdout', proc.stdout), ('stderr', proc.stderr)]:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, name)
    cleanup_deadline = None
    group_killed = False
    def kill():
        nonlocal group_killed
        if not group_killed:
            try:
                _kill_group(proc.pid)
            except PermissionError:
                # Darwin reports EPERM for an exited group during reaping.
                if sys.platform != 'darwin' or proc.poll() is None:
                    raise
            group_killed = True
            if kill_descendants is not None:
                kill_descendants()
    try:
        while selector.get_map() or proc.poll() is None:
            now = time.monotonic()
            if proc.poll() is not None and cleanup_deadline is None:
                kill()  # Parent exit must not leave pipe-holding children.
                cleanup_deadline = now + 0.25
            if now >= deadline and proc.poll() is None and not timed_out:
                timed_out = True
                kill()
                cleanup_deadline = now + 0.25
            if cleanup_deadline is not None and now >= cleanup_deadline:
                break
            for key, _ in selector.select(0.02):
                data = os.read(key.fd, min(65536, max_output_bytes - total + 1))
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                remaining = max_output_bytes - total
                output[key.data].extend(data[:remaining])
                total += min(len(data), remaining)
                if len(data) > remaining:
                    output_limited = True
                    kill()
                    if cleanup_deadline is None:
                        cleanup_deadline = time.monotonic() + 0.25
        kill()
        return_code = proc.wait(timeout=2)
    finally:
        kill()
        if proc.poll() is None:
            proc.wait(timeout=2)
        selector.close()
        proc.stdout.close()
        proc.stderr.close()
    # Invalid UTF-8 is omitted: replacement characters could triple the byte cap.
    return dict(stdout=output['stdout'].decode('utf-8', errors='ignore'),
                stderr=output['stderr'].decode('utf-8', errors='ignore'),
                exit_code=return_code if return_code >= 0 else None,
                signal=-return_code if return_code < 0 else None,
                cancelled=False, timed_out=timed_out, output_limited=output_limited)


def source_digest(source):
    """Fail closed on writable, non-root-owned, or linked immutable inputs."""
    digest = hashlib.sha256()
    root = Path(source)
    for path in [root] + sorted(root.rglob('*')):
        info = path.lstat()
        if info.st_uid != 0 or info.st_mode & 0o222 or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise RuntimeError('immutable source permissions are unsafe')
        digest.update(str(path.relative_to(root)).encode() + b'\0')
        if path.is_file():
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(65536), b''):
                    digest.update(chunk)
        digest.update(b'\0')
    return digest.hexdigest()


class ContainmentError(RuntimeError):
    """The supervisor must stop accepting jobs after containment failure."""


class JobCgroup:
    """Private cgroup v2 leaf; child joins while root before executing user code."""
    def __init__(self):
        self.path = None
        try:
            mount = Path('/sys/fs/cgroup')
            entries = Path('/proc/self/mountinfo').read_text().splitlines()
            if not any(line.split(' - ')[0].split()[4] == str(mount) and
                       line.split(' - ')[1].split()[0] == 'cgroup2' for line in entries):
                raise ContainmentError('cgroup v2 mount required at /sys/fs/cgroup')
            base = mount / 'gsa-worker'
            base.mkdir(mode=0o700, exist_ok=True)
            info = base.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
                raise ContainmentError('private root-owned cgroup parent required')
            self.path = Path(tempfile.mkdtemp(prefix='job-', dir=str(base)))
            if not (self.path / 'cgroup.kill').is_file():
                raise ContainmentError('cgroup.kill support required')
            # Probe cgroup.kill before a command can start. No fallback is safe.
            self.kill()
        except Exception as error:
            if self.path is not None:
                try:
                    self.path.rmdir()
                except OSError:
                    pass
            raise ContainmentError('guest cgroup containment unavailable') from error

    def __enter__(self):
        return self

    def join(self):
        (self.path / 'cgroup.procs').write_text(str(os.getpid()))

    def populated(self):
        events = dict(line.split() for line in (self.path / 'cgroup.events').read_text().splitlines())
        if events.get('populated') not in ('0', '1'):
            raise ContainmentError('invalid cgroup.events')
        return events['populated'] == '1'

    def kill(self):
        try:
            (self.path / 'cgroup.kill').write_text('1')
            deadline = time.monotonic() + 2
            while self.populated():
                if time.monotonic() >= deadline:
                    raise ContainmentError('cgroup remained populated after kill')
                time.sleep(0.01)
        except (OSError, ValueError) as error:
            raise ContainmentError('cgroup kill failed') from error

    def __exit__(self, *_):
        try:
            self.kill()
            self.path.rmdir()
        except OSError as error:
            raise ContainmentError('cgroup cleanup failed') from error


def _prepare_job(job_dir, time_limit_ms):
    os.setsid()
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise OSError(ctypes.get_errno(), 'PR_SET_NO_NEW_PRIVS failed')
    limits = [(resource.RLIMIT_CORE, 0), (resource.RLIMIT_NOFILE, 64),
              (resource.RLIMIT_FSIZE, 64 * 1024 * 1024),
              (resource.RLIMIT_CPU, math.ceil(time_limit_ms / 1000) + 1),
              (resource.RLIMIT_NPROC, 64), (resource.RLIMIT_AS, 1024 * 1024 * 1024)]
    for kind, limit in limits:
        _, hard = resource.getrlimit(kind)
        value = min(limit, hard) if hard != resource.RLIM_INFINITY else limit
        resource.setrlimit(kind, (value, value))
    os.umask(0o077)


def execute_request(req, workspace='/workspace', source='/opt/gsa-source'):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise RuntimeError('worker execution requires a root Linux guest supervisor')
    before = source_digest(source)
    root = Path(workspace).resolve(strict=True)
    cwd = (root / req['cwd_relative']).resolve(strict=True)
    if not cwd.is_relative_to(root) or not cwd.is_dir():
        raise ProtocolError('invalid_cwd')
    job_dir = tempfile.mkdtemp(prefix='gsa-job-', dir='/tmp')
    os.chown(job_dir, 65534, 65534)
    try:
        with JobCgroup() as group:
            def prepare():
                group.join()
                _prepare_job(job_dir, req['time_limit_ms'])
            receipt = capture_process([req['executable']] + req['argv'], cwd=str(cwd),
                                      env={'PATH':'/usr/local/bin:/usr/bin:/bin', 'HOME':job_dir,
                                           'TMPDIR':job_dir, 'LANG':'C.UTF-8'},
                                      time_limit_ms=req['time_limit_ms'], max_output_bytes=req['max_output_bytes'],
                                      prepare_child=prepare, kill_descendants=group.kill)
        try:
            receipt['source_verified'] = before == source_digest(source)
        except (OSError, RuntimeError):
            receipt['source_verified'] = False
        if 'artifact_paths' in req:
            try:
                receipt['artifacts'] = collect_artifacts(str(root), req['artifact_paths'])
                receipt['artifact_error'] = None
            except (OSError, ProtocolError):
                receipt['artifacts'] = []
                receipt['artifact_error'] = 'artifact_missing_unsafe_or_over_quota'
        return receipt
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def serve(reader, writer, config, executor=execute_request):
    nonce, workspace_id = config['nonce'], config['workspace_id']
    last_seq = 0
    def send(kind, seq, **fields):
        writer.write(json.dumps(dict(protocol=PROTOCOL, type=kind, nonce=nonce,
                                     workspace_id=workspace_id, seq=seq, **fields),
                                separators=(',', ':')) + '\n')
        writer.flush()
    send('ready', 0)
    while True:
        line = reader.readline(MAX_REQUEST_BYTES + 1)
        if not line:
            return
        if len(line.encode('utf-8')) > MAX_REQUEST_BYTES:
            while line and not line.endswith('\n'):
                line = reader.readline(MAX_REQUEST_BYTES + 1)
            send('error', last_seq, code='request_too_large')
            continue
        req = None
        try:
            try:
                req = json.loads(line)
            except (ValueError, TypeError):
                raise ProtocolError('invalid_json')
            validate_request(req, nonce, workspace_id, last_seq)
            last_seq = req['seq']  # Consume accepted requests even if execution fails.
            if req['method'] == 'shutdown':
                send('result', last_seq, result={'shutdown':True})
                return
            send('result', last_seq, result=executor(req))
        except ProtocolError as error:
            send('error', last_seq, code=error.code)
        except ContainmentError:
            send('error', last_seq, code='containment_failed')
            return
        except Exception:
            send('error', last_seq, code='execution_failed')


def main():
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise RuntimeError('root Linux guest required')
    config_path = Path('/etc/gsa-worker.json')
    info = config_path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('worker config must be root-only')
    config = json.loads(config_path.read_text())
    if not isinstance(config.get('nonce'), str) or re.fullmatch('[0-9a-f]{64}', config['nonce']) is None:
        raise RuntimeError('invalid worker nonce')
    if not isinstance(config.get('workspace_id'), str) or not config['workspace_id']:
        raise RuntimeError('invalid workspace identity')
    source_digest('/opt/gsa-source')
    os.chmod('/dev/hvc0', 0o600)
    fd = os.open('/dev/hvc0', os.O_RDWR | os.O_NOCTTY | os.O_CLOEXEC)
    tty.setraw(fd, termios.TCSANOW)
    with os.fdopen(fd, 'r', encoding='utf-8', errors='strict') as reader, \
            os.fdopen(os.dup(fd), 'w', buffering=1, encoding='utf-8') as writer:
        serve(reader, writer, config)

if __name__ == '__main__':
    main()
