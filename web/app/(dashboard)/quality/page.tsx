import { qualityReport } from "../../../../lib/askCommands.mjs";
import { vaultDir } from "../../../lib/data.mjs";

export const dynamic = "force-dynamic";

type Row = { check_name: string; severity: string; issues: number; total_magnitude: number };
type Issue = {
  check_name: string;
  severity: string;
  subject_kind: string;
  subject: string;
  detail: string;
  magnitude: number;
};
type Payload = { summary: Row[]; issues: Issue[] };

const SEVERITY_ORDER = ["error", "warn", "info"];

export default async function QualityPage() {
  const demo = Boolean(process.env.KIZUKI_DEMO);
  let payload: Payload | null = null;
  let error: string | null = null;

  if (!demo) {
    try {
      payload = (await qualityReport(vaultDir())) as Payload;
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load the quality report.";
    }
  }

  const errorCount = payload?.summary.filter((r) => r.severity === "error").length ?? 0;

  return (
    <>
      <h1>Data quality</h1>
      <p className="muted">
        Checks run against the current warehouse build. Severity is about what an issue does to an
        answer: <strong>error</strong> means a query can return a wrong number, <strong>warn</strong>{" "}
        means a number is explainable but surprising, <strong>info</strong> is worth knowing and
        nothing more.
      </p>

      {demo ? <p className="empty">Quality checks are disabled in the demo.</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {payload ? (
        <>
          <p className={errorCount ? "form-error" : "form-success"} role="status">
            {errorCount
              ? `${errorCount} check${errorCount === 1 ? "" : "s"} at error severity.`
              : "No checks at error severity."}
          </p>

          <h2>Summary</h2>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Severity</th>
                <th>Issues</th>
                <th>Magnitude</th>
              </tr>
            </thead>
            <tbody>
              {payload.summary.map((row) => (
                <tr key={row.check_name}>
                  <td>
                    <code>{row.check_name}</code>
                  </td>
                  <td>
                    <span className={`badge badge-${row.severity}`}>{row.severity}</span>
                  </td>
                  <td>{row.issues}</td>
                  <td>{row.total_magnitude}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {SEVERITY_ORDER.map((severity) => {
            const rows = payload.issues.filter((i) => i.severity === severity);
            if (!rows.length) return null;
            return (
              <section key={severity}>
                <h2>
                  {severity} ({rows.length})
                </h2>
                <ul className="citations">
                  {rows.map((issue) => (
                    <li key={`${issue.check_name}:${issue.subject}`}>
                      <span className={`badge badge-${issue.severity}`}>{issue.check_name}</span>{" "}
                      <strong>{issue.subject}</strong>{" "}
                      <span className="muted">({issue.subject_kind})</span>
                      <p className="muted">{issue.detail}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      ) : null}
    </>
  );
}
