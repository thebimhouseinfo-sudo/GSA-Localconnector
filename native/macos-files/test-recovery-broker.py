#!/usr/bin/env python3
"""Disposable native tests for the uninstalled recovery-broker candidate.

This is a source-candidate test harness, not evidence about the production
adapter, installer, races, crash recovery, or App Sandbox syscall coverage.
It creates only short-lived signed app bundles and data under tempfile roots.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid


SOURCE = pathlib.Path(__file__).resolve().parents[2] / "native/macos-files/recovery-broker.swift"
BINARY = pathlib.Path("/private/tmp/gsa-recovery-broker-candidate")
PROTOCOL = "gsa-file-recovery-v1"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Fixture:
    def __init__(self, *, sign=True, wrong_entitlements=False, root_layout=None):
        # Use a root-owned sticky temp parent accepted by the broker's
        # recovery-ancestry policy; macOS' user-private T directory is another
        # valid location but does not exercise that policy branch.
        self.tmp = tempfile.TemporaryDirectory(prefix="gsa-recovery-test-", dir="/private/tmp")
        # tempfile may return /var/... while the broker requires canonical
        # absolute roots; resolve the fixture before binding it into Info.plist.
        self.base = pathlib.Path(self.tmp.name).resolve()
        self.workspace = self.base / "workspace"
        self.recovery = self.base / "recovery"
        workspace_target = None
        if root_layout == "recovery_nested_case_alias":
            self.recovery = self.base / "WORKSPACE" / "private"
        elif root_layout == "workspace_nested_case_alias":
            self.workspace = self.base / "workspace" / "private"
            self.recovery = self.base / "WORKSPACE"
        elif root_layout == "same_case_alias":
            self.recovery = self.base / "WORKSPACE"
        elif root_layout == "workspace_symlink":
            workspace_target = self.base / "workspace-target"
            self.workspace = self.base / "workspace-link"
        self.workspace_root = str(self.workspace)
        self.recovery_root = str(self.recovery)
        if root_layout == "workspace_repeated_slash":
            self.workspace_root = self.workspace_root.replace("/workspace", "//workspace")
        elif root_layout == "workspace_dot_segment":
            self.workspace_root = self.workspace_root.replace("/workspace", "/./workspace")
        elif root_layout == "workspace_trailing_slash":
            self.workspace_root += "/"
        elif root_layout == "workspace_symlink":
            self.workspace_root = str(self.workspace)
        self.outside = self.base / "outside-canary.txt"
        if workspace_target is not None:
            workspace_target.mkdir(mode=0o700)
            self.workspace.symlink_to(workspace_target, target_is_directory=True)
        else:
            self.workspace.mkdir(mode=0o700, parents=True)
        self.recovery.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.workspace, 0o700)
        os.chmod(self.recovery, 0o700)
        self.outside.write_bytes(b"outside-canary")
        self.app = self.base / "RecoveryBroker.app"
        macos = self.app / "Contents/MacOS"
        macos.mkdir(parents=True)
        shutil.copy2(BINARY, macos / "recovery-broker")
        os.chmod(macos / "recovery-broker", 0o755)
        self.executable = macos / "recovery-broker"
        self.bundle_id = str(uuid.uuid4())
        self.workspace_id = str(uuid.uuid4())
        self.revision = 7
        self._write_info()
        if sign:
            self.sign(wrong_entitlements=wrong_entitlements)

    def _write_info(self):
        ws, rec = os.stat(self.workspace), os.stat(self.recovery)
        info = {
            "CFBundleIdentifier": "local.gsa.recovery." + self.bundle_id,
            "CFBundleName": "RecoveryBroker",
            "CFBundleExecutable": "recovery-broker",
            "CFBundlePackageType": "APPL",
            "GSARecoveryProtocol": PROTOCOL,
            "GSAWorkspaceRoot": self.workspace_root,
            "GSARecoveryRoot": self.recovery_root,
            "GSAWorkspaceID": self.workspace_id,
            "GSARevision": self.revision,
            "GSADevice": str(ws.st_dev),
            "GSAInode": str(ws.st_ino),
            "GSARecoveryDevice": str(rec.st_dev),
            "GSARecoveryInode": str(rec.st_ino),
        }
        (self.app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))

    def sign(self, wrong_entitlements=False, sandbox=True, extra_downloads=False):
        grants = [self.workspace_root + "/", self.recovery_root + "/"]
        if wrong_entitlements:
            grants = [str(self.workspace) + "/"]
        entitlements = {"com.apple.security.temporary-exception.files.absolute-path.read-write": grants}
        if sandbox:
            entitlements["com.apple.security.app-sandbox"] = True
        if extra_downloads:
            entitlements["com.apple.security.files.downloads.read-write"] = True
        ep = self.base / "entitlements.plist"
        ep.write_bytes(plistlib.dumps(entitlements))
        subprocess.run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-",
                        "--entitlements", str(ep), str(self.app)],
                       check=True, capture_output=True, timeout=8)
        subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(self.app)],
                       check=True, capture_output=True, timeout=8)

    def call(self, req, timeout=8):
        start = time.monotonic()
        env = dict(os.environ, SWIFT_BACKTRACE="enable=yes")
        proc = subprocess.run([str(self.executable)], input=json.dumps(req).encode(),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=timeout, cwd=str(self.base), env=env)
        elapsed = time.monotonic() - start
        Fixture.assert_process(proc)
        try:
            result = json.loads(proc.stdout)
        except Exception as exc:
            raise AssertionError(f"invalid broker stdout {proc.stdout[:300]!r}; stderr={proc.stderr[:300]!r}") from exc
        if elapsed > timeout:
            raise AssertionError(f"broker exceeded {timeout}s timeout")
        return result

    @staticmethod
    def assert_process(proc):
        if proc.returncode != 0:
            raise AssertionError(f"broker exit={proc.returncode}, stdout={proc.stdout[:300]!r}, stderr={proc.stderr[:300]!r}")

    def request(self, operation, path="item", payload=b"replacement", expected=None, txid=None):
        req = {"protocol": PROTOCOL, "operation": operation,
               "transaction_id": txid or str(uuid.uuid4()),
               "workspace_id": self.workspace_id, "revision": self.revision,
               "path": path, "expected_sha256": expected or sha(b"original")}
        if operation == "replace":
            req["base64"] = __import__("base64").b64encode(payload).decode()
        return req

    @staticmethod
    def walk_diagnostic(root):
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open("/", flags)
        rows = []
        try:
            for component in pathlib.Path(root).parts[1:]:
                try:
                    child = os.open(component, flags, dir_fd=fd)
                    os.close(fd)
                    fd = child
                    st = os.fstat(fd)
                    rows.append([component, st.st_dev, st.st_ino, st.st_uid, oct(st.st_mode & 0o7777)])
                except OSError as exc:
                    rows.append([component, type(exc).__name__, exc.errno])
                    break
        finally:
            os.close(fd)
        return rows

    def close(self):
        self.tmp.cleanup()


class RecoveryBrokerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.uname().sysname != "Darwin":
            raise unittest.SkipTest("native macOS Security.framework/App Sandbox candidate test")
        if not BINARY.is_file():
            raise unittest.SkipTest(f"precompiled candidate missing: {BINARY}")
        cls.source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        cls.binary_hash = hashlib.sha256(BINARY.read_bytes()).hexdigest()

    def setUp(self):
        self.fx = Fixture()

    def tearDown(self):
        self.fx.close()

    def test_replace_preserves_old_bytes_and_inspect_confirms_new_bytes(self):
        (self.fx.workspace / "item").write_bytes(b"original")
        r = self.fx.call(self.fx.request("replace"))
        self.assertTrue(r.get("ok"), f"candidate response={r!r}")
        info = plistlib.loads((self.fx.app / "Contents/Info.plist").read_bytes())
        binding = {key: info[key] for key in (
            "GSAWorkspaceRoot", "GSARecoveryRoot", "GSAWorkspaceID", "GSARevision",
            "GSADevice", "GSAInode", "GSARecoveryDevice", "GSARecoveryInode")}
        binding["actual_workspace"] = [str(os.stat(self.fx.workspace).st_dev), str(os.stat(self.fx.workspace).st_ino)]
        binding["actual_recovery"] = [str(os.stat(self.fx.recovery).st_dev), str(os.stat(self.fx.recovery).st_ino)]
        binding["canonical"] = [str(self.fx.workspace.resolve()), str(self.fx.recovery.resolve())]
        binding["workspace_walk"] = self.fx.walk_diagnostic(str(self.fx.workspace))
        binding["recovery_walk"] = self.fx.walk_diagnostic(str(self.fx.recovery))
        self.assertTrue(r["ok"], f"candidate response={r!r}; fixture binding={binding!r}")
        self.assertEqual(r["status"], "APPLIED")
        self.assertEqual((self.fx.workspace / "item").read_bytes(), b"replacement")
        retained = self.fx.recovery / r["transaction_id"] / "captured"
        self.assertEqual(retained.read_bytes(), b"original")
        inspected = self.fx.call({"protocol": PROTOCOL, "operation": "inspect", "transaction_id": r["transaction_id"]})
        self.assertEqual(inspected["status"], "APPLIED")
        self.assertEqual(inspected["observations"]["destination_sha256"], sha(b"replacement"))

    def test_trash_retains_original_and_inspect_verifies_absence(self):
        (self.fx.workspace / "item").write_bytes(b"original")
        r = self.fx.call(self.fx.request("trash"))
        self.assertTrue(r.get("ok"), f"candidate response={r!r}")
        self.assertEqual(r["status"], "APPLIED")
        self.assertFalse((self.fx.workspace / "item").exists())
        self.assertEqual((self.fx.recovery / r["transaction_id"] / "captured").read_bytes(), b"original")
        inspected = self.fx.call({"protocol": PROTOCOL, "operation": "inspect", "transaction_id": r["transaction_id"]})
        self.assertEqual(inspected["status"], "APPLIED")
        self.assertTrue(inspected["observations"]["source_absent"])

    def test_inspect_is_read_only(self):
        (self.fx.workspace / "item").write_bytes(b"original")
        r = self.fx.call(self.fx.request("replace"))
        self.assertTrue(r.get("ok"), f"candidate response={r!r}")
        self.assertEqual(r["status"], "APPLIED")
        before = sorted((p.name, p.stat().st_ino) for p in (self.fx.recovery / r["transaction_id"]).iterdir())
        again = self.fx.call({"protocol": PROTOCOL, "operation": "inspect", "transaction_id": r["transaction_id"]})
        after = sorted((p.name, p.stat().st_ino) for p in (self.fx.recovery / r["transaction_id"]).iterdir())
        self.assertEqual(again["status"], "APPLIED")
        self.assertEqual(before, after)

    def test_hash_mismatch_conflicts_without_namespace_mutation(self):
        (self.fx.workspace / "item").write_bytes(b"different")
        before = sorted(p.name for p in self.fx.workspace.iterdir())
        r = self.fx.call(self.fx.request("replace"))
        self.assertEqual(r["status"], "CONFLICT")
        self.assertEqual((self.fx.workspace / "item").read_bytes(), b"different")
        self.assertEqual(sorted(p.name for p in self.fx.workspace.iterdir()), before)
        self.assertEqual(self.fx.outside.read_bytes(), b"outside-canary")

    def test_existing_transaction_id_is_not_replayed(self):
        (self.fx.workspace / "item").write_bytes(b"original")
        req = self.fx.request("replace", payload=b"first")
        first = self.fx.call(req)
        self.assertEqual(first["status"], "APPLIED")
        second_req = dict(req, base64=__import__("base64").b64encode(b"second").decode())
        second = self.fx.call(second_req)
        self.assertFalse(second["ok"])
        self.assertEqual(second["error"], "TRANSACTION_EXISTS_OR_DENIED")
        self.assertEqual((self.fx.workspace / "item").read_bytes(), b"first")

    def test_traversal_symlink_hardlink_and_binding_mismatch_are_denied(self):
        (self.fx.workspace / "item").write_bytes(b"original")
        traversal = self.fx.call(self.fx.request("trash", path="../outside-canary.txt"))
        self.assertFalse(traversal.get("ok"), f"traversal unexpectedly accepted: {traversal!r}")
        self.assertEqual(traversal.get("error"), "PATH_OUTSIDE_SCOPE", f"response={traversal!r}")
        self.assertEqual(self.fx.outside.read_bytes(), b"outside-canary")
        (self.fx.workspace / "sym").symlink_to(self.fx.outside)
        symlink = self.fx.call(self.fx.request("trash", path="sym"))
        self.assertTrue(symlink.get("ok"), f"post-intent uncertainty must be structured: {symlink!r}")
        self.assertEqual((symlink.get("status"), symlink.get("reason")),
                         ("UNKNOWN", "ENTRY_UNAVAILABLE"), f"response={symlink!r}")
        self.assertEqual(self.fx.outside.read_bytes(), b"outside-canary")
        self.assertTrue((self.fx.workspace / "sym").is_symlink())
        (self.fx.workspace / "hard").write_bytes(b"original")
        os.link(self.fx.workspace / "hard", self.fx.base / "hard-alias")
        hardlink = self.fx.call(self.fx.request("trash", path="hard"))
        self.assertTrue(hardlink.get("ok"), f"post-intent uncertainty must be structured: {hardlink!r}")
        self.assertEqual((hardlink.get("status"), hardlink.get("reason")),
                         ("UNKNOWN", "UNSAFE_FILE_TYPE"), f"response={hardlink!r}")
        self.assertEqual((self.fx.workspace / "hard").read_bytes(), b"original")
        self.assertEqual((self.fx.base / "hard-alias").read_bytes(), b"original")
        mismatch_req = self.fx.request("trash")
        mismatch_req["workspace_id"] = str(uuid.uuid4())
        mismatch = self.fx.call(mismatch_req)
        self.assertFalse(mismatch.get("ok"), f"binding mismatch unexpectedly accepted: {mismatch!r}")
        self.assertEqual(mismatch.get("error"), "GRANT_BINDING_MISMATCH", f"response={mismatch!r}")
        self.assertEqual((self.fx.workspace / "item").read_bytes(), b"original")
        self.assertEqual(self.fx.outside.read_bytes(), b"outside-canary")

    def test_missing_source_conflicts_and_outside_canary_survives(self):
        r = self.fx.call(self.fx.request("trash", path="missing"))
        self.assertTrue(r.get("ok"), f"post-intent uncertainty must be structured: {r!r}")
        self.assertEqual((r.get("status"), r.get("reason")),
                         ("UNKNOWN", "ENTRY_UNAVAILABLE"), f"response={r!r}")
        self.assertFalse((self.fx.workspace / "missing").exists())
        self.assertEqual(self.fx.outside.read_bytes(), b"outside-canary")

    def test_case_insensitive_root_alias_cannot_overlap_workspace(self):
        alias_fixture = Fixture(root_layout="recovery_nested_case_alias")
        try:
            workspace_stat = os.stat(alias_fixture.workspace)
            alias_stat = os.stat(alias_fixture.base / "WORKSPACE")
            if (workspace_stat.st_dev, workspace_stat.st_ino) != (alias_stat.st_dev, alias_stat.st_ino):
                self.skipTest("temporary volume is case-sensitive; uppercase component is not a workspace alias")
            r = alias_fixture.call({"protocol": PROTOCOL, "operation": "inspect",
                                   "transaction_id": str(uuid.uuid4())})
            self.assertFalse(r.get("ok"), f"overlapping recovery root unexpectedly accepted: {r!r}")
            self.assertEqual(r.get("error"), "RECOVERY_OVERLAPS_WORKSPACE", f"response={r!r}")
            self.assertEqual(alias_fixture.outside.read_bytes(), b"outside-canary")
            workspace_children = list(alias_fixture.workspace.iterdir())
            self.assertEqual(len(workspace_children), 1, f"workspace changed: {workspace_children!r}")
            child_stat = os.stat(workspace_children[0])
            recovery_stat = os.stat(alias_fixture.recovery)
            self.assertEqual((child_stat.st_dev, child_stat.st_ino),
                             (recovery_stat.st_dev, recovery_stat.st_ino))
        finally:
            alias_fixture.close()

    def test_inverse_and_same_physical_case_alias_roots_are_denied(self):
        for layout in ("workspace_nested_case_alias", "same_case_alias"):
            alias_fixture = Fixture(root_layout=layout)
            try:
                if layout == "workspace_nested_case_alias":
                    parent = alias_fixture.base / "WORKSPACE"
                    nested = alias_fixture.workspace.parent
                else:
                    parent = alias_fixture.workspace
                    nested = alias_fixture.recovery
                parent_stat, nested_stat = os.stat(parent), os.stat(nested)
                same_alias = (parent_stat.st_dev, parent_stat.st_ino) == (nested_stat.st_dev, nested_stat.st_ino)
                if not same_alias:
                    self.skipTest(f"temporary volume does not realize {layout}")
                r = alias_fixture.call({"protocol": PROTOCOL, "operation": "inspect",
                                        "transaction_id": str(uuid.uuid4())})
                self.assertFalse(r.get("ok"), f"overlapping roots unexpectedly accepted ({layout}): {r!r}")
                self.assertEqual(r.get("error"), "RECOVERY_OVERLAPS_WORKSPACE", f"response={r!r}")
                self.assertEqual(alias_fixture.outside.read_bytes(), b"outside-canary")
            finally:
                alias_fixture.close()

    def test_noncanonical_and_symlink_workspace_roots_are_denied(self):
        for layout in ("workspace_repeated_slash", "workspace_dot_segment",
                       "workspace_trailing_slash", "workspace_symlink"):
            invalid = Fixture(root_layout=layout)
            try:
                r = invalid.call({"protocol": PROTOCOL, "operation": "inspect",
                                  "transaction_id": str(uuid.uuid4())})
                self.assertFalse(r.get("ok"), f"invalid root unexpectedly accepted ({layout}): {r!r}")
                self.assertEqual(r.get("error"), "ROOT_UNVERIFIED", f"response={r!r}")
                self.assertEqual(invalid.outside.read_bytes(), b"outside-canary")
            finally:
                invalid.close()

    def test_unsigned_candidate_is_blocked(self):
        unsigned = Fixture(sign=False)
        try:
            r = unsigned.call({"protocol": PROTOCOL, "operation": "inspect", "transaction_id": str(uuid.uuid4())})
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "SIGNED_SANDBOX_REQUIRED")
        finally:
            unsigned.close()

    def test_wrong_entitlement_candidate_is_blocked(self):
        wrong = Fixture(wrong_entitlements=True)
        try:
            r = wrong.call({"protocol": PROTOCOL, "operation": "inspect", "transaction_id": str(uuid.uuid4())})
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "SIGNED_SANDBOX_REQUIRED")
        finally:
            wrong.close()

    def test_unrequested_downloads_entitlement_is_blocked(self):
        extra = Fixture(sign=False)
        try:
            extra.sign(extra_downloads=True)
            r = extra.call({"protocol": PROTOCOL, "operation": "inspect", "transaction_id": str(uuid.uuid4())})
            self.assertFalse(r["ok"])
            self.assertEqual(r["error"], "SIGNED_SANDBOX_REQUIRED", f"candidate response={r!r}")
        finally:
            extra.close()

    def test_signed_sandbox_ancestor_search_diagnostic(self):
        """Probe ancestor opens under precisely the candidate's two grants."""
        control = Fixture(sign=False)
        try:
            source = control.base / "walk_probe.c"
            source.write_text(r'''#include <sys/types.h>
#include <sys/stat.h>
#include <sys/fcntl.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
static void walk(const char *path, int flags, const char *label) {
  int fd=open("/", O_RDONLY|O_DIRECTORY|O_CLOEXEC);
  printf("%s open-root=%d errno=%d\\n", label, fd, errno);
  if(fd<0)return;
  char *copy=strdup(path), *save=NULL, *part=strtok_r(copy+1,"/",&save);
  while(part) {
    int next=openat(fd,part,flags|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    if(next<0){printf("%s failed-component=%s errno=%d\\n",label,part,errno);close(fd);free(copy);return;}
    close(fd);fd=next;part=strtok_r(NULL,"/",&save);
  }
  printf("%s complete=1\\n",label);close(fd);free(copy);
}
int main(int argc,char **argv) {
  for(int i=1;i<argc;i++) {
    int direct=open(argv[i],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    printf("direct-%d=%d errno=%d\\n",i,direct,errno);if(direct>=0)close(direct);
    walk(argv[i],O_RDONLY,"read");
    walk(argv[i],O_SEARCH,"search");
    walk(argv[i],O_EVTONLY,"event");
  }
  return 0;
}
''')
            subprocess.run(["/usr/bin/clang", str(source), "-o", str(control.executable)],
                           check=True, capture_output=True, timeout=8)
            os.chmod(control.executable, 0o755)
            control.sign()
            proc = subprocess.run([str(control.executable), str(control.workspace), str(control.recovery)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
                                  cwd=str(control.base))
            Fixture.assert_process(proc)
            self.assertIn(b"complete=1", proc.stdout)
            print("sandbox ancestor-open diagnostics:\n" + proc.stdout.decode("utf-8", "replace"))
        finally:
            control.close()

    def test_signed_sandbox_search_root_descriptor_diagnostic(self):
        """Probe the candidate's exact initial O_SEARCH descriptor open."""
        control = Fixture(sign=False)
        try:
            source = control.base / "search_root_probe.c"
            source.write_text(r'''#include <sys/types.h>
#include <sys/stat.h>
#include <sys/fcntl.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
static void walk_search(const char *path) {
  int fd=open("/", O_SEARCH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  printf("initial-O_SEARCH-root=%d errno=%d\\n",fd,errno);
  if(fd<0)return;
  char *copy=strdup(path), *save=NULL, *part=strtok_r(copy+1,"/",&save);
  while(part) {
    int next=openat(fd,part,O_SEARCH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    if(next<0){printf("search-failed-component=%s errno=%d\\n",part,errno);close(fd);free(copy);return;}
    close(fd);fd=next;part=strtok_r(NULL,"/",&save);
  }
  printf("search-walk-complete=1\\n");close(fd);free(copy);
}
int main(int argc,char **argv) {
  int r=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  printf("initial-O_RDONLY-root=%d errno=%d\\n",r,errno);if(r>=0)close(r);
  for(int i=1;i<argc;i++) {
    int direct=open(argv[i],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
    printf("direct-target-%d=%d errno=%d\\n",i,direct,errno);if(direct>=0)close(direct);
    walk_search(argv[i]);
  }
  return 0;
}
''')
            subprocess.run(["/usr/bin/clang", str(source), "-o", str(control.executable)],
                           check=True, capture_output=True, timeout=8)
            os.chmod(control.executable, 0o755)
            control.sign()
            proc = subprocess.run([str(control.executable), str(control.workspace), str(control.recovery)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
                                  cwd=str(control.base))
            Fixture.assert_process(proc)
            self.assertIn(b"initial-O_SEARCH-root=", proc.stdout)
            print("sandbox search-root diagnostics:\n" + proc.stdout.decode("utf-8", "replace"))
        finally:
            control.close()

    def test_signed_sandbox_foundation_binding_diagnostic(self):
        """Inspect the Foundation URL and Info.plist checks under the same grants."""
        control = Fixture(sign=False)
        try:
            source = control.base / "foundation_probe.swift"
            source.write_text(r'''import Foundation
import Darwin
let info = Bundle.main.infoDictionary ?? [:]
let pairs = [("GSAWorkspaceRoot", "GSADevice", "GSAInode"),
             ("GSARecoveryRoot", "GSARecoveryDevice", "GSARecoveryInode")]
for (rootKey, deviceKey, inodeKey) in pairs {
    guard let root = info[rootKey] as? String else { print("missing-root=" + rootKey); continue }
    let url = URL(fileURLWithPath: root)
    let standard = url.standardizedFileURL.path
    let resolved = url.resolvingSymlinksInPath().path
    let nsRoot = root as NSString
    let nsStandard = standard as NSString
    let nsResolved = resolved as NSString
    var st = stat()
    let statResult = lstat(root, &st)
    let deviceValue = info[deviceKey]
    let inodeValue = info[inodeKey]
    print("root=" + rootKey + " rootValue=" + String(reflecting: root) +
          " standardValue=" + String(reflecting: standard) +
          " resolvedValue=" + String(reflecting: resolved) +
          " rootScalars=" + root.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: ",") +
          " standardScalars=" + standard.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: ",") +
          " resolvedScalars=" + resolved.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: ",") +
          " rootNSString=" + String(reflecting: nsRoot) +
          " standardNSString=" + String(reflecting: nsStandard) +
          " resolvedNSString=" + String(reflecting: nsResolved) +
          " standardEqual=" + String(standard == root) +
          " resolvedEqual=" + String(resolved == root) +
          " statResult=" + String(statResult) +
          " statDevice=" + String(st.st_dev) + " statInode=" + String(st.st_ino) +
          " deviceValueType=" + String(describing: type(of: deviceValue as Any)) +
          " inodeValueType=" + String(describing: type(of: inodeValue as Any)) +
          " deviceCastEqual=" + String(String(st.st_dev) == (deviceValue as? String)) +
          " inodeCastEqual=" + String(String(st.st_ino) == (inodeValue as? String)))
}
''')
            subprocess.run(["/usr/bin/swiftc", str(source), "-o", str(control.executable)],
                           check=True, capture_output=True, timeout=12)
            os.chmod(control.executable, 0o755)
            control.sign()
            proc = subprocess.run([str(control.executable)], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, timeout=5, cwd=str(control.base))
            Fixture.assert_process(proc)
            self.assertIn(b"GSAWorkspaceRoot", proc.stdout)
            print("Foundation binding diagnostics:\n" + proc.stdout.decode("utf-8", "replace"))
        finally:
            control.close()

    def test_signed_sandbox_launch_control_binary(self):
        """Separate macOS bundle/sandbox launch from candidate implementation."""
        control = Fixture(sign=False)
        try:
            shutil.copyfile("/usr/bin/true", control.executable)
            os.chmod(control.executable, 0o755)
            control.sign(sandbox=False)
            proc = subprocess.run([str(control.executable)], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, timeout=5, cwd=str(control.base),
                                  env=dict(os.environ, SWIFT_BACKTRACE="enable=yes"))
            self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))
        finally:
            control.close()

if __name__ == "__main__":
    unittest.main(verbosity=2)
