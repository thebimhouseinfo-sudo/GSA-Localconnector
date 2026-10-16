import { createHostAdapter } from "./hosts/index.js";
/** Bootstrap only: no privileged shell, CI, or MCP exposure before security phase. */
export function connectorStatus() {
  const adapter = createHostAdapter();
  return { name: "gsa-localconnector", apiVersion: 1, capabilities: adapter.capabilities, readyForShell: false } as const;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stdout.write(JSON.stringify(connectorStatus()) + "\n");
}
