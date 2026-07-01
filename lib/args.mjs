export const VALID_SOURCES = ["slack", "github", "atlassian", "outlook"];

export function parseArgs(argv) {
  const sources = [];
  let personName = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") {
      const v = argv[++i];
      if (!v) throw new Error("--source requires a value");
      for (const raw of v.split(",")) {
        const src = raw.trim();
        if (!VALID_SOURCES.includes(src)) throw new Error(`unknown source: ${src}`);
        sources.push(src);
      }
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      if (personName) throw new Error("only one person can be specified");
      personName = a;
    }
  }

  return {
    scope: personName ? { kind: "person", name: personName } : { kind: "all" },
    sources: sources.length ? [...new Set(sources)] : [...VALID_SOURCES],
    dryRun,
  };
}
