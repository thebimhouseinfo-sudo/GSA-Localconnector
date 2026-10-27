#!/usr/bin/env python3
"""Disposable macOS/APFS counterexamples; never a production mutation/CAS test."""
import errno
import hashlib
import json
import os
import pathlib
import platform
import select
import signal
import subprocess
import sys
import tempfile
import threading
import time

LIMIT = 1024 * 1024
CHILD_SECONDS = 10
HELPER = r'''
#include <sys/mount.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
static int barrier(const char *phase) {
  char word[16];
  printf("{\"event\":\"ready\",\"phase\":\"%s\"}\n", phase); fflush(stdout);
  return fgets(word, sizeof word, stdin) && strcmp(word,"GO\n")==0;
}
static int rename_exclusive(int from, const char *name, int to, const char *dest, const char *phase) {
  int rc=renameatx_np(from,name,to,dest,RENAME_EXCL); int saved=rc ? errno : 0;
  struct stat st; int found=fstatat(to,dest,&st,AT_SYMLINK_NOFOLLOW)==0;
  printf("{\"event\":\"rename\",\"phase\":\"%s\",\"return\":%d,\"errno\":%d,\"device\":%llu,\"inode\":%llu,\"size\":%lld}\n",
    phase,rc,saved,found?(unsigned long long)st.st_dev:0,found?(unsigned long long)st.st_ino:0,found?(long long)st.st_size:0); fflush(stdout);
  return rc;
}
int main(int argc,char **argv) {
  if(argc==3 && strcmp(argv[1],"filesystem")==0) {
    struct statfs fs; if(statfs(argv[2],&fs)) return 2;
    printf("{\"filesystem\":\"%s\",\"block_size\":%u}\n",fs.f_fstypename,(unsigned)fs.f_bsize); return 0;
  }
  if(argc!=7) return 2;
  int root=open(argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  int recovery=open(argv[3],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  int stage=open(argv[4],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(root<0 || recovery<0 || stage<0) return 3;
  struct stat pinned,current; if(fstat(root,&pinned)) return 4;
  if((unsigned long long)pinned.st_dev!=strtoull(argv[5],NULL,10) ||
     (unsigned long long)pinned.st_ino!=strtoull(argv[6],NULL,10)) return 5;
  if(!barrier("pinned")) return 6;
  if(strcmp(argv[1],"root-check")==0) {
    int mismatch=lstat(argv[2],&current)!=0 || current.st_dev!=pinned.st_dev || current.st_ino!=pinned.st_ino;
    printf("{\"event\":\"root_guard\",\"mismatch\":%s}\n",mismatch?"true":"false");
    close(stage); close(recovery); close(root); return mismatch?0:7;
  }
  if(rename_exclusive(root,"input",recovery,"captured","capture")) return 0;
  if(!barrier("captured")) return 6;
  if(strcmp(argv[1],"restore")==0) rename_exclusive(recovery,"captured",root,"input","restore");
  else rename_exclusive(stage,"new",root,"input","publish");
  if(!barrier("finished")) return 6;
  close(stage); close(recovery); close(root); return 0;
}
'''
WRITER = r'''
import json,os,sys
fd=os.open(sys.argv[1],os.O_RDWR)
st=os.fstat(fd)
print(json.dumps({'event':'writer_ready','device':st.st_dev,'inode':st.st_ino}),flush=True)
for line in sys.stdin:
    command=line.strip()
    if command=='CLOSE': break
    if command=='EDIT': os.pwrite(fd,b'EDIT',0); os.ftruncate(fd,4)
    elif command=='LATE': os.pwrite(fd,b'LATE',0); os.ftruncate(fd,4)
    elif command=='FIRST': os.pwrite(fd,b'1111',0)
    elif command=='SECOND': os.pwrite(fd,b'2222',4)
    elif command=='CREATE':
        new=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        os.write(new,b'USER'); os.fsync(new); os.close(new)
    else: raise RuntimeError('unknown writer command')
    os.fsync(fd)
    s=os.fstat(fd)
    print(json.dumps({'event':'writer_ack','command':command,'bytes_hex':os.pread(fd,s.st_size,0).hex(),'device':s.st_dev,'inode':s.st_ino}),flush=True)
os.close(fd)
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(path):
    st = path.lstat()
    return (st.st_dev, st.st_ino, st.st_mode)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Experiment:
    def __init__(self):
        self.start = time.monotonic()
        self.deadline = self.start + 60
        self.output_used = 0
        self.children = []
        self.owned = {}
        self.created_identities = set()
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='gsa-retained-capture-')).resolve()
        self.root.chmod(0o700)
        self.remember(self.root)
        self.report = {'schema_version': 1, 'ok': False, 'timestamp': time.time(),
                       'host': {'system': platform.system(), 'release': platform.release(), 'architecture': platform.machine()},
                       'fixture': str(self.root), 'fixture_identity': identity(self.root),
                       'source_sha256': digest(pathlib.Path(__file__).read_bytes()),
                       'helper_source_sha256': digest(HELPER.encode()), 'cases': [], 'children': [],
                       'limitations': ['Unsandboxed synthetic filesystem experiment, not authority confinement.',
                                       'No content CAS, immutable recovery, coherent snapshot, move/Trash or durability proof.',
                                       'No production capability or full M1 acceptance.']}
        self.watchdog = threading.Thread(target=self.supervise, daemon=True)
        self.watchdog.start()

    def remember(self, path):
        self.owned[str(path)] = identity(path)
        self.created_identities.add(identity(path))
        return path

    def directory(self, path):
        path.mkdir(mode=0o700)
        return self.remember(path)

    def write(self, path, data):
        require(len(data) <= LIMIT, 'case data exceeds limit')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            require(os.write(fd, data) == len(data), 'short fixture write')
        finally:
            os.close(fd)
        return self.remember(path)

    def supervise(self):
        while not self.stop.wait(0.02):
            now = time.monotonic()
            with self.lock:
                for child in self.children:
                    if not self.quiescent(child) and (now >= self.deadline or now >= child['deadline']):
                        child['timeout'] = True
                        self.kill(child)

    def quiescent(self, child):
        if child.get('group_quiescent'):
            return True
        # Leader exit alone says nothing about compiler/helper descendants.
        leader_stopped = child['proc'].poll() is not None
        try:
            os.killpg(child['proc'].pid, 0)
        except ProcessLookupError:
            if leader_stopped:
                child['group_quiescent'] = True
                return True
        except PermissionError as exc:
            child['stop_error'] = str(exc)
        return False

    def kill(self, child):
        if self.quiescent(child):
            return
        try:
            os.killpg(child['proc'].pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError as exc:
            child['stop_error'] = str(exc)

    def spawn(self, command):
        require(time.monotonic() < self.deadline, 'overall deadline exceeded')
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, start_new_session=True)
        child = {'proc': proc, 'command': command, 'deadline': min(self.deadline, time.monotonic() + CHILD_SECONDS),
                 'buffers': {'stdout': bytearray(), 'stderr': bytearray()}, 'events': [], 'timeout': False}
        with self.lock:
            self.children.append(child)
        return child

    def consume(self, child, stream):
        data = os.read(getattr(child['proc'], stream).fileno(), min(4096, LIMIT - self.output_used + 1))
        self.output_used += len(data)
        require(self.output_used <= LIMIT, 'aggregate child output exceeds 1MiB')
        child['buffers'][stream].extend(data)
        return data

    def event(self, child):
        while True:
            buf = child['buffers']['stdout']
            if b'\n' in buf:
                line, _, remainder = buf.partition(b'\n')
                child['buffers']['stdout'] = bytearray(remainder)
                event = json.loads(line)
                child['events'].append(event)
                return event
            remaining = child['deadline'] - time.monotonic()
            require(remaining > 0 and not child['timeout'], 'child protocol timed out')
            streams, _, _ = select.select([child['proc'].stdout, child['proc'].stderr], [], [], remaining)
            require(streams, 'child protocol timed out')
            for stream in streams:
                name = 'stdout' if stream is child['proc'].stdout else 'stderr'
                data = self.consume(child, name)
                require(data or name != 'stdout', 'unexpected protocol EOF')

    def send(self, child, word='GO'):
        child['proc'].stdin.write((word + '\n').encode())
        child['proc'].stdin.flush()

    def ready(self, child, phase):
        require(self.event(child) == {'event': 'ready', 'phase': phase}, 'unexpected helper barrier')

    def finish(self, child, killed=False):
        proc = child['proc']
        child['expected_returncode'] = -signal.SIGKILL if killed else 0
        if killed:
            self.kill(child)
        if not proc.stdin.closed:
            proc.stdin.close()
        active = [proc.stdout, proc.stderr]
        while active:
            remaining = child['deadline'] - time.monotonic()
            require(remaining > 0, 'child collection timed out')
            readable, _, _ = select.select(active, [], [], remaining)
            require(readable, 'child collection timed out')
            for stream in readable:
                if not self.consume(child, 'stdout' if stream is proc.stdout else 'stderr'):
                    active.remove(stream)
        rc = proc.wait(timeout=max(0.01, child['deadline'] - time.monotonic()))
        require(not child['timeout'], 'watchdog terminated timed-out child')
        record = {'pid': proc.pid, 'command': child['command'], 'returncode': rc,
                  'signal': -rc if rc < 0 else None, 'events': child['events'],
                  'expected_returncode': child['expected_returncode'],
                  'stdout': child['buffers']['stdout'].decode('utf-8', 'replace'),
                  'stderr': child['buffers']['stderr'].decode('utf-8', 'replace')}
        self.report['children'].append(record)
        child['recorded'] = True
        require(rc == (-signal.SIGKILL if killed else 0), 'unexpected child exit: ' + str(record))
        require(self.quiescent(child), 'owned process group remains after leader exit')
        return record

    def command(self, command):
        child = self.spawn(command)
        result = self.finish(child)
        return result['stdout'].strip()

    def observe(self, path):
        if not path.exists():
            return {'path': str(path), 'exists': False}
        st = path.lstat()
        require(not path.is_symlink() and path.is_file(), 'observation requires ordinary file')
        require(st.st_size <= LIMIT, 'observed data exceeds limit')
        data = path.read_bytes()
        return {'path': str(path), 'exists': True, 'identity': identity(path),
                'bytes_hex': data.hex(), 'sha256': digest(data), 'size': len(data)}

    def setup(self, name, data=b'OLD!'):
        case = self.directory(self.root / name)
        a = self.directory(case / 'A')
        recovery = self.directory(case / 'recovery')
        stage = self.directory(case / 'stage')
        self.write(a / 'input', data)
        self.write(stage / 'new', b'NEW!')
        self.write(case / 'unrelated', b'CONTROL')
        rec = {'name': name, 'before': self.observe(a / 'input'), 'barriers': [], 'syscalls': []}
        self.report['cases'].append(rec)
        return case, a, recovery, stage, rec

    def helper(self, a, recovery, stage, mode='publish'):
        st = a.stat()
        child = self.spawn([str(self.binary), mode, str(a), str(recovery), str(stage), str(st.st_dev), str(st.st_ino)])
        self.ready(child, 'pinned')
        return child

    def syscall(self, child, rec, phase, expected_errno=0):
        event = self.event(child)
        rec['syscalls'].append(event)
        require(event.get('event') == 'rename' and event.get('phase') == phase, 'wrong syscall event')
        if event['errno'] in (errno.ENOTSUP, errno.ENOSYS):
            rec['outcome'] = 'UNSUPPORTED'
            raise RuntimeError('exclusive rename unsupported')
        require(event['errno'] == expected_errno and event['return'] == (0 if expected_errno == 0 else -1), 'wrong native rename result')

    def writer(self, path):
        child = self.spawn([sys.executable, '-c', WRITER, str(path)])
        ready = self.event(child)
        require(ready['event'] == 'writer_ready' and (ready['device'], ready['inode']) == identity(path)[:2], 'writer pinned wrong inode')
        return child

    def edit(self, child, word, rec):
        self.send(child, word)
        event = self.event(child)
        require(event.get('event') == 'writer_ack' and event.get('command') == word, 'writer acknowledgement missing')
        rec['barriers'].append(event)
        return bytes.fromhex(event['bytes_hex'])

    def close_writer(self, child):
        self.send(child, 'CLOSE')
        self.finish(child)

    def observe_case(self, case, a, recovery, stage, rec):
        rec['after'] = {name: self.observe(path) for name, path in
                        [('input', a / 'input'), ('captured', recovery / 'captured'), ('staged', stage / 'new'), ('unrelated', case / 'unrelated')]}
        require(rec['after']['unrelated']['bytes_hex'] == b'CONTROL'.hex(), 'unrelated control changed')
        rec['namespace'] = {str(directory): sorted(os.listdir(directory)) for directory in (a, recovery, stage)}

    def run(self):
        require(sys.platform == 'darwin', 'macOS required')
        clang = self.command(['/usr/bin/xcrun', '--find', 'clang'])
        resolved = pathlib.Path(clang).resolve()
        sdk = self.command(['/usr/bin/xcrun', '--show-sdk-path'])
        header = pathlib.Path(sdk) / 'usr/include/stdio.h'
        self.report['toolchain'] = {'launcher': clang, 'resolved': str(resolved), 'sha256': digest(resolved.read_bytes()),
                                    'version': self.command([str(resolved), '--version']), 'queried_sdk_path': sdk,
                                    'queried_sdk_version': self.command(['/usr/bin/xcrun', '--show-sdk-version']),
                                    'queried_sdk_stdio_header_sha256': digest(header.read_bytes()),
                                    'compiler_inputs_note': 'Queried SDK metadata; actual compiler header selection is not independently traced.'}
        source = self.write(self.root / 'helper.c', HELPER.encode())
        self.binary = self.root / 'helper'
        self.command([str(resolved), '-std=c11', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(self.binary)])
        self.remember(self.binary)
        self.report['binary_sha256'] = digest(self.binary.read_bytes())
        fs = json.loads(self.command([str(self.binary), 'filesystem', str(self.root)]))
        self.report['filesystem'] = fs
        require(fs['filesystem'] == 'apfs', 'existing temporary volume is not APFS; unsupported')
        for name in ['stable', 'edit-before-capture', 'open-fd-late-write', 'recreate-before-publication',
                     'recreate-before-restoration', 'crash-after-capture', 'crash-after-publication', 'resource-collision']:
            case, a, recovery, stage, rec = self.setup(name)
            old_id = identity(a / 'input')
            new_id = identity(stage / 'new')
            writer = self.writer(a / 'input') if name in ('edit-before-capture', 'open-fd-late-write', 'recreate-before-publication', 'recreate-before-restoration') else None
            if name == 'resource-collision':
                self.write(recovery / 'captured', b'COLLISION')
            helper = self.helper(a, recovery, stage, 'restore' if name in ('edit-before-capture', 'recreate-before-restoration') else 'publish')
            if name in ('edit-before-capture', 'recreate-before-restoration'):
                require(self.edit(writer, 'EDIT', rec) == b'EDIT', 'external edit failed')
            self.send(helper)
            self.syscall(helper, rec, 'capture', errno.EEXIST if name == 'resource-collision' else 0)
            if name == 'resource-collision':
                self.finish(helper)
                require((a / 'input').read_bytes() == b'OLD!' and (recovery / 'captured').read_bytes() == b'COLLISION', 'collision lost input')
                rec['outcome'] = 'CONFLICT_OBSERVED'
            else:
                self.ready(helper, 'captured')
                require(identity(recovery / 'captured') == old_id and not (a / 'input').exists(), 'capture identity/namespace wrong')
                if name == 'crash-after-capture':
                    self.finish(helper, killed=True)
                    rec['outcome'] = 'UNKNOWN/PARTIAL_OBSERVED'
                else:
                    collision = name in ('recreate-before-publication', 'recreate-before-restoration')
                    if collision:
                        self.edit(writer, 'CREATE', rec)
                        self.remember(a / 'input')
                        recreated = identity(a / 'input')
                    self.send(helper)
                    restoration = name in ('edit-before-capture', 'recreate-before-restoration')
                    self.syscall(helper, rec, 'restore' if restoration else 'publish', errno.EEXIST if collision else 0)
                    self.ready(helper, 'finished')
                    if name == 'open-fd-late-write':
                        require(self.edit(writer, 'LATE', rec) == b'LATE', 'late FD write failed')
                        require((recovery / 'captured').read_bytes() == b'LATE' and identity(recovery / 'captured') == old_id, 'retained inode did not receive late write')
                    if collision:
                        require((a / 'input').read_bytes() == b'USER' and identity(a / 'input') == recreated, 'exclusive rename overwrote user entry')
                        require(identity(recovery / 'captured') == old_id and identity(stage / 'new') == new_id, 'collision lost retained/staged entry')
                    elif restoration:
                        require((a / 'input').read_bytes() == b'EDIT' and identity(a / 'input') == old_id, 'restore did not preserve edited bytes')
                        require(digest(b'EDIT') != rec['before']['sha256'], 'expected hash mismatch not observed')
                    else:
                        require((a / 'input').read_bytes() == b'NEW!' and identity(a / 'input') == new_id, 'publish identity/bytes wrong')
                        require((recovery / 'captured').read_bytes() == (b'LATE' if name == 'open-fd-late-write' else b'OLD!'), 'retained bytes wrong')
                    if name == 'crash-after-publication':
                        self.finish(helper, killed=True)
                    else:
                        self.send(helper)
                        self.finish(helper)
                    rec['outcome'] = 'UNKNOWN/PARTIAL_OBSERVED' if name.startswith('crash') else ('CONFLICT_OBSERVED' if collision or restoration else 'EXPECTED_EFFECTS')
                if name.startswith('crash'):
                    # A fresh child, not the interrupted helper, confirms namespace readback.
                    readback = self.command([sys.executable, '-c', 'import json,pathlib,sys; print(json.dumps({p:pathlib.Path(p).read_bytes().hex() if pathlib.Path(p).exists() else None for p in sys.argv[1:]}))', str(a / 'input'), str(recovery / 'captured')])
                    rec['fresh_process_readback'] = json.loads(readback)
                    require(rec['fresh_process_readback'][str(recovery / 'captured')] == b'OLD!'.hex(), 'crash recovery missing')
                    require(rec['fresh_process_readback'][str(a / 'input')] == (None if name == 'crash-after-capture' else b'NEW!'.hex()), 'crash namespace unexpected')
            if writer:
                self.close_writer(writer)
            self.observe_case(case, a, recovery, stage, rec)
        self.copy_counterexample()
        self.relocation_cases()
        self.cleanup_guard_case()

    def copy_counterexample(self):
        case, a, recovery, stage, rec = self.setup('writer-during-copy-hash', b'AAAA' + b'BBBB')
        writer = self.writer(a / 'input')
        with open(a / 'input', 'rb', buffering=0) as stream:
            first = stream.read(4)
            state1 = self.edit(writer, 'FIRST', rec)
            state2 = self.edit(writer, 'SECOND', rec)
            second = stream.read(4)
        self.close_writer(writer)
        copied = first + second
        states = [b'AAAABBBB', b'1111BBBB', b'11112222']
        require(state1 == states[1] and state2 == states[2], 'writer full-state ordering wrong')
        require(copied == b'AAAA2222' and copied not in states, 'hybrid counterexample not established')
        self.write(stage / 'copied', copied)
        rec.update({'outcome': 'CONFLICT_OBSERVED', 'complete_source_states_hex': [s.hex() for s in states],
                    'copied': self.observe(stage / 'copied'), 'verdict': 'Hash authenticates hybrid copied bytes, not any coherent source state; production remains blocked.'})
        self.observe_case(case, a, recovery, stage, rec)

    def relocation_cases(self):
        for name in ('root-replacement', 'ancestor-relocation'):
            case, a, recovery, stage, rec = self.setup(name)
            helper = self.helper(a, recovery, stage, 'root-check' if name == 'root-replacement' else 'publish')
            if name == 'root-replacement':
                moved = case / 'relocated-A'
                a.rename(moved)
                self.directory(a)
                self.write(a / 'input', b'REPLACEMENT')
                replacement = identity(a / 'input')
                self.send(helper)
                require(self.event(helper) == {'event': 'root_guard', 'mismatch': True}, 'root replacement not detected')
                self.finish(helper)
                require(identity(a / 'input') == replacement and (a / 'input').read_bytes() == b'REPLACEMENT', 'replacement modified')
                rec['relocated_input'] = self.observe(moved / 'input')
            else:
                moved = self.root / 'relocated-ancestor'
                case.rename(moved)
                self.send(helper)
                self.syscall(helper, rec, 'capture')
                self.ready(helper, 'captured')
                require((moved / 'recovery/captured').read_bytes() == b'OLD!' and not (moved / 'A/input').exists(), 'held descriptor relocation observation wrong')
                self.send(helper)
                self.syscall(helper, rec, 'publish')
                self.ready(helper, 'finished')
                self.send(helper)
                self.finish(helper)
                case, a, recovery, stage = moved, moved / 'A', moved / 'recovery', moved / 'stage'
                require((a / 'input').read_bytes() == b'NEW!', 'relocated publication bytes wrong')
                rec['verdict'] = 'Held descriptors mutated relocated tree; not a containment denial. Production boundary remains unproven.'
            rec['outcome'] = 'UNKNOWN/PARTIAL_OBSERVED'
            self.observe_case(case, a, recovery, stage, rec)

    def guarded_unlink(self, path, expected):
        if identity(path) != expected:
            return False
        path.unlink()
        return True

    def cleanup_guard_case(self):
        case, a, recovery, stage, rec = self.setup('cleanup-identity-guard')
        target = a / 'input'
        expected = identity(target)
        target.rename(a / 'relocated-input')
        self.write(target, b'REPLACEMENT')
        require(not self.guarded_unlink(target, expected), 'cleanup accepted replaced identity')
        require(target.read_bytes() == b'REPLACEMENT' and (a / 'relocated-input').read_bytes() == b'OLD!', 'cleanup guard lost data')
        rec.update({'outcome': 'EXPECTED_EFFECTS', 'cleanup_refused_mismatch': True, 'relocated': self.observe(a / 'relocated-input')})
        self.observe_case(case, a, recovery, stage, rec)

    def cleanup(self):
        # Verify the complete tree against independently created inode/type identities,
        # including renamed entries, before deleting anything. Never follow symlinks.
        allowed = self.created_identities
        require(identity(self.root) == self.owned[str(self.root)], 'private root identity changed')
        entries = []
        def visit(path):
            require(identity(path) in allowed, 'unknown cleanup identity: ' + str(path))
            require(not path.is_symlink(), 'symlink during cleanup')
            if path.is_dir():
                for child in path.iterdir():
                    visit(child)
            entries.append((path, identity(path), path.is_dir()))
        visit(self.root)
        for path, expected, directory in entries:
            require(identity(path) == expected, 'cleanup identity changed: ' + str(path))
            if directory:
                path.rmdir()
            else:
                path.unlink()
        return {'removed': not self.root.exists(), 'identity_verified': True}

    def finalize(self, failure):
        self.stop.set()
        self.watchdog.join(timeout=1)
        # One bounded grace period for every owned group together, even if its
        # leader has already exited. Never clean files before group quiescence.
        stop_deadline = min(self.deadline + 2, time.monotonic() + 2)
        for child in self.children:
            if not self.quiescent(child):
                self.kill(child)
        while time.monotonic() < stop_deadline:
            if all(self.quiescent(child) for child in self.children):
                break
            time.sleep(0.01)
        all_stopped = all(self.quiescent(child) for child in self.children)
        if not all_stopped:
            failure = failure or 'Owned process group stop not confirmed; fixture retained'
        self.report['process_group_cleanup'] = {
            'all_confirmed_stopped': all_stopped, 'maximum_grace_seconds': 2,
            'groups': [{'pgid': child['proc'].pid, 'leader_returncode': child['proc'].poll(),
                        'quiescent': child.get('group_quiescent', False),
                        'stop_error': child.get('stop_error')} for child in self.children]}
        for child in self.children:
            if not child.get('recorded'):
                rc = child['proc'].poll()
                self.report['children'].append({'pid': child['proc'].pid, 'command': child['command'],
                                               'returncode': rc, 'signal': -rc if rc is not None and rc < 0 else None,
                                               'timeout': child['timeout'], 'events': child['events'],
                                               'expected_returncode': child.get('expected_returncode'),
                                               'stdout': child['buffers']['stdout'].decode('utf-8', 'replace'),
                                               'stderr': child['buffers']['stderr'].decode('utf-8', 'replace'),
                                               'diagnostics_incomplete': True})
            for stream in (child['proc'].stdin, child['proc'].stdout, child['proc'].stderr):
                stream.close()
        try:
            require(all_stopped, 'owned process group remains or stop is unconfirmed')
            require(not self.watchdog.is_alive(), 'supervisor stop unconfirmed')
            self.report['cleanup'] = self.cleanup()
        except Exception as exc:
            self.report['cleanup'] = {'removed': False, 'retained_path': str(self.root), 'error': str(exc)}
            failure = failure or 'cleanup incomplete'
        self.report.update({'ok': failure is None, 'failure': failure, 'elapsed_seconds': time.monotonic() - self.start,
                            'captured_output_bytes': self.output_used})
        encoded = json.dumps(self.report, sort_keys=True)
        if len(encoded.encode()) + self.output_used > LIMIT:
            encoded = json.dumps({'ok': False, 'failure': 'aggregate evidence/output limit exceeded', 'cleanup': self.report['cleanup'], 'diagnostics_truncated': True})
            failure = 'aggregate evidence/output limit exceeded'
        print(encoded)
        return 1 if failure else 0


def main():
    experiment = Experiment()
    failure = None
    def overall_timeout(_signum, _frame):
        raise TimeoutError('60-second experiment deadline exceeded')
    signal.signal(signal.SIGALRM, overall_timeout)
    signal.setitimer(signal.ITIMER_REAL, max(0.001, experiment.deadline - time.monotonic()))
    try:
        experiment.run()
    except Exception as exc:
        failure = type(exc).__name__ + ': ' + str(exc)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return experiment.finalize(failure)


if __name__ == '__main__':
    sys.exit(main())
