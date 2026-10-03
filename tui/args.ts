import { kizukiHome } from "../lib/paths";

/** The options `kizuki` takes. */
export interface Args {
  /** The data folder from `--home`, if given. */
  home?: string;
  /** True for `--help`. */
  help: boolean;
  /** True for `--version`. */
  version: boolean;
}

/** The text `kizuki --help` prints. */
export const HELP = `Kizuki: a study tool that runs in your terminal.

Usage: kizuki [--home <folder>]

  --home     the folder for your data (default ~/.kizuki, or KIZUKI_HOME)
  --version  print the version
  --help     print this

Kizuki uses Ollama by default, with two models:
  ollama pull qwen3.5:2b
  ollama pull nomic-embed-text

Inside Kizuki, type /help for commands, or /model gateway for bigger hosted models.`;

/** Reads `kizuki` options. An unknown option is an error, so typos are caught. */
export function parseArgs(argv: string[]): Args {
  const out: Args = { help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--version" || arg === "-v") out.version = true;
    else if (arg === "--home") {
      const home = argv[(i += 1)];
      if (!home) throw new Error("--home needs a folder");
      out.home = home;
    } else throw new Error(`unknown option ${arg}. Run kizuki --help`);
  }
  return out;
}

/** The data folder: `--home`, then `KIZUKI_HOME`, then `~/.kizuki`, with `~` expanded. */
export function homeFor(
  args: Args,
  env: Record<string, string | undefined> = process.env,
): string {
  return kizukiHome(args.home ? { ...env, KIZUKI_HOME: args.home } : env);
}
