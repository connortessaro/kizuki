import { rowsToPassages } from "./cells";
import type { Extracted } from "./types";

/** Splits CSV text into rows of fields, following the usual quoting rules. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Reads a CSV file as one section, with rows grouped into passages by cell range. */
export function extractCsv(bytes: Uint8Array, baseName: string): Extracted {
  const rows = parseCsv(new TextDecoder().decode(bytes)).map((fields, i) => ({
    row: i + 1,
    cells: fields.map((value, col) => ({ col, value })),
  }));
  return {
    sections: [{ title: baseName, level: 1 }],
    passages: rowsToPassages(rows).map((p) => ({ sectionIndex: 0, text: p.text, location: { cells: p.cells } })),
  };
}
