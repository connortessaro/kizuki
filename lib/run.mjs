// lib/run.mjs
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "./args.mjs";
import { buildPrompt } from "./prompt.mjs";
import { parsePayload } from "./payload.mjs";
import { applyPayload } from "./apply.mjs";
import { notifyAlerts } from "./notify.mjs";
import { activeInsightsForScope, formatInsightContext } from "./insightContext.mjs";

const TRANSCRIPT_INLINE_CAP = 200_000;

async function inlineTranscripts(vaultDir) {
  const dir = join(vaultDir, "transcripts");
  let names;
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
  let total = 0;
  const parts = [];
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8");
    total += text.length;
    if (total > TRANSCRIPT_INLINE_CAP) {
      throw new Error(`transcripts exceed ${TRANSCRIPT_INLINE_CAP} chars — archive some or use a CLI agent`);
    }
    parts.push(`--- TRANSCRIPT: ${name} ---\n${text}`);
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

export async function runSync({ argv, vaultDir, runAgent, notify = notifyAlerts, agentKind = "cmd" }) {
  const { scope, sources, dryRun } = parseArgs(argv);
  if (agentKind === "http") {
    const unavailable = sources.filter((s) => s !== "transcript");
    if (unavailable.length) {
      throw new Error(
        `http agent supports transcript-only sync — run with --source transcript (unavailable: ${unavailable.join(",")})`,
      );
    }
  }
  const insightContext = formatInsightContext(
    await activeInsightsForScope(vaultDir, scope),
  );
  let prompt = buildPrompt({ scope, sources, vaultDir, insightContext });
  if (agentKind === "http") prompt += await inlineTranscripts(vaultDir);
  const stdout = await runAgent(prompt);
  const payload = parsePayload(stdout);
  const applied = await applyPayload(vaultDir, payload, { dryRun });
  if (!dryRun) await notify(applied.newAlerts);
  return { scope, sources, dryRun, ...applied };
}
