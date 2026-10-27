#!/usr/bin/env python3
"""Native containment regression suite; fixture paths only, never user files."""
import hashlib, json, os, pathlib, plistlib, re, select, shutil, signal, subprocess, sys, tempfile, time, uuid

SOURCE=pathlib.Path(__file__).with_name('broker.swift')
CALL_TIMEOUT_SECONDS=10
PROCESS_CLEANUP_TIMEOUT_SECONDS=2
MAX_EVIDENCE_TEXT=16384

def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()

def sha256_file(path):
    digest=hashlib.sha256()
    with open(path,'rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            digest.update(block)
    return digest.hexdigest()

def bounded_text(value):
    if isinstance(value,bytes):
        value=value.decode('utf-8','replace')
    if len(value)<=MAX_EVIDENCE_TEXT:
        return value
    return value[:MAX_EVIDENCE_TEXT]+'\n<TRUNCATED chars=%d sha256=%s>'%(len(value),sha256_bytes(value.encode()))

def stat_identity(path):
    info=path.stat()
    return {'path':str(path.resolve()),'device':info.st_dev,'inode':info.st_ino}

evidence={'schema_version':1,'ok':False,'checks':[],'operations':[],'artifacts':{},'failure':None}
failure=None
temporary=tempfile.TemporaryDirectory(prefix='gsa-scoped-files-')
base=pathlib.Path(temporary.name).resolve()
evidence['fixture']={'temporary_root':stat_identity(base)}
root=base/'root'

def record_failure(exc):
    return {'type':type(exc).__name__,'message':bounded_text(str(exc))}

def parse_response(record,stdout):
    try:
        record['response']=json.loads(stdout)
    except (json.JSONDecodeError,TypeError) as exc:
        record['response_parse_error']=str(exc)

def terminate_process_group(proc):
    try:
        os.killpg(proc.pid,signal.SIGKILL)
    except ProcessLookupError:
        pass

def read_ready_line(stream,timeout):
    deadline=time.monotonic()+timeout
    line=bytearray()
    while len(line)<=128:
        remaining=deadline-time.monotonic()
        if remaining<=0 or not select.select([stream],[],[],remaining)[0]:
            return None
        byte=os.read(stream.fileno(),1)
        if not byte:
            return line.decode('utf-8','replace') if line else None
        if byte==b'\n':
            return line.decode('utf-8','replace').rstrip('\r')
        line.extend(byte)
    raise AssertionError('oversized READY line')

try:
    root.mkdir()
    outside=base/'outside'; outside.write_bytes(b'outside'); outside.chmod(0o644)
    (root/'input').write_bytes(b'old'); (root/'escape').symlink_to(outside); os.link(outside,root/'hardlink')
    app=base/'Broker.app'; binary=app/'Contents/MacOS/broker'; binary.parent.mkdir(parents=True)
    info_plist=app/'Contents/Info.plist'
    info_plist.write_bytes(plistlib.dumps({'CFBundleIdentifier':'com.gsa-lc.files.test.'+uuid.uuid4().hex,'CFBundleExecutable':'broker','CFBundlePackageType':'APPL','CFBundleVersion':'1','GSAWorkspaceID':'workspace','GSAWorkspaceRole':'workspace','GSAWorkspaceRoot':str(root),'GSADevice':str(root.stat().st_dev),'GSAInode':str(root.stat().st_ino),'GSARevision':1}))
    entitlements=base/'entitlements.plist'
    entitlement_values={'com.apple.security.app-sandbox':True,'com.apple.security.temporary-exception.files.absolute-path.read-write':[str(root)+'/']}
    entitlements.write_bytes(plistlib.dumps(entitlement_values))
    st=root.stat()
    evidence['fixture'].update({'working_root':stat_identity(root),'outside_canary':stat_identity(outside)})
    evidence['artifacts'].update({'source':{'path':str(SOURCE.resolve()),'sha256':sha256_file(SOURCE)},'info_plist':{'path':str(info_plist),'sha256':sha256_file(info_plist)},'entitlements':{'path':str(entitlements),'sha256':sha256_file(entitlements),'values':entitlement_values}})

    compiler_launcher=shutil.which('swiftc')
    assert compiler_launcher, 'swiftc not found on PATH'
    launcher_path=pathlib.Path(compiler_launcher).absolute()
    selection_command=['/usr/bin/xcrun','--find','swiftc']
    selection=subprocess.run(selection_command,check=False,capture_output=True,text=True,timeout=CALL_TIMEOUT_SECONDS)
    selected_path=selection.stdout.strip()
    assert selection.returncode==0 and selected_path, ('xcrun swiftc selection failed',selection.returncode,selection.stderr)
    resolved_path=pathlib.Path(selected_path).resolve()
    version=subprocess.run([str(resolved_path),'--version'],check=False,capture_output=True,text=True,timeout=CALL_TIMEOUT_SECONDS)
    evidence['artifacts']['compiler']={
        'launcher':{'path':str(launcher_path),'sha256':sha256_file(launcher_path)},
        'selection':{'command':selection_command,'returncode':selection.returncode,'stdout':bounded_text(selection.stdout),'stderr':bounded_text(selection.stderr),'selected_path':selected_path},
        'resolved':{'path':str(resolved_path),'sha256':sha256_file(resolved_path),'version_returncode':version.returncode,'version_stdout':bounded_text(version.stdout),'version_stderr':bounded_text(version.stderr)},
    }
    assert version.returncode==0, ('resolved swiftc --version failed',version.returncode,version.stderr)
    compile_command=[compiler_launcher,'-D','CONTAINMENT_TESTS',str(SOURCE),'-o',str(binary)]
    compiled=subprocess.run(compile_command,check=False,capture_output=True,text=True,timeout=120)
    evidence['artifacts']['compile']={'command':compile_command,'compiler_identity':'compiler.launcher','returncode':compiled.returncode,'stdout':bounded_text(compiled.stdout),'stderr':bounded_text(compiled.stderr)}
    assert compiled.returncode==0, ('swiftc failed',compiled.returncode,compiled.stderr)

    sign_command=['/usr/bin/codesign','--force','--sign','-','--entitlements',str(entitlements),str(app)]
    signed=subprocess.run(sign_command,check=False,capture_output=True,text=True,timeout=CALL_TIMEOUT_SECONDS)
    evidence['artifacts']['codesign']={'command':sign_command,'returncode':signed.returncode,'stdout':bounded_text(signed.stdout),'stderr':bounded_text(signed.stderr)}
    assert signed.returncode==0, ('codesign failed',signed.returncode,signed.stderr)
    display_command=['/usr/bin/codesign','--display','--verbose=4',str(app)]
    display=subprocess.run(display_command,check=False,capture_output=True,text=True,timeout=CALL_TIMEOUT_SECONDS)
    signature_text=display.stdout+display.stderr
    code_directory=re.search(r'(?m)^CDHash=(\S+)',signature_text)
    evidence['artifacts']['signature']={'display_command':display_command,'display_returncode':display.returncode,'display_stdout':bounded_text(display.stdout),'display_stderr':bounded_text(display.stderr),'metadata_sha256':sha256_bytes(signature_text.encode()),'code_directory_hash':code_directory.group(1) if code_directory else None}
    assert display.returncode==0 and code_directory, ('signature metadata unavailable',display.returncode,signature_text)
    verify_command=['/usr/bin/codesign','--verify','--strict','--verbose=2',str(app)]
    verified=subprocess.run(verify_command,check=False,capture_output=True,text=True,timeout=CALL_TIMEOUT_SECONDS)
    evidence['artifacts']['signature'].update({'verify_command':verify_command,'verify_returncode':verified.returncode,'verify_stdout':bounded_text(verified.stdout),'verify_stderr':bounded_text(verified.stderr)})
    assert verified.returncode==0, ('strict codesign verification failed',verified.returncode,verified.stderr)
    evidence['artifacts']['binary']={'path':str(binary),'sha256':sha256_file(binary)}
    evidence['artifacts']['app_bundle']={'path':str(app),'code_directory_hash':code_directory.group(1)}

    def call(label,op,path,**fields):
        req=dict(operation=op,workspace_id='workspace',role='workspace',root=str(root),device=str(st.st_dev),inode=str(st.st_ino),path=path,revision=1,**fields)
        record={'label':label,'command':[str(binary)],'request':req,'returncode':None,'timed_out':False}
        try:
            result=subprocess.run([str(binary)],input=json.dumps(req),text=True,capture_output=True,timeout=CALL_TIMEOUT_SECONDS)
            record.update({'returncode':result.returncode,'stdout':bounded_text(result.stdout),'stderr':bounded_text(result.stderr)})
            parse_response(record,result.stdout)
        except subprocess.TimeoutExpired as exc:
            record.update({'timed_out':True,'stdout':bounded_text(exc.stdout or ''),'stderr':bounded_text(exc.stderr or ''),'error':bounded_text(str(exc))})
        evidence['operations'].append(record)
        assert not record['timed_out'], (label,'timed out',record)
        assert record['returncode']==0, (label,'nonzero process exit',record)
        assert 'response' in record, (label,'invalid response',record)
        return record['response']

    def ok(label,op,path,**fields):
        result=call(label,op,path,**fields); assert result.get('ok'),(label,result); evidence['checks'].append(label); return result

    def deny(label,op,path,**fields):
        result=call(label,op,path,**fields); assert not result.get('ok'),(label,result); evidence['checks'].append(label)

    assert ok('native-read','read','input',maxBytes=100)['base64']=='b2xk'
    deny('traversal-denied','read','../outside',maxBytes=100)
    deny('symlink-denied','read','escape',maxBytes=100)
    deny('hardlink-denied','read','hardlink',maxBytes=100)
    deny('read-cap','read','input',maxBytes=2)
    ok('create-exclusive','create','new',base64='bmV3')
    deny('create-duplicate-denied','create','new',base64='eA==')
    ok('mkdir','mkdir','dir')
    deny('symlink-create-denied','create','escape',base64='eA==')
    expected=hashlib.sha256(b'old').hexdigest()
    deny('hash-conflict','replace','input',base64='eA==',expectedSha256='0'*64)
    ok('copy-exclusive','copy','input',destination='copied',expectedSha256=expected)
    assert (root/'copied').read_bytes()==b'old'
    assert outside.read_bytes()==b'outside'

    # Deterministic ancestor relocation between descriptor traversal and I/O.
    (root/'racing').mkdir(); (root/'racing/input').write_bytes(b'inside')
    req=dict(operation='read',workspace_id='workspace',role='workspace',root=str(root),device=str(st.st_dev),inode=str(st.st_ino),path='racing/input',revision=1,maxBytes=100,testPause=True)
    command=[str(binary)]
    record={'label':'ancestor-relocation','command':command,'request':req,'returncode':None,'timed_out':False}
    proc=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try:
        proc.stdin.write(json.dumps(req).encode()); proc.stdin.close(); proc.stdin=None
        ready_line=read_ready_line(proc.stdout,CALL_TIMEOUT_SECONDS)
        if ready_line is None:
            record['timed_out']=True
            terminate_process_group(proc)
            stdout,stderr=proc.communicate(timeout=PROCESS_CLEANUP_TIMEOUT_SECONDS)
            record.update({'stdout':bounded_text(stdout),'stderr':bounded_text(stderr),'returncode':proc.returncode,'error':'timed out waiting for READY'})
        else:
            record['ready_line']=ready_line
            assert ready_line=='READY', ('ancestor-relocation did not reach pause',ready_line)
            (root/'racing').rename(base/'relocated')
            try:
                stdout,stderr=proc.communicate(timeout=CALL_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                record['timed_out']=True
                terminate_process_group(proc)
                stdout,stderr=proc.communicate(timeout=PROCESS_CLEANUP_TIMEOUT_SECONDS)
                record['error']='timed out waiting for broker response after relocation'
            record.update({'stdout':bounded_text(stdout),'stderr':bounded_text(stderr),'returncode':proc.returncode})
            parse_response(record,stdout)
    except Exception as exc:
        if proc.poll() is None:
            terminate_process_group(proc)
            try:
                stdout,stderr=proc.communicate(timeout=PROCESS_CLEANUP_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                stdout,stderr='','process cleanup timed out'
            record.update({'stdout':bounded_text(stdout),'stderr':bounded_text(stderr),'returncode':proc.returncode})
        record['harness_error']=record_failure(exc)
    evidence['operations'].append(record)
    assert not record['timed_out'], ('ancestor-relocation timed out',record)
    assert record.get('returncode')==0, ('ancestor-relocation process failed',record)
    assert 'response' in record, ('ancestor-relocation response missing',record)
    assert not record['response'].get('ok'), record['response']
    evidence['checks'].append('ancestor-relocation')

    # A grant pins both device and inode; replacing the root invalidates it.
    root.rename(base/'renamed'); root.mkdir(); (root/'input').write_bytes(b'wrong')
    deny('root-identity','read','input',maxBytes=100)
except Exception as exc:
    failure=record_failure(exc)
finally:
    try:
        temporary.cleanup()
        evidence['cleanup']={'temporary_root_removed':not base.exists()}
    except Exception as exc:
        evidence['cleanup']={'temporary_root_removed':not base.exists(),'error':record_failure(exc)}
    if not evidence.get('cleanup',{}).get('temporary_root_removed'):
        failure=failure or {'type':'CleanupError','message':'temporary fixture root remains'}
    evidence['ok']=failure is None
    evidence['failure']=failure
    print(json.dumps(evidence,sort_keys=True))

if failure is not None:
    sys.exit(1)
