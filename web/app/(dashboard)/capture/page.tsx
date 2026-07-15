import { CAPTURE_KINDS, ENTITY_TYPES } from "../../../lib/api.mjs";
import { captureAction } from "./actions";

export const dynamic = "force-dynamic";

const CAPTURED_RE = /^cap_[0-9a-f-]+$/;

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ captured?: string; error?: string }>;
}) {
  const { captured, error } = await searchParams;
  const demo = Boolean(process.env.KIZUKI_DEMO);
  const capturedId = captured && CAPTURED_RE.test(captured) ? captured : null;
  return (
    <>
      <h1>Capture</h1>
      <p className="muted">
        Record a correction, decision, hypothesis, or question. Captures go to your local Kizuki
        daemon over the authenticated API — nothing is sent anywhere else.
      </p>
      {capturedId ? (
        <p className="form-success" role="status">
          Captured {capturedId}.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {demo ? (
        <p className="empty">Capture is disabled in the demo. Run Kizuki locally to record evidence.</p>
      ) : null}
      <form action={captureAction} className="capture-form">
        <fieldset disabled={demo}>
          <label htmlFor="capture-text">Text</label>
          <textarea
            id="capture-text"
            name="text"
            rows={5}
            required
            placeholder="What did you notice?"
          />

          <label htmlFor="capture-kind">Kind</label>
          <select id="capture-kind" name="kind" defaultValue="note">
            {CAPTURE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>

          <label htmlFor="capture-entity-type">Entity type (optional)</label>
          <select id="capture-entity-type" name="entityType" defaultValue="">
            <option value="">none</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <label htmlFor="capture-entity-name">Entity name (optional)</label>
          <input id="capture-entity-name" name="entityName" type="text" placeholder="e.g. checkout-v2" />

          <button type="submit">Capture</button>
        </fieldset>
      </form>
      <p className="muted capture-privacy">
        First slice: every capture stays private to you on this machine. Kizuki observes and advises
        — it never sends messages or takes action.
      </p>
    </>
  );
}
