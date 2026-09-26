/** Turns a 0-based column number into spreadsheet letters: 0 is A, 26 is AA. */
export function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Turns spreadsheet letters back into a 0-based column number. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One row of a sheet: its 1-based row number and its cells by column. Empty cells may be included; {@link rowsToPassages} skips them. */
export interface Row {
  /** The row's number in the sheet, starting at 1. */
  row: number;
  /** The row's cells, each with its column number (starting at 0) and its text. */
  cells: { col: number; value: string }[];
}

/** Groups rows into passages of at most `maxRows` rows and about `maxChars` characters, each with its cell range. */
export function rowsToPassages(rows: Row[], maxRows = 15, maxChars = 900): { text: string; cells: string }[] {
  const out: { text: string; cells: string }[] = [];
  let group: Row[] = [];
  let size = 0;
  const flush = () => {
    if (group.length === 0) return;
    const cols = group.flatMap((r) => r.cells.map((c) => c.col));
    const first = group[0]!.row;
    const last = group[group.length - 1]!.row;
    out.push({
      text: group.map((r) => r.cells.map((c) => c.value).join(" | ")).join("\n"),
      cells: `${columnLetters(Math.min(...cols))}${first}:${columnLetters(Math.max(...cols))}${last}`,
    });
    group = [];
    size = 0;
  };
  for (const row of rows) {
    const cells = row.cells.filter((c) => c.value.trim() !== "");
    if (cells.length === 0) continue;
    const line = cells.map((c) => c.value).join(" | ");
    if (group.length >= maxRows || (group.length > 0 && size + line.length + 1 > maxChars)) flush();
    group.push({ row: row.row, cells });
    size += line.length + 1;
  }
  flush();
  return out;
}
