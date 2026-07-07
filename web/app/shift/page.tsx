import { vaultDir, getShift, copyQueue, formatDateTime } from "../../lib/data.mjs";
import CopyButton from "../copy-button";

export const dynamic = "force-dynamic";

export default async function ShiftPage() {
  const dir = vaultDir();
  const shift = await getShift(dir);
  const queue = await copyQueue(dir);

  return (
    <>
      <h1>Shift</h1>
      <section>
        <h2>Status</h2>
        {shift ? (
          <p className="shift-on">Shift active since {formatDateTime(new Date(shift.started))}.</p>
        ) : (
          <p className="empty">No shift in progress.</p>
        )}
        <p className="muted cli-hint">
          Start or stop from the terminal: <code>./kizuki start</code> · <code>./kizuki stop</code>
        </p>
      </section>

      <section>
        <h2>Copy queue</h2>
        <p className="muted">Drafts ready to paste — Kizuki never sends on your behalf.</p>
        {queue.length ? (
          <ul className="copy-queue">
            {queue.map((item, i) => (
              <li key={`${item.label}-${i}`}>
                <span className="eyebrow">{item.label}</span>
                <div className="draft-block">
                  <pre>{item.text}</pre>
                  <CopyButton text={item.text} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No drafts queued.</p>
        )}
      </section>
    </>
  );
}
