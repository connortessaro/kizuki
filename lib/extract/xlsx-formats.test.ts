import { describe, expect, it } from "vitest";
import { makeZip } from "../test-helpers/fixtures";
import { extract } from "./index";

// A workbook with number formats, the way Excel saves them: dates are day counts and
// percentages are fractions, and a style says how to show each.
function workbook(cells: { v: number; s: number }[]): Uint8Array {
  const row = cells.map((c, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${c.s}"><v>${c.v}</v></c>`).join("");
  return makeZip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Grades" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${row}</row></sheetData></worksheet>`,
    "xl/styles.xml": `<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
      <cellXfs count="7"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/><xf numFmtId="10"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="2"/></cellXfs></styleSheet>`,
  });
}

describe("xlsx cells as they are shown in Excel", () => {
  it("writes dates as dates and percentages as percentages, not the numbers Excel stores", async () => {
    const out = await extract("xlsx", workbook([{ v: 45566, s: 1 }, { v: 0.12, s: 2 }, { v: 0.1234, s: 3 }, { v: 45566, s: 4 }, { v: 0.456, s: 5 }, { v: 3.14159, s: 6 }, { v: 7, s: 0 }]), "grades.xlsx");
    expect(out.passages[0]!.text).toBe("2024-10-01 | 12% | 12.34% | 2024-10-01 | 45.6% | 3.14 | 7");
  });
});
