import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

/**
 * The browser tab title, description, and icon.
 *
 * @openapi
 * GET /seal-ki.svg:
 *   summary: The Kizuki seal
 *   description: The picture in the header and the browser tab, served from `public/`.
 *   responses:
 *     "200":
 *       description: The picture.
 *       content:
 *         image/svg+xml:
 *           schema: { type: string }
 */
export const metadata = { title: "Kizuki", description: "Teach it back. Kizuki asks, quoting your own material.", icons: { icon: "/seal-ki.svg" } };

/** The frame around every page: the header and navigation. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">
            <img src="/seal-ki.svg" alt="" />
            Kizuki
          </Link>
          <Link href="/">Today</Link>
          <Link href="/courses">Courses</Link>
          <Link href="/history">History</Link>
          <span className="spacer" />
          <Link href="/settings">Settings</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
