import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {createMacPrivateFile} from "./mac-desktop-private-file.mjs";
import {loadDesktopConfig, saveDesktopConfig} from "./desktop-config.mjs";
import {startDesktopRuntime} from "./desktop-supervisor.mjs";
import {verifyReleaseManifest} from "./desktop-release.mjs";
import {probeDesktopHealth} from "./desktop-health.mjs";

const fail = code => Object.assign(new Error(code), {code});
const absolute = value => typeof value === "string" && path.isAbsolute(value) && !/[\u0000-\u001f\u007f]/.test(value);
const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

export function ensureLogin({firstInstall, existingPreference}) {
  if (typeof existingPreference === "boolean") return existingPreference;
  return firstInstall === true;
}

export function renderLaunchAgentPlist({label, appPath, configPath}) {
  if (typeof label !== "string" || !/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/.test(label) ||
      !absolute(appPath) || !appPath.endsWith(".app") || !absolute(configPath)) throw fail("LAUNCH_PATH_INVALID");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(path.join(appPath, "Contents/MacOS/GSA Local Connector"))}</string><string>--desktop-config</string><string>${xml(configPath)}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>AbandonProcessGroup</key><false/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Interactive</string>
<key>Umask</key><integer>63</integer>
</dict></plist>\n`;
}

async function metadata(configPath, privateFile) {
  if (!absolute(configPath)) throw fail("DESKTOP_CONFIG_INVALID");
  const {bytes} = await privateFile.readVerified(configPath);
  let value;
  try {value = JSON.parse(bytes.toString("utf8"));} catch {throw fail("DESKTOP_CONFIG_INVALID");}
  if (!value || Object.keys(value).some(key => !["runtimeRoot", "envPath", "installationId", "statusPath"].includes(key)) ||
      !absolute(value.runtimeRoot) || !absolute(value.envPath) ||
      (value.statusPath !== undefined && !absolute(value.statusPath)) ||
      (value.installationId !== undefined && !/^[A-Za-z0-9-]{1,128}$/.test(value.installationId))) throw fail("DESKTOP_CONFIG_INVALID");
  return {...value, directory: path.dirname(configPath), statusPath: value.statusPath ?? path.join(path.dirname(configPath), "status.json")};
}

async function publish(privateFile, name, bytes) {
  let identity = null;
  try {identity = (await privateFile.readVerified(name)).identity;} catch (error) {if (error.code !== "FILE_MISSING") throw error;}
  return privateFile.replaceVerified(name, bytes, identity);
}

const guardScript = String.raw`
import fcntl, os, stat, sys
def safe(info):
    return stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600
try:
    for target, create in [(sys.argv[2], False), (sys.argv[1], True)]:
        try:
            fd = os.open(target, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_CREAT if create else 0), 0o600)
        except FileNotFoundError:
            if not create: continue
            raise
        if not safe(os.fstat(fd)): raise ValueError()
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not create: os.close(fd)
    print('OWNED', flush=True)
    while sys.stdin.buffer.read(1024): pass
except Exception:
    print('BLOCKED', flush=True)
    sys.exit(75)
`;

async function acquireGuard(config, environment) {
  if (!absolute(environment.HOME)) throw fail("DESKTOP_HOME_INVALID");
  const own = path.join(config.directory, "desktop-owner.lock");
  const legacy = path.join(environment.HOME, "Library/Application Support/GSA-Localconnector/server-owner.lock");
  // The existing CLI remains the authoritative kernel fence. This probe refuses
  // an already active legacy owner; it neither reads nor creates identity state.
  const helper = spawn("/usr/bin/python3", ["-I", "-c", guardScript, own, legacy], {stdio: ["pipe", "pipe", "ignore"], env: environment});
  let exited = false;
  helper.on("close", () => {exited = true;});
  await new Promise((resolve, reject) => {
    let output = "", done = false;
    const finish = error => {
      if (done) return;
      done = true; clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {helper.stdin.end(); finish(fail("OWNER_UNAVAILABLE"));}, 5000);
    helper.on("error", () => finish(fail("OWNER_UNAVAILABLE")));
    helper.stdin.on("error", () => finish(fail("OWNER_UNAVAILABLE")));
    helper.on("close", () => finish(fail("OWNER_ACTIVE")));
    helper.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("OWNED\n")) finish();
      else if (output.includes("BLOCKED") || output.length > 64) {helper.stdin.end(); finish(fail("OWNER_ACTIVE"));}
    });
  });
  return {installationId: config.installationId ?? "desktop-installation", sessionId: randomUUID(),
    async release() {
      if (exited) return;
      await new Promise(resolve => {helper.once("close", resolve); helper.stdin.end();});
    }};
}

function safeEnvironment() {
  const env = {};
  for (const name of ["HOME", "PATH", "TMPDIR"]) {
    const value = process.env[name];
    if (typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(value)) env[name] = value;
  }
  return env;
}

export class MacDesktopAdapter {
  constructor({configPath,registrationPruner=null,pauseReader=null}) {this.configPath = configPath; this.pauseReader = pauseReader; this.pauseWriteInFlight = false; this.lastPauseObservation = null; this.pauseRequestAttempt = 0; this.pauseRequestOutcome = null; this.privateFile = createMacPrivateFile(); this.runtime = null; this.quitOutcome = null; this.paused = false; this.pauseQueue = Promise.resolve(); this.registrationPruneAttempt = 0; this.registrationPruneOutcome = null; this.registrationPruneQueue = Promise.resolve(); this.registrationPruner = registrationPruner;}
  ensureLogin(options) {return ensureLogin(options);}
  async start() {
    if (this.runtime) return this.runtime;
    if (process.platform !== "darwin" || process.arch !== "arm64") throw fail("MAC_BACKEND_UNAVAILABLE");
    const config = await metadata(this.configPath, this.privateFile);
    this.config = config;
    const manifestPath = path.join(config.runtimeRoot, "manifest.json");
    const manifestInfo = await fs.lstat(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.nlink !== 1 || manifestInfo.uid !== process.getuid() || (manifestInfo.mode & 0o022)) throw fail("RUNTIME_UNSAFE");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    await verifyReleaseManifest({releaseRoot: config.runtimeRoot, manifest});
    const env = safeEnvironment();
    const node = path.join(config.runtimeRoot, "bin/node");
    const client = path.join(config.runtimeRoot, "bin/tunnel-client");
    const entry = path.join(config.runtimeRoot, "dist/src/mcp/cli.js");
    const ownerLauncher = path.join(config.runtimeRoot, "scripts/macos-owner-launcher.py");
    for (const file of [node, client, entry, ownerLauncher]) {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o022)) throw fail("RUNTIME_UNSAFE");
    }
    let log = Buffer.alloc(0), tunnelChild, healthProbe;
    const healthFile = path.join(config.directory, "desktop-health.url");
    this.runtime = await startDesktopRuntime({runtimeRoot: config.runtimeRoot, envPath: config.envPath, platformAdapter: {
      loadSetup: ({envPath}) => loadDesktopConfig({envPath, privateFile: this.privateFile}),
      acquireOwner: () => acquireGuard(config, env),
      releaseOwner: owner => owner.release(),
      tunnelClient: () => client,
      runFlag: "--config", // Characterized tunnel-client 0.0.14; package verification pins this binary.
      baseEnvironment: env,
      prepareProfile: async ({tunnelId}) => {
        // A fresh owner session starts unpaused, before the tunnel is spawned.
        // The sealed directory is never a workspace; only the menu supervisor
        // publishes this local admission flag.
        try {
          await publish(this.privateFile,path.join(config.directory,"pause-state.json"),
            Buffer.from(JSON.stringify({format:"gsa-desktop-pause-v1",paused:false})));
        } catch (error) {
          if (error?.code === "FILE_UNSAFE") throw fail("DESKTOP_PAUSE_STATE_UNSAFE");
          throw error;
        }
        this.paused=false;
        // Reset the owned private locator before launch: never accept a previous
        // session's readiness, or probe the default port of another connector.
        await publish(this.privateFile, healthFile, Buffer.alloc(0));
        const profile = path.join(config.directory, "desktop-profile.yaml");
        const command = [node, entry].map(value => '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"').join(" ");
        const yaml = `config_version: 1\ncontrol_plane:\n  tunnel_id: ${JSON.stringify(tunnelId)}\n  api_key: env:CONTROL_PLANE_API_KEY\nlog:\n  level: warn\n  format: json\nmcp:\n  commands:\n    - channel: main\n      command: '${command.replaceAll("'", "''")}'\n`;
        await publish(this.privateFile, profile, Buffer.from(yaml));
        return {path: profile};
      },
      spawn: (command, args, options) => {
        tunnelChild = spawn(command, [...args, "--health.listen-addr", "127.0.0.1:0", "--health.url-file", healthFile], options);
        return tunnelChild;
      },
      connectionStatus: async () => {
        // Share an in-flight probe; the one-second status timer must not build
        // up a queue when a bounded health command is slow.
        if (!healthProbe) healthProbe = probeDesktopHealth({client, pid: tunnelChild?.pid, urlFile: healthFile,
          privateFile: this.privateFile, environment: env}).finally(() => {healthProbe = null;});
        return healthProbe;
      },
      ownedWorkState: async () => "UNKNOWN", // No verified native retained-work observer is available yet.
      writeLog: async chunk => {
        log = Buffer.concat([log, chunk]).subarray(-16384);
        await publish(this.privateFile, path.join(config.directory, "desktop.log"), log);
      }
    }});
    await this.publishStatus();
    return this.runtime;
  }
  async status() {return this.runtime ? this.runtime.status() : {state: "STOPPED", connection: "UNKNOWN", installationId: null, sessionId: null};}
  async stopOwned() {return this.runtime ? this.runtime.stopOwned() : {stopped: true};}
  /** Serialize local menu requests; no signal terminates an active task. */
  async setPaused(paused) {
    if(typeof paused!=="boolean")throw fail("DESKTOP_PAUSE_INVALID");
    const request=this.pauseQueue.then(async()=>{
      if(!this.runtime||!this.config)throw fail("DESKTOP_NOT_RUNNING");
      const observed=await this.runtime.status();
      if(observed.state!=="RUNNING")throw fail("DESKTOP_NOT_RUNNING");
      this.pauseWriteInFlight=true;
      try {
        await publish(this.privateFile,path.join(this.config.directory,"pause-state.json"),
          Buffer.from(JSON.stringify({format:"gsa-desktop-pause-v1",paused})));
        this.paused=paused;
      } finally {this.pauseWriteInFlight=false;}
      return this.publishStatus();
    });
    this.pauseQueue=request.then(()=>{},()=>{});
    return request;
  }
  /** Menu entry point: never rejects; the outcome is published for the app. */
  async requestPause(paused) {
    let outcome;
    try {
      await this.setPaused(paused);
      outcome={pauseRequestStatus:"DONE",pauseRequestReason:null};
    } catch(error) {
      const code=error?.code;
      outcome={pauseRequestStatus:"FAILED",pauseRequestReason:code==="FILE_UNSAFE"?"PAUSE_FILE_UNSAFE":
        (code==="FILE_BUSY"||code==="FILE_STALE")?"PAUSE_FILE_BUSY":code==="DESKTOP_NOT_RUNNING"?"DESKTOP_NOT_RUNNING":"PAUSE_WRITE_FAILED"};
    }
    this.pauseRequestAttempt++;
    this.pauseRequestOutcome={pauseRequestAttempt:this.pauseRequestAttempt,...outcome};
    try {await this.publishStatus();} catch {}
    return this.pauseRequestOutcome;
  }
  /** What the MCP process actually sees in the pause file. Never throws. */
  async observePause() {
    if (!this.config?.directory) return {desktopPauseState:"UNTRUSTED",desktopPauseEffective:null,desktopPauseReason:"OBSERVER_UNAVAILABLE"};
    if (this.pauseWriteInFlight && this.lastPauseObservation) return this.lastPauseObservation;
    let observation;
    try {
      const reader=this.pauseReader??(await import("../dist/src/local/desktop-pause.js")).readDesktopPauseFile;
      const reading=await reader(path.join(this.config.directory,"pause-state.json"));
      const effective=reading.paused;
      observation={desktopPauseState:effective===this.paused?"VERIFIED":"MISMATCH",desktopPauseEffective:effective,desktopPauseReason:null};
    } catch(error) {
      observation={desktopPauseState:"UNTRUSTED",desktopPauseEffective:null,
        desktopPauseReason:error?.code==="DESKTOP_PAUSE_STATE_UNTRUSTED"&&typeof error.reason==="string"?error.reason:"OBSERVER_UNAVAILABLE"};
    }
    this.lastPauseObservation=observation;
    return observation;
  }
  /** A menu-only maintenance request. Never revokes ACTIVE workspaces, sessions,
   * controller leases or signed installation. The grant store owns its lock.
   */
  async pruneInactiveRegistrations() {
    const request=this.registrationPruneQueue.then(async()=>{
      let outcome;
      try {
        const status=await this.status();
        if(!this.runtime||!this.config||status.state!=="RUNNING")throw fail("DESKTOP_NOT_RUNNING");
        const prune=this.registrationPruner??(async()=>{
          const {pruneInactiveWorkspaceRegistrations}=await import("../dist/src/local/grants.js");
          return pruneInactiveWorkspaceRegistrations();
        });
        const summary=await prune();
        outcome={registrationPruneStatus:"DONE",registrationPruneSummary:summary};
      } catch(error) {
        outcome={registrationPruneStatus:"FAILED",registrationPruneReason:error?.code==="GRANT_STORE_BUSY"?"GRANT_STORE_BUSY":"REGISTRATION_PRUNE_FAILED"};
      }
      this.registrationPruneAttempt++;
      this.registrationPruneOutcome={registrationPruneAttempt:this.registrationPruneAttempt,...outcome};
      await this.publishStatus();
      return this.registrationPruneOutcome;
    });
    this.registrationPruneQueue=request.then(()=>{},()=>{});
    return request;
  }
  async publishStatus() {
    if (this.statusPublication) return this.statusPublication;
    this.statusPublication = (async () => {
      const status = await this.status();
      const pause = await this.observePause();
      const published = {...status,desktopPaused:this.paused,...pause,...(this.quitOutcome??{}),...(this.registrationPruneOutcome??{}),...(this.pauseRequestOutcome??{})};
      await publish(this.privateFile, this.config.statusPath, Buffer.from(JSON.stringify(published)));
      return published;
    })();
    try { return await this.statusPublication; }
    finally { this.statusPublication = null; }
  }
}

async function main() {
  process.umask(0o077);
  const [action, flag, configPath, ...extra] = process.argv.slice(2);
  if (!['run', 'configure'].includes(action) || flag !== "--desktop-config" || !absolute(configPath) || extra.length) throw fail("DESKTOP_ARGUMENTS_INVALID");
  const privateFile = createMacPrivateFile();
  const config = await metadata(configPath, privateFile);
  if (action === "configure") {
    let input = Buffer.alloc(0);
    for await (const chunk of process.stdin) {
      input = Buffer.concat([input, chunk]);
      if (input.length > 16384) throw fail("CONFIG_INVALID");
    }
    let values;
    try {values = JSON.parse(input.toString("utf8"));} catch {throw fail("CONFIG_INVALID");}
    let identity = null;
    try {identity = (await privateFile.readVerified(config.envPath)).identity;} catch (error) {if (error.code !== "FILE_MISSING") throw error;}
    await saveDesktopConfig({envPath: config.envPath, values, expectedIdentity: identity, privateFile});
    process.stdout.write('{"state":"SAVED"}\n');
    return;
  }
  const adapter = new MacDesktopAdapter({configPath});
  try {
    await adapter.start();
  } catch (error) {
    const reason = ["OWNER_ACTIVE","DESKTOP_PAUSE_STATE_UNSAFE"].includes(error.code) ? error.code : "RUNTIME_UNAVAILABLE";
    await publish(privateFile, config.statusPath, Buffer.from(JSON.stringify({state: "FAILED", connection: "UNKNOWN", reason})));
    process.exitCode = 1;
    return;
  }
  const first = await adapter.status();
  if (first.state === "SETUP_REQUIRED") return;
  let stopAttempt = 0;
  let publishing = false;
  const timer = setInterval(() => {
    if (publishing) return;
    publishing = true;
    void adapter.publishStatus().then(status => {
    if (["STOPPED", "FAILED"].includes(status.state)) clearInterval(timer);
  }).catch(() => {clearInterval(timer); process.exitCode = 1;}).finally(() => {publishing = false;});}, 1000);
  // UI-owned signals affect only admission of NEW MCP mutations. SIGUSR1
  // is deliberately unused because Node reserves it for debugging.
  process.on("SIGUSR2",()=>{void adapter.requestPause(true);});
  process.on("SIGHUP",()=>{void adapter.requestPause(false);});
  // A dedicated menu signal asks the retained adapter to prune only inactive
  // registrations. No arbitrary PID, process kill or active-grant revocation.
  process.on("SIGWINCH",()=>{void adapter.pruneInactiveRegistrations().catch(()=>{});});
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
    void adapter.stopOwned().then(async result => {
      stopAttempt++;
      adapter.quitOutcome = {stopAttempt,stopBlockedReason:result.stopped ? null : (result.reason ?? "STOP_UNCONFIRMED")};
      await adapter.publishStatus();
      if (result.stopped) clearInterval(timer);
    }).catch(async () => {
      stopAttempt++;
      adapter.quitOutcome = {stopAttempt,stopBlockedReason:"STOP_UNCONFIRMED"};
      try {await adapter.publishStatus();} catch {process.exitCode = 1;}
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  process.stderr.write("DESKTOP_OPERATION_FAILED\n"); process.exitCode = 1;
});
