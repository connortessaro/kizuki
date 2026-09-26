import { chunkParagraphs, type Paragraph } from "./chunk";
import type { Extracted, ExtractedSection } from "./types";
import { childrenNamed, descendants, find, parseXml, type XNode } from "./xml";
import { openZip, zipText } from "./zip";

function paragraphText(p: XNode): string {
  let out = "";
  for (const n of descendants(p)) {
    if (n.name === "w:t") out += n.children.map((c) => c.text).join("");
    else if (n.name === "w:tab") out += "\t";
    else if (n.name === "w:br" || n.name === "w:cr") out += "\n";
  }
  return out;
}

function styleNames(stylesXml: string | undefined): Map<string, string> {
  const names = new Map<string, string>();
  if (!stylesXml) return names;
  for (const style of descendants(parseXml(stylesXml))) {
    if (style.name !== "w:style") continue;
    const name = find(style, "w:name")?.attrs["w:val"];
    if (style.attrs["w:styleId"] && name) names.set(style.attrs["w:styleId"], name);
  }
  return names;
}

function headingLevel(p: XNode, names: Map<string, string>): number | null {
  const pPr = childrenNamed(p, "w:pPr")[0];
  if (!pPr) return null;
  const outline = find(pPr, "w:outlineLvl")?.attrs["w:val"];
  if (outline !== undefined && Number(outline) < 9) return Math.min(Number(outline) + 1, 6);
  const styleId = find(pPr, "w:pStyle")?.attrs["w:val"];
  if (!styleId) return null;
  const name = names.get(styleId) ?? styleId;
  if (/^title$/i.test(name)) return 1;
  const match = /^heading\s*(\d)$/i.exec(name);
  return match ? Math.min(Number(match[1]), 6) : null;
}

function* paragraphs(node: XNode): Generator<XNode> {
  for (const child of node.children) {
    if (child.name === "w:p") yield child;
    else yield* paragraphs(child);
  }
}

/** Reads a Word document. Headings (by style or outline level) become sections. */
export function extractDocx(bytes: Uint8Array, baseName: string): Extracted {
  const files = openZip(bytes, "docx");
  const documentXml = zipText(files, "word/document.xml");
  if (!documentXml) throw new Error("not a valid docx file: word/document.xml is missing");
  const names = styleNames(zipText(files, "word/styles.xml"));
  const body = find(parseXml(documentXml), "w:body");
  if (!body) throw new Error("not a valid docx file: the document has no body");

  const sections: ExtractedSection[] = [];
  const bySection: Paragraph[][] = [];
  let index = 0;
  for (const p of paragraphs(body)) {
    const text = paragraphText(p).trim();
    const level = headingLevel(p, names);
    if (level !== null && text) {
      sections.push({ title: text, level, heading: true });
      bySection.push([]);
    } else if (text) {
      if (sections.length === 0) {
        sections.push({ title: baseName, level: 1 });
        bySection.push([]);
      }
      const sectionIndex = sections.length - 1;
      bySection[sectionIndex]!.push({
        text,
        location: { heading: sections[sectionIndex]!.title, paragraph: index },
        group: String(sectionIndex),
      });
    }
    index += 1;
  }
  const passages = bySection.flatMap((paras, sectionIndex) =>
    chunkParagraphs(paras).map((chunk) => ({ sectionIndex, text: chunk.text, location: chunk.location })),
  );
  return { sections, passages };
}
