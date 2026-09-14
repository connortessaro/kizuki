import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { buildActivityEvent } from "./activityEvents.mjs";
import { appendActivityEvents } from "./activityStore.mjs";

const execFileAsync = promisify(execFile);

const RECORD_SEP = String.fromCharCode(0);
const FIELD_SEP = String.fromCharCode(31);
const FORMAT = "%x00%H%x1f%aI%x1f%cI%x1f%an%x1f%ae%x1f%P%x1f%s";

const MAX_BUFFER = 1 << 28;

function toUtcIso(value, label) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(label + " is not a parsable date: " + JSON.stringify(value));
  }
  return new Date(parsed).toISOString();
}

function splitOnce(value, needle) {
  const at = value.indexOf(needle);
  return at === -1 ? null : [value.slice(0, at), value.slice(at + needle.length)];
}

const normalizeSlashes = (path) => path.replace(/\/{2,}/g, "/");

export function parseNumstatPath(raw) {
  const brace = raw.match(/^(.*)\{(.*?) => (.*?)\}(.*)$/);
  if (brace) {
    const [, prefix, from, to, suffix] = brace;
    return {
      path: normalizeSlashes(prefix + to + suffix),
      renamedFrom: normalizeSlashes(prefix + from + suffix),
    };
  }
  const plain = splitOnce(raw, " => ");
  if (plain) return { path: plain[1], renamedFrom: plain[0] };
  return { path: raw, renamedFrom: null };
}

function parseNumstatLine(line) {
  const parts = line.split("\t");
  if (parts.length < 3) throw new Error("malformed numstat line: " + JSON.stringify(line));
  const [insertions, deletions] = parts;
  const raw = parts.slice(2).join("\t");
  const { path, renamedFrom } = parseNumstatPath(raw);
  const binary = insertions === "-" && deletions === "-";
  return {
    path,
    insertions: binary ? null : Number.parseInt(insertions, 10),
    deletions: binary ? null : Number.parseInt(deletions, 10),
    binary,
    renamedFrom,
  };
}

export function parseGitLog(stdout, repo) {
  const commits = [];
  for (const record of stdout.split(RECORD_SEP)) {
    if (record.trim() === "") continue;
    const newline = record.indexOf("\n");
    const header = newline === -1 ? record : record.slice(0, newline);
    const body = newline === -1 ? "" : record.slice(newline + 1);
    const fields = header.split(FIELD_SEP);
    if (fields.length !== 7) {
      throw new Error("malformed git log header in " + repo + ": " + JSON.stringify(header));
    }
    const [sha, authoredAt, committedAt, authorName, authorEmail, parents, subject] = fields;
    const files = [];
    const seen = new Set();
    for (const line of body.split("\n")) {
      if (line.trim() === "") continue;
      const file = parseNumstatLine(line);
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }
    commits.push({
      repo,
      sha,
      authoredAt: toUtcIso(authoredAt, "authored date"),
      committedAt: toUtcIso(committedAt, "commit date"),
      authorName: authorName === "" ? "(unknown)" : authorName,
      authorEmail: authorEmail === "" ? "(unknown)" : authorEmail,
      subject,
      parents: parents === "" ? 0 : parents.split(" ").filter(Boolean).length,
      files,
    });
  }
  return commits;
}

const DEFAULT_REF_CANDIDATES = ["refs/remotes/origin/HEAD", "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master", "HEAD"];

export async function resolveDefaultRef(dir, exec) {
  for (const ref of DEFAULT_REF_CANDIDATES) {
    try {
      const { stdout } = await exec("git", ["-C", dir, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8" });
      if (stdout.trim() !== "") return ref;
    } catch {
      continue;
    }
  }
  return null;
}

async function defaultBranchShas(dir, exec, ref) {
  if (ref === null) return new Set();
  const { stdout } = await exec("git", ["-C", dir, "rev-list", ref], { maxBuffer: MAX_BUFFER, encoding: "utf8" });
  return new Set(stdout.split("\n").filter(Boolean));
}

export async function readRepoCommits(repoPath, { exec = execFileAsync, refScope = "all" } = {}) {
  const dir = resolve(repoPath);
  const repo = basename(dir);
  const defaultRef = await resolveDefaultRef(dir, exec);
  const args = ["-C", dir, "log", "--numstat", "--format=" + FORMAT];
  args.push(refScope === "default" ? (defaultRef ?? "HEAD") : "--all");
  const { stdout } = await exec("git", args, { maxBuffer: MAX_BUFFER, encoding: "utf8" });
  const onDefault = await defaultBranchShas(dir, exec, defaultRef);
  const commits = parseGitLog(stdout, repo).map((commit) => ({
    ...commit,
    onDefaultBranch: onDefault.has(commit.sha),
  }));
  return { repo, defaultRef, commits };
}

export async function ingestRepo(repoPath, vaultDir, options = {}) {
  const { repo, defaultRef, commits } = await readRepoCommits(repoPath, options);
  const onDefault = commits.filter((commit) => commit.onDefaultBranch).length;
  const events = commits.map((commit) => buildActivityEvent(commit));
  const result = await appendActivityEvents(vaultDir, events, options);
  return { repo, defaultRef, scanned: commits.length, onDefault, ...result };
}

const USAGE = "usage: kizuki ingest git <repo-path>... [--ref-scope all|default]";

export async function runIngestCommand(argv, vaultDir, options = {}) {
  const [kind, ...rest] = argv;
  if (kind !== "git") throw new Error(USAGE);
  const at = rest.indexOf("--ref-scope");
  const refScope = at === -1 ? "all" : rest[at + 1];
  if (refScope !== "all" && refScope !== "default") throw new Error(USAGE);
  const valueIndex = at === -1 ? -1 : at + 1;
  const paths = rest.filter((arg, index) => !arg.startsWith("--") && index !== valueIndex);
  if (paths.length === 0) throw new Error(USAGE);
  const results = [];
  for (const path of paths) {
    results.push(await ingestRepo(path, vaultDir, { ...options, refScope }));
  }
  return results;
}

export function formatIngestResults(results) {
  const lines = results.map(
    (r) =>
      r.repo + ": scanned " + r.scanned + " (" + r.onDefault + " on " + (r.defaultRef ?? "no default ref") +
      "), appended " + r.appended + ", already present " + r.skipped,
  );
  const appended = results.reduce((sum, r) => sum + r.appended, 0);
  lines.push("total appended " + appended + " across " + results.length + " repo(s)");
  return lines.join("\n");
}
