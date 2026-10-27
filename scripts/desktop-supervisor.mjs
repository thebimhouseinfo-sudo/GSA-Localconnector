import path from "node:path";
import {parseDesktopEnv} from "./desktop-config.mjs";

const failure = code => Object.assign(new Error(code), {code});
const connectionStates = new Set(["CONNECTED", "DISCONNECTED", "CONNECTING", "AUTH_REJECTED", "UNKNOWN"]);
const absolute = value => typeof value === "string" && path.isAbsolute(value) && !/[\u0000-\u001f\u007f]/.test(value);

/** Own one retained tunnel child. Login/GUI supervision belongs to the adapter. */
export async function startDesktopRuntime({runtimeRoot, envPath, platformAdapter: adapter}) {
  if (!absolute(runtimeRoot) || !absolute(envPath)) throw failure("RUNTIME_PATH_INVALID");
  let state = "STARTING", reason, connection = "UNKNOWN", owner = null, child = null;
  let closed = false, releasing, closing, stopPromise, authenticationRejected = false;
  let logQueue = Promise.resolve(), loggedBytes = 0, logFailed = false;
  const pending = new Map();
  let secret;
  let childExitCode, childSignal;
  let resolveClose;
  const closedEvent = new Promise(resolve => {resolveClose = resolve;});

  async function release() {
    if (!owner) return;
    if (!releasing) releasing = Promise.resolve().then(() => adapter.releaseOwner(owner)).catch(() => {
      state = "FAILED"; reason = "OWNER_RELEASE_FAILED";
    });
    await releasing;
  }

  async function stopChild() {
    if (closed) {await closing; return {stopped: true};}
    if (!child) return {stopped: state === "STOPPED" || state === "SETUP_REQUIRED"};
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      let work;
      try {work = await adapter.ownedWorkState(owner);} catch {work = "UNKNOWN";}
      if (work !== "IDLE") return {stopped: false, reason: work === "ACTIVE" ? "ACTIVE_WORK_PRESENT" : "ACTIVE_WORK_UNKNOWN"};
      let signalled;
      try {signalled = child.kill("SIGTERM");} catch {signalled = false;}
      if (!signalled) return {stopped: false, reason: "STOP_UNCONFIRMED"};
      let timer;
      const confirmed = await Promise.race([
        closedEvent.then(() => true),
        new Promise(resolve => {timer = setTimeout(() => resolve(false), 1000);})
      ]);
      clearTimeout(timer);
      if (!confirmed) return {stopped: false, reason: "STOP_UNCONFIRMED"};
      await closing;
      return {stopped: true};
    })();
    try {return await stopPromise;} finally {stopPromise = null;}
  }

  function enqueue(bytes) {
    if (logFailed || loggedBytes >= 65536 || bytes.length === 0) return;
    const part = Buffer.from(bytes.subarray(0, 65536 - loggedBytes));
    loggedBytes += part.length;
    logQueue = logQueue.then(() => adapter.writeLog(part)).catch(() => {
      logFailed = true;
      state = "FAILED"; reason = "LOG_FAILED";
      // Ownership stays held if retained work makes stopping unsafe.
      void stopChild();
    });
  }

  function redact(bytes) {
    const pieces = [];
    let offset = 0, match;
    while ((match = bytes.indexOf(secret, offset)) !== -1) {
      pieces.push(bytes.subarray(offset, match), Buffer.from("[REDACTED]"));
      offset = match + secret.length;
    }
    pieces.push(bytes.subarray(offset));
    return Buffer.concat(pieces);
  }

  function log(stream, chunk, final = false) {
    if (logFailed || loggedBytes >= 65536) {pending.delete(stream); return;}
    const bytes = redact(Buffer.concat([pending.get(stream) ?? Buffer.alloc(0), Buffer.from(chunk)]));
    const keep = final ? 0 : Math.min(secret.length - 1, bytes.length);
    const cut = bytes.length - keep;
    enqueue(bytes.subarray(0, cut));
    pending.set(stream, Buffer.from(bytes.subarray(cut)));
  }

  function onClose(code, signal) {
    if (closed) return;
    closed = true;
    childExitCode = Number.isInteger(code) ? code : null;
    childSignal = ['SIGTERM','SIGINT','SIGKILL','SIGABRT','SIGSEGV','SIGPIPE','SIGHUP'].includes(signal) ? signal : null;
    for (const stream of pending.keys()) log(stream, Buffer.alloc(0), true);
    if (state !== "FAILED" && !authenticationRejected) {
      state = stopPromise ? "STOPPED" : "FAILED";
      if (state === "FAILED") reason = "CHILD_EXITED";
    }
    closing = (async () => {await logQueue; await release();})();
    resolveClose();
  }

  const runtime = {
    async status() {
      if (child && !closed && !authenticationRejected) {
        try {
          const observed = await adapter.connectionStatus(owner);
          connection = connectionStates.has(observed) ? observed : "UNKNOWN";
        } catch {connection = "UNKNOWN";}
        if (connection === "AUTH_REJECTED") {
          authenticationRejected = true;
          state = "SETUP_REQUIRED"; reason = "AUTH_REJECTED";
          await stopChild();
        }
      }
      if (closed) await closing;
      return {installationId: owner?.installationId ?? null, sessionId: owner?.sessionId ?? null,
        state, connection, ...(reason ? {reason} : {}), ...(closed ? {childExitCode,childSignal} : {})};
    },
    stopOwned: stopChild
  };

  let setup;
  try {setup = await adapter.loadSetup({envPath});} catch {
    state = "SETUP_REQUIRED"; reason = "CONFIG_UNAVAILABLE"; return runtime;
  }
  if (setup?.state !== "READY") {
    state = "SETUP_REQUIRED"; reason = "CONFIG_REQUIRED"; return runtime;
  }
  let values;
  try {
    values = parseDesktopEnv(`GSA_LC_TUNNEL_ID=${setup.values.tunnelId}\nCONTROL_PLANE_API_KEY=${setup.values.apiKey}\n`);
  } catch {state = "SETUP_REQUIRED"; reason = "CONFIG_INVALID"; return runtime;}
  secret = Buffer.from(values.apiKey);
  try {owner = await adapter.acquireOwner({runtimeRoot});} catch (error) {
    throw failure(error?.code === "OWNER_ACTIVE" ? "OWNER_ACTIVE" : "OWNER_UNAVAILABLE");
  }
  try {
    if (typeof owner?.installationId !== "string" || typeof owner.sessionId !== "string" ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(owner.installationId) || !/^[a-zA-Z0-9-]{1,128}$/.test(owner.sessionId)) throw failure("OWNER_INVALID");
    if (!["--config", "--profile-file"].includes(adapter.runFlag)) throw failure("CLIENT_FLAG_UNSUPPORTED");
    const profile = await adapter.prepareProfile({runtimeRoot, tunnelId: values.tunnelId});
    const command = adapter.tunnelClient();
    if (!absolute(profile?.path) || !absolute(command)) throw failure("RUNTIME_PATH_INVALID");
    const env = {};
    for (const name of ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL"]) {
      const value = adapter.baseEnvironment?.[name];
      if (typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(value)) env[name] = value;
    }
    env.CONTROL_PLANE_API_KEY = values.apiKey;
    // The raw tunnel is not a trusted worker: never transplant the CLI's FD3.
    // The installed stdio CLI keeps its existing Python/kernel owner fence.
    child = await adapter.spawn(command, ["run", adapter.runFlag, profile.path], {env, stdio: ["ignore", "pipe", "pipe"]});
    if (!child || typeof child.on !== "function" || typeof child.kill !== "function") throw failure("CHILD_INVALID");
    child.on("close", onClose);
    child.on("error", () => {state = "FAILED"; reason = "CHILD_FAILED";});
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) {
        stream.on("data", chunk => log(stream, chunk));
        stream.on("error", () => {state = "FAILED"; reason = "LOG_FAILED"; void stopChild();});
      }
    }
    state = "RUNNING";
    if (child.exitCode !== null && child.exitCode !== undefined) onClose(child.exitCode);
    return runtime;
  } catch {
    if (!child) await release();
    throw failure("RUNTIME_START_FAILED");
  }
}
