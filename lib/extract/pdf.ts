import { extractText, getDocumentProxy } from "unpdf";
import { chunkParagraphs } from "./chunk";
import type { Extracted, ExtractedSection } from "./types";

interface OutlineEntry {
  title: string;
  level: number;
  page: number;
}

type Proxy = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineItem = { title: string; dest: unknown; items?: OutlineItem[] };

async function readOutline(pdf: Proxy): Promise<OutlineEntry[]> {
  const outline = (await pdf.getOutline().catch(() => null)) as OutlineItem[] | null;
  if (!outline || outline.length === 0) return [];
  const out: OutlineEntry[] = [];
  const visit = async (items: OutlineItem[], level: number) => {
    for (const item of items) {
      try {
        const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref) out.push({ title: item.title.trim(), level, page: (await pdf.getPageIndex(ref)) + 1 });
      } catch {
        // An outline entry that points nowhere is skipped; the pages still get read.
      }
      if (level < 2 && item.items?.length) await visit(item.items, level + 1);
    }
  };
  await visit(outline, 1);
  return out.filter((e) => e.title).sort((a, b) => a.page - b.page);
}

function firstLine(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}

/** The most pages Kizuki reads from one PDF: far more than any textbook, so a file made to hang it is refused. */
export const MAX_PDF_PAGES = 3000;

/**
 * Reads the text layer of a PDF, page by page. A PDF with more than `maxPages` pages is refused.
 * Sections come from the PDF's outline (bookmarks) when it has one, otherwise one section per page
 * titled by the page's first line.
 */
export async function extractPdf(bytes: Uint8Array, maxPages = MAX_PDF_PAGES): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  if (pdf.numPages > maxPages) {
    throw new Error(`this PDF has ${pdf.numPages} pages; Kizuki reads at most ${maxPages}. Split it into smaller files, such as one per chapter.`);
  }
  const { text: pages } = await extractText(pdf, { mergePages: false });
  const outline = await readOutline(pdf);

  const sections: ExtractedSection[] = [];
  const pageSection: number[] = [];
  if (outline.length > 0) {
    const lead = outline[0]!.page > 1 ? 1 : 0;
    if (lead) sections.push({ title: firstLine(pages[0] ?? "") || "Start", level: 1 });
    for (const entry of outline) sections.push({ title: entry.title, level: entry.level, heading: true });
    pages.forEach((_, i) => {
      let index = 0;
      outline.forEach((entry, j) => {
        if (entry.page <= i + 1) index = j + lead;
      });
      pageSection.push(index);
    });
  } else {
    pages.forEach((text, i) => {
      sections.push({ title: firstLine(text) || `Page ${i + 1}`, level: 1 });
      pageSection.push(i);
    });
  }

  const passages = pages.flatMap((text, i) =>
    chunkParagraphs(text.split(/\n\s*\n/).map((p) => ({ text: p, location: { page: i + 1 } }))).map((chunk) => ({
      sectionIndex: pageSection[i]!,
      text: chunk.text,
      location: chunk.location,
    })),
  );
  return { sections, passages };
}
