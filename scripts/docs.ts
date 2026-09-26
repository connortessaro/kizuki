// Builds Kizuki's docs: the HTTP reference (docs/openapi.json and its viewer page) and the
// code reference (TypeDoc, with the guides in docs/guides/).
//
//   node scripts/docs.ts          write docs/openapi.json, then build the site into docs/api/
//   node scripts/docs.ts --check  fail if the HTTP docs are incomplete or docs/openapi.json is out of date
//   node scripts/docs.ts --site   build the site from the committed docs/openapi.json (the kizuki.dev build)
//
// The routes and the headers come from the code. The words come from `@openapi` blocks in the
// doc comment on each handler, page, and form action. See the "How the docs are made" guide.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import YAML from "yaml";

/** The HTTP methods a route file can answer, in the order the docs list them. */
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

type Json = Record<string, unknown>;

/** One address and method the server answers, found in the code. */
export interface Route {
  path: string;
  method: string;
  /** `page`: a page. `route`: a route handler. `generated`: written by the Workflow SDK at build time. `public`: a file in public/. */
  kind: "page" | "route" | "generated" | "public";
  file: string;
}

/** One `@openapi` block, parsed. */
export interface DocBlock {
  file: string;
  line: number;
  /** The name of the declaration the comment sits on (`default` for a default export). */
  target: string;
  /** The rest of the doc comment: the plain description above the tags. */
  summary: string;
  doc: Json;
}

/** A header name written in the code. */
export interface HeaderUse {
  name: string;
  /** `request`: read from a request. `response`: set on a response. `outbound`: sent by Kizuki to a model server. */
  side: "request" | "response" | "outbound";
  file: string;
  line: number;
}

/** A form action (a server action) and the form fields it reads. */
export interface Action {
  name: string;
  file: string;
  /** Values the page binds when it renders the form, such as the course id. */
  bound: string[];
  /** Form field names. A part in braces stands for a value, as in `answer:{questionId}`. */
  fields: string[];
  /** The page addresses whose forms run this action. */
  pages: string[];
}

/**
 * Headers the framework reads or sets for Kizuki, which never appear as text in Kizuki's code.
 * The docs may name them only while the code that makes the framework use them is still there.
 */
export const FRAMEWORK_HEADERS: { name: string; side: HeaderUse["side"]; file: string; contains: string; why: string }[] = [
  { name: "next-action", side: "request", file: "app/actions.ts", contains: '"use server"', why: "Next.js reads it to pick the form action to run" },
  { name: "origin", side: "request", file: "app/actions.ts", contains: '"use server"', why: "Next.js compares it with Host before it runs a form action" },
  { name: "x-action-redirect", side: "response", file: "app/actions.ts", contains: "redirect(", why: "Next.js sets it when a form action calls redirect()" },
  { name: "x-nextjs-action-not-found", side: "response", file: "app/actions.ts", contains: '"use server"', why: "Next.js sets it when a form action id is unknown" },
  { name: "location", side: "response", file: "app/actions.ts", contains: "redirect(", why: "Next.js sets it when a form posted without JavaScript calls redirect()" },
  { name: "location", side: "response", file: "app/concepts/[conceptId]/page.tsx", contains: "redirect(", why: "Next.js sets it when a page calls redirect()" },
];

const posix = (p: string) => p.split(sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = /\.m?js$/.test(file) ? ts.ScriptKind.JS : file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The address a file in app/ answers on: `[id]` becomes `{id}`, and `(group)` folders are left out. */
export function routePath(fileInApp: string): string {
  const parts = posix(dirname(fileInApp))
    .split("/")
    .filter((p) => p && p !== "." && !/^\(.*\)$/.test(p))
    .map((p) => p.replace(/^\[\[?(?:\.\.\.)?([^\]]+)\]?\]$/, "{$1}"));
  return `/${parts.join("/")}`;
}

/** The HTTP methods a route file exports, such as `export async function GET`. */
export function exportedMethods(file: string, text: string): string[] {
  const names = new Set<string>();
  for (const stmt of parse(file, text).statements) {
    if (ts.isFunctionDeclaration(stmt) && isExported(stmt) && stmt.name) names.add(stmt.name.text);
    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) names.add(el.name.text);
    }
  }
  return HTTP_METHODS.filter((m) => names.has(m));
}

/** Every page, route handler, generated route, and public file the server answers, with its methods. */
export function discoverRoutes(root: string): Route[] {
  const routes: Route[] = [];
  const app = join(root, "app");
  for (const path of walk(app)) {
    const rel = posix(relative(app, path));
    const file = posix(relative(root, path));
    // Folders starting with _ are private in Next.js and never answer.
    if (rel.split("/").some((p) => p.startsWith("_"))) continue;
    const name = basename(rel);
    if (/^page\.(tsx|ts|jsx|js)$/.test(name)) routes.push({ path: routePath(rel), method: "GET", kind: "page", file });
    else if (/^route\.(ts|js)$/.test(name)) {
      const kind = rel.startsWith(".well-known/workflow/") ? "generated" : "route";
      for (const method of exportedMethods(path, readFileSync(path, "utf8"))) routes.push({ path: routePath(rel), method, kind, file });
    }
  }
  const pub = join(root, "public");
  for (const path of walk(pub)) routes.push({ path: `/${posix(relative(pub, path))}`, method: "GET", kind: "public", file: posix(relative(root, path)) });
  return routes;
}

function commentLines(raw: string): string[] {
  return raw
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, ""));
}

/** The YAML text of the `@openapi` tag in a doc comment, or `null` if it has none. */
export function openapiText(raw: string): string | null {
  const lines = commentLines(raw);
  const start = lines.findIndex((l) => l.trim() === "@openapi");
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^@\w/.test(l));
  return rest.slice(0, end < 0 ? undefined : end).join("\n");
}

/** The description part of a doc comment: everything above the first tag, as one paragraph per blank line. */
export function commentSummary(raw: string): string {
  const lines = commentLines(raw);
  const end = lines.findIndex((l) => /^@\w/.test(l.trim()));
  return lines
    .slice(0, end < 0 ? undefined : end)
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function statementName(stmt: ts.Statement): string {
  if (ts.isExportAssignment(stmt)) return "default";
  if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
    const isDefault = (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    return isDefault ? "default" : stmt.name.text;
  }
  if (ts.isVariableStatement(stmt)) {
    const d = stmt.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) return d.name.text;
  }
  return "(statement)";
}

/** Reads every `@openapi` block from the top-level doc comments of the given files. Bad YAML is an error naming the file and line. */
export function readDocBlocks(root: string, files: string[]): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const sf = parse(file, text);
    for (const stmt of sf.statements) {
      for (const range of ts.getLeadingCommentRanges(text, stmt.pos) ?? []) {
        const raw = text.slice(range.pos, range.end);
        if (!raw.startsWith("/**")) continue;
        const yaml = openapiText(raw);
        if (yaml === null) continue;
        const line = sf.getLineAndCharacterOfPosition(range.pos).line + 1;
        if (yaml.includes("{@link")) throw new Error(`${file}:${line}: {@link} does not work inside an @openapi block. Name the function in backticks instead.`);
        let doc: unknown;
        try {
          doc = YAML.parse(yaml);
        } catch (error) {
          throw new Error(`${file}:${line}: the @openapi block is not valid YAML (${(error as Error).message})`, { cause: error });
        }
        if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${file}:${line}: the @openapi block must be a set of named entries`);
        blocks.push({ file, line, target: statementName(stmt), summary: commentSummary(raw), doc: doc as Json });
      }
    }
  }
  return blocks;
}

function stringValue(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function objectLiterals(node: ts.Node | undefined): ts.ObjectLiteralExpression[] {
  if (!node) return [];
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return objectLiterals(node.expression);
  if (ts.isConditionalExpression(node)) return [...objectLiterals(node.whenTrue), ...objectLiterals(node.whenFalse)];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((e) => objectLiterals(e));
  return [];
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/** True if `node` sits inside `new Response(...)`, `Response.json(...)`, or Next.js's `headers()` config. */
function inResponseContext(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && /Response\b/.test(n.expression.getText())) return true;
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === "headers") return true;
  }
  return false;
}

/**
 * Finds every header name written in the code: names read with `headers.get("…")`, keys of a
 * `headers` object (on a response, in Next.js's `headers()` config, or sent with `fetch`), and
 * `{ key: "…" }` entries in the config. Names are lower case.
 */
export function scanHeaders(root: string, files: string[]): HeaderUse[] {
  const out: HeaderUse[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const sf = parse(file, text);
    const add = (name: string, side: HeaderUse["side"], at: ts.Node) =>
      out.push({ name: name.toLowerCase(), side, file, line: sf.getLineAndCharacterOfPosition(at.getStart()).line + 1 });
    const fromObjects = (init: ts.Node | undefined, side: HeaderUse["side"]) => {
      for (const obj of objectLiterals(init)) {
        const key = obj.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p.name) === "key") as ts.PropertyAssignment | undefined;
        const keyText = key && stringValue(key.initializer);
        if (keyText) {
          add(keyText, side, key);
          continue;
        }
        for (const p of obj.properties) {
          const name = (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && propertyName(p.name);
          if (name) add(name, side, p);
        }
      }
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const target = node.expression.expression;
        const onHeaders = (ts.isPropertyAccessExpression(target) && target.name.text === "headers") || (ts.isIdentifier(target) && target.text === "headers");
        const first = node.arguments[0] && stringValue(node.arguments[0]);
        if (onHeaders && first && ["get", "has", "set", "append", "delete"].includes(method)) {
          add(first, method === "get" || method === "has" ? "request" : "response", node);
        }
      }
      if (ts.isPropertyAssignment(node) && propertyName(node.name) === "headers") fromObjects(node.initializer, inResponseContext(node) ? "response" : "outbound");
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "headers") {
        fromObjects(node.initializer, inResponseContext(node) ? "response" : "outbound");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** True if the file starts with the `"use server"` directive. */
function isServerActionFile(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server");
}

/** A form field name from a string or a template: `` `answer:${q.questionId}` `` becomes `answer:{questionId}`. */
function fieldName(node: ts.Node): string | undefined {
  const plain = stringValue(node);
  if (plain !== undefined) return plain;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const expr = span.expression;
      out += `{${ts.isPropertyAccessExpression(expr) ? expr.name.text : expr.getText()}}` + span.literal.text;
    }
    return out;
  }
  return undefined;
}

/** The form fields a function reads from its FormData parameter `formName`, following calls to other functions in the same file. */
function fieldsRead(fn: ts.FunctionLikeDeclaration, formName: string, locals: Map<string, ts.FunctionLikeDeclaration>, seen = new Set<ts.Node>()): Set<string> {
  const fields = new Set<string>();
  if (seen.has(fn) || !fn.body) return fields;
  seen.add(fn);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const args = node.arguments;
      const formAt = args.findIndex((a) => ts.isIdentifier(a) && a.text === formName);
      const callee = node.expression;
      // form.get("x"), form.getAll("x")
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === formName && ["get", "getAll", "has"].includes(callee.name.text)) {
        const name = args[0] && fieldName(args[0]);
        if (name) fields.add(name);
      } else if (formAt >= 0) {
        // helper(form, "x")
        for (const a of args) {
          const name = a !== args[formAt] ? fieldName(a) : undefined;
          if (name) fields.add(name);
        }
        // otherHelper(before, after, form): read what that function reads
        const local = ts.isIdentifier(callee) ? locals.get(callee.text) : undefined;
        const param = local?.parameters[formAt];
        if (local && param && ts.isIdentifier(param.name)) for (const f of fieldsRead(local, param.name.text, locals, seen)) fields.add(f);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return fields;
}

/** Every exported form action in `"use server"` files, with its fields and the pages whose forms run it. */
export function discoverActions(root: string, sourceFiles: string[], pageFiles: string[]): Action[] {
  const actions: Action[] = [];
  for (const file of sourceFiles) {
    const sf = parse(file, readFileSync(join(root, file), "utf8"));
    if (!isServerActionFile(sf)) continue;
    const locals = new Map<string, ts.FunctionLikeDeclaration>();
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name) locals.set(stmt.name.text, stmt);
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) locals.set(d.name.text, d.initializer);
        }
      }
    }
    for (const stmt of sf.statements) {
      if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !isExported(stmt)) continue;
      const form = stmt.parameters.find((p) => p.type?.getText() === "FormData");
      const bound = stmt.parameters.filter((p) => p !== form).map((p) => p.name.getText());
      const fields = form && ts.isIdentifier(form.name) ? [...fieldsRead(stmt, form.name.text, locals)].sort() : [];
      actions.push({ name: stmt.name.text, file, bound, fields, pages: [] });
    }
  }
  const byName = new Map(actions.map((a) => [a.name, a]));
  for (const file of pageFiles) {
    const sf = parse(file, readFileSync(join(root, file), "utf8"));
    const path = routePath(posix(relative("app", file)));
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && ["action", "formAction"].includes(node.name.getText()) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        let expr: ts.Expression = node.initializer.expression;
        if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "bind") expr = expr.expression.expression;
        const action = ts.isIdentifier(expr) ? byName.get(expr.text) : undefined;
        if (action && !action.pages.includes(path)) action.pages.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const a of actions) a.pages.sort();
  return actions;
}

/** Where the docs tool looks. Tests and generated files are left out of the header scan and the doc blocks. */
export function sourceFiles(root: string): string[] {
  const inScope = (f: string) => /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.mts") && !f.includes("/.well-known/") && !f.includes("/test-helpers/");
  const files = ["app", "lib", "workflows", "bin"].flatMap((d) => walk(join(root, d))).map((p) => posix(relative(root, p)));
  for (const f of ["proxy.ts", "next.config.ts"]) if (existsSync(join(root, f))) files.push(f);
  return files.filter(inScope).sort();
}

const METHOD = `(?:${HTTP_METHODS.join("|")})`;
/** An operation key: one or more methods and a path, as in `GET /files/{materialId}` or `GET, HEAD /x`. */
const OP_KEY = new RegExp(`^(${METHOD}(?:, ${METHOD})*) (/\\S*)$`);
const BLOCK_KEYS = new Set(["info", "servers", "security", "tags", "components", "action", "actions", "outbound"]);

function operationId(method: string, path: string): string {
  const words = path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return method.toLowerCase() + words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
}

function resolveRef(spec: Json, ref: unknown): Json | undefined {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node: unknown = spec;
  for (const part of ref.slice(2).split("/")) node = (node as Json | undefined)?.[part];
  return node as Json | undefined;
}

/** Everything the build needs, found in the code. */
export interface Found {
  routes: Route[];
  blocks: DocBlock[];
  headers: HeaderUse[];
  actions: Action[];
  version: string;
  /** File text by path, for the framework anchors. */
  read: (file: string) => string;
}

/** Collects everything from a checkout. */
export function findAll(root: string): Found {
  const files = sourceFiles(root);
  const pages = files.filter((f) => f.startsWith("app/") && /\/page\.tsx$/.test(f));
  return {
    routes: discoverRoutes(root),
    blocks: readDocBlocks(root, files),
    headers: scanHeaders(root, files),
    actions: discoverActions(root, files, pages),
    version: (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version,
    read: (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : ""),
  };
}

/**
 * Builds the OpenAPI document and lists every problem: a route or method with no docs, docs for
 * a route that is gone, a header in the code the docs leave out, a header in the docs the code
 * no longer uses, and a form action whose documented fields differ from the fields it reads.
 */
export function buildSpec(found: Found): { spec: Json; errors: string[] } {
  const errors: string[] = [];
  const spec: Json = { openapi: "3.1.0", info: {}, servers: [], security: [], tags: [], paths: {}, components: {} };
  const components = spec.components as Record<string, Json>;
  const ops = new Map<string, { op: Json; block: DocBlock }>();
  const outbound: Record<string, Json> = {};
  let actionTemplate: { op: Json; block: DocBlock } | undefined;
  const actionDocs = new Map<string, { doc: Json; block: DocBlock }>();
  const where = (b: DocBlock) => `${b.file}:${b.line}`;

  for (const block of found.blocks) {
    for (const [key, value] of Object.entries(block.doc)) {
      const op = OP_KEY.exec(key);
      if (op) {
        for (const method of op[1]!.split(", ")) {
          const one = `${method} ${op[2]}`;
          if (ops.has(one)) errors.push(`${where(block)}: ${one} is documented twice (also at ${where(ops.get(one)!.block)})`);
          ops.set(one, { op: structuredClone(value as Json), block });
        }
      } else if (!BLOCK_KEYS.has(key)) {
        errors.push(`${where(block)}: "${key}" is not a known @openapi entry. Use "GET /path", info, servers, security, tags, components, action, actions, or outbound.`);
      } else if (key === "info") spec.info = { ...(value as Json) };
      else if (key === "servers" || key === "security" || key === "tags") spec[key] = value;
      else if (key === "components") {
        for (const [kind, entries] of Object.entries(value as Json)) components[kind] = { ...components[kind], ...(entries as Json) };
      } else if (key === "outbound") Object.assign(outbound, value);
      else if (key === "actions") actionTemplate = { op: { ...(value as Json) }, block };
      else if (key === "action") actionDocs.set(block.target, { doc: value as Json, block });
    }
  }

  // Every route the server answers needs docs, next to its code.
  const routeKeys = new Set<string>();
  for (const r of found.routes) {
    const key = `${r.method} ${r.path}`;
    routeKeys.add(key);
    const entry = ops.get(key);
    if (!entry) {
      const place = r.kind === "generated" ? "the default export of next.config.ts" : r.kind === "public" ? "any doc comment (layout.tsx holds the others)" : `the doc comment of the handler in ${r.file}`;
      errors.push(`${r.file} answers ${key}, but it has no docs. Add a "${key}:" entry to an @openapi block in ${place}.`);
      continue;
    }
    if ((r.kind === "page" || r.kind === "route") && entry.block.file !== r.file) {
      errors.push(`${where(entry.block)}: ${key} is documented away from its code. Move the entry to ${r.file}.`);
    }
    const tag = { page: "Pages", route: "Files", generated: "Background jobs", public: "Static files" }[r.kind];
    entry.op.tags ??= [tag];
  }
  for (const [key, { op, block }] of ops) {
    if (routeKeys.has(key)) continue;
    const path = key.split(" ")[1]!;
    const anchor = path.split("/").slice(1, 3).join("/");
    if (op["x-framework"] === true && found.read(block.file).includes(anchor)) {
      op.tags ??= ["Static files"];
      continue;
    }
    errors.push(`${where(block)}: the docs describe ${key}, but the server no longer answers it. Remove the entry, or mark it "x-framework: true" in a file that names ${anchor}.`);
  }

  // Form actions: one POST per page, listing the actions its forms run.
  const pagesWithActions = new Map<string, typeof found.actions>();
  for (const a of found.actions) {
    const d = actionDocs.get(a.name);
    if (!d || d.block.file !== a.file) {
      errors.push(`${a.file}: the form action ${a.name} has no docs. Add an @openapi block with an "action:" entry to its doc comment.`);
      continue;
    }
    const documented = Object.keys((d.doc.fields as Json | undefined) ?? {}).sort();
    for (const f of a.fields) if (!documented.includes(f)) errors.push(`${where(d.block)}: ${a.name} reads the form field "${f}", but its docs leave it out.`);
    for (const f of documented) if (!a.fields.includes(f)) errors.push(`${where(d.block)}: the docs of ${a.name} name the form field "${f}", but the action no longer reads it.`);
    if (typeof d.doc.result !== "string") errors.push(`${where(d.block)}: the docs of ${a.name} need a "result:" line saying where the browser goes next.`);
    if (a.pages.length === 0) errors.push(`${a.file}: no page's form runs ${a.name}. Remove it, or use it in a form.`);
    for (const p of a.pages) pagesWithActions.set(p, [...(pagesWithActions.get(p) ?? []), a]);
  }
  for (const target of actionDocs.keys()) {
    if (!found.actions.some((a) => a.name === target)) errors.push(`${where(actionDocs.get(target)!.block)}: "action:" docs sit on ${target}, which is not an exported form action.`);
  }
  if (found.actions.length > 0 && !actionTemplate) errors.push(`the form actions need an "actions:" entry (the shared request and response) in the "use server" file.`);
  if (actionTemplate) {
    for (const [path, actions] of pagesWithActions) {
      const key = `POST ${path}`;
      if (ops.has(key)) {
        errors.push(`${where(ops.get(key)!.block)}: ${key} is made from the form actions. Remove the entry and document the actions instead.`);
        continue;
      }
      const t = actionTemplate.op;
      // The page's own path parameters apply to its forms too.
      const pathParams = (((ops.get(`GET ${path}`)?.op.parameters as Json[] | undefined) ?? []).filter((p) => p.in === "path"));
      const schemas = actions.map((a) => {
        const d = actionDocs.get(a.name)!;
        const fields = (d.doc.fields as Record<string, string> | undefined) ?? {};
        return {
          title: a.name,
          description: [d.block.summary, `**Result:** ${d.doc.result as string}`, a.bound.length ? `**Set by the page:** ${a.bound.map((b) => `\`${b}\``).join(", ")}` : ""]
            .filter(Boolean)
            .join("\n\n"),
          type: "object",
          properties: Object.fromEntries(Object.entries(fields).map(([name, description]) => [name, { type: "string", description }])),
        };
      });
      ops.set(key, {
        block: actionTemplate.block,
        op: {
          ...structuredClone(t),
          tags: t.tags ?? ["Form actions"],
          // Name each page's forms after the page, so the list of form entries reads apart.
          summary: typeof ops.get(`GET ${path}`)?.op.summary === "string" ? `${ops.get(`GET ${path}`)!.op.summary as string}: forms` : t.summary,
          description: [t.description ?? actionTemplate.block.summary, `Forms on this page run: ${actions.map((a) => `\`${a.name}\``).join(", ")}.`].join("\n\n"),
          parameters: [...structuredClone(pathParams), ...((t.parameters as Json[] | undefined) ?? [])],
          // The forms' fields can overlap, so a request matches any of them.
          requestBody: { required: true, content: { "multipart/form-data": { schema: schemas.length === 1 ? schemas[0] : { anyOf: schemas } } } },
        },
      });
    }
  }

  // Shared parts: the host check on every request, and the headers set on every response.
  const everyResponse = Object.entries(components.headers ?? {}).filter(([, h]) => (h as Json)["x-on-every-response"] === true);
  const everyRequestParams = Object.entries(components.parameters ?? {}).filter(([, p]) => (p as Json)["x-on-every-request"] === true);
  const everyRequestResponses = Object.entries(components.responses ?? {}).filter(([, r]) => (r as Json)["x-on-every-request"] === true);
  const addEveryResponse = (response: Json) => {
    const headers = { ...((response.headers as Json | undefined) ?? {}) };
    for (const [name] of everyResponse) headers[name] ??= { $ref: `#/components/headers/${name}` };
    if (Object.keys(headers).length) response.headers = headers;
  };
  for (const r of Object.values(components.responses ?? {})) addEveryResponse(r as Json);

  const paths: Record<string, Json> = {};
  for (const key of [...ops.keys()].sort()) {
    const [method, path] = key.split(" ") as [string, string];
    const { op, block } = ops.get(key)!;
    op.description ??= block.summary;
    op.operationId ??= operationId(method, path);
    if (typeof op.summary !== "string") errors.push(`${where(block)}: ${key} needs a "summary:" line.`);
    if (!op.responses || typeof op.responses !== "object") errors.push(`${where(block)}: ${key} needs "responses:".`);
    const responses = { ...((op.responses as Json | undefined) ?? {}) };
    for (const [code, response] of Object.entries(responses)) {
      if ((response as Json).$ref) continue;
      const copy = { ...(response as Json) };
      addEveryResponse(copy);
      responses[code] = copy;
    }
    if (op["x-skips-host-check"] !== true) {
      op.parameters = [...everyRequestParams.map(([name]) => ({ $ref: `#/components/parameters/${name}` })), ...((op.parameters as Json[] | undefined) ?? [])];
      for (const [name, r] of everyRequestResponses) responses[String((r as Json)["x-status"])] ??= { $ref: `#/components/responses/${name}` };
    }
    op.responses = Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)));
    // Path parameters in the address must be documented.
    for (const name of path.match(/\{([^}]+)\}/g) ?? []) {
      const bare = name.slice(1, -1);
      const params = (op.parameters as Json[] | undefined) ?? [];
      if (!params.some((p) => p.in === "path" && p.name === bare)) errors.push(`${where(block)}: ${key} needs a path parameter named ${bare}.`);
    }
    paths[path] = { ...paths[path], [method.toLowerCase()]: op };
  }
  spec.paths = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));

  // Tags: every tag in use needs a description, and every described tag must be in use.
  const used = new Set(Object.values(paths).flatMap((p) => Object.values(p).flatMap((op) => ((op as Json).tags as string[] | undefined) ?? [])));
  const tags = (spec.tags as { name: string }[]) ?? [];
  for (const t of used) if (!tags.some((x) => x.name === t)) errors.push(`the tag "${t}" needs a name and description under "tags:" in next.config.ts.`);
  for (const t of tags) if (!used.has(t.name)) errors.push(`the tag "${t.name}" is described but no route uses it. Remove it.`);

  // Headers: the docs and the code must name the same ones.
  const documented = { request: new Set<string>(), response: new Set<string>(), outbound: new Set<string>() };
  const params = (list: unknown) => ((list as Json[] | undefined) ?? []).map((p) => (p.$ref ? resolveRef(spec, p.$ref) : p) ?? {});
  for (const p of Object.values(components.parameters ?? {})) if ((p as Json).in === "header") documented.request.add(String((p as Json).name).toLowerCase());
  for (const name of Object.keys(components.headers ?? {})) documented.response.add(name.toLowerCase());
  for (const r of Object.values(components.responses ?? {})) for (const name of Object.keys(((r as Json).headers as Json | undefined) ?? {})) documented.response.add(name.toLowerCase());
  for (const p of Object.values(paths)) {
    for (const op of Object.values(p) as Json[]) {
      for (const param of params(op.parameters)) if (param.in === "header") documented.request.add(String(param.name).toLowerCase());
      for (const r of Object.values((op.responses as Json | undefined) ?? {})) {
        for (const name of Object.keys(((r as Json).headers as Json | undefined) ?? {})) documented.response.add(name.toLowerCase());
      }
    }
  }
  for (const entry of Object.values(outbound)) for (const name of Object.keys(((entry as Json).headers as Json | undefined) ?? {})) documented.outbound.add(name.toLowerCase());
  const label = { request: "request header", response: "response header", outbound: "header Kizuki sends to a model server" };
  for (const h of found.headers) {
    if (!documented[h.side].has(h.name)) errors.push(`${h.file}:${h.line} uses the ${label[h.side]} "${h.name}", but the docs leave it out.`);
  }
  for (const side of ["request", "response", "outbound"] as const) {
    for (const name of documented[side]) {
      if (found.headers.some((h) => h.side === side && h.name === name)) continue;
      const fw = FRAMEWORK_HEADERS.filter((f) => f.name === name && f.side === side);
      if (fw.some((f) => found.read(f.file).includes(f.contains))) continue;
      errors.push(`the docs name the ${label[side]} "${name}", but no code uses it any more. Remove it from the docs${fw.length ? `, or restore the code in ${fw.map((f) => f.file).join(" or ")}` : ""}.`);
    }
  }

  // Outbound requests go in an extension and in the description, where viewers show them.
  const info = spec.info as Json;
  info.version = found.version;
  if (typeof info.title !== "string" || typeof info.description !== "string") errors.push(`next.config.ts needs an "info:" entry with a title and a description.`);
  if (Object.keys(outbound).length) {
    spec["x-outbound-requests"] = outbound;
    const rows = Object.entries(outbound).map(([request, e]) => {
      const entry = e as Json;
      const headers = Object.entries((entry.headers as Record<string, string> | undefined) ?? {}).map(([n, d]) => `\`${n}\`: ${d}`);
      return `- **${request}**: ${entry.description as string}${headers.length ? ` Headers: ${headers.join("; ")}` : ""}`;
    });
    info.description = `${info.description as string}\n\n## Requests Kizuki sends\n\nKizuki itself calls out only to the model servers in your settings (\`baseURL\`):\n\n${rows.join("\n")}`;
  }

  // Strip the markers this tool reads; they mean nothing to other tools.
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node as Json)
        .filter(([k]) => !["x-on-every-response", "x-on-every-request", "x-status", "x-framework", "x-skips-host-check"].includes(k))
        .map(([k, v]) => [k, strip(v)]),
    );
  };
  return { spec: strip(spec) as Json, errors };
}

/** The OpenAPI document as it is saved: two-space JSON with a final newline. */
export function specText(spec: Json): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** The viewer page for the HTTP reference. It loads the Scalar viewer from the same folder, so it makes no requests to other sites. */
export function viewerPage(): string {
  const config = { url: "./openapi.json", hideTestRequestButton: true, hideClientButton: true, telemetry: false, withDefaultFonts: false, showDeveloperTools: "never", hideModels: true, agent: { disabled: true }, mcp: { disabled: true } };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kizuki HTTP API</title>
    <link rel="icon" href="/seal-ki.svg" type="image/svg+xml" />
    <style>:root { --scalar-font: system-ui, -apple-system, "Segoe UI", sans-serif; --scalar-font-code: ui-monospace, "SF Mono", Menlo, monospace; } .back { display: block; padding: 0.5rem 1rem; font: 14px system-ui, sans-serif; }</style>
  </head>
  <body>
    <a class="back" href="../index.html">← Kizuki code docs and guides</a>
    <div id="app"></div>
    <script src="./scalar.js"></script>
    <script>Scalar.createApiReference("#app", ${JSON.stringify(config)});</script>
  </body>
</html>
`;
}

function run(cmd: string, args: string[], root: string): void {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

/** Builds the site into docs/api/: TypeDoc (with the guides), then the HTTP reference page next to it. */
function buildSite(root: string, specFile: string): void {
  run(process.execPath, [join(root, "node_modules", "typedoc", "bin", "typedoc")], root);
  const out = join(root, "docs", "api", "http-api");
  mkdirSync(out, { recursive: true });
  copyFileSync(specFile, join(out, "openapi.json"));
  // The package does not export its browser file, so it is read from where npm installs it.
  const viewer = join(root, "node_modules", "@scalar", "api-reference", "dist", "browser", "standalone.js");
  if (!existsSync(viewer)) throw new Error(`${viewer} is missing. Run npm ci.`);
  copyFileSync(viewer, join(out, "scalar.js"));
  writeFileSync(join(out, "index.html"), viewerPage());
  console.log("HTTP reference written to docs/api/http-api/");
}

function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const mode = process.argv[2] ?? "";
  if (!["", "--check", "--site"].includes(mode)) {
    console.error(`unknown option ${mode}. Use no option, --check, or --site.`);
    process.exit(2);
  }
  const specFile = join(root, "docs", "openapi.json");
  if (mode === "--site") {
    if (!existsSync(specFile)) throw new Error("docs/openapi.json is missing. Run npm run docs and commit it.");
    buildSite(root, specFile);
    return;
  }
  // The Workflow SDK writes its routes into app/.well-known/ when Next.js loads its config.
  // `next typegen` does that in about a second, without a full build.
  const require = createRequire(join(root, "package.json"));
  run(process.execPath, [require.resolve("next/dist/bin/next"), "typegen"], root);
  const { spec, errors } = buildSpec(findAll(root));
  if (errors.length) {
    console.error(`\nThe HTTP docs have ${errors.length === 1 ? "a problem" : "problems"}:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
    process.exit(1);
  }
  const text = specText(spec);
  if (mode === "--check") {
    const committed = existsSync(specFile) ? readFileSync(specFile, "utf8") : "";
    if (committed !== text) {
      console.error("\ndocs/openapi.json is out of date with the code. Run npm run docs and commit the result.\n");
      process.exit(1);
    }
    console.log("docs/openapi.json matches the code.");
  } else {
    writeFileSync(specFile, text);
    console.log("docs/openapi.json written.");
  }
  buildSite(root, specFile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`docs: ${(error as Error).message}`);
    process.exit(1);
  }
}
