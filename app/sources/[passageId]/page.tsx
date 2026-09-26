import Link from "next/link";
import { notFound } from "next/navigation";
import { addCorrectionAction } from "../../actions";
import { Messages } from "../../components/Messages";
import { SubmitButton } from "../../components/SubmitButton";
import { loadPageData, passageLabel } from "@/lib/pageData";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

/**
 * One passage of your material in context, with your corrections and a form to add one.
 *
 * @openapi
 * GET /sources/{passageId}:
 *   summary: One passage of your material
 *   parameters:
 *     - name: passageId
 *       in: path
 *       required: true
 *       description: The passage id, as in `psg_` and 16 letters and digits.
 *       schema: { type: string }
 *     - name: note
 *       in: query
 *       required: false
 *       description: >-
 *         The id of a message a form action left for this page, such as "Settings saved." or an
 *         error. Only ids this running Kizuki made show anything; any other value is ignored.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: The page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "404":
 *       description: No passage has this id. The "Not found" page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "500":
 *       description: >-
 *         Kizuki could not read your data, for example because a log line is broken. The page
 *         shows "Something went wrong"; the full message, with the file and line, is printed
 *         where Kizuki runs.
 */
export default async function SourcePage({ params, searchParams }: { params: Promise<{ passageId: string }>; searchParams: Promise<{ note?: string }> }) {
  const { passageId } = await params;
  const messages = await searchParams;
  const data = await loadPageData();
  const passage = data.passages.get(passageId);
  if (!passage) notFound();
  const material = data.state.materials.get(passage.materialId);
  const siblings = [...data.passages.values()].filter((p) => p.materialId === passage.materialId).sort((a, b) => a.ordinal - b.ordinal);
  const index = siblings.findIndex((p) => p.passageId === passageId);
  const before = siblings[index - 1];
  const after = siblings[index + 1];
  const corrections = data.state.corrections.filter((c) => c.passageId === passageId);
  const readings = [...data.state.clarifications.values()].filter((c) => c.passageId === passageId && c.answer);
  const fileLink = material ? `/files/${material.materialId}${material.format === "pdf" && passage.location.page ? `#page=${passage.location.page}` : ""}` : null;

  return (
    <>
      <Messages {...messages} />
      <p className="eyebrow">
        {material ? <Link href={`/courses/${material.courseId}`}>{data.state.courses.get(material.courseId)?.name}</Link> : null} · source
      </p>
      <h1>{passageLabel(data, passageId)}</h1>
      {fileLink ? (
        <p>
          <a href={fileLink} target="_blank">
            Open the original file{material?.format === "pdf" ? " at this page" : ""} →
          </a>
        </p>
      ) : null}

      {before ? <div className="passage muted small">{before.text}</div> : null}
      <div className="passage focus" style={{ margin: "0.6rem 0" }}>
        {passage.text}
      </div>
      {after ? <div className="passage muted small">{after.text}</div> : null}

      {corrections.length > 0 || readings.length > 0 ? (
        <>
          <h2>Your notes on this passage</h2>
          {corrections.map((c) => (
            <div key={c.correctionId} className="card small">
              <strong>Correction:</strong> “{c.quote}” should be “{c.correction}”.{c.note ? <span className="muted"> {c.note}</span> : null}
            </div>
          ))}
          {readings.map((c) => (
            <div key={c.clarificationId} className="card small">
              <strong>Your reading of “{c.quote}”:</strong> {c.answer}
            </div>
          ))}
        </>
      ) : null}

      <h2>Correct this passage</h2>
      <p className="muted small">If the material is wrong (a typo, or your professor corrected it in class), record your version. From then on your version wins.</p>
      <form action={addCorrectionAction.bind(null, passageId)} className="card stack">
        <label>
          The wrong text, copied exactly from the passage
          <input type="text" name="quote" required />
        </label>
        <label>
          Your version
          <input type="text" name="correction" required />
        </label>
        <label>
          Note (optional)
          <input type="text" name="note" placeholder="For example: corrected in lecture on Sept 12" />
        </label>
        <SubmitButton className="secondary" pending="Saving…">
          Save correction
        </SubmitButton>
      </form>
    </>
  );
}
