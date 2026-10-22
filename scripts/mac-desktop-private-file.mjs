import {spawn} from "node:child_process";
import path from "node:path";

const MAX_BYTES = 16384;
const failure = code => Object.assign(new Error(code), {code});
const codes = new Set(["FILE_MISSING", "FILE_UNSAFE", "FILE_BUSY", "FILE_STALE", "FILE_TOO_LARGE"]);

// Python's dir_fd operations retain each directory instead of reopening full paths.
// The lock serializes cooperating writers. This is not a same-UID sandbox or an
// adversarial compare-and-swap primitive: macOS rename has no expected-inode CAS.
const helper = String.raw`
import base64, errno, hashlib, json, os, secrets, stat, sys

LIMIT = 16384
class Refused(Exception):
    pass
def refuse(code):
    raise Refused(code)
def private_directory(info):
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        refuse('FILE_UNSAFE')
def leaf_info(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
        refuse('FILE_UNSAFE')
    if info.st_size > LIMIT:
        refuse('FILE_TOO_LARGE')
    return info
def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_uid, info.st_mode, info.st_nlink)
def read_leaf(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        before = leaf_info(fd)
        data = b''
        while len(data) <= LIMIT:
            chunk = os.read(fd, min(4096, LIMIT + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        if len(data) > LIMIT:
            refuse('FILE_TOO_LARGE')
        after = leaf_info(fd)
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if signature(before) != signature(after) or signature(current) != signature(after):
            refuse('FILE_STALE')
        identity = hashlib.sha256((repr(signature(after)) + ':' + hashlib.sha256(data).hexdigest()).encode()).hexdigest()
        return data, identity
    finally:
        os.close(fd)

def operate(request):
    target = request['path']
    parts = target.split('/')[1:]
    if not target.startswith('/') or not parts or any(part in ('', '.', '..') for part in parts):
        refuse('FILE_UNSAFE')
    descriptors = [os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
    chain = []
    parent = descriptors[0]
    lock_name = None
    lock_fd = None
    temporary = None
    try:
        for component in parts[:-1]:
            try:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            except FileNotFoundError:
                if request['action'] != 'replace':
                    raise
                # Creating configuration directories is allowed only inside an
                # already private, owned directory; never chmod existing paths.
                private_directory(os.fstat(parent))
                try:
                    os.mkdir(component, 0o700, dir_fd=parent)
                except FileExistsError:
                    pass
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            child_info = os.fstat(child)
            if child_info.st_uid not in (0, os.getuid()):
                os.close(child)
                refuse('FILE_UNSAFE')
            chain.append((parent, component, child))
            descriptors.append(child)
            parent = child
        private_directory(os.fstat(parent))
        def verify_chain():
            private_directory(os.fstat(parent))
            for ancestor, name, retained in chain:
                visible = os.stat(name, dir_fd=ancestor, follow_symlinks=False)
                held = os.fstat(retained)
                if not stat.S_ISDIR(visible.st_mode) or (visible.st_dev, visible.st_ino) != (held.st_dev, held.st_ino):
                    refuse('FILE_STALE')
        name = parts[-1]
        verify_chain()
        if request['action'] == 'read':
            data, identity = read_leaf(parent, name)
            verify_chain()
            return {'bytes': base64.b64encode(data).decode(), 'identity': identity}
        lock_name = '.' + name + '.gsa-lock'
        try:
            lock_fd = os.open(lock_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        except FileExistsError:
            lock_name = None
            refuse('FILE_BUSY')
        expected = request['expectedIdentity']
        if expected is not None:
            _, identity = read_leaf(parent, name)
            if identity != expected:
                refuse('FILE_STALE')
        else:
            try:
                os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                refuse('FILE_STALE')
        data = base64.b64decode(request['bytes'], validate=True)
        if len(data) > LIMIT:
            refuse('FILE_TOO_LARGE')
        temporary = '.' + name + '.gsa-' + secrets.token_hex(16)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            os.fchmod(fd, 0o600)
            offset = 0
            while offset < len(data):
                offset += os.write(fd, data[offset:])
            os.fsync(fd)
        finally:
            os.close(fd)
        verify_chain()
        if expected is None:
            # linkat creates exclusively, without the check-then-rename race.
            os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            os.unlink(temporary, dir_fd=parent)
        else:
            _, identity = read_leaf(parent, name)
            if identity != expected:
                refuse('FILE_STALE')
            os.rename(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        temporary = None
        os.fsync(parent)
        _, identity = read_leaf(parent, name)
        verify_chain()
        return {'identity': identity}
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary, dir_fd=parent)
            except OSError:
                pass
        if lock_fd is not None:
            try:
                held = os.fstat(lock_fd)
                visible = os.stat(lock_name, dir_fd=parent, follow_symlinks=False)
                if (held.st_dev, held.st_ino) == (visible.st_dev, visible.st_ino):
                    os.unlink(lock_name, dir_fd=parent)
            except OSError:
                pass
            os.close(lock_fd)
        for fd in reversed(descriptors):
            os.close(fd)

try:
    request = json.loads(sys.stdin.buffer.read(32769))
    print(json.dumps(operate(request)))
except Refused as error:
    print(json.dumps({'error': str(error)}))
except OSError as error:
    print(json.dumps({'error': 'FILE_MISSING' if error.errno == errno.ENOENT else 'FILE_UNSAFE'}))
except Exception:
    print(json.dumps({'error': 'FILE_UNSAFE'}))
`;

function invoke(request) {
  if (process.platform !== "darwin") return Promise.reject(failure("PRIVATE_FILE_UNAVAILABLE"));
  if (typeof request.path !== "string" || !path.isAbsolute(request.path) ||
      request.path.split("/").slice(1).some(part => !part || part === "." || part === "..") ||
      /[\u0000-\u001f\u007f]/.test(request.path)) return Promise.reject(failure("FILE_UNSAFE"));
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/python3", ["-I", "-c", helper], {stdio: ["pipe", "pipe", "pipe"], env: {PATH: "/usr/bin:/bin"}});
    let output = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {child.kill("SIGKILL"); finish(failure("PRIVATE_FILE_UNAVAILABLE"));}, 10000);
    child.on("error", () => finish(failure("PRIVATE_FILE_UNAVAILABLE")));
    child.stdin.on("error", () => finish(failure("PRIVATE_FILE_UNAVAILABLE")));
    child.stderr.resume(); // Never expose native diagnostics or credential bytes.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 32768) {child.kill("SIGKILL"); finish(failure("FILE_TOO_LARGE"));}
    });
    child.on("close", code => {
      if (code !== 0) return finish(failure("PRIVATE_FILE_UNAVAILABLE"));
      try {
        const result = JSON.parse(output);
        if (result.error) return finish(failure(codes.has(result.error) ? result.error : "FILE_UNSAFE"));
        if (typeof result.identity !== "string" || !/^[a-f0-9]{64}$/.test(result.identity)) throw failure("FILE_UNSAFE");
        if (request.action === "read") {
          if (typeof result.bytes !== "string") throw failure("FILE_UNSAFE");
          return finish(null, {bytes: Buffer.from(result.bytes, "base64"), identity: result.identity});
        }
        finish(null, {identity: result.identity});
      } catch {finish(failure("FILE_UNSAFE"));}
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export function createMacPrivateFile() {
  return {
    readVerified(envPath) {return invoke({action: "read", path: envPath});},
    replaceVerified(envPath, bytes, expectedIdentity) {
      if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) return Promise.reject(failure("FILE_TOO_LARGE"));
      if (expectedIdentity !== null && (typeof expectedIdentity !== "string" || !expectedIdentity)) return Promise.reject(failure("FILE_STALE"));
      return invoke({action: "replace", path: envPath, bytes: bytes.toString("base64"), expectedIdentity});
    }
  };
}
