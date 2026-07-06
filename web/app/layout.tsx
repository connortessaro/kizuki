import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Kizuki" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">Kizuki</Link>
          <Link href="/people">People</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/teams">Teams</Link>
          <Link href="/followups">Follow-ups</Link>
          <Link href="/days">Days</Link>
          <form action="/search">
            <input name="q" placeholder="Search vault…" />
          </form>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
