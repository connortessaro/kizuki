import { readFile } from "node:fs/promises";
import type { Format } from "@/lib/events";
import { kizukiHome, storedFilePath } from "@/lib/paths";
import { loadState } from "@/lib/state";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

const TYPES: Record<Format, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** Formats a browser can show safely in a tab. Slides, documents, and workbooks are downloaded. */
const INLINE = new Set<Format>(["pdf", "md", "txt", "csv"]);

/**
 * Serves the original copy of an added file, so you can check a quote against it.
 *
 * @openapi
 * GET /files/{materialId}:
 *   summary: Open an added file
 *   description: >-
 *     Returns the copy of a file you added, byte for byte, from `files/` in the data folder.
 *     Source pages link here, with `#page=N` added for a PDF so the browser opens it at the
 *     quoted page.
 *   parameters:
 *     - name: materialId
 *       in: path
 *       required: true
 *       description: The file's id, as in `mat_` followed by 16 letters and digits.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: The file.
 *       headers:
 *         content-type:
 *           description: >-
 *             Set from the file's format: `application/pdf`; the Office types for pptx, docx,
 *             and xlsx (`application/vnd.openxmlformats-officedocument.…`); or `text/csv`,
 *             `text/markdown`, or `text/plain`, each with `; charset=utf-8`.
 *           schema: { type: string }
 *         content-disposition:
 *           description: >-
 *             `inline` for PDF, markdown, text, and CSV, which a browser can show in a tab, and
 *             `attachment` for slides, documents, and workbooks, which download. Both carry the
 *             file's original name as `filename*=UTF-8''<name>`, with the name percent-encoded.
 *           schema: { type: string, examples: ["inline; filename*=UTF-8''Week%203.pdf"] }
 *       content:
 *         application/octet-stream:
 *           schema: { type: string, contentMediaType: application/octet-stream }
 *     "404":
 *       description: No file has this id. The body is the text `Not found`.
 *       content:
 *         text/plain:
 *           schema: { type: string, const: Not found }
 *     "500":
 *       description: >-
 *         The copy is missing from `files/`, or the log line for the file was changed so that it
 *         points outside `files/` (`storedFilePath` in lib/paths.ts refuses it).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  const home = kizukiHome();
  const material = (await loadState(home)).materials.get(materialId);
  if (!material) return new Response("Not found", { status: 404 });
  const bytes = await readFile(storedFilePath(home, material));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[material.format],
      "content-disposition": `${INLINE.has(material.format) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(material.fileName)}`,
    },
  });
}
