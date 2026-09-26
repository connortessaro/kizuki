import { posix } from "node:path";
import { chunkParagraphs } from "./chunk";
import type { Extracted, ExtractedPassage, ExtractedSection } from "./types";
import { childrenNamed, descendants, find, findAll, parseXml, textOf, type XNode } from "./xml";
import { openZip, resolveTarget, zipText, type ZipFiles } from "./zip";

const SKIP_PLACEHOLDERS = new Set(["sldNum", "dt", "ftr", "sldImg", "hdr"]);

function relationships(files: ZipFiles, relsPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const xml = zipText(files, relsPath);
  if (!xml) return map;
  for (const rel of findAll(parseXml(xml), "Relationship")) {
    if (rel.attrs.Id && rel.attrs.Target) map.set(rel.attrs.Id, rel.attrs.Target);
  }
  return map;
}

function relsPathFor(partPath: string): string {
  return posix.join(posix.dirname(partPath), "_rels", `${posix.basename(partPath)}.rels`);
}

function shapeLines(shape: XNode): string[] {
  return findAll(shape, "a:p")
    .map((p) => textOf(p, "a:t").trim())
    .filter((line) => line.length > 0);
}

function tableLines(frame: XNode): string[] {
  return findAll(frame, "a:tr")
    .map((row) => findAll(row, "a:tc").map((cell) => textOf(cell, "a:t").trim()).filter(Boolean).join(" | "))
    .filter((line) => line.length > 0);
}

function readShapes(tree: XNode): { title: string; lines: string[] } {
  let title = "";
  const lines: string[] = [];
  for (const node of descendants(tree)) {
    if (node.name === "p:sp") {
      const type = find(node, "p:ph")?.attrs.type;
      if (type && SKIP_PLACEHOLDERS.has(type)) continue;
      const text = shapeLines(node);
      if (!title && (type === "title" || type === "ctrTitle")) title = text.join(" ");
      else lines.push(...text);
    } else if (node.name === "p:graphicFrame") {
      lines.push(...tableLines(node));
    }
  }
  return { title, lines };
}

/** Reads a PowerPoint file slide by slide. Each slide is a section; speaker notes are their own passages. */
export function extractPptx(bytes: Uint8Array): Extracted {
  const files = openZip(bytes, "pptx");
  const presentation = zipText(files, "ppt/presentation.xml");
  if (!presentation) throw new Error("not a valid pptx file: ppt/presentation.xml is missing");
  const rels = relationships(files, "ppt/_rels/presentation.xml.rels");
  const slidePaths = findAll(parseXml(presentation), "p:sldId")
    .map((s) => rels.get(s.attrs["r:id"] ?? ""))
    .filter((t): t is string => Boolean(t))
    .map((t) => resolveTarget("ppt", t));

  const sections: ExtractedSection[] = [];
  const passages: ExtractedPassage[] = [];
  slidePaths.forEach((path, i) => {
    const xml = zipText(files, path);
    if (!xml) return;
    const tree = find(parseXml(xml), "p:spTree");
    const { title, lines } = tree ? readShapes(tree) : { title: "", lines: [] };
    const sectionIndex = sections.length;
    const slide = i + 1;
    sections.push(title ? { title, level: 1, heading: true } : { title: `Slide ${slide}`, level: 1 });
    const body = title || lines.length ? lines : [];
    for (const chunk of chunkParagraphs([{ text: body.join("\n"), location: { slide } }])) {
      passages.push({ sectionIndex, text: chunk.text, location: chunk.location });
    }

    const notesTarget = [...relationships(files, relsPathFor(path)).values()].find((t) => t.includes("notesSlide"));
    if (!notesTarget) return;
    const notesXml = zipText(files, resolveTarget(posix.dirname(path), notesTarget));
    const notesTree = notesXml ? find(parseXml(notesXml), "p:spTree") : undefined;
    if (!notesTree) return;
    const notes = childrenNamed(notesTree, "p:sp")
      .filter((sp) => {
        const type = find(sp, "p:ph")?.attrs.type;
        return !type || !SKIP_PLACEHOLDERS.has(type);
      })
      .flatMap(shapeLines);
    for (const chunk of chunkParagraphs([{ text: notes.join("\n"), location: { slide, notes: true } }])) {
      passages.push({ sectionIndex, text: chunk.text, location: chunk.location });
    }
  });
  return { sections, passages };
}
