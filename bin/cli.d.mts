/** A model address and name, as in settings.json. */
export interface ModelTarget {
  /** The server's address, such as `http://localhost:11434/v1`. Must be http or https. */
  baseURL: string;
  /** The model's name on that server, such as `nomic-embed-text`. */
  model: string;
  /** The name of the environment variable that holds the API key, ending in `_API_KEY`. `undefined` means no key is sent. */
  apiKeyEnv?: string;
}

/** The defaults Kizuki ships with. */
export declare const DEFAULT_MODELS: { chat: ModelTarget; embed: ModelTarget };

/** The options of `kizuki`. */
export interface CliOptions {
  /** The port the dashboard runs on at 127.0.0.1, from `--port`. 3700 by default. */
  port: number;
  /** The data folder from `--home`. `undefined` means use `KIZUKI_HOME` or `~/.kizuki`. */
  home: string | undefined;
  /** Whether to open the dashboard in the browser. `--no-open` turns it off. */
  open: boolean;
  /** True with `--help` or `-h`: print the help and stop. */
  help: boolean;
}

/** Reads `kizuki` options. Unknown options are an error. */
export declare function parseArgs(argv: string[]): CliOptions;

/** The data folder: --home, then KIZUKI_HOME, then ~/.kizuki. */
export declare function resolveHome(flag: string | undefined, env?: Record<string, string | undefined>): string;

/** Checks that the model servers answer and the models are installed. Returns fix-it messages. */
export declare function checkModels(
  settings: { chat: ModelTarget; embed: ModelTarget },
  env?: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<string[]>;

/** The command that opens a web address in the default browser. */
export declare function openCommand(url: string, platform?: string): [string, string[]];

/** Records the build's native-module links in .next/kizuki-links.json. */
export declare function recordLinks(root: string): { name: string; package: string }[];

/** Recreates the recorded links, pointing at each package's installed folder. Returns the links it made. */
export declare function restoreLinks(root: string, locate: (pkg: string) => string): string[];

/** The folder a package is installed in, as Node would find it from `from`. */
export declare function packageDir(pkg: string, from: string): string;

/** Reads settings.json, or the defaults if there is none. A broken file names itself and says how to fix it. */
export declare function readSettingsFile(path: string): { chat: ModelTarget; embed: ModelTarget };

/** Waits until the dashboard answers. True if it did, false if it gave up. */
export declare function waitForServer(url: string, options?: { tries?: number; everyMs?: number; fetchImpl?: typeof fetch }): Promise<boolean>;
