#!/usr/bin/env python3
"""Native containment regression suite; fixture paths only, never user files."""
import json, pathlib, tempfile, subprocess, plistlib, os, hashlib, sys, uuid
SOURCE=pathlib.Path(__file__).with_name('broker.swift')
with tempfile.TemporaryDirectory(prefix='gsa-scoped-files-') as temporary:
    base=pathlib.Path(temporary).resolve(); root=base/'root'; root.mkdir(); outside=base/'outside'; outside.write_bytes(b'outside'); outside.chmod(0o644)
    (root/'input').write_bytes(b'old'); (root/'escape').symlink_to(outside); os.link(outside,root/'hardlink')
    app=base/'Broker.app'; binary=app/'Contents/MacOS/broker'; binary.parent.mkdir(parents=True)
    (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'com.gsa-lc.files.test.'+uuid.uuid4().hex,'CFBundleExecutable':'broker','CFBundlePackageType':'APPL','CFBundleVersion':'1','GSAWorkspaceRoot':str(root),'GSADevice':str(root.stat().st_dev),'GSAInode':str(root.stat().st_ino),'GSARevision':1}))
    entitlements=base/'entitlements.plist'; entitlements.write_bytes(plistlib.dumps({'com.apple.security.app-sandbox':True,'com.apple.security.temporary-exception.files.absolute-path.read-write':[str(root)+'/']}))
    subprocess.run(['swiftc','-D','CONTAINMENT_TESTS',str(SOURCE),'-o',str(binary)],check=True)
    subprocess.run(['/usr/bin/codesign','--force','--sign','-','--entitlements',str(entitlements),str(app)],check=True)
    st=root.stat()
    def call(op,path,**fields):
        req=dict(operation=op,root=str(root),device=str(st.st_dev),inode=str(st.st_ino),path=path,revision=1,**fields)
        p=subprocess.run([str(binary)],input=json.dumps(req),text=True,capture_output=True,timeout=10)
        assert p.returncode==0,(p.returncode,p.stderr)
        return json.loads(p.stdout)
    def ok(op,path,**fields):
        result=call(op,path,**fields); assert result.get('ok'),result; return result
    def deny(op,path,**fields):
        result=call(op,path,**fields); assert not result.get('ok'),result
    assert ok('read','input',maxBytes=100)['base64']=='b2xk'
    deny('read','../outside',maxBytes=100); deny('read','escape',maxBytes=100); deny('read','hardlink',maxBytes=100)
    deny('read','input',maxBytes=2)
    ok('create','new',base64='bmV3'); deny('create','new',base64='eA==')
    ok('mkdir','dir'); deny('create','escape',base64='eA==')
    expected=hashlib.sha256(b'old').hexdigest()
    deny('replace','input',base64='eA==',expectedSha256='0'*64)
    ok('copy','input',destination='copied',expectedSha256=expected)
    assert (root/'copied').read_bytes()==b'old'
    assert outside.read_bytes()==b'outside'
    # Deterministic ancestor relocation between descriptor traversal and I/O.
    (root/'racing').mkdir();(root/'racing/input').write_bytes(b'inside')
    req=dict(operation='read',root=str(root),device=str(st.st_dev),inode=str(st.st_ino),path='racing/input',revision=1,maxBytes=100,testPause=True)
    proc=subprocess.Popen([str(binary)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write(json.dumps(req));proc.stdin.close()
    assert proc.stdout.readline().strip()=='READY'
    (root/'racing').rename(base/'relocated')
    race_result=json.loads(proc.stdout.read());proc.wait()
    assert not race_result.get('ok'),race_result
    # A grant pins both device and inode; replacing the root invalidates it.
    root.rename(base/'renamed');root.mkdir();(root/'input').write_bytes(b'wrong')
    deny('read','input',maxBytes=100)
    print(json.dumps({'checks':['native-read','create-exclusive','mkdir','copy-exclusive','symlink-denied','hardlink-denied','traversal-denied','read-cap','hash-conflict','root-identity'],'ok':True}))
