import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { render } from "ink";
import { App } from "./App";
import { HELP, homeFor, parseArgs, type Args } from "./args";
import { Study } from "./study";


function version(): string {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

function openFile(path: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [path]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", path]]
        : ["xdg-open", [path]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

/** Starts the terminal app. Exits with 2 for a bad option and 1 for any other start-up problem. */
export async function main(argv: string[]): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`kizuki: ${(error as Error).message}`);
    process.exit(2);
  }
  if (args.help) return console.log(HELP);
  if (args.version) return console.log(version());
  if (!process.stdin.isTTY) {
    console.error(
      "kizuki: run Kizuki in a terminal window. It needs the keyboard.",
    );
    process.exit(1);
  }
  // AI SDK warnings print straight to the terminal and would break the screen.
  globalThis.AI_SDK_LOG_WARNINGS = false;
  const home = homeFor(args);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const quit = { now: () => {} };
  const study = new Study({ home, openFile, onQuit: () => quit.now() });
  const app = render(<App study={study} version={version()} home={home} />, { exitOnCtrlC: false });
  quit.now = () => app.unmount();
  await study.start();
  await app.waitUntilExit();
}
