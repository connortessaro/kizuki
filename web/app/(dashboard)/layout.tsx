import Link from "next/link";
import type { ReactNode } from "react";
import AutoRefresh from "./auto-refresh";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
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
        <Link href="/capture">Capture</Link>
        <form action="/search">
          <input name="q" placeholder="Search vault…" aria-label="Search vault" />
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
