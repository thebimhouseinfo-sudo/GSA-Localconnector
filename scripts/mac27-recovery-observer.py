#!/usr/bin/python3
"""Disposable recovery observer. Import alone performs no libproc call/signal.

The captured-name gate and the held parent-FD identity are distinct. A vnode FD
match before capture cannot trigger a post-capture STOP. One watch, one deadline,
2000 iterations and at most one SIGSTOP; no restarted watcher or global scan.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import sys
import time


def captured_name(path, device, inode):
    try:
        value = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
        return None
    if str(value.st_dev) != device or str(value.st_ino) != inode:
        return None
    return {"present": True, "device": device, "inode": inode}


def main(argv):
    source = Path(__file__).resolve().parent.parent / "native/macos-files/test-tree-broker.py"
    spec = importlib.util.spec_from_file_location("gsa_recovery_libproc", source)
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    if len(argv) >= 2 and argv[1] in ("identity", "confirm"):
        return base.main(argv)
    if len(argv) != 13 or argv[1] != "watch":
        raise ValueError("WATCH_ARGUMENTS")
    _, _, raw_pid, raw_parent, executable, start, device, inode, phase, capture, cap_device, cap_inode, unset_fd = argv
    pid, parent = int(raw_pid), int(raw_parent)
    if pid <= 1 or parent <= 1 or pid == parent or unset_fd != "-":
        raise ValueError("IDENTITY_ARGUMENTS")
    if phase not in ("parent", "capture") or not all(v.isdecimal() for v in (device, inode, cap_device, cap_inode)):
        raise ValueError("PHASE_ARGUMENTS")
    if not os.path.isabs(executable) or not os.path.isabs(capture):
        raise ValueError("PATH_ARGUMENTS")
    observed = base.process(pid, parent, executable, start)
    if observed is None:
        raise ValueError("PROCESS_IDENTITY_MISMATCH")
    base.emit({"event": "WATCH_READY", "pid": pid, "parentPid": parent,
               "startTime": start, "device": device, "inode": inode})
    started = time.monotonic()
    deadline = started + 5.5
    for iteration in range(2000):
        if time.monotonic() >= deadline:
            break
        gate = captured_name(capture, cap_device, cap_inode) if phase == "capture" else None
        if phase == "capture" and gate is None:
            time.sleep(0.0002)
            continue
        observed = base.process(pid, parent, executable, start)
        if observed is None:
            raise ValueError("PROCESS_EXITED_OR_CHANGED")
        fds = base.matching_fds(pid, int(device), int(inode))
        if not fds:
            time.sleep(0.0002)
            continue
        observed = base.process(pid, parent, executable, start)
        if observed is None or fds[0] not in base.matching_fds(pid, int(device), int(inode), fds[0]):
            raise ValueError("OWNED_FD_CHANGED")
        if phase == "capture":
            gate = captured_name(capture, cap_device, cap_inode)
            if gate is None:
                time.sleep(0.0002)
                continue
        info, birth, actual = observed
        os.kill(pid, signal.SIGSTOP)
        base.emit({"event": "STOP_SENT", "pid": pid, "parentPid": parent,
                   "startTime": birth, "executable": actual, "status": info.status,
                   "fd": fds[0], "device": device, "inode": inode,
                   "fdDevice": device, "fdInode": inode, "phase": phase,
                   "captured": gate, "signal": "SIGSTOP", "iteration": iteration + 1,
                   "elapsedMs": (time.monotonic() - started) * 1000})
        return
    raise TimeoutError("OBSERVATION_INCONCLUSIVE")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except Exception as error:
        sys.stderr.write(str(error)[:512] + "\n")
        sys.exit(2)
