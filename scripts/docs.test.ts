import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSpec, commentSummary, discoverActions, discoverRoutes, findAll, openapiText, routePath, scanHeaders, specText } from "./docs";

/** A small project with one of everything the docs tool reads, all documented. */
const PROJECT: Record<string, string> = {
  "package.json": `{ "version": "1.2.3" }`,
  "proxy.ts": `
/**
 * Refuses other hosts.
 * @openapi
 * components:
 *   parameters:
 *     Host:
 *       name: Host
 *       in: header
 *       required: true
 *       description: Must name this computer.
 *       schema: { type: string }
 *       x-on-every-request: true
 *   responses:
 *     NotThisComputer:
 *       description: Another host.
 *       x-status: 403
 *       x-on-every-request: true
 * GET /_next/static/{path}:
 *   summary: Built files
 *   x-framework: true
 *   x-skips-host-check: true
 *   parameters:
 *     - { name: path, in: path, required: true, schema: { type: string } }
 *   responses:
 *     "200": { description: A file. }
 */
export function proxy(request: Request) {
  return request.headers.get("host");
}
/** Matcher. */
export const config = { matcher: ["/((?!_next/static).*)"] };
`,
  "next.config.ts": `
const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },
};
/**
 * The config.
 * @openapi
 * info:
 *   title: Test API
 *   description: A test.
 * tags:
 *   - { name: Pages, description: Pages. }
 *   - { name: Files, description: Files. }
 *   - { name: Static files, description: Static. }
 *   - { name: Form actions, description: Forms. }
 * components:
 *   headers:
 *     X-Frame-Options:
 *       description: No frames.
 *       schema: { type: string }
 *       x-on-every-response: true
 * GET /logo.svg:
 *   summary: The logo
 *   responses:
 *     "200": { description: The picture. }
 */
export default nextConfig;
`,
  "app/page.tsx": `
import { saveAction } from "./actions";
/**
 * The home page.
 * @openapi
 * GET /:
 *   summary: Home
 *   responses:
 *     "200": { description: The page. }
 */
export default function Home() {
  return <form action={saveAction}><input name="name" /></form>;
}
`,
  "app/files/[id]/route.ts": `
/**
 * Serves a file.
 * @openapi
 * GET /files/{id}:
 *   summary: A file
 *   parameters:
 *     - { name: id, in: path, required: true, schema: { type: string } }
 *   responses:
 *     "200":
 *       description: The bytes.
 *       headers:
 *         content-type: { description: The type., schema: { type: string } }
 */
export async function GET() {
  return new Response("x", { headers: { "content-type": "text/plain" } });
}
`,
  "app/actions.ts": `"use server";
const text = (form: FormData, key: string) => String(form.get(key) ?? "");
/**
 * Runs an action.
 * @openapi
 * actions:
 *   summary: Form actions
 *   parameters:
 *     - { name: Next-Action, in: header, required: true, schema: { type: string } }
 *   responses:
 *     "200": { description: Done. }
 */
async function attempt(fn: () => Promise<void>) {
  await fn();
  redirect("/");
}
function redirect(_to: string) {}
/**
 * Saves a name.
 * @openapi
 * action:
 *   fields:
 *     name: The name.
 *   result: Goes home.
 */
export async function saveAction(form: FormData) {
  return attempt(async () => void text(form, "name"));
}
`,
  "lib/model.ts": `
/**
 * Lists models.
 * @openapi
 * outbound:
 *   GET {baseURL}/models:
 *     description: Lists the models.
 *     headers:
 *       Authorization: The key.
 */
export async function list(key: string) {
  const headers = { authorization: key };
  return fetch("http://localhost/models", { headers });
}
`,
  "public/logo.svg": "<svg/>",
};

function project(changes: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kizuki-docs-"));
  for (const [file, text] of Object.entries({ ...PROJECT, ...changes })) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const errorsFor = (changes: Record<string, string | null>) => buildSpec(findAll(project(changes))).errors;

describe("the HTTP docs tool", () => {
  it("turns folder names into addresses", () => {
    expect(routePath("page.tsx")).toBe("/");
    expect(routePath("courses/[courseId]/page.tsx")).toBe("/courses/{courseId}");
    expect(routePath("(group)/files/[...rest]/route.ts")).toBe("/files/{rest}");
  });

  it("reads the @openapi block and the description of a doc comment", () => {
    const raw = "/**\n * Says hi.\n * Twice.\n *\n * @openapi\n * GET /:\n *   summary: Hi\n * @deprecated\n */";
    expect(openapiText(raw)).toBe("GET /:\n  summary: Hi");
    expect(commentSummary(raw)).toBe("Says hi. Twice.");
    expect(openapiText("/** No tag here. */")).toBeNull();
  });

  it("finds pages, the methods of route files, and public files", () => {
    const root = project({
      "app/_private/page.tsx": "export default function P() { return null; }",
      "app/.well-known/workflow/v1/step/route.js": "const a = 1; export { a as HEAD, a as POST };",
      "app/x/route.ts": "export const OPTIONS = () => new Response(); export async function PUT() {}",
    });
    const found = discoverRoutes(root).map((r) => `${r.kind} ${r.method} ${r.path}`);
    expect(found).toEqual(
      expect.arrayContaining([
        "page GET /",
        "route GET /files/{id}",
        "generated HEAD /.well-known/workflow/v1/step",
        "generated POST /.well-known/workflow/v1/step",
        "route PUT /x",
        "route OPTIONS /x",
        "public GET /logo.svg",
      ]),
    );
    expect(found.some((r) => r.includes("_private"))).toBe(false);
  });

  it("finds every header name the code writes, and which side it is on", () => {
    const root = project();
    const headers = scanHeaders(root, ["proxy.ts", "next.config.ts", "app/files/[id]/route.ts", "lib/model.ts"]).map((h) => `${h.side} ${h.name}`);
    expect(headers.sort()).toEqual(["outbound authorization", "request host", "response content-type", "response x-frame-options"]);
  });

  it("finds the fields a form action reads, through helpers and in templates", () => {
    const root = project({
      "app/actions.ts": `"use server";
const text = (form: FormData, key: string) => String(form.get(key) ?? "");
function agree(form: FormData) { return text(form, "ok"); }
export async function answerAction(id: string, form: FormData) {
  agree(form);
  form.getAll("picked");
  return text(form, \`answer:\${q.questionId}\`);
}`,
      "app/page.tsx": `import { answerAction } from "./actions";
export default function Home() { return <form action={answerAction.bind(null, "1")} />; }`,
    });
    const [action] = discoverActions(root, ["app/actions.ts"], ["app/page.tsx"]);
    expect(action).toEqual({ name: "answerAction", file: "app/actions.ts", bound: ["id"], fields: ["answer:{questionId}", "ok", "picked"], pages: ["/"] });
  });

  it("builds a complete document with the shared parts on every operation", () => {
    const { spec, errors } = buildSpec(findAll(project()));
    expect(errors).toEqual([]);
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(paths)).toEqual(["/", "/_next/static/{path}", "/files/{id}", "/logo.svg"]);
    const file = paths["/files/{id}"]!.get!;
    expect(file.description).toBe("Serves a file.");
    expect(file.parameters).toContainEqual({ $ref: "#/components/parameters/Host" });
    expect(Object.keys(file.responses as object)).toEqual(["200", "403"]);
    expect((file.responses as Record<string, { headers: object }>)["200"]!.headers).toHaveProperty("X-Frame-Options");
    expect(paths["/_next/static/{path}"]!.get!.parameters).not.toContainEqual({ $ref: "#/components/parameters/Host" });
    const post = paths["/"]!.post!;
    expect(JSON.stringify(post.requestBody)).toContain('"title":"saveAction"');
    expect((spec.info as { version: string }).version).toBe("1.2.3");
    expect((spec.info as { description: string }).description).toContain("GET {baseURL}/models");
    expect(specText(spec)).not.toContain("x-on-every");
  });

  it("fails when a route has no docs", () => {
    expect(errorsFor({ "app/new/page.tsx": "/** A page. */\nexport default function P() { return null; }" })).toContainEqual(expect.stringContaining("answers GET /new, but it has no docs"));
  });

  it("fails when the docs describe a route that is gone", () => {
    expect(errorsFor({ "app/files/[id]/route.ts": PROJECT["app/files/[id]/route.ts"]!.replace("export async function GET", "async function get") })).toContainEqual(
      expect.stringContaining("the server no longer answers it"),
    );
  });

  it("fails when docs sit away from the route they describe", () => {
    const moved = PROJECT["app/page.tsx"]!.replace(/\/\*\*[\s\S]*?\*\//, "/** The home page. */");
    const next = PROJECT["next.config.ts"]!.replace(" * GET /logo.svg:", " * GET /:\n *   summary: Home\n *   responses:\n *     \"200\": { description: The page. }\n * GET /logo.svg:");
    expect(errorsFor({ "app/page.tsx": moved, "next.config.ts": next })).toContainEqual(expect.stringContaining("documented away from its code"));
  });

  it("fails when the code uses a header the docs leave out", () => {
    const route = PROJECT["app/files/[id]/route.ts"]!.replace('"content-type": "text/plain"', '"content-type": "text/plain", "x-secret": "1"');
    expect(errorsFor({ "app/files/[id]/route.ts": route })).toContainEqual(expect.stringContaining('uses the response header "x-secret", but the docs leave it out'));
  });

  it("fails when the docs name a header no code uses", () => {
    const route = PROJECT["app/files/[id]/route.ts"]!.replace('{ headers: { "content-type": "text/plain" } }', "{}");
    expect(errorsFor({ "app/files/[id]/route.ts": route })).toContainEqual(expect.stringContaining('the docs name the response header "content-type", but no code uses it'));
  });

  it("fails when a form action's documented fields differ from what it reads", () => {
    const actions = PROJECT["app/actions.ts"]!.replace('text(form, "name")', 'text(form, "title")');
    const errors = errorsFor({ "app/actions.ts": actions });
    expect(errors).toContainEqual(expect.stringContaining('reads the form field "title", but its docs leave it out'));
    expect(errors).toContainEqual(expect.stringContaining('name the form field "name", but the action no longer reads it'));
  });

  it("fails when a form action has no docs", () => {
    const actions = `${PROJECT["app/actions.ts"]}\n/** Undocumented. */\nexport async function otherAction() {}\n`;
    expect(errorsFor({ "app/actions.ts": actions })).toContainEqual(expect.stringContaining("the form action otherAction has no docs"));
  });

  it("names the file and line of a broken @openapi block", () => {
    const root = project({ "app/page.tsx": "/**\n * Home.\n * @openapi\n * GET /: [\n */\nexport default function H() { return null; }" });
    expect(() => findAll(root)).toThrow(/app\/page\.tsx:1: the @openapi block is not valid YAML/);
  });
});
