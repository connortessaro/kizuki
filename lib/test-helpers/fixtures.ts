import { strToU8, zipSync } from "fflate";

/** Builds a zip file (the container used by docx, pptx, and xlsx) from file paths and text contents. */
export function makeZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])));
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Builds a small real PDF. Each page is a list of lines drawn top to bottom in Helvetica. */
export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const fontObj = 3 + pages.length * 2;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((lines, i) => {
    const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l, j) => `${j === 0 ? "" : "0 -18 Td "}(${escapePdfText(l)}) Tj`).join(" ")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Builds a minimal docx. Each paragraph has an optional style such as `Heading1`. */
export function makeDocx(paragraphs: { style?: string; text: string }[]): Uint8Array {
  const body = paragraphs
    .map(({ style, text }) => {
      const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
      return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    })
    .join("");
  return makeZip({
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

/** Builds a minimal pptx. Each slide has a title, body lines, and optional speaker notes. */
export function makePptx(slides: { title: string; body: string[]; notes?: string }[]): Uint8Array {
  const ns = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  const files: Record<string, string> = {};
  const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join("");
  files["ppt/presentation.xml"] = `<p:presentation ${ns}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`;
  files["ppt/_rels/presentation.xml.rels"] = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
    .map((_, i) => `<Relationship Id="rId${i + 10}" Target="slides/slide${i + 1}.xml"/>`)
    .join("")}</Relationships>`;
  slides.forEach((slide, i) => {
    const para = (t: string) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
    files[`ppt/slides/slide${i + 1}.xml`] = `<p:sld ${ns}><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody>${para(slide.title)}</p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${slide.body.map(para).join("")}</p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`;
    if (slide.notes) {
      files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`;
      files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = `<p:notes ${ns}><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${para(slide.notes)}</p:txBody></p:sp>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody>${para(String(i + 1))}</p:txBody></p:sp>
      </p:spTree></p:cSld></p:notes>`;
    }
  });
  return makeZip(files);
}

/** Builds a minimal xlsx. Each sheet is a name and rows of cell values; text uses shared strings. */
export function makeXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (s: string) => {
    const at = strings.indexOf(s);
    if (at >= 0) return at;
    strings.push(s);
    return strings.length - 1;
  };
  const col = (i: number) => String.fromCharCode(65 + i);
  const files: Record<string, string> = {};
  sheets.forEach((sheet, s) => {
    const rows = sheet.rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((v, c) =>
              typeof v === "number"
                ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
                : `<c r="${col(c)}${r + 1}" t="s"><v>${stringIndex(v)}</v></c>`,
            )
            .join("")}</row>`,
      )
      .join("");
    files[`xl/worksheets/sheet${s + 1}.xml`] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  files["xl/workbook.xml"] = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((sh, i) => `<sheet name="${sh.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}</Relationships>`;
  files["xl/sharedStrings.xml"] = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
  return makeZip(files);
}
