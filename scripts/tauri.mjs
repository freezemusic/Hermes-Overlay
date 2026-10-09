import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/** `tauri dev` merges the dev identifier so it cannot overwrite an installed config. */
export function withDevConfig(args) {
  const next = [...args];
  if (next[0] === "dev" && !next.includes("--config") && !next.includes("-c")) {
    next.splice(1, 0, "--config", "src-tauri/tauri.dev.conf.json");
  }
  return next;
}

function run() {
  const args = withDevConfig(process.argv.slice(2));
  const cli = require.resolve("@tauri-apps/cli/tauri.js");
  const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) run();
