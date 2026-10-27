"""Real terminal tests; synthetic credentials and disposable HOME only."""
import os
import pathlib
import pty
import select
import shutil
import subprocess
import tempfile
import termios
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = shutil.which('node')
TUNNEL = b'tunnel_0123456789abcdef0123456789abcdef'
KEY = b'synthetic-pty-key-$literal-123'


def session(home, cancel=False, keep=False):
    master, slave = pty.openpty()
    before = termios.tcgetattr(slave)
    child = subprocess.Popen([NODE, str(ROOT / 'scripts/desktop-install.mjs'), 'setup'],
                             stdin=slave, stdout=slave, stderr=slave,
                             env={'HOME': str(home), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': str(home)})
    transcript = bytearray()

    def until(needle):
        deadline = time.monotonic() + 10
        while needle not in transcript:
            assert time.monotonic() < deadline, 'terminal prompt timed out'
            if select.select([master], [], [], 0.1)[0]:
                transcript.extend(os.read(master, 65536))
            elif child.poll() is not None:
                raise AssertionError('terminal exited before prompt')

    try:
        until(b'Tunnel ID')
        os.write(master, b'\r' if keep else TUNNEL + b'\r')
        until(b'API key')
        assert not termios.tcgetattr(slave)[3] & termios.ECHO, 'key input must disable echo'
        os.write(master, b'\x03' if cancel else b'\r' if keep else KEY + b'X\x7f\r')
        child.wait(timeout=10)
        while select.select([master], [], [], 0)[0]:
            transcript.extend(os.read(master, 65536))
        assert child.returncode == (1 if cancel else 0)
        assert KEY not in transcript, 'secret echoed into terminal'
        assert termios.tcgetattr(slave) == before, 'terminal flags were not restored'
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        os.close(master)
        os.close(slave)


with tempfile.TemporaryDirectory(prefix='gsa-terminal-pty-') as directory:
    home = pathlib.Path(directory).resolve()
    session(home)
    env_path = home / 'Library/Application Support/GSA-Localconnector/desktop/.env'
    expected = b'GSA_LC_TUNNEL_ID=' + TUNNEL + b'\nCONTROL_PLANE_API_KEY=' + KEY + b'\n'
    assert env_path.read_bytes() == expected
    assert env_path.stat().st_mode & 0o777 == 0o600
    session(home, cancel=True)
    assert env_path.read_bytes() == expected, 'cancel overwrote configuration'
    session(home, keep=True)
    assert env_path.read_bytes() == expected, 'Enter must retain saved values'
    child = subprocess.run([NODE, str(ROOT / 'scripts/desktop-install.mjs'), 'setup'], input=b'unused\n',
                           capture_output=True, env={'HOME': str(home), 'PATH': '/usr/bin:/bin'})
    assert child.returncode == 1 and b'SETUP_REQUIRES_TTY' in child.stderr
    assert env_path.read_bytes() == expected
print('PASS: real PTY hidden entry/backspace, cancellation, terminal restore, saved-value reuse, non-TTY refusal')
