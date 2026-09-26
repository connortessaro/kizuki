import { columnIndex, rowsToPassages, type Row } from "./cells";
import type { Extracted, ExtractedPassage, ExtractedSection } from "./types";
import { childrenNamed, find, findAll, parseXml, type XNode } from "./xml";
import { openZip, resolveTarget, zipText } from "./zip";

function stringItemText(si: XNode): string {
  let out = "";
  const visit = (node: XNode) => {
    for (const child of node.children) {
      if (child.name === "rPh") continue;
      if (child.name === "t") out += child.children.map((c) => c.text).join("");
      else visit(child);
    }
  };
  visit(si);
  return out;
}

/** Excel's built-in number formats that change how a number looks. The rest show it as stored. */
const BUILT_IN_FORMATS: Record<number, string> = {
  1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%",
  14: "yyyy-mm-dd", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy-mm-dd h:mm",
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0",
};

/** The number format of each cell style, from xl/styles.xml. */
function styleFormats(stylesXml: string | undefined): string[] {
  if (!stylesXml) return [];
  const tree = parseXml(stylesXml);
  const custom = new Map(findAll(tree, "numFmt").map((f) => [Number(f.attrs.numFmtId), f.attrs.formatCode ?? ""]));
  const xfs = find(tree, "cellXfs");
  return (xfs ? childrenNamed(xfs, "xf") : []).map((xf) => {
    const id = Number(xf.attrs.numFmtId ?? 0);
    return custom.get(id) ?? BUILT_IN_FORMATS[id] ?? "";
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Shows a stored number the way its format shows it in Excel, so a quote reads like the
 * sheet: dates as dates (written 2024-10-01, whatever order the sheet uses), percentages
 * with their % sign, and a fixed number of decimals. Other numbers stay as stored.
 */
export function formatNumber(stored: string, format: string): string {
  const value = Number(stored);
  if (!format || stored === "" || !Number.isFinite(value)) return stored;
  const plain = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  const decimals = /\.(0+)/.exec(plain)?.[1]?.length ?? 0;
  if (plain.includes("%")) return `${(value * 100).toFixed(decimals)}%`;
  const hasDate = /[yd]/i.test(plain) || /m{3,}/i.test(plain);
  const hasTime = /[hs]/i.test(plain);
  if (hasDate || hasTime) {
    const at = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
    const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
    const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}${/s/i.test(plain) ? `:${pad(at.getUTCSeconds())}` : ""}`;
    return hasDate && hasTime ? `${date} ${time}` : hasDate ? date : time;
  }
  if (/[0#]/.test(plain)) {
    const fixed = value.toFixed(decimals);
    return plain.includes(",") ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
  }
  return stored;
}

function cellValue(cell: XNode, shared: string[], formats: string[] = []): string {
  const type = cell.attrs.t;
  const v = find(cell, "v")?.children.map((c) => c.text).join("") ?? "";
  if (type === "s") return shared[Number(v)] ?? "";
  if (type === "inlineStr") {
    const is = find(cell, "is");
    return is ? stringItemText(is) : "";
  }
  if (type === "b") return v === "1" ? "TRUE" : "FALSE";
  if (type === "str" || type === "e") return v;
  return formatNumber(v, formats[Number(cell.attrs.s ?? 0)] ?? "");
}

/**
 * Reads an Excel workbook sheet by sheet. Each sheet is a section; rows are grouped into
 * passages with their cell range. Numbers are shown as their format shows them ({@link formatNumber}).
 */
export function extractXlsx(bytes: Uint8Array): Extracted {
  const files = openZip(bytes, "xlsx");
  const workbook = zipText(files, "xl/workbook.xml");
  if (!workbook) throw new Error("not a valid xlsx file: xl/workbook.xml is missing");
  const rels = new Map<string, string>();
  const relsXml = zipText(files, "xl/_rels/workbook.xml.rels");
  if (relsXml) for (const r of findAll(parseXml(relsXml), "Relationship")) rels.set(r.attrs.Id ?? "", r.attrs.Target ?? "");
  const sharedXml = zipText(files, "xl/sharedStrings.xml");
  const shared = sharedXml ? findAll(parseXml(sharedXml), "si").map(stringItemText) : [];
  const formats = styleFormats(zipText(files, "xl/styles.xml"));

  const sections: ExtractedSection[] = [];
  const passages: ExtractedPassage[] = [];
  for (const sheet of findAll(parseXml(workbook), "sheet")) {
    const name = sheet.attrs.name ?? `Sheet ${sections.length + 1}`;
    const target = rels.get(sheet.attrs["r:id"] ?? "");
    const xml = target ? zipText(files, resolveTarget("xl", target)) : undefined;
    if (!xml) continue;
    const data = find(parseXml(xml), "sheetData");
    const rows: Row[] = (data ? childrenNamed(data, "row") : []).map((row, i) => ({
      row: Number(row.attrs.r ?? i + 1),
      cells: childrenNamed(row, "c").map((cell, j) => {
        const ref = /^([A-Z]+)/i.exec(cell.attrs.r ?? "")?.[1];
        return { col: ref ? columnIndex(ref) : j, value: cellValue(cell, shared, formats) };
      }),
    }));
    const sectionIndex = sections.length;
    sections.push({ title: name, level: 1 });
    for (const p of rowsToPassages(rows)) passages.push({ sectionIndex, text: p.text, location: { sheet: name, cells: p.cells } });
  }
  return { sections, passages };
}
