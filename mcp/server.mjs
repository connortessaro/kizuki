#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  archiveInsightTool,
  captureContextTool,
  captureInsightTool,
  listEntities,
  listFollowups,
  listInsightsTool,
  readEntity,
  readInsightTool,
  search,
  upsertAnalysis,
} from "./tools.mjs";
import { CAPTURE_KINDS } from "../lib/platformEvents.mjs";

const text = (value) => ({ content: [{ type: "text", text: value }] });
const guard = (fn) => async (args) => {
  try {
    return text(await fn(args));
  } catch (error) {
    return {
      content: [{ type: "text", text: "Error: " + error.message }],
      isError: true,
    };
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
    recommendedActions: z.array(z.object({
      action: z.string(),
      draft: z.string().optional(),
    })).optional(),
  })
  .passthrough();
const rawEntrySchema = z.object({
  source: z.string(),
  timestamp: z.string().optional(),
  text: z.string(),
});
const insightKindEnum = z.enum([
  "decision",
  "learning",
  "hypothesis",
  "question",
]);
const insightStatusEnum = z.enum(["active", "archived", "all"]);
const insightEntitySchema = z.object({
  type: typeEnum,
  name: z.string(),
}).strict();
const insightOriginSchema = z.object({
  client: z.enum(["codex", "cursor", "other"]),
  locator: z.string().nullable().optional(),
}).strict();
const captureInsightSchema = z.object({
  kind: insightKindEnum,
  summary: z.string(),
  context: z.string().nullable().optional(),
  entities: z.array(insightEntitySchema).optional(),
  origin: insightOriginSchema,
}).strict();
const listInsightsSchema = z.object({
  status: insightStatusEnum.optional(),
}).strict();
const readInsightSchema = z.object({
  insightId: z.string().regex(/^ins_[0-9a-f]{12}$/),
}).strict();
const archiveInsightSchema = z.object({
  insightId: z.string().regex(/^ins_[0-9a-f]{12}$/),
  note: z.string().nullable().optional(),
}).strict();
const captureKindEnum = z.enum([...CAPTURE_KINDS]);
const captureContextSchema = z.object({
  kind: captureKindEnum,
  text: z.string(),
  entity: z.object({ type: typeEnum, name: z.string() }).strict().optional(),
}).strict();

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const packageVersion = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
).version;

export function createKizukiServer(vaultDir) {
  const server = new McpServer({ name: "kizuki", version: packageVersion });

  server.registerTool(
    "list_entities",
    {
      title: "List entities",
      description:
        "List people, projects, and teams in the vault, each with its one-line status. Use to discover what exists before reading a specific entity.",
      inputSchema: { type: typeEnum.optional() },
      annotations: readOnly,
    },
    guard(({ type }) => listEntities(vaultDir, type)),
  );

  server.registerTool(
    "read_entity",
    {
      title: "Read entity",
      description:
        "Read the full markdown file for one person, project, or team (log + managed analysis + any hand-notes).",
      inputSchema: { type: typeEnum, name: z.string() },
      annotations: readOnly,
    },
    guard(({ type, name }) => readEntity(vaultDir, type, name)),
  );

  server.registerTool(
    "list_followups",
    {
      title: "List follow-ups",
      description:
        "Aggregate every open follow-up and recommended action across the whole vault. The 'what do I need to do' view.",
      inputSchema: {},
      annotations: readOnly,
    },
    guard(() => listFollowups(vaultDir)),
  );

  server.registerTool(
    "search",
    {
      title: "Search vault",
      description:
        "Case-insensitive substring search across entity files and active captured insights.",
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
        "Persist analysis for one entity. Creates the file if missing, appends de-duplicated raw log entries, and rewrites ONLY the managed analysis section. Hand-written notes outside the markers are never touched. Idempotent: re-running with the same input is a no-op.",
      inputSchema: {
        type: typeEnum,
        name: z.string().describe("kebab-case entity name; no slashes or '..'"),
        analysis: analysisSchema,
        rawEntries: z.array(rawEntrySchema).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard(({ type, name, analysis, rawEntries }) =>
      upsertAnalysis(vaultDir, { type, name, analysis, rawEntries })),
  );

  server.registerTool(
    "capture_insight",
    {
      title: "Capture insight",
      description:
        "Call when the user says 'Kizuki this' or explicitly asks to save a thought. Distill only the durable decision, learning, hypothesis, or question. Never copy the full conversation or raw tool output.",
      inputSchema: captureInsightSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard((input) => captureInsightTool(vaultDir, input)),
  );

  server.registerTool(
    "capture_context",
    {
      title: "Capture context",
      description:
        "Capture one durable note, correction, decision, hypothesis, or question into the platform through the authenticated local daemon. Kizuki only records it — it never sends messages or acts. Distill a single thought; never paste the full conversation or raw tool output.",
      inputSchema: captureContextSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard((input) => captureContextTool(vaultDir, input)),
  );

  server.registerTool(
    "list_insights",
    {
      title: "List insights",
      description: "List captured insights. Defaults to active items, newest first.",
      inputSchema: listInsightsSchema,
      annotations: readOnly,
    },
    guard((input) => listInsightsTool(vaultDir, input)),
  );

  server.registerTool(
    "read_insight",
    {
      title: "Read insight",
      description: "Read one captured insight with its full event history.",
      inputSchema: readInsightSchema,
      annotations: readOnly,
    },
    guard((input) => readInsightTool(vaultDir, input)),
  );

  server.registerTool(
    "archive_insight",
    {
      title: "Archive insight",
      description: "Archive one active insight. Archival is terminal in this version.",
      inputSchema: archiveInsightSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guard((input) => archiveInsightTool(vaultDir, input)),
  );

  return server;
}

export function isDirectExecution(argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1])) {
  const vaultDir =
    process.env.KIZUKI_VAULT ||
    resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const server = createKizukiServer(vaultDir);
  await server.connect(new StdioServerTransport());
}
