#!/usr/bin/python3
"""Targeted libproc observer for the disposable tree-reader relocation fixture.

This process accepts one already-owned child PID. It never enumerates the
system process table and never signals a process until PID, parent, birth tuple,
executable and a retained vnode FD identity all match the caller's request.
"""
import ctypes
import json
import os
import signal
import sys
import time

PROC_PIDLISTFDS = 1
PROC_PIDTBSDINFO = 3
PROC_PIDFDVNODEINFO = 1
SSTOP = 4


class ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint32), ("status", ctypes.c_uint32),
        ("xstatus", ctypes.c_uint32), ("pid", ctypes.c_uint32),
        ("ppid", ctypes.c_uint32), ("uid", ctypes.c_uint32),
        ("gid", ctypes.c_uint32), ("ruid", ctypes.c_uint32),
        ("rgid", ctypes.c_uint32), ("svuid", ctypes.c_uint32),
        ("svgid", ctypes.c_uint32), ("reserved", ctypes.c_uint32),
        ("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32),
        ("nfiles", ctypes.c_uint32), ("pgid", ctypes.c_uint32),
        ("pjobc", ctypes.c_uint32), ("ttydev", ctypes.c_uint32),
        ("tpgid", ctypes.c_uint32), ("nice", ctypes.c_int32),
        ("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64),
    ]


class ProcFdInfo(ctypes.Structure):
    _fields_ = [("fd", ctypes.c_int32), ("kind", ctypes.c_uint32)]


class ProcFileInfo(ctypes.Structure):
    _fields_ = [
        ("openflags", ctypes.c_uint32), ("status", ctypes.c_uint32),
        ("offset", ctypes.c_int64), ("kind", ctypes.c_int32),
        ("guardflags", ctypes.c_uint32),
    ]


class VInfoStat(ctypes.Structure):
    _fields_ = [
        ("dev", ctypes.c_uint32), ("mode", ctypes.c_uint16),
        ("nlink", ctypes.c_uint16), ("ino", ctypes.c_uint64),
        ("uid", ctypes.c_uint32), ("gid", ctypes.c_uint32),
        ("atime", ctypes.c_int64), ("atimensec", ctypes.c_int64),
        ("mtime", ctypes.c_int64), ("mtimensec", ctypes.c_int64),
        ("ctime", ctypes.c_int64), ("ctimensec", ctypes.c_int64),
        ("birthtime", ctypes.c_int64), ("birthtimensec", ctypes.c_int64),
        ("size", ctypes.c_int64), ("blocks", ctypes.c_int64),
        ("blksize", ctypes.c_int32), ("flags", ctypes.c_uint32),
        ("gen", ctypes.c_uint32), ("rdev", ctypes.c_uint32),
        ("qspare", ctypes.c_int64 * 2),
    ]


class Fsid(ctypes.Structure):
    _fields_ = [("val", ctypes.c_int32 * 2)]


class VnodeInfo(ctypes.Structure):
    _fields_ = [("stat", VInfoStat), ("kind", ctypes.c_int32),
                ("pad", ctypes.c_int32), ("fsid", Fsid)]


class VnodeFdInfo(ctypes.Structure):
    _fields_ = [("file", ProcFileInfo), ("vnode", VnodeInfo)]


libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                 ctypes.c_void_p, ctypes.c_int]
libproc.proc_pidinfo.restype = ctypes.c_int
libproc.proc_pidfdinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_void_p, ctypes.c_int]
libproc.proc_pidfdinfo.restype = ctypes.c_int
libproc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
libproc.proc_pidpath.restype = ctypes.c_int


def process(pid, parent, executable, start=None):
    info = ProcBsdInfo()
    size = ctypes.sizeof(info)
    if libproc.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ctypes.byref(info), size) != size:
        return None
    if info.pid != pid or info.ppid != parent:
        return None
    birth = f"{info.start_sec}:{info.start_usec}"
    if start is not None and birth != start:
        return None
    path_buffer = ctypes.create_string_buffer(4096)
    if libproc.proc_pidpath(pid, path_buffer, len(path_buffer)) <= 0:
        return None
    actual = os.path.realpath(os.fsdecode(path_buffer.value))
    if actual != os.path.realpath(executable):
        return None
    return info, birth, actual


def matching_fds(pid, device, inode, wanted=None):
    size = libproc.proc_pidinfo(pid, PROC_PIDLISTFDS, 0, None, 0)
    stride = ctypes.sizeof(ProcFdInfo)
    if size <= 0 or size > 65536 or size % stride:
        return []
    raw = ctypes.create_string_buffer(size)
    got = libproc.proc_pidinfo(pid, PROC_PIDLISTFDS, 0, raw, size)
    if got < stride or got > size:
        return []
    result = []
    for offset in range(0, got - stride + 1, stride):
        descriptor = ProcFdInfo.from_buffer_copy(raw, offset).fd
        if wanted is not None and descriptor != wanted:
            continue
        vnode = VnodeFdInfo()
        amount = libproc.proc_pidfdinfo(pid, descriptor, PROC_PIDFDVNODEINFO,
                                        ctypes.byref(vnode), ctypes.sizeof(vnode))
        if amount >= ctypes.sizeof(ProcFileInfo) + ctypes.sizeof(VInfoStat):
            if vnode.vnode.stat.dev == device and vnode.vnode.stat.ino == inode:
                result.append(descriptor)
    return result


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stdout.flush()


def main(argv):
    if len(argv) < 5:
        raise ValueError("USAGE")
    mode, raw_pid, raw_parent, executable = argv[1:5]
    pid, parent = int(raw_pid), int(raw_parent)
    if pid <= 1 or parent <= 1 or pid == parent or not os.path.isabs(executable):
        raise ValueError("IDENTITY_ARGUMENTS")
    observed = process(pid, parent, executable)
    if observed is None:
        raise ValueError("PROCESS_IDENTITY_MISMATCH")
    info, birth, actual = observed
    identity = {"pid": pid, "parentPid": parent, "startTime": birth,
                "executable": actual, "status": info.status}
    if mode == "identity" and len(argv) == 5:
        emit(identity)
        return
    if mode not in ("watch", "confirm") or len(argv) != 9:
        raise ValueError("OBSERVER_ARGUMENTS")
    start, device, inode, raw_fd = argv[5:9]
    # The caller supplies the start tuple and expected vnode identity. The
    # extra raw FD is '-' for watch, otherwise one exact descriptor to confirm.
    if start != birth or not device.isdecimal() or not inode.isdecimal():
        raise ValueError("OBSERVER_EXPECTATION_MISMATCH")
    wanted = None if raw_fd == "-" else int(raw_fd)
    if mode == "confirm":
        if wanted is None or info.status != SSTOP:
            raise ValueError("STOP_NOT_CONFIRMED")
        if wanted not in matching_fds(pid, int(device), int(inode), wanted):
            raise ValueError("FD_IDENTITY_MISMATCH")
        emit({**identity, "fd": wanted, "device": device, "inode": inode,
              "signal": "SIGSTOP", "state": "T (stopped)"})
        return
    if wanted is not None:
        raise ValueError("WATCH_FD_MUST_BE_UNSET")
    emit({"event": "WATCH_READY", "pid": pid, "parentPid": parent,
          "startTime": start, "device": device, "inode": inode})
    deadline = time.monotonic() + 4.0
    while time.monotonic() < deadline:
        observed = process(pid, parent, executable, start)
        if observed is None:
            raise ValueError("PROCESS_EXITED_OR_CHANGED")
        if matching_fds(pid, int(device), int(inode)):
            # Revalidate the same PID/birth/executable and vnode immediately
            # before SIGSTOP; never signal a PID selected by a global scan.
            observed = process(pid, parent, executable, start)
            descriptors = matching_fds(pid, int(device), int(inode))
            if observed is None or not descriptors:
                continue
            os.kill(pid, signal.SIGSTOP)
            stop_deadline = time.monotonic() + 1.0
            while time.monotonic() < stop_deadline:
                stopped = process(pid, parent, executable, start)
                if stopped is None:
                    raise ValueError("PROCESS_CHANGED_AFTER_STOP")
                if stopped[0].status == SSTOP:
                    fd = descriptors[0]
                    if fd not in matching_fds(pid, int(device), int(inode), fd):
                        raise ValueError("FD_CHANGED_AFTER_STOP")
                    emit({**identity, "fd": fd, "device": device,
                          "inode": inode, "signal": "SIGSTOP",
                          "state": "T (stopped)"})
                    return
                time.sleep(0.01)
            raise ValueError("STOP_NOT_CONFIRMED")
        time.sleep(0.0002)
    raise TimeoutError("OBSERVATION_TIMEOUT")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except Exception as error:
        sys.stderr.write(str(error)[:512] + "\n")
        sys.exit(2)
