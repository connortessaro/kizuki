#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { upsertAnalysis, readEntity, listEntities, listFollowups, search } from "./tools.mjs";

const vaultDir = process.env.ORGMIND_VAULT || resolve(dirname(fileURLToPath(import.meta.url)), "..");

const text = (t) => ({ content: [{ type: "text", text: t }] });
const guard = (fn) => async (args) => {
  try {
    return text(await fn(args));
  } catch (e) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
};

const typeEnum = z.enum(["person", "project", "team"]);
const analysisSchema = z
  .object({
    status: z.string().optional(),
    needs: z.string().optional(),
    doesntKnow: z.string().optional(),
    blockers: z.string().optional(),
    openQuestions: z.string().optional(),
    followUps: z.array(z.string()).optional(),
    recommendedActions: z.array(z.object({ action: z.string(), draft: z.string().optional() })).optional(),
  })
  .passthrough();
const rawEntrySchema = z.object({ source: z.string(), timestamp: z.string().optional(), text: z.string() });

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const server = new McpServer({ name: "orgmind", version: "1.0.0" });

server.registerTool(
  "list_entities",
  {
    title: "List entities",
    description: "List people, projects, and teams in the vault, each with its one-line status. Use to discover what exists before reading a specific entity.",
    inputSchema: { type: typeEnum.optional() },
    annotations: readOnly,
  },
  guard(({ type }) => listEntities(vaultDir, type)),
);

server.registerTool(
  "read_entity",
  {
    title: "Read entity",
    description: "Read the full markdown file for one person, project, or team (log + managed analysis + any hand-notes).",
    inputSchema: { type: typeEnum, name: z.string() },
    annotations: readOnly,
  },
  guard(({ type, name }) => readEntity(vaultDir, type, name)),
);

server.registerTool(
  "list_followups",
  {
    title: "List follow-ups",
    description: "Aggregate every open follow-up and recommended action across the whole vault. The 'what do I need to do' view.",
    inputSchema: {},
    annotations: readOnly,
  },
  guard(() => listFollowups(vaultDir)),
);

server.registerTool(
  "search",
  {
    title: "Search vault",
    description: "Case-insensitive substring search across all entity files. Returns matching lines with their entity and line number.",
    inputSchema: { query: z.string() },
    annotations: readOnly,
  },
  guard(({ query }) => search(vaultDir, query)),
);

server.registerTool(
  "upsert_analysis",
  {
    title: "Upsert analysis",
    description:
      "Persist analysis for one entity. Creates the file if missing, appends de-duplicated raw log entries, and rewrites ONLY the managed analysis section — hand-written notes outside the markers are never touched. Idempotent: re-running with the same input is a no-op.",
    inputSchema: {
      type: typeEnum,
      name: z.string().describe("kebab-case entity name; no slashes or '..'"),
      analysis: analysisSchema,
      rawEntries: z.array(rawEntrySchema).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  guard(({ type, name, analysis, rawEntries }) => upsertAnalysis(vaultDir, { type, name, analysis, rawEntries })),
);

await server.connect(new StdioServerTransport());
