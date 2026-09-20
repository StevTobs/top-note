// Starts the desktop app against the current dist/ build.
// Some shells (VS Code's, notably) export ELECTRON_RUN_AS_NODE=1, which makes the Electron
// binary behave as plain Node and exit immediately, so it is removed here.
import { spawn } from "node:child_process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ["."], { stdio: "inherit", env }).on("exit", (code) =>
  process.exit(code ?? 0),
);
