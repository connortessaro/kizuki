import { askAction, runAsk } from "./actions";

export const dynamic = "force-dynamic";

type Citation = {
  source_path: string;
  title: string | null;
  doc_kind: string;
  is_synthetic: boolean;
  score: number;
  excerpt: string;
};

type Payload = {
  route: string;
  answer: string;
  contains_synthetic: boolean;
  warnings: string[];
  sql: {
    executed_sql: string | null;
    error: string | null;
    columns: string[];
    rows: (string | number | null)[][];
    row_count: number;
    cache_hit: boolean;
  };
  citations: Citation[];
};

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const demo = Boolean(process.env.KIZUKI_DEMO);

  let payload: Payload | null = null;
  let error: string | null = null;
  if (q && !demo) {
    try {
      payload = (await runAsk(q)) as Payload;
    } catch (e) {
      error = e instanceof Error ? e.message : "Ask failed.";
    }
  }

  return (
    <>
      <h1>Ask</h1>
      <p className="muted">
        Questions are answered from the commit warehouse, the document store, or both. The
        generated SQL and every retrieved source are shown so you can check the answer rather
        than trust it.
      </p>

      {demo ? (
        <p className="empty">Ask is disabled in the demo. Run Kizuki locally to query your own data.</p>
      ) : null}

      <form action={askAction} className="capture-form">
        <fieldset disabled={demo}>
          <label htmlFor="ask-question">Question</label>
          <input
            id="ask-question"
            name="question"
            type="text"
            defaultValue={q ?? ""}
            placeholder="Why did activity in harbor increase in April 2026?"
            required
          />
          <button type="submit">Ask</button>
        </fieldset>
      </form>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {payload ? (
        <section className="ask-result">
          <p className="muted">
            Route: <strong>{payload.route}</strong>
            {payload.sql.cache_hit ? " · SQL served from cache" : null}
          </p>

          {payload.contains_synthetic ? (
            <p className="form-error" role="note">
              Some sources below are generated demo records, not real meetings. Commit figures are
              real; discussion and decisions are fabricated.
            </p>
          ) : null}

          <h2>Answer</h2>
          {payload.answer.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}

          {payload.warnings.length ? (
            <ul className="muted">
              {payload.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          {payload.sql.executed_sql ? (
            <>
              <h2>Generated SQL</h2>
              <pre>
                <code>{payload.sql.executed_sql}</code>
              </pre>
            </>
          ) : null}

          {payload.sql.error ? <p className="form-error">{payload.sql.error}</p> : null}

          {payload.sql.row_count ? (
            <>
              <h2>Result ({payload.sql.row_count} rows)</h2>
              <table>
                <thead>
                  <tr>
                    {payload.sql.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.sql.rows.slice(0, 25).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{String(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {payload.citations.length ? (
            <>
              <h2>Sources</h2>
              <ul className="citations">
                {payload.citations.map((c) => (
                  <li key={c.source_path + c.score}>
                    <span className={c.is_synthetic ? "badge badge-synthetic" : "badge badge-real"}>
                      {c.is_synthetic ? "synthetic" : "real"}
                    </span>{" "}
                    <strong>{c.title ?? c.source_path}</strong>{" "}
                    <span className="muted">
                      {c.doc_kind} · similarity {c.score.toFixed(3)}
                    </span>
                    <p className="muted">{c.excerpt}</p>
                    <code className="muted">{c.source_path}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
