import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import AutoRefresh from "./auto-refresh";

export const metadata = { title: "Kizuki" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <AutoRefresh seconds={60} />
        {process.env.KIZUKI_DEMO ? (
          <div className="demo-banner">
            Demo — synthetic data, read-only. Kizuki runs locally against your real vault.
          </div>
        ) : null}
        <nav>
          <Link href="/" className="brand">気づき</Link>
          <Link href="/alerts">Alerts</Link>
          <Link href="/shift">Shift</Link>
          <Link href="/people">People</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/teams">Teams</Link>
          <Link href="/followups">Follow-ups</Link>
          <Link href="/days">Days</Link>
          <form action="/search">
            <input name="q" placeholder="Search vault…" aria-label="Search vault" />
          </form>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
