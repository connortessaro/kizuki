export const VALID_SOURCES = ["slack", "github", "atlassian", "outlook"];

export function parseArgs(argv) {
  const sources = [];
  let personName = null;
  let projectName = null;
  let teamName = null;
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
    } else if (a === "--project") {
      const v = argv[++i];
      if (!v) throw new Error("--project requires a value");
      if (projectName) throw new Error("only one --project can be specified");
      projectName = v;
    } else if (a === "--team") {
      const v = argv[++i];
      if (!v) throw new Error("--team requires a value");
      if (teamName) throw new Error("only one --team can be specified");
      teamName = v;
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      if (personName) throw new Error("only one person can be specified");
      personName = a;
    }
  }

  const scopes = [
    personName ? "person" : null,
    projectName ? "project" : null,
    teamName ? "team" : null,
  ].filter(Boolean);
  if (scopes.length > 1) throw new Error("specify only one of: person, --project, --team");

  let scope = { kind: "all" };
  if (personName) scope = { kind: "person", name: personName };
  else if (projectName) scope = { kind: "project", name: projectName };
  else if (teamName) scope = { kind: "team", name: teamName };

  return {
    scope,
    sources: sources.length ? [...new Set(sources)] : [...VALID_SOURCES],
    dryRun,
  };
}
