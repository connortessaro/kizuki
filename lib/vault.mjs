import { join } from "node:path";

export const ANALYSIS_START = "<!-- ORGMIND:ANALYSIS:START -->";
export const ANALYSIS_END = "<!-- ORGMIND:ANALYSIS:END -->";
const LOG_HEADING = "## Log";

const DIR_BY_TYPE = { person: "people", project: "projects", team: "teams" };

export function entityDir(type) {
  const dir = DIR_BY_TYPE[type];
  if (!dir) throw new Error(`unknown entity type: ${type}`);
  return dir;
}

export function entityPath(vaultDir, type, name) {
  return join(vaultDir, entityDir(type), `${name}.md`);
}

export function newEntityFile(type, name) {
  const fm =
    type === "person"
      ? `role: ""\nteam: ""\nmanager: ""`
      : type === "project"
        ? `status: ""\nstakeholders: []`
        : `members: []`;
  return `---\ntype: ${type}\nname: ${name}\n${fm}\n---\n\n# ${name}\n\n${LOG_HEADING}\n\n${ANALYSIS_START}\n${ANALYSIS_END}\n`;
}

export function spliceManagedSection(content, block) {
  const replacement = `${ANALYSIS_START}\n${block}\n${ANALYSIS_END}`;
  const s = content.indexOf(ANALYSIS_START);
  const e = content.indexOf(ANALYSIS_END);
  if (s !== -1 && e !== -1 && e > s) {
    return content.slice(0, s) + replacement + content.slice(e + ANALYSIS_END.length);
  }
  const sep = content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}\n${replacement}\n`;
}

export function appendLog(content, entries) {
  if (!entries.length) return content;
  const lines = entries
    .map((e) => `- **${e.source ?? "?"}** ${e.timestamp ?? ""}: ${e.text ?? ""}`.replace(/\s+$/, ""))
    .filter((line) => !content.includes(line));
  if (!lines.length) return content;
  const block = lines.join("\n");

  const idx = content.indexOf(LOG_HEADING);
  if (idx === -1) {
    const sep = content.endsWith("\n") ? "" : "\n";
    return `${content}${sep}\n${LOG_HEADING}\n\n${block}\n`;
  }
  const insertAt = idx + LOG_HEADING.length;
  return content.slice(0, insertAt) + `\n\n${block}` + content.slice(insertAt);
}

export function renderAnalysis(entity, now = new Date()) {
  const a = entity.analysis ?? {};
  const out = [`_Updated ${now.toISOString()}_`, ""];

  if (entity.type === "project") {
    out.push(`**Status:** ${a.status ?? ""}`);
    out.push(`**Blockers:** ${a.blockers ?? a.needs ?? ""}`);
    out.push(`**Open questions:** ${a.openQuestions ?? a.doesntKnow ?? ""}`);
  } else {
    out.push(`**Status:** ${a.status ?? ""}`);
    out.push(`**Needs:** ${a.needs ?? ""}`);
    out.push(`**Doesn't know:** ${a.doesntKnow ?? ""}`);
  }

  const followUps = a.followUps ?? [];
  if (followUps.length) {
    out.push("", "**Follow-ups:**");
    for (const f of followUps) out.push(`- ${f}`);
  }

  const actions = a.recommendedActions ?? [];
  if (actions.length) {
    out.push("", "**Recommended actions:**");
    for (const r of actions) {
      out.push(`- ${r.action ?? ""}`);
      if (r.draft) {
        const indented = String(r.draft).replace(/\n/g, "\n  ");
        out.push("  ```", `  ${indented}`, "  ```");
      }
    }
  }

  return out.join("\n");
}
