---
title: Adding material
---

# Adding material

You add course files with `/add <files>`, or by dropping them onto the Kizuki window, which pastes their paths. Kizuki keeps a copy, reads the text out of it, splits the text into passages that remember where they came from, adds them to search, and proposes concepts for you to review.

## What Kizuki reads

{@link lib/extract!formatOf | formatOf} picks the reader from the file name's ending. {@link lib/events!FORMATS | FORMATS} lists the formats.

| Ending | Reader | Sections come from | Each passage remembers |
| --- | --- | --- | --- |
| `.pdf` | {@link lib/extract/pdf!extractPdf | extractPdf} | The PDF's bookmarks (two levels deep) when it has them, otherwise one section per page, titled by the page's first line | The page number |
| `.pptx` | {@link lib/extract/pptx!extractPptx | extractPptx} | One section per slide, titled by the slide title, or "Slide N" | The slide number, and whether it is from the speaker notes |
| `.docx` | {@link lib/extract/docx!extractDocx | extractDocx} | Paragraphs styled as headings (Title, Heading 1 to 6, or an outline level) | The heading above it and the paragraph number |
| `.xlsx` | {@link lib/extract/xlsx!extractXlsx | extractXlsx} | One section per sheet | The sheet name and the cell range, such as `A1:D15` |
| `.csv` | {@link lib/extract/csv!extractCsv | extractCsv} | One section named after the file | The cell range |
| `.md`, `.markdown` | {@link lib/extract/text!extractMarkdown | extractMarkdown} | `#` headings | The heading above it |
| `.txt` | {@link lib/extract/text!extractText | extractText} | One section named after the file | The paragraph number |

Details that change what a quote looks like:

- **PDF.** Kizuki reads the text layer only. A scanned PDF has none, so {@link lib/extract!extract | extract} stops with "no readable text found". A PDF with more than {@link lib/extract/pdf!MAX_PDF_PAGES | MAX_PDF_PAGES} pages is refused, so a file made to hang Kizuki cannot.
- **Slides.** Slide numbers, dates, footers, headers, and picture placeholders are skipped. Table rows become lines with ` | ` between cells. Speaker notes become their own passages, marked as notes.
- **Word.** Tabs and line breaks inside a paragraph are kept. Text before the first heading goes in a section named after the file.
- **Excel.** Rows are grouped into passages of up to 15 rows and about 900 characters ({@link lib/extract/cells!rowsToPassages | rowsToPassages}), cells joined with ` | `. {@link lib/extract/xlsx!formatNumber | formatNumber} shows numbers the way the sheet shows them: dates as `2024-10-01`, percentages with `%`, and fixed decimals, so a quote reads like the sheet.
- **CSV.** {@link lib/extract/csv!parseCsv | parseCsv} follows the usual quoting rules, including `""` for a quote mark inside a field.
- **Markdown.** {@link lib/extract/text!stripInlineMarkdown | stripInlineMarkdown} removes formatting marks (links, bold, code marks, list bullets, `>`), so quotes match the words alone. Code blocks are kept as text.

Slides, Word files, and workbooks are zip files of XML. {@link lib/extract/zip!openZip | openZip} unpacks only the XML parts and refuses a file whose text parts unpack past the {@link lib/extract/zip!ZIP_LIMITS | ZIP_LIMITS}, so a small file that unpacks to gigabytes cannot use up your computer's memory.

### What Kizuki does not read

Jupyter notebooks (`.ipynb`), images, scanned PDFs, audio, video, `.doc`, `.ppt`, `.xls`, and other formats are refused when you add them, with "Kizuki can't read .ipynb files yet" and the list of formats it does read ({@link lib/commands!addMaterial | addMaterial}). To study a notebook today, export it to markdown or PDF first. Text recognition for images and scans is planned for a later version.

## From adding a file to review

1. **Add.** `/add` or a dropped path reads the file and calls {@link lib/commands!addMaterial | addMaterial}. It refuses an unknown format and a file whose SHA-256 fingerprint matches a file already in the course (unless that one failed). It copies the bytes to `files/<materialId><ending>` in the data folder and records `material.added` in `materials.jsonl`. {@link tui/paths!splitPaths | splitPaths} reads the forms a terminal pastes: quoted paths, spaces escaped with a backslash, and `~` for your home folder.
2. **Processing starts** in the background while you keep typing. Files go one at a time, and the line under the input says which file Kizuki is reading. {@link lib/run!processMaterial | processMaterial} runs the steps below in order. Each step is safe to run twice: it checks the logs before it writes.
3. **Read.** {@link lib/materialFlow!readMaterial | readMaterial} runs the reader, then {@link lib/extract!toRecords | toRecords} gives every section and passage an id made from the file's id and its position ({@link lib/ids!stableId | stableId}), so reading the same file again gives the same ids. The passages are written once to `passages.jsonl`.
4. **Search.** {@link lib/materialFlow!indexMaterial | indexMaterial} adds the passages to the search file with their meaning numbers (see [Passages and sentences](./passages-and-sentences.md)).
5. **Concepts.** {@link lib/materialFlow!proposeForMaterial | proposeForMaterial} proposes concepts: one for every real heading, made in plain code by {@link lib/concepts!headingConcepts | headingConcepts}, then smaller ideas from the model, checked by {@link lib/concepts!validateConceptReply | validateConceptReply}. The model may also point at sentences it cannot read; each becomes a "what does this mean?" question for you. See [The model never writes facts](./the-model-never-writes-facts.md).
6. **Your review.** Processing stops here, and Kizuki says how many concepts it proposed. The file waits with status `review` in the log until you type `/review`. See [Nothing is saved without your OK](./nothing-saved-without-your-ok.md).
7. **Links.** After you confirm or drop the concepts, {@link lib/run!finishMaterialReview | finishMaterialReview} records the review and {@link lib/materialFlow!proposeLinksForMaterial | proposeLinksForMaterial} asks the model which confirmed concepts need which others first.

Each file's status comes from {@link lib/state!MaterialStatus | MaterialStatus}: waiting, reading, indexing, proposing, review, linking, done, or failed. A failure records the model's or the reader's message ({@link lib/materialFlow!failMaterial | failMaterial}), and Kizuki prints it with the file's name. Add the file again to try again.

If you quit while a file is being read, nothing is lost. When Kizuki starts, {@link lib/run!resumeUnfinished | resumeUnfinished} finds files left in waiting, reading, indexing, proposing, or linking and finishes them, skipping the steps the logs show are done.
