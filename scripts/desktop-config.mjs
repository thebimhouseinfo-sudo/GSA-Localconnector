import path from "node:path";

const MAX_BYTES = 16384;
const reasons = new Set(["FILE_MISSING", "FILE_UNSAFE", "FILE_BUSY", "FILE_STALE", "FILE_TOO_LARGE", "PRIVATE_FILE_UNAVAILABLE"]);
const failure = code => Object.assign(new Error(code), {code});
const setupRequired = reason => ({state: "SETUP_REQUIRED", reason});

function validateValues(values) {
  if (!values || typeof values !== "object" ||
      Object.keys(values).sort().join(",") !== "apiKey,tunnelId" ||
      typeof values.tunnelId !== "string" || !/^tunnel_[a-fA-F0-9]{32}$/.test(values.tunnelId) ||
      typeof values.apiKey !== "string" || values.apiKey.length === 0 ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(values.apiKey)) throw failure("CONFIG_INVALID");
  return {tunnelId: values.tunnelId, apiKey: values.apiKey};
}

export function parseDesktopEnv(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BYTES) throw failure("CONFIG_INVALID");
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    const name = line.slice(0, separator);
    if (separator < 0 || !["GSA_LC_TUNNEL_ID", "CONTROL_PLANE_API_KEY"].includes(name) || entries.has(name)) {
      throw failure("CONFIG_INVALID");
    }
    entries.set(name, line.slice(separator + 1));
  }
  return validateValues({tunnelId: entries.get("GSA_LC_TUNNEL_ID"), apiKey: entries.get("CONTROL_PLANE_API_KEY")});
}

function validateAdapter(envPath, privateFile) {
  if (typeof envPath !== "string" || !path.isAbsolute(envPath) || /[\u0000-\u001f\u007f]/.test(envPath)) throw failure("CONFIG_PATH_INVALID");
  if (!privateFile || typeof privateFile.readVerified !== "function" || typeof privateFile.replaceVerified !== "function") {
    throw failure("PRIVATE_FILE_UNAVAILABLE");
  }
}

async function inspectSetup({envPath, privateFile}) {
  let identity = null;
  try {
    validateAdapter(envPath, privateFile);
    const read = await privateFile.readVerified(envPath);
    if (typeof read.identity !== "string" || !read.identity || !Buffer.isBuffer(read.bytes)) throw failure("FILE_UNSAFE");
    identity = read.identity;
    const text = new TextDecoder("utf-8", {fatal: true}).decode(read.bytes);
    return {result: {state: "READY", values: parseDesktopEnv(text), identity}, identity};
  } catch (error) {
    const reason = identity !== null ? "CONFIG_INVALID"
      : reasons.has(error?.code) || error?.code === "CONFIG_PATH_INVALID" ? error.code : "FILE_UNSAFE";
    return {result: setupRequired(reason), identity};
  }
}

export async function loadDesktopConfig(options) {
  return (await inspectSetup(options)).result;
}

export async function saveDesktopConfig({envPath, values, expectedIdentity, privateFile}) {
  validateAdapter(envPath, privateFile);
  const validated = validateValues(values);
  const bytes = Buffer.from(`GSA_LC_TUNNEL_ID=${validated.tunnelId}\nCONTROL_PLANE_API_KEY=${validated.apiKey}\n`);
  if (bytes.length > MAX_BYTES) throw failure("CONFIG_INVALID");
  if (expectedIdentity !== null && (typeof expectedIdentity !== "string" || !expectedIdentity)) throw failure("FILE_STALE");
  try {
    return await privateFile.replaceVerified(envPath, bytes, expectedIdentity);
  } catch (error) {
    throw failure(reasons.has(error?.code) ? error.code : "FILE_UNSAFE");
  }
}

export async function resolveDesktopSetup({envPath, privateFile, promptOnce, setupRequested = false}) {
  const inspected = await inspectSetup({envPath, privateFile});
  if (inspected.result.state === "READY" || setupRequested !== true || typeof promptOnce !== "function" ||
      !["FILE_MISSING", "CONFIG_INVALID"].includes(inspected.result.reason)) return inspected.result;
  try {
    const values = await promptOnce();
    await saveDesktopConfig({envPath, privateFile, values, expectedIdentity: inspected.identity});
    return await loadDesktopConfig({envPath, privateFile});
  } catch (error) {
    return setupRequired(reasons.has(error?.code) || error?.code === "CONFIG_INVALID" ? error.code : "SETUP_FAILED");
  }
}
