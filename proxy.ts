import { NextResponse, type NextRequest } from "next/server";
import { isLocalHost } from "./lib/hosts";

/**
 * Refuses requests that do not name this computer as their host.
 *
 * @openapi
 * components:
 *   parameters:
 *     Host:
 *       name: Host
 *       in: header
 *       required: true
 *       description: >-
 *         Must name this computer: `127.0.0.1`, `localhost`, or `[::1]`, with any port.
 *         Browsers and HTTP tools set it from the address you open. Any other name, or
 *         no Host header at all, gets the 403 answer. This stops a website that points its
 *         own domain name at your computer from reaching Kizuki, which has no login.
 *       schema:
 *         type: string
 *         examples: ["127.0.0.1:3700"]
 *       x-on-every-request: true
 *   responses:
 *     NotThisComputer:
 *       description: The Host header does not name this computer (see the Host parameter).
 *       x-status: 403
 *       x-on-every-request: true
 *       content:
 *         text/plain:
 *           schema:
 *             type: string
 *             const: Kizuki only answers requests addressed to this computer.
 * GET /_next/static/{path}:
 *   summary: Built scripts and styles
 *   description: >-
 *     The JavaScript and CSS files that `next build` made for the pages. Their names change
 *     with every build. The host check does not run on these addresses, because they hold
 *     no study data.
 *   x-framework: true
 *   x-skips-host-check: true
 *   parameters:
 *     - name: path
 *       in: path
 *       required: true
 *       description: The file's path under `.next/static/`, such as `chunks/abc123.css`. It may contain slashes.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: The file, with a content type that matches its ending.
 *     "404":
 *       description: No built file has this path.
 * GET /_next/image:
 *   summary: Next.js image resizer (unused)
 *   description: >-
 *     Next.js answers here to resize pictures for pages that ask for it. Kizuki's pages never
 *     do. Its only picture is an SVG, which the resizer refuses, and it refuses addresses on
 *     other sites, so in Kizuki this answers 400. The host check does not run here.
 *   x-framework: true
 *   x-skips-host-check: true
 *   parameters:
 *     - { name: url, in: query, required: true, description: The picture to resize., schema: { type: string } }
 *     - { name: w, in: query, required: true, description: The width in pixels., schema: { type: integer } }
 *     - { name: q, in: query, required: true, description: The quality from 1 to 100., schema: { type: integer } }
 *   responses:
 *     "400":
 *       description: >-
 *         A plain-text reason, such as `"url" parameter is required`, `"url" parameter is not allowed`,
 *         or `The requested resource isn't a valid image.`
 *       content:
 *         text/plain:
 *           schema: { type: string }
 */
export function proxy(request: NextRequest) {
  if (!isLocalHost(request.headers.get("host"))) {
    return new NextResponse("Kizuki only answers requests addressed to this computer.", { status: 403 });
  }
  return NextResponse.next();
}

/** Which addresses the host check runs on: every one except built static files. */
export const config = {
  // The background-job routes (/.well-known/workflow/) are checked too. Kizuki's own job queue
  // calls them at http://localhost, so it passes; a page on another address does not.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
