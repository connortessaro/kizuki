import { homedir } from "node:os";
import { join } from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

/**
 * The folder that holds all study data: `KIZUKI_HOME` if set, otherwise `~/.kizuki`. The same
 * rule as {@link lib/paths!kizukiHome}, repeated here because the npm package ships this file
 * without lib/. A test keeps the two in step.
 */
function home(env: Record<string, string | undefined> = process.env): string {
  const set = env.KIZUKI_HOME?.trim();
  if (!set) return join(homedir(), ".kizuki");
  if (set === "~") return homedir();
  if (set.startsWith("~/")) return join(homedir(), set.slice(2));
  return set;
}

// The Workflow SDK keeps its runs in .next/ unless told otherwise, which a rebuild or an
// update wipes. Keep them in the Kizuki home folder instead, next to the logs.
if (!process.env.WORKFLOW_TARGET_WORLD) {
  process.env.WORKFLOW_TARGET_WORLD = "local";
  process.env.WORKFLOW_LOCAL_DATA_DIR ??= join(home(), "workflow-data");
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sqlite-vec"],
  // No other site may show Kizuki in a frame (where it could trick a click on "Hosted model"),
  // files are never read as another type, and addresses never leak to other sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "200mb" },
  },
};

export { home as kizukiHomeForConfig };

/**
 * The Next.js settings for the dashboard, with the Workflow SDK added. The Workflow SDK writes
 * its own routes into `app/.well-known/workflow/` when Next.js loads this file.
 *
 * @openapi
 * info:
 *   title: Kizuki local HTTP API
 *   description: |-
 *     Everything the Kizuki dashboard answers over HTTP. Kizuki runs on your computer and listens
 *     only on `127.0.0.1`, so this reference is for reading how the app works, for testing, and
 *     for tools you run on the same computer. No server on the internet hosts it.
 *
 *     Most addresses are pages that return HTML. Changes to your data go through **form
 *     actions**: a page's forms post back to that page's address, and Next.js picks the action
 *     from the `Next-Action` header. The action ids come from each build, so treat them as part
 *     of the page, not as a stable API. The only other data address is `GET /files/{materialId}`,
 *     which returns a file you added.
 *
 *     There is no login. Every address except the built files under `/_next/` checks the `Host`
 *     header and refuses any name other than this computer (see the Host parameter). Every
 *     answer carries the four safety headers listed under each response.
 *
 *     Next.js also answers `HEAD` for every page and file, with the same headers and no body, and
 *     `OPTIONS` for route handlers. Addresses Kizuki has no page for get the 404 "Not found"
 *     page.
 *   license:
 *     name: Apache-2.0
 *     identifier: Apache-2.0
 * security: []
 * servers:
 *   - url: http://127.0.0.1:3700
 *     description: "`npx kizuki` (change the port with --port)"
 *   - url: http://127.0.0.1:3000
 *     description: "`npm run dev` while working on Kizuki"
 * tags:
 *   - name: Pages
 *     description: The dashboard's pages. Each reads your data fresh from the logs on every request and returns HTML.
 *   - name: Form actions
 *     description: >-
 *       The forms on each page. The browser posts them back to the page's own address, and each
 *       one changes your data through the checked commands in lib/, then sends the browser to
 *       the next page.
 *   - name: Files
 *     description: The copies of the files you added.
 *   - name: Background jobs
 *     description: >-
 *       Addresses the Workflow SDK adds for Kizuki's background jobs (reading a file, running a
 *       session). Kizuki's own job queue calls them on this computer; you never need to.
 *   - name: Static files
 *     description: Pictures and built scripts that never change while Kizuki runs.
 * components:
 *   headers:
 *     X-Frame-Options:
 *       description: Always `DENY`. No other site may show Kizuki inside a frame, where it could trick you into a click.
 *       schema: { type: string, const: DENY }
 *       x-on-every-response: true
 *     Content-Security-Policy:
 *       description: Always `frame-ancestors 'none'`, the same rule as X-Frame-Options for newer browsers.
 *       schema: { type: string, const: "frame-ancestors 'none'" }
 *       x-on-every-response: true
 *     X-Content-Type-Options:
 *       description: Always `nosniff`. Browsers must use the content type Kizuki sends and never guess another.
 *       schema: { type: string, const: nosniff }
 *       x-on-every-response: true
 *     Referrer-Policy:
 *       description: Always `no-referrer`. When you follow a link out of Kizuki, the other site is not told which Kizuki page you came from.
 *       schema: { type: string, const: no-referrer }
 *       x-on-every-response: true
 * GET, HEAD, POST, OPTIONS /.well-known/workflow/v1/flow:
 *   summary: Run a workflow's next part
 *   description: >-
 *     Kizuki's job queue posts here to move a workflow (processing a file, or running a
 *     teach-back session) to its next step. The request and answer formats belong to the
 *     Workflow SDK and can change with its version. With `?__health` in the address, it
 *     answers whether the endpoint works instead.
 *   parameters:
 *     - name: __health
 *       in: query
 *       required: false
 *       description: Present (with any value, or none) to ask for a health check.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: "The health check answer, such as `{\"healthy\":true,\"endpoint\":\"/.well-known/workflow/v1/flow\"}`, or the result of a queue message."
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     "400":
 *       description: "No request body, as in `{\"error\":\"Missing request body\"}`, or a body the SDK cannot read."
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { error: { type: string } } }
 * HEAD, POST /.well-known/workflow/v1/step:
 *   summary: Run one workflow step
 *   description: >-
 *     Kizuki's job queue posts here to run one step, such as reading a file's text or asking the
 *     model for questions. The formats belong to the Workflow SDK. `GET` answers 405. With
 *     `?__health` in the address, it answers whether the endpoint works instead.
 *   parameters:
 *     - name: __health
 *       in: query
 *       required: false
 *       description: Present to ask for a health check.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: The health check answer, or the result of a queue message.
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     "400":
 *       description: A request the SDK cannot read, such as one with no body.
 * GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS /.well-known/workflow/v1/webhook/{token}:
 *   summary: Resume a workflow from outside (unused)
 *   description: >-
 *     The Workflow SDK adds this so a workflow can wait for a call from another service. Kizuki's
 *     workflows only pause with `createHook`, and Kizuki resumes them itself from its form
 *     actions. The SDK refuses to resume those pauses from this address, so every request here
 *     gets 404.
 *   parameters:
 *     - name: token
 *       in: path
 *       required: true
 *       description: The name of the pause to resume.
 *       schema: { type: string }
 *   responses:
 *     "404":
 *       description: No pause with this name accepts calls from this address. The body is empty.
 */
export default withWorkflow(nextConfig);
